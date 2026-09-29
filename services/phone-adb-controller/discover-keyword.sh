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
$C --profile "$P" search-time-layer six_months "$TAG-filter" most_liked unlimited unlimited "$LOC" >/dev/null 2>&1 || { log "筛选失败"; exit 1; }
nap 2
$C --profile "$P" search-video-cards "$TAG-cards" 2>/dev/null | grep -E "^[0-9]+	" | head -"$MAXV"
exit 0
