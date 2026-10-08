#!/bin/zsh
# 用法：qualification|collection PROFILE VIDEO_ID URL TITLE_B64 KEYWORD_B64 RUN_TAG LINE
# 新流程0102的已持锁逐视频动作；队列读取/认领与事务提交由调用方负责。
set -uo pipefail
setopt extendedglob
(( $# == 8 )) || { print -u2 'usage: process-queued-video.sh qualification|collection|identity PROFILE ID URL TITLE_B64 KEYWORD_B64 RUN_TAG LINE'; exit 2; }
MODE="$1"; P="$2"; VID="$3"; VURL="$4"; TAG="$7"; LINE="$8"
[[ "$MODE" == qualification || "$MODE" == collection || "$MODE" == identity ]] || exit 2
[[ "$VID" == <-> && ${#VID} -ge 16 && ${#VID} -le 24 ]] || exit 2
[[ "$TAG" == [A-Za-z0-9_-]## && -n "$P" && -n "$LINE" ]] || exit 2
TITLE="$(python3 -c 'import base64,sys;print(base64.b64decode(sys.argv[1],validate=True).decode())' "$5")" || exit 2
KWTXT="$(python3 -c 'import base64,sys;print(base64.b64decode(sys.argv[1],validate=True).decode())' "$6")" || exit 2
# 输出TSV，禁止队列文本换行/制表符破坏字段边界。
[[ "$TITLE$KWTXT$VURL" != *$'\t'* && "$TITLE$KWTXT$VURL" != *$'\n'* ]] || exit 2
QV_DIR="${0:A:h}"; C="${DOUYIN_PHONE_ADB:-$HOME/.local/bin/douyin-phone-adb}"
QV_OWN_CONF="${OWN_ACCOUNTS_CONF:-$HOME/bin-harvest/config/own-accounts.json}"
[[ -r "$QV_OWN_CONF" ]] || QV_OWN_CONF="$QV_DIR/config/own-accounts.json"
source "$QV_DIR/queued-video-lib.sh" || exit 2
qv_open || exit $?
if [[ "$MODE" == identity ]]; then
  print -- "IDENTITY\t$VID\tverified"
elif [[ "$MODE" == qualification ]]; then
  qv_qualify
else
  QV_RESCANS=0
  qv_collect; rc=$?
  print -- "RESCAN\t$VID\t$QV_RESCANS"
  exit "$rc"
fi
