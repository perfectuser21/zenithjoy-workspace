#!/usr/bin/env bash
# wf-status.sh —— Commander 查一次 run 的现状（只读）。
# 用法: wf-status.sh <host> <TAG>     host=xian-m4/xian-m1（获客 wf-run 形态）或 mmv（codex_agent 形态，MMV 本机外壳 runner）
# 输出: 起跑日志尾 + 采收日志里本 TAG 的最近行 + 最后一行 WF_STATUS state=running|finished|unknown
set -uo pipefail
if [[ $# -eq 1 ]]; then
  exec python3 "$(cd "$(dirname "$0")" && pwd)/wf-v2.py" status "$1"
fi
[[ $# -eq 2 ]] || { echo "用法: wf-status.sh <host> <TAG>" >&2; exit 2; }
HOST="$1"; TAG="$2"
[[ "$HOST" == "xian-m4" || "$HOST" == "xian-m1" || "$HOST" == "mmv" ]] || { echo "host 只允许 xian-m4 / xian-m1 / mmv" >&2; exit 2; }
[[ "$TAG" =~ ^[a-z]+[0-9]+$ ]] || { echo "TAG 非法: $TAG" >&2; exit 2; }
if [[ "$HOST" == "mmv" ]]; then
  # codex_agent 形态（任务 c0fe7e30）：runner 跑在本机，日志 ~/wf-logs/<TAG>.out；收尾 trap 必写 WF_RUN_FINISHED
  LOG="$HOME/wf-logs/$TAG.out"
  echo '── 起跑日志'; tail -n 25 "$LOG" 2>/dev/null || echo '(无)'
  if pgrep -f "wf-agent-run.sh .*--tag $TAG" >/dev/null 2>&1; then echo 'WF_STATUS state=running'
  elif grep -q WF_RUN_FINISHED "$LOG" 2>/dev/null; then echo 'WF_STATUS state=finished'
  elif [[ -f "$LOG" ]]; then echo 'WF_STATUS state=unknown reason=runner_gone_without_finish'
  else echo 'WF_STATUS state=unknown'; fi
  exit 0
fi
OUT=$(ssh -o ConnectTimeout=20 -o BatchMode=yes "$HOST" "
  echo '── 起跑日志'; tail -n 15 ~/wf-logs/$TAG.out 2>/dev/null || echo '(无)'
  echo '── 采收日志'; grep -F '[$TAG]' ~/harvest-cron.log 2>/dev/null | tail -n 25
  if pgrep -f 'wf-run.sh .*--tag $TAG' >/dev/null; then echo 'WF_STATUS state=running';
  elif [ -f ~/wf-logs/$TAG.out ]; then echo 'WF_STATUS state=finished'; else echo 'WF_STATUS state=unknown'; fi
") || { echo "WF_STATUS state=unknown reason=ssh_failed"; exit 1; }
echo "$OUT"
