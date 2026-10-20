#!/usr/bin/env bash
# A workflow SHA is evidence only when both the source and installed build match it.
set -euo pipefail
umask 077
SHA=${1:-}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full staging candidate SHA required' >&2; exit 1; }
REPO=${ZJ_HK_REPO:-/opt/zenithjoy/repo}
RELEASES=${ZJ_STAGING_RELEASES:-/opt/zenithjoy/staging-api/releases}
LOCK=${ZJ_STAGING_LOCK:-/opt/zenithjoy/staging-api/deploy.lock}
SERVICE=zenithjoy-api-staging
mkdir -p "$RELEASES" "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || { echo 'Another staging API deployment holds the host lock' >&2; exit 1; }
SOURCE="$RELEASES/$SHA/source"
if [[ ! -f "$SOURCE/deploy/docker-compose.staging-api.yml" ]]; then
  git -C "$REPO" cat-file -e "$SHA^{commit}" 2>/dev/null || git -C "$REPO" fetch origin main
  TEMP=$(mktemp -d "$RELEASES/source.XXXXXX")
  git -C "$REPO" archive "$SHA" | tar -x -C "$TEMP"
  test -f "$TEMP/deploy/docker-compose.staging-api.yml"
  mkdir -p "$RELEASES/$SHA"
  mv "$TEMP" "$SOURCE"
fi
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
BUILD_SHA="$SHA" compose build "$SERVICE"
# The migration environment is the staging file; it is never inherited from production.
docker run --rm --network zenithjoy-net --env-file /opt/zenithjoy/staging-api/.env \
  -e TS_NODE_TRANSPILE_ONLY=1 -v "$SOURCE:/repo" -w /repo node:20-bookworm-slim \
  sh -c 'npm ci --include=dev --workspace=apps/api --silent && cd apps/api && npx ts-node db/migrations/run-migration.ts'
compose up -d --no-build --pull never "$SERVICE"
for ((i=0; i<${ZJ_HEALTH_ATTEMPTS:-30}; i++)); do
  STATUS=$(docker inspect "$SERVICE" --format '{{.State.Health.Status}}' 2>/dev/null || true)
  GOT_SHA=$(curl --max-time 10 -fsS http://127.0.0.1:5201/health 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin).get('build',{}).get('sha',''))" 2>/dev/null || true)
  if [[ "$STATUS" == healthy && "$GOT_SHA" == "$SHA" ]]; then
    printf '{"target":"api","environment":"staging","sha":"%s","health":"healthy"}\n' "$SHA"
    exit 0
  fi
  sleep "${ZJ_HEALTH_INTERVAL:-5}"
done
echo "Staging runtime health/build SHA verification failed for $SHA" >&2
exit 1
