#!/usr/bin/env bash
# HK API: fixed source, retained images, verified activation and automatic recovery.
# Schema migrations must remain backward compatible; image rollback never undoes data.
set -Eeuo pipefail
umask 077
ACTION=${1:-}
TARGET=${2:-}
REPO=${ZJ_HK_REPO:-/opt/zenithjoy/repo}
RELEASES=${ZJ_HK_RELEASES:-/opt/zenithjoy/prod-api/releases}
LOCK=${ZJ_HK_LOCK:-/opt/zenithjoy/prod-api/release.lock}
SERVICE=zenithjoy-api-prod
HEALTH_URL=${ZJ_HK_HEALTH_URL:-http://127.0.0.1:5200/health}
fail() { echo "HK API release refused: $*" >&2; exit 1; }
sha_ok() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
[[ "$ACTION" == promote || "$ACTION" == rollback ]] || fail 'usage: promote SHA | rollback [SHA]'
[[ "$ACTION" != promote ]] || sha_ok "$TARGET" || fail 'promote requires full commit SHA'
[[ -z "$TARGET" ]] || sha_ok "$TARGET" || fail 'invalid release SHA'
mkdir -p "$RELEASES" "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || fail 'another HK API release owns the host lock'

json_field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
health_sha() { curl --max-time 10 -fsS "$HEALTH_URL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('build',{}).get('sha',''))"; }
source_for() {
  local sha=$1 dir="$RELEASES/$1/source"
  if [[ ! -f "$dir/deploy/docker-compose.prod-api.yml" ]]; then
    git -C "$REPO" cat-file -e "$sha^{commit}" 2>/dev/null || git -C "$REPO" fetch origin main
    git -C "$REPO" cat-file -e "$sha^{commit}"
    local tmp
    tmp=$(mktemp -d "$RELEASES/source.XXXXXX")
    git -C "$REPO" archive "$sha" | tar -x -C "$tmp"
    [[ -f "$tmp/deploy/docker-compose.prod-api.yml" ]] || fail 'candidate lacks production compose'
    mkdir -p "$RELEASES/$sha"
    mv "$tmp" "$dir"
  fi
}
override() {
  python3 - "$RELEASES/$1/image.json" "$2" <<'PY'
import json,sys,os
p,image=sys.argv[1:]
with open(p+'.tmp','w') as f: json.dump({'services':{'zenithjoy-api-prod':{'image':image}}},f)
os.replace(p+'.tmp',p)
PY
}
record() {
  python3 - "$RELEASES/$1/release.json" "$1" "$2" "$PROJECT" "$3" <<'PY'
import json,sys,os
p,sha,image,project,verified=sys.argv[1:]
with open(p+'.tmp','w') as f: json.dump(dict(sha=sha,image=image,project=project,verified=verified=='true'),f)
os.replace(p+'.tmp',p)
PY
}
compose() {
  local sha=$1; shift
  docker compose -p "$PROJECT" -f "$RELEASES/$sha/source/deploy/docker-compose.prod-api.yml" \
    -f "$RELEASES/$sha/image.json" "$@"
}
verify() {
  local sha=$1 status i
  for ((i=0; i<${ZJ_HEALTH_ATTEMPTS:-30}; i++)); do
    status=$(docker inspect "$SERVICE" --format '{{.State.Health.Status}}' 2>/dev/null || true)
    if [[ "$status" == healthy ]] && [[ "$(health_sha 2>/dev/null || true)" == "$sha" ]]; then return 0; fi
    sleep "${ZJ_HEALTH_INTERVAL:-5}"
  done
  echo "health/build.sha verification failed for $sha" >&2
  return 1
}

# Bootstrap from the actual running image, never from a mutable latest tag.
CURRENT=$(health_sha 2>/dev/null || true)
if [[ "$ACTION" == rollback && -f "$RELEASES/current" ]]; then CURRENT=$(cat "$RELEASES/current"); fi
sha_ok "$CURRENT" || fail 'running production does not expose a full build SHA'
OLD_IMAGE=$(docker inspect "$SERVICE" --format '{{.Image}}')
[[ -n "$OLD_IMAGE" ]] || fail 'running image is unavailable'
PROJECT=$(docker inspect "$SERVICE" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'running compose project is unavailable'
if [[ ! -f "$RELEASES/$CURRENT/release.json" ]]; then
  source_for "$CURRENT"
  docker tag "$OLD_IMAGE" "zenithjoy-api-prod:retained-$CURRENT"
  override "$CURRENT" "$OLD_IMAGE"
  record "$CURRENT" "$OLD_IMAGE" true
else
  [[ "$(json_field "$RELEASES/$CURRENT/release.json" image)" == "$OLD_IMAGE" ]] || fail 'running image drifted from retained release'
fi
if [[ "$ACTION" == promote ]]; then
  verify "$CURRENT" || fail 'current production is unhealthy; refusing an unsafe release'
fi

if [[ "$ACTION" == rollback ]]; then
  if [[ -z "$TARGET" ]]; then
    [[ -f "$RELEASES/previous" ]] || fail 'no previous verified release'
    TARGET=$(cat "$RELEASES/previous")
  fi
  sha_ok "$TARGET" || fail 'invalid retained SHA'
  if [[ "$TARGET" == "$CURRENT" ]]; then verify "$CURRENT"; echo "Already healthy at $CURRENT"; exit 0; fi
  MANIFEST="$RELEASES/$TARGET/release.json"
  [[ -f "$MANIFEST" ]] || fail 'requested release is not retained'
  [[ "$(json_field "$MANIFEST" verified)" == True ]] || fail 'requested release was never verified'
  [[ "$(json_field "$MANIFEST" project)" == "$PROJECT" ]] || fail 'compose project mismatch'
  IMAGE=$(json_field "$MANIFEST" image)
  docker image inspect "$IMAGE" >/dev/null || fail 'retained image missing; rollback cannot rebuild'
  override "$TARGET" "$IMAGE"
else
  if [[ "$TARGET" == "$CURRENT" ]]; then echo "Already healthy at $CURRENT"; echo "HK_RELEASE_PREVIOUS=$CURRENT"; exit 0; fi
  if [[ -f "$RELEASES/$TARGET/release.json" ]] && [[ "$(json_field "$RELEASES/$TARGET/release.json" verified)" == True ]]; then
    fail 'verified release already retained; use rollback to restore its exact image'
  fi
  source_for "$TARGET"
  IMAGE="zenithjoy-api-prod:candidate-$TARGET"
  override "$TARGET" "$IMAGE"
  BUILD_SHA="$TARGET" compose "$TARGET" build "$SERVICE"
  IMAGE=$(docker image inspect "$IMAGE" --format '{{.Id}}')
  override "$TARGET" "$IMAGE"
  record "$TARGET" "$IMAGE" false
  # Build before migrating, and do not touch the current container on migration failure.
  docker run --rm --network zenithjoy-net --env-file /opt/zenithjoy/prod-api/.env \
    -e TS_NODE_TRANSPILE_ONLY=1 -v "$RELEASES/$TARGET/source:/repo" -w /repo \
    node:20-bookworm-slim sh -c 'npm ci --include=dev --workspace=apps/api --silent && cd apps/api && npx ts-node db/migrations/run-migration.ts'
fi

SWITCHED=false
recover() {
  local code=$?
  trap - EXIT INT TERM
  if [[ "$SWITCHED" == true ]]; then
    echo "Activation failed; restoring retained image for $CURRENT" >&2
    if compose "$CURRENT" up -d --no-build --pull never "$SERVICE" && verify "$CURRENT"; then
      echo "Previous production restored: $CURRENT" >&2
    else
      echo 'CRITICAL: previous production could not be restored' >&2
    fi
  fi
  exit "$code"
}
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SWITCHED=true
compose "$TARGET" up -d --no-build --pull never "$SERVICE"
verify "$TARGET"
record "$TARGET" "$IMAGE" true
printf '%s\n' "$CURRENT" > "$RELEASES/previous.tmp"
mv "$RELEASES/previous.tmp" "$RELEASES/previous"
printf '%s\n' "$TARGET" > "$RELEASES/current.tmp"
mv "$RELEASES/current.tmp" "$RELEASES/current"
SWITCHED=false
trap - EXIT INT TERM
echo "HK API $ACTION verified: $TARGET"
echo "HK_RELEASE_PREVIOUS=$CURRENT"
