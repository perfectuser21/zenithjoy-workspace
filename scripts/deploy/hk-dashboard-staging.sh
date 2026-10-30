#!/usr/bin/env bash
# Install a CI-built dashboard without building on the HK host.
set -euo pipefail
umask 077
SHA=${1:-}
EXPECTED_HASH=${2:-}
RUN_ID=${3:-}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid candidate metadata' >&2; exit 1; }
[[ "$EXPECTED_HASH" == rollback || "$EXPECTED_HASH" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid candidate metadata' >&2; exit 1; }
[[ "$RUN_ID" =~ ^[0-9]+-[0-9]+$ ]] || { echo 'Invalid dashboard run ID' >&2; exit 1; }
BASE=${ZJ_DASHBOARD_BASE:-/opt/zenithjoy/autopilot-staging}
LOCK=${ZJ_DASHBOARD_LOCK:-$BASE/deploy.lock}
SERVICE=autopilot-staging
ROOT="$BASE/dist/_releases"
mkdir -p "$ROOT" "$(dirname "$LOCK")"
chmod 755 "$ROOT"
exec 9>"$LOCK"
flock -n 9 || { echo 'Dashboard staging deployment already running' >&2; exit 1; }
# Existing web server and its bind mounts are a prerequisite, not something to guess or replace.
docker inspect "$SERVICE" --format '{{.State.Running}}' | grep -qx true || { echo 'Existing staging web server is unavailable' >&2; exit 1; }
[[ -f "$BASE/nginx.conf" && -d "$BASE/dist" ]] || { echo 'Existing staging configuration unavailable' >&2; exit 1; }
if [[ "$EXPECTED_HASH" == rollback ]]; then
  HISTORY="$BASE/history/$RUN_ID"
  [[ -L "$ROOT/current" && $(readlink "$ROOT/current") == "$SHA" && -f "$BASE/active-run" && $(cat "$BASE/active-run") == "$RUN_ID" && -f "$HISTORY/candidate-sha" && $(cat "$HISTORY/candidate-sha") == "$SHA" && -f "$HISTORY/previous-nginx.conf" && -f "$HISTORY/previous-pointer" && -f "$HISTORY/previous-sha" ]] || { echo 'No matching activated dashboard to roll back' >&2; exit 1; }
  old_pointer=$(cat "$HISTORY/previous-pointer")
  old_sha=$(cat "$HISTORY/previous-sha")
  old_run=$(cat "$HISTORY/previous-run")
  [[ -z "$old_pointer" || "$old_pointer" =~ ^[0-9a-f]{40}$ ]] || exit 1
  [[ "$old_sha" =~ ^[0-9a-f]{40}$ ]] || exit 1
  if [[ -n "$old_pointer" ]]; then ln -s "$old_pointer" "$ROOT/.rollback-$$"; mv -Tf "$ROOT/.rollback-$$" "$ROOT/current"; else rm -f "$ROOT/current"; fi
  if [[ -n "$old_run" ]]; then printf '%s\n' "$old_run" > "$BASE/.active-run-$$"; mv -Tf "$BASE/.active-run-$$" "$BASE/active-run"; else rm -f "$BASE/active-run"; fi
  cat "$HISTORY/previous-nginx.conf" > "$BASE/nginx.conf"
  docker exec "$SERVICE" nginx -t
  docker exec "$SERVICE" nginx -s reload
  for ((i=0; i<20; i++)); do
    actual=$(curl -fsS --max-time 5 'http://localhost:521/release-sha.json' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("sha",""))' 2>/dev/null || true)
    [[ "$actual" == "$old_sha" ]] && { echo "Previous dashboard restored sha=$old_sha"; exit 0; }
    sleep 1
  done
  echo 'Dashboard rollback SHA verification failed' >&2
  exit 1
fi
PREVIOUS_SHA=$(curl -fsS --max-time 5 'http://localhost:521/release-sha.json' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("sha",""))')
[[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Cannot verify previous dashboard release SHA' >&2; exit 1; }
WORK=$(mktemp -d "$BASE/.candidate.XXXXXX")
old_pointer=''
old_run=''
[[ ! -f "$BASE/active-run" ]] || old_run=$(cat "$BASE/active-run")
[[ -z "$old_run" || "$old_run" =~ ^[0-9]+-[0-9]+$ ]] || { echo 'Invalid previous run ID' >&2; exit 1; }
old_exists=0
switched=0
if [[ -L "$ROOT/current" ]]; then old_exists=1; old_pointer=$(readlink "$ROOT/current"); [[ "$old_pointer" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid previous release pointer' >&2; exit 1; }; fi
cp -p "$BASE/nginx.conf" "$WORK/previous-nginx.conf"
cleanup() {
  local result=$?
  if (( result != 0 && switched )); then
    if (( old_exists )); then ln -s "$old_pointer" "$ROOT/.rollback-$$" && mv -Tf "$ROOT/.rollback-$$" "$ROOT/current"; else rm -f "$ROOT/current"; fi
    if [[ -n "$old_run" ]]; then printf '%s\n' "$old_run" > "$BASE/.active-run-$$"; mv -Tf "$BASE/.active-run-$$" "$BASE/active-run"; else rm -f "$BASE/active-run"; fi
    cat "$WORK/previous-nginx.conf" > "$BASE/nginx.conf"
    if docker exec "$SERVICE" nginx -t >/dev/null 2>&1 && docker exec "$SERVICE" nginx -s reload >/dev/null 2>&1; then
      local restored='' attempt
      for ((attempt=0; attempt<20; attempt++)); do
        restored=$(curl -fsS --max-time 5 'http://localhost:521/release-sha.json' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("sha",""))' 2>/dev/null || true)
        [[ "$restored" == "$PREVIOUS_SHA" ]] && break
        sleep 1
      done
      [[ "$restored" == "$PREVIOUS_SHA" ]] && echo "Previous dashboard restored sha=$PREVIOUS_SHA" >&2 || echo 'Dashboard rollback SHA verification failed' >&2
    else
      echo 'Dashboard rollback reload failed' >&2
    fi
  fi
  rm -rf "$WORK"
  return "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 129' HUP
trap 'exit 141' PIPE
AVAILABLE_KB=$(df -Pk "$BASE" | awk 'NR==2 {print $4}')
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ && "$AVAILABLE_KB" -ge 262144 ]] || { echo 'Insufficient dashboard staging disk space' >&2; exit 1; }
# Bound streamed input even when the archive is invalid or unexpectedly large.
python3 -c '
import sys
limit=100*1024*1024
size=0
with open(sys.argv[1],"wb") as out:
 while True:
  b=sys.stdin.buffer.read(1024*1024)
  if not b: break
  size+=len(b)
  if size>limit: raise ValueError("dashboard bundle exceeds 100 MiB")
  out.write(b)
' "$WORK/bundle.tar.gz"
[[ $(sha256sum "$WORK/bundle.tar.gz" | awk '{print $1}') == "$EXPECTED_HASH" ]] || { echo 'Dashboard bundle checksum mismatch' >&2; exit 1; }
mkdir "$WORK/unpacked"
python3 - "$WORK/bundle.tar.gz" "$WORK/unpacked" <<'PY'
import os,sys,tarfile
with tarfile.open(sys.argv[1],'r:gz') as t:
 members=t.getmembers()
 total=sum(m.size for m in members if m.isfile())
 if total > 128*1024*1024: raise ValueError('dashboard release exceeds 128 MiB')
 if os.statvfs(sys.argv[2]).f_bavail * os.statvfs(sys.argv[2]).f_frsize < total + 128*1024*1024:
  raise ValueError('insufficient staging space to extract dashboard')
 for m in members:
  n=m.name.removeprefix('./')
  if not (n == 'nginx.conf' or n == 'dist' or n.startswith('dist/')) or n.startswith('/') or '..' in n.split('/') or not (m.isfile() or m.isdir()):
   raise ValueError('invalid bundle member')
  t.extract(m,sys.argv[2])
PY
python3 - "$WORK/unpacked/dist/release-sha.json" "$SHA" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['sha']==sys.argv[2], 'Release SHA mismatch'
PY
grep -Fxq '    root /usr/share/nginx/html/_releases/current;' "$WORK/unpacked/nginx.conf" || { echo 'Wrong staging root' >&2; exit 1; }
grep -Fxq '        root /usr/share/nginx/html/_shared_assets;' "$WORK/unpacked/nginx.conf" || { echo 'Missing shared asset root' >&2; exit 1; }
[[ -f "$WORK/unpacked/dist/index.html" ]] || { echo 'Dashboard index missing' >&2; exit 1; }
# Only this pinned, publicly distributed frontend is deduplicated. Verify its
# complete manifest before copying anything into the append-only shared tree.
OFFICIAL_WHEEL=593af1d79767cefc3587c862dd3b3d90ff00530c5f83071522f8f9807c175346
OFFICIAL_REL="assets/comfy/$OFFICIAL_WHEEL"
OFFICIAL_SOURCE="$WORK/unpacked/dist/$OFFICIAL_REL"
OFFICIAL_SHARED="$BASE/dist/_shared_assets/$OFFICIAL_REL"
OFFICIAL_URL="/$OFFICIAL_REL/assets/index-CqDKM-zt.js"
OFFICIAL_ENABLED=0
if grep -Fq "$OFFICIAL_URL" "$WORK/unpacked/nginx.conf"; then OFFICIAL_ENABLED=1; fi
verify_official() {
  python3 - "$1" "$OFFICIAL_WHEEL" <<'PYOFFICIAL'
import hashlib,json,os,re,sys
from pathlib import Path
root=Path(sys.argv[1]); sha=sys.argv[2]
if root.is_symlink() or not root.is_dir(): raise ValueError('invalid official assets root')
manifest=root/'manifest.json'
if manifest.is_symlink() or not manifest.is_file(): raise ValueError('official assets manifest missing')
data=json.loads(manifest.read_text())
files=data.get('files')
required={'assets/index-CqDKM-zt.js','assets/rolldown-runtime-CM1DJQSe.js','assets/vendor-datadog-CS-2l-KQ.js','fonts/inter-latin-normal.woff2','fonts/inter-latin-italic.woff2','fonts/materialdesignicons-webfont.woff2'}
if data.get('wheel_sha256')!=sha or not isinstance(files,dict) or not required.issubset(files): raise ValueError('invalid official assets manifest')
for name,digest in files.items():
 if not isinstance(name,str) or not re.fullmatch(r'(assets|fonts)/[A-Za-z0-9._@/-]+',name) or any(x in ('','.','..') for x in name.split('/')) or not isinstance(digest,str) or not re.fullmatch(r'[a-f0-9]{64}',digest): raise ValueError('invalid official assets entry')
actual=set()
for directory,dirs,names in os.walk(root,followlinks=False):
 if any((Path(directory)/n).is_symlink() for n in dirs+names): raise ValueError('official asset symlink rejected')
 for name in names:
  p=Path(directory)/name; rel=p.relative_to(root).as_posix()
  if rel=='manifest.json': continue
  actual.add(rel)
  if rel not in files or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=files[rel]: raise ValueError('official asset digest mismatch')
if actual!=set(files): raise ValueError('official assets incomplete')
PYOFFICIAL
}
HAS_OFFICIAL=0
if [[ -e "$OFFICIAL_SOURCE" || -L "$OFFICIAL_SOURCE" ]]; then
  verify_official "$OFFICIAL_SOURCE"
  HAS_OFFICIAL=1
fi
if (( OFFICIAL_ENABLED && ! HAS_OFFICIAL )); then
  echo 'Official CDN is enabled but candidate official assets are missing' >&2
  exit 1
fi
# Old open tabs may still lazy-load hashed assets. Keep a content-checked,
# append-only union and never replace a name with different bytes.
python3 - "$BASE/dist/assets" "$WORK/unpacked/dist/assets" "$BASE/dist/_shared_assets/assets" <<'PYASSETS'
import hashlib,os,shutil,sys,tempfile
old,new,dest=sys.argv[1:]
os.umask(0o022)
for path in (dest,os.path.dirname(dest)):
 if os.path.islink(path): raise ValueError('shared asset root symlink rejected')
os.makedirs(dest,mode=0o755,exist_ok=True)
os.chmod(dest,0o755)
def digest(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
 return h.digest()
planned={}
for src in (old,new):
 if not os.path.exists(src): continue
 if os.path.islink(src) or not os.path.isdir(src): raise ValueError('invalid asset directory')
 for root,dirs,files in os.walk(src,followlinks=False):
  if any(os.path.islink(os.path.join(root,n)) for n in dirs+files): raise ValueError('asset symlink rejected')
  for name in files:
   source=os.path.join(root,name); rel=os.path.relpath(source,src); output=os.path.join(dest,rel)
   current=dest
   for part in rel.split(os.sep)[:-1]:
    current=os.path.join(current,part)
    if os.path.islink(current): raise ValueError('shared asset directory symlink rejected')
   if rel in planned and digest(source)!=digest(planned[rel]): raise ValueError('asset filename collision')
   if os.path.lexists(output):
    if os.path.islink(output) or not os.path.isfile(output) or digest(source)!=digest(output): raise ValueError('asset filename collision')
   else: planned[rel]=source
needed=sum(os.path.getsize(p) for p in planned.values())
v=os.statvfs(dest)
if v.f_bavail*v.f_frsize < needed + 128*1024*1024: raise ValueError('insufficient space for shared assets')
for rel,source in planned.items():
 output=os.path.join(dest,rel); directory=os.path.dirname(output)
 os.makedirs(directory,mode=0o755,exist_ok=True); os.chmod(directory,0o755)
 fd,temp=tempfile.mkstemp(prefix='.asset-',dir=directory)
 try:
  with os.fdopen(fd,'wb') as out, open(source,'rb') as inp:
   shutil.copyfileobj(inp,out,1024*1024); out.flush(); os.fsync(out.fileno())
  if digest(temp)!=digest(source): raise ValueError('asset copy verification failed')
  os.chmod(temp,0o644); os.replace(temp,output)
 finally:
  if os.path.exists(temp): os.unlink(temp)
os.chmod(os.path.dirname(dest),0o755)
PYASSETS
if (( HAS_OFFICIAL )); then
  # Shared copy must exactly match the candidate, including the manifest,
  # before the candidate's redundant copy can be removed.
  verify_official "$OFFICIAL_SHARED"
  cmp -s "$OFFICIAL_SOURCE/manifest.json" "$OFFICIAL_SHARED/manifest.json" || { echo 'Official asset manifest collision' >&2; exit 1; }
  rm -rf -- "$OFFICIAL_SOURCE"
fi
# Keep the exact previous config and pointer for later manual recovery as well.
HISTORY="$BASE/history/$RUN_ID"
[[ ! -e "$HISTORY" ]] || { echo 'Dashboard run ID already used' >&2; exit 1; }
mkdir -p "$HISTORY"
cp -p "$WORK/previous-nginx.conf" "$HISTORY/previous-nginx.conf"
printf '%s\n' "$old_pointer" > "$HISTORY/previous-pointer"
printf '%s\n' "$PREVIOUS_SHA" > "$HISTORY/previous-sha"
printf '%s\n' "$old_run" > "$HISTORY/previous-run"
printf '%s\n' "$SHA" > "$HISTORY/candidate-sha"
if [[ -e "$ROOT/$SHA" ]]; then
  if (( HAS_OFFICIAL )) && [[ -e "$ROOT/$SHA/$OFFICIAL_REL" ]]; then
    verify_official "$ROOT/$SHA/$OFFICIAL_REL"
    cmp -s "$OFFICIAL_SHARED/manifest.json" "$ROOT/$SHA/$OFFICIAL_REL/manifest.json" || { echo 'Existing official release differs' >&2; exit 1; }
  fi
  python3 - "$WORK/unpacked/dist" "$ROOT/$SHA" "$OFFICIAL_REL" "$HAS_OFFICIAL" <<'PYRELEASE' || { echo 'Existing release differs; refusing overwrite' >&2; exit 1; }
import filecmp,os,sys
from pathlib import Path
left,right=map(Path,sys.argv[1:3]); skip=sys.argv[3] if sys.argv[4]=='1' else None
def entries(root):
 result={}
 for directory,dirs,files in os.walk(root,followlinks=False):
  rel=Path(directory).relative_to(root).as_posix()
  for name in list(dirs):
   p=Path(directory)/name; key=p.relative_to(root).as_posix()
   if p.is_symlink(): raise ValueError('release symlink rejected')
   if key==skip: dirs.remove(name); continue
   result[key]=None
  for name in files:
   p=Path(directory)/name; key=p.relative_to(root).as_posix()
   if p.is_symlink() or not p.is_file(): raise ValueError('invalid release file')
   result[key]=p
 return result
a,b=entries(left),entries(right)
if a.keys()!=b.keys() or any((a[k] is None)!=(b[k] is None) or (a[k] is not None and not filecmp.cmp(a[k],b[k],shallow=False)) for k in a): raise ValueError('release differs')
PYRELEASE
else
  chmod -R a+rX "$WORK/unpacked/dist"
  mv "$WORK/unpacked/dist" "$ROOT/$SHA"
fi
ln -s "$SHA" "$ROOT/.current-$$"
switched=1
printf '%s\n' "$RUN_ID" > "$BASE/.active-run-$$"
mv -Tf "$BASE/.active-run-$$" "$BASE/active-run"
mv -Tf "$ROOT/.current-$$" "$ROOT/current"
cat "$WORK/unpacked/nginx.conf" > "$BASE/nginx.conf"
docker exec "$SERVICE" nginx -t
docker exec "$SERVICE" nginx -s reload
EXPECTED_INDEX=$(sha256sum "$ROOT/$SHA/index.html" | awk '{print $1}')
for ((i=0; i<${ZJ_DASHBOARD_HEALTH_ATTEMPTS:-20}; i++)); do
  GOT_SHA=$(curl -fsS --max-time 5 "http://localhost:521/release-sha.json?candidate=$SHA" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("sha",""))' 2>/dev/null || true)
  GOT_INDEX=$(curl -fsS --max-time 5 'http://localhost:521/' | sha256sum | awk '{print $1}' || true)
  API_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 'http://localhost:521/api/creative-canvas/status' || true)
  OFFICIAL_OK=1
  if (( OFFICIAL_ENABLED )); then
    EXPECTED_OFFICIAL=$(sha256sum "$OFFICIAL_SHARED/assets/index-CqDKM-zt.js" | awk '{print $1}' || true)
    OFFICIAL_STATUS=''
    GOT_OFFICIAL=''
    if OFFICIAL_STATUS=$(curl -fsS --max-time 10 -o "$WORK/official-http-body" -w '%{http_code}' "http://localhost:521$OFFICIAL_URL"); then
      GOT_OFFICIAL=$(sha256sum "$WORK/official-http-body" | awk '{print $1}' || true)
    else
      OFFICIAL_OK=0
    fi
    [[ "$OFFICIAL_STATUS" == 200 && "$EXPECTED_OFFICIAL" =~ ^[0-9a-f]{64}$ && "$GOT_OFFICIAL" == "$EXPECTED_OFFICIAL" ]] || OFFICIAL_OK=0
  fi
  if [[ "$GOT_SHA" == "$SHA" && "$GOT_INDEX" == "$EXPECTED_INDEX" && "$API_STATUS" == 401 && "$OFFICIAL_OK" == 1 ]]; then switched=0; echo "Dashboard staging verified sha=$SHA"; exit 0; fi
  sleep "${ZJ_DASHBOARD_HEALTH_INTERVAL:-1}"
done
echo 'Dashboard staging verification failed' >&2
exit 1
