#!/usr/bin/env bash
set -euo pipefail
umask 077

SHA=${1:-}
ARCHIVE_SHA=${2:-}
ARCHIVE_BYTES=${3:-}
UNPACKED_BYTES=${4:-}
CONFIG=${5:-}
LAYERS=${6:-}
IDENTITY_SCRIPT=${7:-}
fail() { echo "Hangzhou candidate image refused: $*" >&2; exit 1; }
[[ "$SHA" =~ ^[a-f0-9]{40}$ && "$ARCHIVE_SHA" =~ ^[a-f0-9]{64}$ &&
   "$CONFIG" =~ ^sha256:[a-f0-9]{64}$ && "$LAYERS" =~ ^[a-f0-9]{64}$ &&
   "$ARCHIVE_BYTES" =~ ^[1-9][0-9]{0,9}$ && "$UNPACKED_BYTES" =~ ^[1-9][0-9]{0,9}$ &&
   -n "$IDENTITY_SCRIPT" ]] || fail 'invalid artifact identity'
(( ARCHIVE_BYTES < 5368709120 && UNPACKED_BYTES < 5368709120 )) || fail 'image exceeds size cap'

ROOT=/var/lib/zenithjoy-cn-production
[[ -d "$ROOT" && ! -L "$ROOT" && $(stat -c '%a:%u' "$ROOT") == 700:0 ]] || fail 'unexpected release host'
DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}')
[[ $(df -P "$ROOT" | awk 'NR==2 {print $1}') == "$(df -P "$DOCKER_ROOT" | awk 'NR==2 {print $1}')" ]] || fail 'image paths span filesystems'
AVAILABLE=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
REQUIRED=$(((2 * ARCHIVE_BYTES + UNPACKED_BYTES + 536870912 + 1023) / 1024))
if [[ ! "$AVAILABLE" =~ ^[0-9]+$ ]] || (( AVAILABLE < REQUIRED )); then
  fail 'insufficient storage for archive and image'
fi

TEMP=$(mktemp -d "$ROOT/.ci-image.XXXXXXXX")
trap 'rm -rf -- "$TEMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(
  ulimit -f "$(((ARCHIVE_BYTES + 1023) / 1024))"
  gzip -dc > "$TEMP/image.tar"
)
[[ $(stat -c '%s' "$TEMP/image.tar") == "$ARCHIVE_BYTES" &&
   $(sha256sum "$TEMP/image.tar" | awk '{print $1}') == "$ARCHIVE_SHA" ]] || fail 'archive hash or size mismatch'
TAG="zenithjoy-api-staging:$SHA"
IDENTITY=$(python3 -c "$IDENTITY_SCRIPT" "$TAG" < "$TEMP/image.tar")
ACTUAL_CONFIG=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["config"])' <<< "$IDENTITY")
ACTUAL_LAYERS=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["layers_hash"])' <<< "$IDENTITY")
[[ "$ACTUAL_CONFIG" == "$CONFIG" && "$ACTUAL_LAYERS" == "$LAYERS" ]] || fail 'archive config or layers mismatch'
docker load -i "$TEMP/image.tar" >/dev/null
IMAGE=$(docker image inspect "$TAG" --format '{{.Id}}')
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'invalid loaded image ID'
[[ $(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]] || fail 'loaded image platform mismatch'
[[ $(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$SHA" ]] || fail 'loaded image revision mismatch'
echo "HZ_CANDIDATE_IMAGE=$IMAGE"
