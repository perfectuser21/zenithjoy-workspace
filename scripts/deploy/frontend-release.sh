#!/usr/bin/env bash
# Promote: DIR SHA BUILT CONTAINER URL deploy-lib [configs]
# Rollback: --rollback DIR [SHA] CONTAINER URL deploy-lib
set -euo pipefail
MODE=promote
if [[ ${1:-} == --rollback ]]; then MODE=rollback; shift; fi
[[ $# -ge 5 ]] || { echo 'frontend-release: 缺少参数' >&2; exit 2; }
DIR=$1 TARGET=$2
if [[ "$MODE" == promote ]]; then
  [[ $# -ge 6 ]] || exit 2
  BUILT=$3 CONTAINER=$4 URL=$5 LIB=$6 CONFIGS=${7:-}
  [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo '非法候选 SHA' >&2; exit 1; }
  [[ -s "$BUILT/index.html" && -s "$BUILT/release-sha.json" ]] || { echo '候选资源或版本戳缺失' >&2; exit 1; }
  jq -e --arg sha "$TARGET" '.sha == $sha' "$BUILT/release-sha.json" >/dev/null
else
  CONTAINER=$3 URL=$4 LIB=$5 CONFIGS=''
fi
# shellcheck source=/dev/null
source "$LIB"
valid_id() { [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; }
[[ -d "$DIR/dist" ]] || { echo '没有可回退的现网 dist，拒绝覆盖' >&2; exit 1; }
exec 9>"$DIR/.release.flock"
flock -n 9 || { echo '另一次前端发布尚未结束' >&2; exit 1; }
SNAPSHOT=$(mktemp -d "$DIR/.release-work.XXXXXX")
if [[ -f "$DIR/.previous-verified" ]]; then cp "$DIR/.previous-verified" "$SNAPSHOT/previous-pointer"; fi
PREVIOUS=$(current_release_sha "$DIR/releases")
CHANGED=false
CAN_RESTORE=false

make_proof() {
  python3 - "$1" "$2" "$3" "$4" "$5" <<'PY'
import hashlib,json,pathlib,re,sys
root,release,expected,out,configs_dir=sys.argv[1:]; root=pathlib.Path(root); configs_dir=pathlib.Path(configs_dir)
version=None
if (root/'release-sha.json').is_file():
    version=json.loads((root/'release-sha.json').read_text()).get('sha')
    if not isinstance(version,str) or not re.fullmatch('[0-9a-f]{40}',version): raise ValueError('invalid retained version stamp')
if expected and version != expected: raise ValueError('candidate version mismatch')
configs={name: hashlib.sha256((configs_dir/name).read_bytes()).hexdigest() if (configs_dir/name).is_file() else None for name in ['nginx.conf','common.conf']}
proof=dict(version=1,release_id=release,sha=version,index_sha256=hashlib.sha256((root/'index.html').read_bytes()).hexdigest(),configs=configs)
pathlib.Path(out).write_text(json.dumps(proof))
PY
}
check_files() {
  python3 - "$1" "$2" "${3:-}" <<'PY'
import hashlib,json,pathlib,re,sys
root,proof,runtime=sys.argv[1:]; root=pathlib.Path(root); p=json.loads(pathlib.Path(proof).read_text())
assert p.get('version')==1 and p.get('release_id')==root.name, 'retained proof identity mismatch'
assert re.fullmatch('[0-9a-f]{64}',p.get('index_sha256','')), 'missing content digest'
assert hashlib.sha256((root/'index.html').read_bytes()).hexdigest()==p['index_sha256'], 'retained content changed'
if p.get('sha') is not None:
    assert re.fullmatch('[0-9a-f]{40}',p['sha']), 'invalid proof SHA'
    assert json.loads((root/'release-sha.json').read_text()).get('sha')==p['sha'], 'retained version changed'
assert set(p.get('configs',{}))=={'nginx.conf','common.conf'}, 'missing configuration proof'
for name,digest in p['configs'].items():
    for folder in [pathlib.Path(proof).parent/'configs']+([pathlib.Path(runtime)] if runtime else []):
        item=folder/name
        if digest is None: assert not item.exists(), 'configuration unexpectedly present: '+name
        else:
            assert re.fullmatch('[0-9a-f]{64}',digest), 'invalid configuration digest'
            assert hashlib.sha256(item.read_bytes()).hexdigest()==digest, 'configuration changed: '+name
PY
}
verify_proof() {
  local root=$1 proof=$2 expected actual sha
  check_files "$root" "$proof" "$DIR" || return 1
  expected=$(jq -r .index_sha256 "$proof") || return 1
  curl --fail --silent --show-error --retry "${ZJ_FRONTEND_VERIFY_RETRIES:-5}" --retry-delay 2 --max-time 30 \
    "${URL%/}/index.html?release_verify=$$" -o "$SNAPSHOT/http-index" || return 1
  actual=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$SNAPSHOT/http-index") || return 1
  [[ "$actual" == "$expected" ]] || { echo 'HTTP旧/新内容摘要与留存实物不符' >&2; return 1; }
  sha=$(jq -r '.sha // empty' "$proof") || return 1
  if [[ -n "$sha" ]]; then
    curl --fail --silent --show-error --retry "${ZJ_FRONTEND_VERIFY_RETRIES:-5}" --retry-delay 2 --max-time 30 \
      "${URL%/}/release-sha.json?release_verify=$$" | jq -e --arg sha "$sha" '.sha == $sha' >/dev/null || return 1
  fi
}
certify() {
  local release=$1 expected=${2:-} root="$DIR/releases/$1" state="$DIR/.release-state/$1" proof
  proof="$state/verified.json"
  if [[ -f "$proof" ]]; then
    if [[ -n "$expected" ]]; then jq -e --arg sha "$expected" '.sha == $sha' "$proof" >/dev/null; fi
    verify_proof "$root" "$proof"
    return
  fi
  mkdir -p "$state/configs"
  for config in nginx.conf common.conf; do
    if [[ -f "$DIR/$config" ]]; then cp "$DIR/$config" "$state/configs/$config"; else rm -f "$state/configs/$config"; fi
  done
  make_proof "$root" "$release" "$expected" "$proof.tmp" "$state/configs"
  verify_proof "$root" "$proof.tmp"
  mv "$proof.tmp" "$proof"
}
persist_previous() {
  printf '%s\n' "$PREVIOUS" > "$DIR/.previous-verified.tmp"
  mv "$DIR/.previous-verified.tmp" "$DIR/.previous-verified"
}
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ "$code" -ne 0 && "$CHANGED" == true ]]; then
    if [[ "$CAN_RESTORE" != true ]]; then
      echo '::error::目标回退失败且原候选未验证，拒绝再次恢复未验证候选' >&2
      rm -rf "$SNAPSHOT"
      exit "$code"
    fi
    echo "候选失败，恢复上一版 ${PREVIOUS}" >&2
    local rollback_failed=false
    dashboard_release_rollback "$DIR" "$PREVIOUS" || rollback_failed=true
    _atomic_swap_symlink "$DIR/releases/current" "$DIR/dist" || rollback_failed=true
    for config in nginx.conf common.conf; do
      if [[ -f "$SNAPSHOT/$config" ]]; then
        cp "$SNAPSHOT/$config" "$DIR/$config" || rollback_failed=true
      elif [[ -f "$SNAPSHOT/$config.absent" ]]; then
        rm -f "$DIR/$config" || rollback_failed=true
      fi
    done
    docker restart "$CONTAINER" || rollback_failed=true
    verify_proof "$DIR/releases/$PREVIOUS" "$DIR/.release-state/$PREVIOUS/verified.json" || rollback_failed=true
    if [[ "$rollback_failed" == true ]]; then
      echo '::error::自动回退后真实内容未确认，必须按失败事件处理' >&2
    elif [[ "$MODE" == promote && "$TARGET" != "$PREVIOUS" && -d "$DIR/releases/$TARGET" ]]; then
      # 失败候选不进入任何人工回退列表；保留事故实物用于诊断。
      local failed_dir
      failed_dir="$DIR/failed/$TARGET-$(date +%s)-$$"
      mkdir -p "$failed_dir"
      mv "$DIR/releases/$TARGET" "$failed_dir/assets" || true
      if [[ -d "$DIR/.release-state/$TARGET" ]]; then mv "$DIR/.release-state/$TARGET" "$failed_dir/state" || true; fi
    fi
  fi
  if [[ "$code" -ne 0 && "$CHANGED" == true ]]; then
    if [[ -f "$SNAPSHOT/previous-pointer" ]]; then cp "$SNAPSHOT/previous-pointer" "$DIR/.previous-verified"; else rm -f "$DIR/.previous-verified"; fi
  fi
  rm -rf "$SNAPSHOT"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for config in nginx.conf common.conf; do
  if [[ -f "$DIR/$config" ]]; then cp "$DIR/$config" "$SNAPSHOT/$config"; else touch "$SNAPSHOT/$config.absent"; fi
done

if [[ "$MODE" == promote ]]; then
  [[ "$PREVIOUS" != "$TARGET" ]] || { echo '当前已是此 SHA；禁止原地重建现网 release' >&2; exit 1; }
  [[ ! -f "$DIR/.release-state/$TARGET/verified.json" ]] || { echo '已验证的留存版本不可覆盖，请使用回退' >&2; exit 1; }
  if [[ ! -L "$DIR/dist" ]]; then
    PREVIOUS="baseline-$(date +%s)-$$"
    mkdir -p "$DIR/releases"
    cp -R "$DIR/dist" "$DIR/releases/$PREVIOUS"
    # 无SHA旧现场使用真实index摘要，不捏造版本号。
    certify "$PREVIOUS"
    CAN_RESTORE=true
    persist_previous
    CHANGED=true
    mv "$DIR/dist" "$SNAPSHOT/original-dist"
    ln -s "$DIR/releases/$PREVIOUS" "$DIR/dist"
  fi
  [[ -n "$PREVIOUS" && -d "$DIR/releases/$PREVIOUS" ]] || { echo '上一版 release 不完整，拒绝晋级' >&2; exit 1; }
  certify "$PREVIOUS"
  CAN_RESTORE=true
  persist_previous
  touch "$DIR/releases/$PREVIOUS"
  CHANGED=true
  dashboard_release_promote "$DIR" "$TARGET" "$BUILT" 5
  if [[ -n "$CONFIGS" ]]; then
    for config in nginx.conf common.conf; do
      [[ -f "$CONFIGS/$config" ]] || { echo "候选配置缺少 $config" >&2; exit 1; }
      cp "$CONFIGS/$config" "$DIR/$config"
    done
  fi
  docker restart "$CONTAINER"
  certify "$TARGET" "$TARGET"
else
  if [[ -z "$TARGET" && -f "$DIR/.previous-verified" ]]; then TARGET=$(cat "$DIR/.previous-verified"); fi
  valid_id "$TARGET" || { echo '没有合法的已验证回退目标' >&2; exit 1; }
  [[ -f "$DIR/.release-state/$TARGET/verified.json" ]] || { echo '回退目标从未验证通过' >&2; exit 1; }
  check_files "$DIR/releases/$TARGET" "$DIR/.release-state/$TARGET/verified.json"
  [[ -n "$PREVIOUS" ]] || { echo '当前指针缺失，无法识别现场' >&2; exit 1; }
  if [[ -f "$DIR/.release-state/$PREVIOUS/verified.json" ]]; then CAN_RESTORE=true; fi
  if [[ "$TARGET" == "$PREVIOUS" ]]; then verify_proof "$DIR/releases/$TARGET" "$DIR/.release-state/$TARGET/verified.json"; exit 0; fi
  CHANGED=true
  dashboard_release_rollback "$DIR" "$TARGET"
  for config in nginx.conf common.conf; do
    if [[ -f "$DIR/.release-state/$TARGET/configs/$config" ]]; then
      cp "$DIR/.release-state/$TARGET/configs/$config" "$DIR/$config"
    else
      rm -f "$DIR/$config"
    fi
  done
  docker restart "$CONTAINER"
  verify_proof "$DIR/releases/$TARGET" "$DIR/.release-state/$TARGET/verified.json"
fi
if [[ "$CAN_RESTORE" == true ]]; then persist_previous; else rm -f "$DIR/.previous-verified"; fi
CHANGED=false
echo "前端$MODE成功，HTTP真实内容已核验；当前=$TARGET，上一版=$PREVIOUS"
