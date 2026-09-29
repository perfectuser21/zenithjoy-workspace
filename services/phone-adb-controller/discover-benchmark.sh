#!/bin/zsh
# discover-benchmark.sh — 对标发现（对标链接获客 · discovery 活动，0929 决策 7f842d12）
# 用法: discover-benchmark.sh PROFILE SOURCE_ENC MAXV TAG LOC
#   SOURCE_ENC = url-encode 过的对标主页链接（douyin.com/user/<sec_uid> 或 v.douyin.com 短链）或裸 sec_uid
#   LOC        = 仅为与 harvest-keyword.sh 发现段接口对齐，对标发现不按地域筛
# 约定（与 runner 共同遵守，别改）:
#   调用时本 run 已持设备锁且 App 已开；执行后屏幕停在对标主页「作品」网格（可点卡片的列表页）；
#   stdout 每行 X\tY\tDUR\tTITLE，最多 MAXV 行（DUR/TITLE 主页网格树上读不到，留空但列齐）；
#   对标账号无公开作品 → exit 0 空输出；失败 → exit 1；日志全走 stderr。
# 逐视频处理完后调用方须用 `douyin-phone-adb back-to-profile`（默认最多 10 次 back，取链后真机要 7 次）归位（不是 back-to-results——
#   那个只认搜索结果页，在主页上会一路按 back 把人退出抖音）。
set -uo pipefail
C="${DOUYIN_PHONE_ADB:-$HOME/.local/bin/douyin-phone-adb}"
P="$1"; SRC_ENC="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-}"
log(){ print -u2 -- "[$(date +%H:%M:%S)] discover-benchmark: $*"; }
[[ "$MAXV" == <-> ]] && (( MAXV >= 1 )) || { log "MAXV 必须是正整数: $MAXV"; exit 1; }
SRC="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))' "$SRC_ENC")"
[[ -n "$SRC" ]] || { log "SOURCE 为空"; exit 1; }
ERRF="$(mktemp -t discover-benchmark.XXXXXX)"
trap 'rm -f "$ERRF"' EXIT
tail_err(){ tail -2 "$ERRF" | tr '\n' ' ' | head -c 240; }
cards_of(){ print -r -- "$1" | grep -E $'^[0-9]+\t[0-9]+\t'; }

# step1 open_benchmark_profile：deeplink 打开 + 回读校验（控制器内建：先归位 feed，再验「他人主页」树）
OPEN="$($C --profile "$P" open-user-profile "$SRC" "$TAG-bench" 2>"$ERRF")" \
  || { log "打开对标主页失败: $(tail_err)"; exit 1; }
field(){ print -r -- "$OPEN" | sed -n "s/^$1=//p" | head -1; }
log "已打开对标主页 sec_uid=$(field sec_uid) 抖音号=$(field douyin_id) 昵称=$(field nickname) 作品数=$(field works_count)"
[[ "$(field works_count)" == 0 ]] && { log "对标账号无公开作品(works_count=0),empty_ok"; exit 0; }

# step2 list_recent_videos：读作品网格。首屏被主页头部占掉大半（真机 3~6 格），不够 MAXV 时
# 慢速上滑一次把「作品」tab 推到吸顶位，网格铺满全屏（真机 12 格）再重读。
# 只滑这一次，之后坐标固定；点进视频再 back 回主页，RecyclerView 保持滚动位置（0929 真机实证）。
read_cards(){ $C --profile "$P" profile-video-cards "$TAG-$1" 2>>"$ERRF"; }
RAW="$(read_cards pcards)" || { log "读作品网格失败: $(tail_err)"; exit 1; }
print -r -- "$RAW" | grep -q '^empty_results=true' && { log "主页网格为空(无公开作品),empty_ok"; exit 0; }
CARDS="$(cards_of "$RAW")"
N="$(print -r -- "$CARDS" | grep -c .)"
if (( N < MAXV )); then
  TAB_Y="$(grep -oE 'content-desc="作品[^"]*"[^>]*selected="true"[^>]*bounds="\[[0-9]+,[0-9]+\]' "$(field evidence)" 2>/dev/null | head -1 | sed -E 's/.*,([0-9]+)\]$/\1/')"
  MIDX="$(print -r -- "$CARDS" | sed -n 2p | cut -f1)"; [[ "$MIDX" == <-> ]] || MIDX=600
  if [[ "$TAB_Y" == <-> ]] && (( TAB_Y > 700 )); then
    log "首屏只有 $N 格 < $MAXV,上滑一次让作品 tab 吸顶(tab y=$TAB_Y)"
    $C --profile "$P" swipe "$MIDX" "$TAB_Y" "$MIDX" 350 1500 >/dev/null 2>>"$ERRF" || { log "上滑失败: $(tail_err)"; exit 1; }
    sleep 2
    # 滑过之后首屏坐标已失效：重读失败/为空只能报错，不能退回旧坐标
    RAW="$(read_cards pcards2)" || { log "上滑后重读作品网格失败: $(tail_err)"; exit 1; }
    CARDS="$(cards_of "$RAW")"
  fi
fi
[[ -n "$CARDS" ]] || { log "作品网格无可点卡片"; exit 1; }
print -r -- "$CARDS" | head -"$MAXV"
log "输出卡片 $(print -r -- "$CARDS" | head -"$MAXV" | grep -c .) 张"
exit 0
