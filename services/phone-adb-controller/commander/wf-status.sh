#!/usr/bin/env bash
# wf-status.sh —— Commander 查一次 run 的现状（只读）。
# 用法: wf-status.sh <host> <TAG>
# 输出: 起跑日志尾 + 采收日志里本 TAG 的最近行 + 最后一行 WF_STATUS state=running|finished|unknown
set -uo pipefail
[[ $# -eq 2 ]] || { echo "用法: wf-status.sh <host> <TAG>" >&2; exit 2; }
HOST="$1"; TAG="$2"
[[ "$HOST" == "xian-m4" || "$HOST" == "xian-m1" ]] || { echo "host 只允许 xian-m4 / xian-m1" >&2; exit 2; }
[[ "$TAG" =~ ^[a-z]+[0-9]+$ ]] || { echo "TAG 非法: $TAG" >&2; exit 2; }
OUT=$(ssh -o ConnectTimeout=20 -o BatchMode=yes "$HOST" "
  echo '── 起跑日志'; tail -n 15 ~/wf-logs/$TAG.out 2>/dev/null || echo '(无)'
  echo '── 采收日志'; grep -F '[$TAG]' ~/harvest-cron.log 2>/dev/null | tail -n 25
  if pgrep -f 'wf-run.sh .*--tag $TAG' >/dev/null; then echo 'WF_STATUS state=running';
  elif [ -f ~/wf-logs/$TAG.out ]; then echo 'WF_STATUS state=finished'; else echo 'WF_STATUS state=unknown'; fi
") || { echo "WF_STATUS state=unknown reason=ssh_failed"; exit 1; }
echo "$OUT"
