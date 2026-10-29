#!/usr/bin/env bash
# A workflow SHA is evidence only when both the source and installed build match it.
set -euo pipefail
umask 077
SHA=${1:-}
DIGEST=${2:-}
EXPECTED_CONFIG=${3:-}
ARCHIVE_BYTES=${4:-}
UNPACKED_BYTES=${5:-}
EXPECTED_LAYERS_HASH=${6:-}
[[ "$DIGEST" =~ ^[0-9a-f]{64}$ && "$EXPECTED_CONFIG" =~ ^sha256:[0-9a-f]{64}$ && "$EXPECTED_LAYERS_HASH" =~ ^[0-9a-f]{64}$ && "$ARCHIVE_BYTES" =~ ^[0-9]{1,12}$ && "$UNPACKED_BYTES" =~ ^[0-9]{1,12}$ ]] || { echo 'Invalid streamed image metadata' >&2; exit 1; }
(( ARCHIVE_BYTES > 0 && UNPACKED_BYTES > 0 )) || { echo 'Image sizes must be positive' >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full staging candidate SHA required' >&2; exit 1; }
REPO=${ZJ_HK_REPO:-/opt/zenithjoy/repo}
RELEASES=${ZJ_STAGING_RELEASES:-/opt/zenithjoy/staging-api/releases}
LOCK=${ZJ_STAGING_LOCK:-/opt/zenithjoy/staging-api/deploy.lock}
SERVICE=zenithjoy-api-staging
mkdir -p "$RELEASES" "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || { echo 'Another staging API deployment holds the host lock' >&2; exit 1; }
# The image archive is streamed, but Docker may buffer it during load. Reserve
# the complete archive, all unpacked layers and 512 MiB, without assuming sharing.
DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}')
[[ $(df -P "$RELEASES" | awk 'NR==2 {print $1}') == "$(df -P "$DOCKER_ROOT" | awk 'NR==2 {print $1}')" ]] || { echo 'Docker and staging are on different filesystems' >&2; exit 1; }
AVAILABLE_KB=$(df -Pk "$RELEASES" | awk 'NR==2 {print $4}')
REQUIRED_KB=$(((ARCHIVE_BYTES + UNPACKED_BYTES + 536870912 + 1023) / 1024))
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ && "$AVAILABLE_KB" -ge "$REQUIRED_KB" ]] || { echo 'Insufficient staging disk space for streamed image' >&2; exit 1; }
SOURCE="$RELEASES/$SHA/source"
if [[ ! -f "$SOURCE/deploy/docker-compose.staging-api.yml" ]]; then
  # Shared with dashboard staging and production source_for; serialize only fetch.
  git -C "$REPO" cat-file -e "$SHA^{commit}" 2>/dev/null || \
    flock "$REPO/.git/hk-source-fetch.lock" git -C "$REPO" fetch origin main
  TEMP=$(mktemp -d "$RELEASES/source.XXXXXX")
  git -C "$REPO" archive "$SHA" | tar -x -C "$TEMP"
  test -f "$TEMP/deploy/docker-compose.staging-api.yml"
  mkdir -p "$RELEASES/$SHA"
  mv "$TEMP" "$SOURCE"
fi
# A cached source tree must not silently change deployment settings.
git -C "$REPO" show "$SHA:deploy/docker-compose.staging-api.yml" | cmp - "$SOURCE/deploy/docker-compose.staging-api.yml" || { echo 'Cached compose differs from candidate' >&2; exit 1; }
# Read the existing compose project, without mutating the shared host checkout.
PROJECT=$(docker inspect "$SERVICE" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
PROJECT=${PROJECT:-repo}
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid compose project' >&2; exit 1; }
IMAGE="zenithjoy-api-staging:$SHA"
printf '{"services":{"zenithjoy-api-staging":{"image":"%s"}}}\n' "$IMAGE" > "$RELEASES/$SHA/image.json"
compose() {
  docker compose -p "$PROJECT" -f "$SOURCE/deploy/docker-compose.staging-api.yml" \
    -f "$RELEASES/$SHA/image.json" "$@"
}
# CI sends a gzip-compressed docker-save stream. Only its SHA digest is stored;
# a mismatch, wrong config or wrong architecture aborts before migration.
PREVIOUS_IMAGE=$(docker inspect "$SERVICE" --format '{{.Image}}')
[[ "$PREVIOUS_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Cannot identify current staging image' >&2; exit 1; }
docker image inspect "$PREVIOUS_IMAGE" >/dev/null
PREVIOUS_SHA=$(curl --max-time 10 -fsS http://127.0.0.1:5201/health | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',{}).get('sha',''))")
[[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Cannot identify previous staging SHA' >&2; exit 1; }
PREVIOUS_FILES=$(docker inspect "$SERVICE" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
IFS=',' read -r -a PREVIOUS_CONFIG <<< "$PREVIOUS_FILES"
[[ ${#PREVIOUS_CONFIG[@]} -gt 0 ]] || { echo 'Previous compose configuration unavailable' >&2; exit 1; }
for file in "${PREVIOUS_CONFIG[@]}"; do [[ -f "$file" ]] || { echo 'Previous compose file unavailable' >&2; exit 1; }; done
ROLLBACK_OVERRIDE=$(mktemp "$RELEASES/.rollback.XXXXXX")
printf '{"services":{"zenithjoy-api-staging":{"image":"%s"}}}\n' "$PREVIOUS_IMAGE" > "$ROLLBACK_OVERRIDE"
docker tag "$PREVIOUS_IMAGE" "zenithjoy-api-staging:rollback-$SHA"
CHECKSUM=$(mktemp "$RELEASES/.stream-checksum.XXXXXX")
trap 'rm -f "$CHECKSUM" "$ROLLBACK_OVERRIDE"' EXIT
gzip -dc | tee >(sha256sum | awk '{print $1}' > "$CHECKSUM") | docker load
for _ in $(seq 1 20); do [[ -s "$CHECKSUM" ]] && break; sleep 1; done
[[ $(cat "$CHECKSUM") == "$DIGEST" ]] || { echo 'Image stream checksum mismatch' >&2; exit 1; }
# Docker backends can expose different .Id values for identical content. Compare
# the config bytes and ordered uncompressed layer identities instead, streaming
# a second docker save directly to Python without an archive on the host.
IDENTITY=$(docker save "$IMAGE" | python3 "$SOURCE/scripts/deploy/staging-image-identity.py" "$IMAGE")
ACTUAL_CONFIG=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["config"])' "$IDENTITY")
ACTUAL_LAYERS_HASH=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["layers_hash"])' "$IDENTITY")
[[ "$ACTUAL_CONFIG" == "$EXPECTED_CONFIG" && "$ACTUAL_LAYERS_HASH" == "$EXPECTED_LAYERS_HASH" ]] || { echo 'Image content identity mismatch' >&2; exit 1; }
LOADED_IMAGE=$(docker image inspect "$IMAGE" --format '{{.Id}}')
[[ "$LOADED_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Loaded image identifier invalid' >&2; exit 1; }
INSPECT_LAYERS_HASH=$(docker image inspect "$IMAGE" --format '{{json .RootFS.Layers}}' | python3 -c 'import hashlib,json,sys; print(hashlib.sha256(json.dumps(json.load(sys.stdin),separators=(",",":")).encode()).hexdigest())')
[[ "$INSPECT_LAYERS_HASH" == "$EXPECTED_LAYERS_HASH" ]] || { echo 'Loaded image layers mismatch' >&2; exit 1; }
[[ $(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]] || { echo 'Image platform mismatch' >&2; exit 1; }
[[ $(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$SHA" ]] || { echo 'Image SHA label mismatch' >&2; exit 1; }
AVAILABLE_KB=$(df -Pk "$RELEASES" | awk 'NR==2 {print $4}')
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ && "$AVAILABLE_KB" -ge 524288 ]] || { echo 'Insufficient staging disk space after build: require 512 MiB free' >&2; exit 1; }
# Archive only the migration sources and TypeScript configuration from the
# exact commit. A prior release source may contain stale untracked node_modules.
MIGRATION_SOURCE=$(mktemp -d "$RELEASES/migration-source.XXXXXX")
trap 'rm -rf "$MIGRATION_SOURCE"; rm -f "$CHECKSUM" "$ROLLBACK_OVERRIDE"' EXIT
git -C "$REPO" archive "$SHA" apps/api/db/migrations apps/api/tsconfig.json tsconfig.base.json | tar -x -C "$MIGRATION_SOURCE"
if find "$MIGRATION_SOURCE" -name node_modules -print -quit | grep -q .; then echo 'Unexpected node_modules in migration archive' >&2; exit 1; fi
# Match both configured connection and PostgreSQL's actual identity before writes.
docker run --rm --network zenithjoy-net --env-file /opt/zenithjoy/staging-api/.env \
  -e NODE_PATH=/repo/node_modules -w /repo/apps/api "$IMAGE" node -e '
const { Pool } = require("pg");
const raw=process.env.DATABASE_URL;
if(process.env.DATABASE_HOST!=="zenithjoy-db-postgres"||process.env.DATABASE_NAME!=="zenithjoy_staging"||process.env.DATABASE_USER!=="zenithjoy"||(process.env.DATABASE_PORT&&process.env.DATABASE_PORT!=="5432"))throw Error("staging runtime database configuration mismatch");
const runtime={host:process.env.DATABASE_HOST,database:process.env.DATABASE_NAME,user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,port:5432};
const connections=[runtime];
if(raw){let u=new URL(raw);if(!["postgres:","postgresql:"].includes(u.protocol)||u.hostname!=="zenithjoy-db-postgres"||(u.port&&u.port!=="5432")||decodeURIComponent(u.pathname.slice(1))!=="zenithjoy_staging"||decodeURIComponent(u.username)!=="zenithjoy")throw Error("staging migration database configuration mismatch");const migration={connectionString:raw}; connections.push(migration);}
(async()=>{for(const config of connections){const p=new Pool(config);try {const r=await p.query("SELECT current_database() AS db, current_user AS usr, inet_server_port() AS port");const x=r.rows[0];if(x.db!=="zenithjoy_staging"||x.usr!=="zenithjoy"||x.port!==5432)throw Error("staging database identity mismatch");} finally {await p.end();}}})().catch(()=>{process.stderr.write("staging database identity check failed\n");process.exitCode=1;});'
# Execute the actual candidate's locked ts-node and dependencies with that
# clean read-only archive: no second npm ci or host-side dependency tree.
docker run --rm --network zenithjoy-net --env-file /opt/zenithjoy/staging-api/.env \
  -e NODE_PATH=/repo/node_modules -e TS_NODE_PROJECT=/source/apps/api/tsconfig.json \
  -e TS_NODE_TRANSPILE_ONLY=1 -v "$MIGRATION_SOURCE:/source:ro" -w /source/apps/api "$IMAGE" \
  node -r /repo/node_modules/ts-node/register/transpile-only /source/apps/api/db/migrations/run-migration.ts
rollback_previous() {
  local -a flags=()
  for file in "${PREVIOUS_CONFIG[@]}"; do flags+=(-f "$file"); done
  flags+=(-f "$ROLLBACK_OVERRIDE")
  if ! docker compose -p "$PROJECT" "${flags[@]}" up -d --no-build --pull never "$SERVICE"; then
    echo 'Previous staging restore failed' >&2; return 1
  fi
  for ((r=0; r<${ZJ_HEALTH_ATTEMPTS:-30}; r++)); do
    local status actual current
    status=$(docker inspect "$SERVICE" --format '{{.State.Health.Status}}' 2>/dev/null || true)
    current=$(docker inspect "$SERVICE" --format '{{.Image}}' 2>/dev/null || true)
    actual=$(curl --max-time 10 -fsS http://127.0.0.1:5201/health 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',{}).get('sha',''))" 2>/dev/null || true)
    if [[ "$status" == healthy && "$current" == "$PREVIOUS_IMAGE" && "$actual" == "$PREVIOUS_SHA" ]]; then
      echo "Previous staging image restored: $PREVIOUS_SHA" >&2; return 0
    fi
    sleep "${ZJ_HEALTH_INTERVAL:-5}"
  done
  echo 'Previous staging restore could not be verified' >&2; return 1
}
if ! compose up -d --no-build --pull never "$SERVICE"; then
  rollback_previous || true
  exit 1
fi
for ((i=0; i<${ZJ_HEALTH_ATTEMPTS:-30}; i++)); do
  STATUS=$(docker inspect "$SERVICE" --format '{{.State.Health.Status}}' 2>/dev/null || true)
  GOT_SHA=$(curl --max-time 10 -fsS http://127.0.0.1:5201/health 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin).get('build',{}).get('sha',''))" 2>/dev/null || true)
  CURRENT_IMAGE=$(docker inspect "$SERVICE" --format '{{.Image}}' 2>/dev/null || true)
  if [[ "$STATUS" == healthy && "$GOT_SHA" == "$SHA" && "$CURRENT_IMAGE" == "$LOADED_IMAGE" ]]; then
    printf '{"target":"api","environment":"staging","sha":"%s","health":"healthy"}\n' "$SHA"
    exit 0
  fi
  sleep "${ZJ_HEALTH_INTERVAL:-5}"
done
echo "Staging runtime health/build SHA verification failed for $SHA" >&2
rollback_previous || true
exit 1
