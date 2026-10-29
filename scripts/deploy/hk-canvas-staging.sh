#!/usr/bin/env bash
# Single-employee staging canvas only. The private token remains on the host.
set -euo pipefail
umask 077
ACTION=${1:-}
SHA=${2:-}
[[ "$ACTION" == deploy || "$ACTION" == rollback ]] || { echo 'Use deploy or rollback' >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full candidate SHA required' >&2; exit 1; }
REPO=${ZJ_CANVAS_REPO:-/opt/zenithjoy/repo}
BASE=${ZJ_CANVAS_BASE:-/opt/zenithjoy/creative-canvas-staging}
RELEASES="$BASE/releases"
ENVFILE="$BASE/.env"
SERVICE=creative-canvas-staging
CONTAINER=zenithjoy-creative-canvas-staging-1
PROJECT=zenithjoy-creative-canvas-staging
mkdir -p "$RELEASES"
exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo 'Another canvas staging deployment holds the lock' >&2; exit 1; }
[[ -f "$ENVFILE" && ! -L "$ENVFILE" ]] || { echo 'Private staging token file not found' >&2; exit 1; }
[[ $(stat -c %a "$ENVFILE") == 600 && $(stat -c %u "$ENVFILE") == 0 ]] || { echo 'Token file must be root-owned mode 600' >&2; exit 1; }
unset ZENITHJOY_CANVAS_TOKEN
ENV_HASH=$(sha256sum "$ENVFILE" | cut -d ' ' -f 1)
SOURCE="$RELEASES/$SHA/source"
# The canvas must never be reachable from the shared application network.
# Require the staging API and allow only this one canvas on the private bridge.
docker network inspect zenithjoy-canvas-staging-net --format '{{json .Containers}}' | python3 -c 'import json,sys; v=json.load(sys.stdin) or {}; names={c["Name"] for c in v.values()}; assert "zenithjoy-api-staging" in names and names <= {"zenithjoy-api-staging","zenithjoy-creative-canvas-staging-1"}, "Unexpected private network membership"'
if [[ "$ACTION" == deploy ]]; then
  # Only deploy commits already present on remote main, including older pinned
  # candidates. Unmerged PR refs cannot reach this staging entry point.
  REMOTE_MAIN=$(flock "$REPO/.git/hk-source-fetch.lock" sh -c 'git -C "$1" fetch origin main && git -C "$1" rev-parse FETCH_HEAD' _ "$REPO")
  [[ "$REMOTE_MAIN" =~ ^[0-9a-f]{40}$ ]]
  git -C "$REPO" cat-file -e "$SHA^{commit}"
  git -C "$REPO" merge-base --is-ancestor "$SHA" "$REMOTE_MAIN" || { echo 'Candidate is not an ancestor of origin main' >&2; exit 1; }
fi
if [[ "$ACTION" == deploy && ! -f "$SOURCE/deploy/docker-compose.creative-canvas-staging.yml" ]]; then
  TEMP=$(mktemp -d "$RELEASES/source.XXXXXX")
  trap 'rm -rf "$TEMP"' EXIT
  git -C "$REPO" archive "$SHA" | tar -x -C "$TEMP"
  test -f "$TEMP/deploy/docker-compose.creative-canvas-staging.yml"
  mkdir -p "$RELEASES/$SHA"
  mv "$TEMP" "$SOURCE"
  trap - EXIT
fi
[[ -f "$SOURCE/deploy/docker-compose.creative-canvas-staging.yml" ]] || { echo 'Release source missing; cannot roll back' >&2; exit 1; }
EXISTING_PROJECT=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
[[ -z "$EXISTING_PROJECT" || "$EXISTING_PROJECT" == "$PROJECT" ]] || { echo 'Existing canvas belongs to another project; refusing takeover' >&2; exit 1; }
if [[ -n "$EXISTING_PROJECT" ]]; then
  PREVIOUS_TAG=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
  PREVIOUS_ID=$(docker inspect "$CONTAINER" --format '{{.Image}}')
  PREVIOUS_SHA=${PREVIOUS_TAG#zenithjoy-creative-canvas-staging:}
  [[ "$PREVIOUS_TAG" == "zenithjoy-creative-canvas-staging:$PREVIOUS_SHA" && "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Existing canvas has an unknown image; refusing takeover' >&2; exit 1; }
  if [[ -f "$RELEASES/$PREVIOUS_SHA/receipt.json" ]]; then
    python3 - "$RELEASES/$PREVIOUS_SHA/receipt.json" "$PREVIOUS_ID" "$ENV_HASH" <<'PYCODE'
import json,sys
r=json.load(open(sys.argv[1])); assert r['image_id']==sys.argv[2] and r['environment_hash']==sys.argv[3], 'Previous image or private environment does not match its receipt'
PYCODE
  else
    # A failed candidate can be retried or replaced by a verified rollback.
    PREVIOUS_REVISION=$(docker image inspect "$PREVIOUS_ID" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    [[ "$PREVIOUS_REVISION" == "$PREVIOUS_SHA" ]] || { echo 'Unverified canvas image lacks candidate provenance' >&2; exit 1; }
  fi
fi
IMAGE="zenithjoy-creative-canvas-staging:$SHA"
OVERRIDE="$RELEASES/$SHA/image.json"
printf '{"services":{"%s":{"image":"%s"}}}\n' "$SERVICE" "$IMAGE" > "$OVERRIDE"
compose() { docker compose --env-file "$ENVFILE" -p "$PROJECT" -f "$SOURCE/deploy/docker-compose.creative-canvas-staging.yml" -f "$OVERRIDE" "$@"; }
compose config -q
if [[ "$ACTION" == deploy && ! -f "$RELEASES/$SHA/receipt.json" ]]; then
  docker build --label "org.opencontainers.image.revision=$SHA" -f "$SOURCE/infrastructure/comfyui/Dockerfile" -t "$IMAGE" "$SOURCE"
else
  [[ -f "$RELEASES/$SHA/receipt.json" ]] || { echo 'Rollback requires a previously verified release receipt' >&2; exit 1; }
  python3 - "$RELEASES/$SHA/receipt.json" "$ENV_HASH" <<'PY'
import json, sys
r=json.load(open(sys.argv[1])); assert r['environment_hash']==sys.argv[2], 'Private environment changed; cannot restore this receipt safely'
PY
fi
IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
if [[ -f "$RELEASES/$SHA/receipt.json" ]]; then
  python3 - "$RELEASES/$SHA/receipt.json" "$IMAGE_ID" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))['image_id']==sys.argv[2], 'Previous image identity differs'
PY
fi
compose up -d --no-build --pull never "$SERVICE"
# Fail if an override or stale container accidentally exposes the canvas.
docker inspect "$CONTAINER" --format '{{json .NetworkSettings.Networks}}' | python3 -c 'import json,sys; v=json.load(sys.stdin) or {}; assert set(v)=={"zenithjoy-canvas-staging-net"}, "Canvas is attached to an unexpected network"'
docker inspect "$CONTAINER" --format '{{json .HostConfig.PortBindings}}' | python3 -c 'import json,sys; assert not json.load(sys.stdin), "Canvas has published host ports"'
docker network inspect zenithjoy-canvas-staging-net --format '{{json .Containers}}' | python3 -c 'import json,sys; v=json.load(sys.stdin) or {}; names={c["Name"] for c in v.values()}; assert names == {"zenithjoy-api-staging","zenithjoy-creative-canvas-staging-1"}, "Unexpected private network membership"'
for ((i=0; i<36; i++)); do
  STATUS=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || true)
  CURRENT_IMAGE=$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true)
  if [[ "$STATUS" == healthy && "$CURRENT_IMAGE" == "$IMAGE_ID" ]] && docker exec "$CONTAINER" python -c "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8188/object_info',timeout=5)); assert all(n in d for n in ('ZenithJoyImage2','ZenithJoyLoadAsset','ZenithJoyChooseAsset','ZenithJoyWan')); assert urllib.request.urlopen('http://127.0.0.1:8188/extensions/zenithjoy/image2-select-wan.json',timeout=5).status == 200"; then
    python3 - "$RELEASES/$SHA/receipt.json.tmp" "$SHA" "$IMAGE_ID" "$ENV_HASH" <<'PY'
import json,sys
with open(sys.argv[1], 'w') as f: json.dump({'sha':sys.argv[2], 'image_id':sys.argv[3], 'environment_hash':sys.argv[4], 'health':'healthy'}, f)
PY
    mv "$RELEASES/$SHA/receipt.json.tmp" "$RELEASES/$SHA/receipt.json"
    echo "Canvas staging healthy; action=$ACTION sha=$SHA image=$IMAGE_ID"
    exit 0
  fi
  sleep 5
done
echo "Canvas staging health verification failed for $SHA; preserve volumes and use a previous verified receipt to roll back" >&2
exit 1
