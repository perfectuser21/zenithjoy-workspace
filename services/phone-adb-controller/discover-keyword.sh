#!/bin/zsh
# discover-keyword.sh PROFILE SOURCE_ENC MAXV TAG LOC —— 关键词「发现」(决策 7f842d12 契约组装执行)
# 从 harvest-keyword.sh 原样抽出(打开App → 搜索 → 视频tab → 筛选 → 取卡片),契约 keyword_acquisition.discovery 的 runtime.entry。
# 发现接口(与 discover-benchmark.sh 共同遵守,别改):
#   调用时本 run 已持设备锁、seen-videos 已拉(锁/trap 留在 harvest-keyword.sh);执行后屏幕停在可点卡片的列表页;
#   stdout 每行 X\tY\tDUR\tTITLE(与 search-video-cards 同格式,最多 MAXV 行);无卡片 exit 0 空输出;失败 exit 1;日志走 stderr。
set -uo pipefail
C=~/.local/bin/douyin-phone-adb
P="$1"; KW="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-same_city}"
log(){ print -u2 -- "[$(date +%H:%M:%S)] $*"; }
nap(){ [[ -n "${HARVEST_KEYWORD_TESTING:-}" ]] && return 0; /bin/sleep "$1" }

$C --profile "$P" open-app >/dev/null 2>&1; nap 2
$C --profile "$P" open-search "$KW" >/dev/null 2>&1 || { log "open-search失败"; exit 1; }
nap 3
$C --profile "$P" search-video-tab "$TAG-vtab" >/dev/null 2>&1 || log "切视频tab失败(可能已在)"
# 0930 任务 913a6b03：原来 stderr 整段丢 /dev/null、日志只剩一句「筛选失败」，09-29 三批风暴
# （4/12、12/12、6/12 词作废）查不到死因（失败不留原因病）。现在：留底层原因；失败先重开搜索
# 再来一次（视觉定位偶发/面板没弹出这类瞬时故障值一次重试）；两次都不过才作废本词。
_stl_err="$(mktemp)"; _stl_ok=0
for _stl_try in 1 2; do
  _stl_eid="$TAG-filter"; (( _stl_try == 2 )) && _stl_eid="$TAG-filter-r2"
  if $C --profile "$P" search-time-layer six_months "$_stl_eid" most_liked unlimited unlimited "$LOC" >/dev/null 2>"$_stl_err"; then _stl_ok=1; break; fi
  _stl_reason="$(grep -v -e DeprecationWarning -e '^warning' -e '^ *$' "$_stl_err" | tail -1 | head -c 200)"
  log "筛选失败: ${_stl_reason:-无stderr} (第${_stl_try}次)"
  if (( _stl_try == 1 )); then
    $C --profile "$P" open-search "$KW" >/dev/null 2>&1; nap 3
    $C --profile "$P" search-video-tab "$TAG-vtab-r2" >/dev/null 2>&1 || true
  fi
done
rm -f "$_stl_err"
(( _stl_ok )) || exit 1
nap 2
$C --profile "$P" search-video-cards "$TAG-cards" 2>/dev/null | grep -E "^[0-9]+	" | head -"$MAXV"
exit 0
