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
# BEGIN CANVAS ARCHIVE RESTORE
restore_canvas_image_if_needed() {
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then return 0; fi
  local archive_root=/opt/zenithjoy-backups/canvas-archives
  local archive="$archive_root/$SHA/image.archive.tar"
  local manifest="$archive_root/$SHA/image.archive.json"
  local receipt="$RELEASES/$SHA/receipt.json"
  local docker_root free containerd_config
  [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || { echo 'Rollback requires the local Docker daemon' >&2; return 1; }
  [[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || { echo 'Rollback requires the local Docker socket' >&2; return 1; }
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  [[ "$docker_root" == /var/lib/docker && -d /var/lib/containerd ]] || { echo 'Unknown Docker storage layout; refusing archive load' >&2; return 1; }
  [[ $(docker info --format '{{.Driver}}') == overlayfs ]] || { echo 'Unknown Docker storage driver; refusing archive load' >&2; return 1; }
  containerd_config=$(containerd config dump 2>/dev/null)
  [[ $(printf '%s\n' "$containerd_config" | awk '/^root = / {gsub(/\047|\042/, "", $3); print $3}') == /var/lib/containerd ]] || { echo 'Unknown containerd root; refusing archive load' >&2; return 1; }
  if printf '%s\n' "$containerd_config" | grep -E '^[[:space:]]*(root_path|temp) = ' | grep -vE "= (''|\"\")$" >/dev/null; then
    echo 'Custom containerd storage or temporary path requires separate budgeting' >&2; return 1
  fi
  free=$(df -PB1 --output=avail /var/lib/containerd | tail -n 1 | tr -d '[:space:]')
  python3 - "$manifest" "$archive" "$receipt" "$free" "$IMAGE" "$archive_root" "$docker_root" <<'PY'
import gzip, hashlib, json, os, posixpath, re, stat, sys, tarfile
manifest_path, archive_path, receipt_path, free, image, archive_root, docker_root = sys.argv[1:]
# Archive path must be rooted in a trusted directory chain. A root-owned sticky
# directory (such as /tmp in the isolated tests) protects its owned children.
path = os.path.dirname(archive_path)
while True:
    info = os.lstat(path)
    sticky_root = bool(info.st_mode & stat.S_ISVTX) and info.st_uid == 0
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.geteuid())
        or info.st_mode & 0o022 and not sticky_root):
        raise SystemExit('Rollback archive directory chain is not trusted')
    parent = os.path.dirname(path)
    if parent == path: break
    path = parent
if not os.path.commonpath([archive_path, archive_root]) == archive_root:
    raise SystemExit('Rollback archive escaped its protected root')
for path in (manifest_path, archive_path, receipt_path):
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise SystemExit('Rollback archive and receipt must be private, owner-controlled regular files')
stores = [docker_root, docker_root + '/tmp', '/var/lib/containerd',
          '/var/lib/containerd/io.containerd.content.v1.content',
          '/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs', '/tmp', '/var/tmp']
if len({os.stat(path).st_dev for path in stores}) != 1:
    raise SystemExit('Docker, containerd or temporary storage uses separate filesystems; budget each before restoring')
with open(manifest_path, encoding='utf-8') as f: manifest = json.load(f)
with open(receipt_path, encoding='utf-8') as f: receipt = json.load(f)
if (set(manifest) != {'version', 'sha256', 'image_id', 'required_free_bytes'}
    or type(manifest['version']) is not int or manifest['version'] != 1
    or not isinstance(manifest['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', manifest['sha256'])
    or not isinstance(manifest['image_id'], str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', manifest['image_id'])
    or manifest['image_id'] != receipt.get('image_id')
    or type(manifest['required_free_bytes']) is not int or manifest['required_free_bytes'] <= 0):
    raise SystemExit('Rollback archive manifest does not match the verified receipt')
digest = hashlib.sha256()
with open(archive_path, 'rb') as f:
    for block in iter(lambda: f.read(1024 * 1024), b''): digest.update(block)
if digest.hexdigest() != manifest['sha256']:
    raise SystemExit('Rollback archive checksum mismatch')
with tarfile.open(archive_path, 'r:') as archive:
    entries = {}
    for entry in archive:
        name = entry.name.rstrip('/')
        if not name or name.startswith('/') or posixpath.normpath(name) != name or name in entries:
            raise SystemExit('Rollback archive has unsafe or duplicate paths')
        if not entry.isfile() and not entry.isdir():
            raise SystemExit('Rollback archive contains a link or unsupported entry')
        if entry.isfile() and name not in ('index.json', 'manifest.json', 'oci-layout') and not re.fullmatch(r'blobs/sha256/[0-9a-f]{64}', name):
            raise SystemExit('Rollback archive contains an unexpected file')
        entries[name] = entry
    def metadata(name):
        e = entries.get(name)
        if not e or not e.isfile() or e.size > 4 * 1024 * 1024:
            raise SystemExit('Rollback archive metadata is invalid')
        return json.load(archive.extractfile(e))
    index, legacy = metadata('index.json'), metadata('manifest.json')
    descriptors = index.get('manifests', []) if isinstance(index, dict) else []
    canonical = image if '/' in image else 'docker.io/library/' + image
    if (len(descriptors) != 1 or descriptors[0].get('digest') != manifest['image_id']
        or descriptors[0].get('annotations', {}).get('io.containerd.image.name') != canonical
        or not isinstance(legacy, list) or len(legacy) != 1 or legacy[0].get('RepoTags') != [image]):
        raise SystemExit('Rollback archive must contain only the receipt image and expected tag')
    seen, descriptors_seen, matches, expanded, largest = set(), {}, False, 0, 0
    def check(desc):
        global matches, expanded, largest
        digest = desc.get('digest', '')
        if not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise SystemExit('Invalid OCI blob digest')
        name = 'blobs/sha256/' + digest[7:]
        e = entries.get(name)
        if not e or not e.isfile() or type(desc.get('size')) is not int or e.size != desc['size']:
            raise SystemExit('Missing or incorrectly sized OCI blob')
        kind = desc.get('mediaType', '')
        signature = (desc['size'], kind)
        if name in seen:
            if descriptors_seen[name] != signature: raise SystemExit('OCI blob has conflicting descriptors')
            return
        descriptors_seen[name] = signature
        seen.add(name); largest = max(largest, e.size)
        h = hashlib.sha256(); stream = archive.extractfile(e)
        for b in iter(lambda: stream.read(1024 * 1024), b''): h.update(b)
        if h.hexdigest() != digest[7:]: raise SystemExit('OCI blob checksum mismatch')
        if 'image.index' in kind or 'manifest.list' in kind or 'image.manifest' in kind or 'manifest.v2' in kind:
            if e.size > 4 * 1024 * 1024: raise SystemExit('OCI metadata is too large')
            data = json.load(archive.extractfile(e))
            if 'manifests' in data:
                for child in data['manifests']: check(child)
            elif 'config' in data and 'layers' in data:
                if (legacy[0].get('Config') == 'blobs/sha256/' + data['config'].get('digest', '')[7:]
                    and legacy[0].get('Layers') == ['blobs/sha256/' + item.get('digest', '')[7:] for item in data['layers']]): matches = True
                check(data['config'])
                for child in data['layers']: check(child)
            else: raise SystemExit('Invalid OCI manifest')
        elif 'image.layer' in kind or 'rootfs.diff' in kind:
            if kind.endswith('+gzip') or kind.endswith('.gzip'):
                layer = gzip.GzipFile(fileobj=archive.extractfile(e))
            elif kind.endswith('.tar'): layer = archive.extractfile(e)
            else: raise SystemExit('Unsupported OCI layer compression')
            count = 0
            with layer, tarfile.open(fileobj=layer, mode='r|') as unpacked:
                for item in unpacked:
                    count += 1
                    if item.sparse is not None or any(k.startswith('GNU.sparse') for k in item.pax_headers):
                        raise SystemExit('Sparse OCI layers cannot be budgeted safely')
                    expanded += 16384 + ((item.size + 4095) // 4096 * 4096 if item.isfile() else 0)
                    if count > 2000000 or expanded > 64 * 1024**3:
                        raise SystemExit('OCI layer size or entry count exceeds safety cap')
    check(descriptors[0])
    if not matches: raise SystemExit('Docker manifest does not match an OCI image manifest')
    if {name for name, item in entries.items() if item.isfile() and name.startswith('blobs/sha256/')} != seen:
        raise SystemExit('Rollback archive contains unreferenced OCI blobs')
    # Compressed content, a temporary copy of the largest blob, unpacked layer
    # bytes plus 20% for filesystem metadata, and 512 MiB remain on the host.
    computed = sum(entries[name].size for name in seen) + largest + (expanded * 6 + 4) // 5
    required = max(manifest['required_free_bytes'], computed) + 512 * 1024 * 1024
    if not free.isdecimal() or int(free) < required:
        raise SystemExit('Insufficient free space to restore the rollback image safely')
PY
  docker load --input "$archive"
  local loaded expected
  loaded=$(docker image inspect "$IMAGE" --format '{{.Id}}')
  expected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image_id"])' "$receipt")
  [[ "$loaded" == "$expected" ]] || { echo 'Restored image identity differs from verified receipt' >&2; return 1; }
}
# END CANVAS ARCHIVE RESTORE
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
if [[ "$ACTION" == rollback ]]; then restore_canvas_image_if_needed; fi
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
probe_capabilities() {
  if [[ -f "$SOURCE/scripts/deploy/canvas-capabilities.py" ]]; then
    docker exec "$CONTAINER" python -c "$(cat "$SOURCE/scripts/deploy/canvas-capabilities.py")"
  elif [[ "$ACTION" == rollback ]]; then
    # An admitted historical release predating this probe retains its original
    # capability contract. New deployments must carry the fixed-source probe.
    docker exec "$CONTAINER" python -c "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8188/object_info',timeout=5)); assert all(n in d for n in ['ZenithJoyImage2','ZenithJoyLoadAsset','ZenithJoyChooseAsset','ZenithJoyWan']); assert urllib.request.urlopen('http://127.0.0.1:8188/extensions/zenithjoy/image2-select-wan.json',timeout=5).status == 200"
  else
    echo 'Candidate capability probe missing' >&2
    return 1
  fi
}
for ((i=0; i<36; i++)); do
  STATUS=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || true)
  CURRENT_IMAGE=$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true)
  if [[ "$STATUS" == healthy && "$CURRENT_IMAGE" == "$IMAGE_ID" ]] && probe_capabilities; then
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
