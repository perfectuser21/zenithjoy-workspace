#!/usr/bin/env bash
set -euo pipefail
# The caller owns the single 300s deadline. No host sources or network settings change.
temp_root=$1 source_file=$2 mirror_file=$3
shift 3
stage() {
  local name=$1 started=$SECONDS
  shift
  echo "PREFLIGHT_APT_STAGE $name start elapsed_s=$SECONDS" >&2
  "$@"
  echo "PREFLIGHT_APT_STAGE $name done elapsed_s=$((SECONDS-started))" >&2
}
echo 'PREFLIGHT_APT_CONFIG original-public-sources'
/bin/cat "$source_file" "$mirror_file"
work=$(/usr/bin/mktemp -d "$temp_root/openclaw-apt.XXXXXX")
[[ "$work" == "$temp_root"/openclaw-apt.* ]] || exit 1
trap 'status=$?; sudo /bin/rm -rf -- "$work" || { echo APT_TEMP_CLEANUP_FAILED >&2; [ "$status" -ne 0 ] || status=1; }; exit "$status"' EXIT
/bin/mkdir -p "$work/lists/partial"
/bin/chmod 0755 "$work" "$work/lists"
python3 - "$source_file" "$work/ubuntu.sources" <<'PY'
import pathlib,re,sys
text=pathlib.Path(sys.argv[1]).read_text()
allowed={'mirror+file:/etc/apt/apt-mirrors.txt':'https://archive.ubuntu.com/ubuntu/',
 'http://azure.archive.ubuntu.com/ubuntu/':'https://archive.ubuntu.com/ubuntu/',
 'https://archive.ubuntu.com/ubuntu/':'https://archive.ubuntu.com/ubuntu/',
 'http://security.ubuntu.com/ubuntu/':'https://security.ubuntu.com/ubuntu/',
 'https://security.ubuntu.com/ubuntu/':'https://security.ubuntu.com/ubuntu/'}
blocks=[]
for block in re.split(r'\n\s*\n',text.strip()):
 fields={}
 for line in block.splitlines():
  if not line or line.startswith('#'):continue
  if line[0].isspace() or ':' not in line:raise SystemExit('APT_SOURCE_UNTRUSTED')
  key,value=line.split(':',1)
  if key in fields:raise SystemExit('APT_SOURCE_UNTRUSTED')
  fields[key]=value.strip()
 if fields.get('Types')!='deb' or fields.get('Signed-By')!='/usr/share/keyrings/ubuntu-archive-keyring.gpg':raise SystemExit('APT_SOURCE_SIGNATURE_REQUIRED')
 if any(k.lower() in ('trusted','allow-insecure','allow-weak','allow-downgrade-to-insecure') for k in fields):raise SystemExit('APT_SOURCE_UNTRUSTED')
 uris=fields.get('URIs','').split()
 if not uris or any(u not in allowed for u in uris):raise SystemExit('APT_SOURCE_UNTRUSTED')
 if not fields.get('Suites') or any(s not in ('noble','noble-updates','noble-backports','noble-security') for s in fields['Suites'].split()):raise SystemExit('APT_SOURCE_UNTRUSTED')
 blocks.append('\n'.join('URIs: '+' '.join(dict.fromkeys(allowed[u] for u in uris)) if l.startswith('URIs:') else l for l in block.splitlines()))
if not blocks:raise SystemExit('APT_SOURCE_UNTRUSTED')
pathlib.Path(sys.argv[2]).write_text('\n\n'.join(blocks)+'\n')
PY
/bin/chmod 0644 "$work/ubuntu.sources"
echo 'PREFLIGHT_APT_CONFIG selected-official-sources'
/bin/cat "$work/ubuntu.sources"
opts=(-o DPkg::Lock::Timeout=20 -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)
isolated=(-o "Dir::Etc::sourcelist=$work/ubuntu.sources" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$work/lists")
stage original-plan sudo env LC_ALL=C apt-get --simulate "${opts[@]}" install "$@" > "$work/original.plan"
stage official-index sudo env LC_ALL=C apt-get "${isolated[@]}" "${opts[@]}" -o APT::Update::Error-Mode=any update
stage official-plan sudo env LC_ALL=C apt-get --simulate "${isolated[@]}" "${opts[@]}" install "$@" > "$work/official.plan"
python3 - "$work/original.plan" "$work/official.plan" <<'PY'
import pathlib,re,sys
def plan(path):
 result=[]
 for line in pathlib.Path(path).read_text().splitlines():
  if not line.startswith(('Inst','Remv')):continue
  m=re.fullmatch(r'Inst ([a-z0-9][a-z0-9+.:\-]*) (?:\[[^\]\r\n]+\] )?\(([^\s()]+) [^\r\n]*\)',line)
  if m:result.append(('Inst',*m.groups()));continue
  m=re.fullmatch(r'Remv ([a-z0-9][a-z0-9+.:\-]*)(?: \[([^\]\r\n]+)\])?',line)
  if m:result.append(('Remv',*m.groups()));continue
  raise SystemExit('APT_PLAN_UNRECOGNIZED')
 return sorted(result,key=str)
a,b=plan(sys.argv[1]),plan(sys.argv[2])
if a!=b:
 print('APT_PLAN_CHANGED original='+repr(a)+' official='+repr(b),file=sys.stderr);raise SystemExit(1)
if any(row[0]=='Remv' for row in a):raise SystemExit('APT_PLAN_REMOVAL_REFUSED')
print('PREFLIGHT_APT_PLAN identical packages='+str(len(a)))
PY
stage official-install sudo env DEBIAN_FRONTEND=noninteractive LC_ALL=C apt-get "${isolated[@]}" "${opts[@]}" install -y "$@"
echo 'PREFLIGHT_APT_DONE'
