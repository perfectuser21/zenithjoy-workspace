#!/usr/bin/env bash
# 固定候选静态资源晋级；复用 deploy-lib 的 release 指针与回退。
# 参数：应用目录 SHA 构建目录 容器 URL deploy-lib [nginx配置目录]
set -euo pipefail
[[ $# -ge 6 ]] || { echo 'frontend-release: 缺少参数' >&2; exit 2; }
DIR="$1" SHA="$2" BUILT="$3" CONTAINER="$4" URL="$5" LIB="$6" CONFIGS="${7:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '非法候选 SHA' >&2; exit 1; }
[[ -s "$BUILT/index.html" && -s "$BUILT/release-sha.json" ]] || { echo '候选资源或版本戳缺失' >&2; exit 1; }
jq -e --arg sha "$SHA" '.sha == $sha' "$BUILT/release-sha.json" >/dev/null
# shellcheck source=/dev/null
source "$LIB"
[[ -d "$DIR/dist" ]] || { echo '没有可回退的现网 dist，拒绝覆盖' >&2; exit 1; }
mkdir "$DIR/.release.lock" || { echo '另一次前端发布尚未结束' >&2; exit 1; }
SNAPSHOT="$(mktemp -d "$DIR/.release.lock/snapshot.XXXXXX")"
CHANGED=false
PREVIOUS="$(current_release_sha "$DIR/releases")"
cleanup() {
  local code=$?
  trap - EXIT
  if [[ "$code" -ne 0 && "$CHANGED" == true ]]; then
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
    if ! curl --fail --silent --show-error --max-time 30 "${URL%/}/" >/dev/null; then rollback_failed=true; fi
    if [[ "$rollback_failed" == true ]]; then echo '::error::自动回退后健康未确认，需按失败事件处理' >&2; fi
  fi
  rm -rf "$DIR/.release.lock"
  exit "$code"
}
trap cleanup EXIT
[[ "$PREVIOUS" != "$SHA" ]] || { echo '当前已是此 SHA；禁止原地重建现网 release' >&2; exit 1; }
for config in nginx.conf common.conf; do
  if [[ -f "$DIR/$config" ]]; then cp "$DIR/$config" "$SNAPSHOT/$config"; else touch "$SNAPSHOT/$config.absent"; fi
done
if [[ ! -L "$DIR/dist" ]]; then
  PREVIOUS="baseline-$(date +%s)-$$"
  mkdir -p "$DIR/releases"
  cp -R "$DIR/dist" "$DIR/releases/$PREVIOUS"
  CHANGED=true
  mv "$DIR/dist" "$SNAPSHOT/original-dist"
  ln -s "$DIR/releases/$PREVIOUS" "$DIR/dist"
fi
[[ -n "$PREVIOUS" && -d "$DIR/releases/$PREVIOUS" ]] || { echo '上一版 release 不完整，拒绝晋级' >&2; exit 1; }
# 保证刚离开的现网仍处于留存窗口，不能被本次 prune 清掉。
touch "$DIR/releases/$PREVIOUS"
CHANGED=true
dashboard_release_promote "$DIR" "$SHA" "$BUILT" 5
if [[ -n "$CONFIGS" ]]; then
  for config in nginx.conf common.conf; do
    [[ -f "$CONFIGS/$config" ]] || { echo "候选配置缺少 $config" >&2; exit 1; }
    cp "$CONFIGS/$config" "$DIR/$config"
  done
fi
docker restart "$CONTAINER"
curl --fail --silent --show-error --retry 5 --retry-delay 2 --max-time 30 "${URL%/}/" >/dev/null
curl --fail --silent --show-error --retry 5 --retry-delay 2 --max-time 30 \
  "${URL%/}/release-sha.json?candidate=$SHA" | jq -e --arg sha "$SHA" '.sha == $sha' >/dev/null
CHANGED=false
echo "前端晋级成功，HTTP 读回 SHA=$SHA；上一版=$PREVIOUS"
