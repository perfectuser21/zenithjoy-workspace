#!/bin/zsh
# discover-keyword.sh PROFILE SOURCE_ENC MAXV TAG LOC —— 关键词「发现」(决策 7f842d12 契约组装执行)
# 从 harvest-keyword.sh 原样抽出(打开App → 搜索 → 视频tab → 筛选 → 取卡片),契约 keyword_acquisition.discovery 的 runtime.entry。
# 发现接口(与 discover-benchmark.sh 共同遵守,别改):
#   调用时本 run 已持设备锁、seen-videos 已拉(锁/trap 留在 harvest-keyword.sh);执行后屏幕停在可点卡片的列表页;
#   stdout 每行 X\tY\tDUR\tTITLE(与 search-video-cards 同格式,最多 MAXV 行);无卡片 exit 0 空输出;失败 exit 1;日志走 stderr。
set -uo pipefail
C="${DOUYIN_PHONE_ADB:-$HOME/.local/bin/douyin-phone-adb}"
P="$1"; KW="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-same_city}"
log(){ print -u2 -- "[$(date +%H:%M:%S)] $*"; }
nap(){ [[ -n "${HARVEST_KEYWORD_TESTING:-}" ]] && return 0; /bin/sleep "$1" }
# 发现改造(Brain 任务 9a8784b7,名单见 config/discovery-v2.profiles): 按「最新」排序 + 翻屏取满 DISCOVERY_V2_CARDS 张,
# 每行多两列 作者/屏号(第几屏扫到的,0 起;harvest-keyword.sh 据此翻屏后按标题重新定位)。名单外的号原样。
source "${0:A:h}/discovery-v2-lib.sh" || exit 1
SORT=most_liked; DV2=0
discovery_v2_on "$P" && { SORT=latest; DV2=1; }

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
  if $C --profile "$P" search-time-layer six_months "$_stl_eid" "$SORT" unlimited unlimited "$LOC" >/dev/null 2>"$_stl_err"; then _stl_ok=1; break; fi
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
if (( ! DV2 )); then
  $C --profile "$P" search-video-cards "$TAG-cards" 2>/dev/null | grep -E "^[0-9]+	" | head -"$MAXV"
  exit 0
fi
# v2: 一屏只有 4 张,翻屏累积到上限;翻屏有重叠,按标题去重;一屏扫不到新卡(到底/翻不动)即停
DV2_CAP="${DISCOVERY_V2_CARDS:-20}"; DV2_MAXSCR="${DISCOVERY_V2_MAX_SCREENS:-10}"
typeset -A _dv2_seen
_n=0; _scr=0
while :; do
  _new=0; _sfx=""; (( _scr > 0 )) && _sfx="-s$_scr"
  for _line in "${(@f)$($C --profile "$P" search-video-cards "$TAG-cards$_sfx" 2>/dev/null | grep -E "^[0-9]+	")}"; do
    [[ -n "$_line" ]] || continue
    _f=("${(@ps:\t:)_line}"); _t="${_f[4]:-}"
    [[ -n "$_t" && -z "${_dv2_seen[$_t]:-}" ]] || continue
    _dv2_seen[$_t]=1
    print -r -- "$_line	$_scr"
    _n=$((_n+1)); _new=$((_new+1))
    (( _n >= DV2_CAP )) && break
  done
  (( _n >= DV2_CAP || _new == 0 || _scr + 1 >= DV2_MAXSCR )) && break
  $C --profile "$P" search-grid-scroll "$TAG-scroll$_scr" up >/dev/null 2>&1 || { log "翻屏失败,本词卡片到此为止"; break; }
  _scr=$((_scr+1)); nap 2
done
log "v2发现: 最新排序翻 $((_scr+1)) 屏取到 $_n 张卡片"
# 翻回顶部: 采收按屏号从 0 屏起算翻屏定位
for (( _k = 0; _k <= _scr; _k++ )); do
  $C --profile "$P" search-grid-scroll "$TAG-top$_k" down >/dev/null 2>&1 || break
  nap 1
done
exit 0
