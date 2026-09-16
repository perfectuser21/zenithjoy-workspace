#!/bin/zsh
# log-stream-push.sh v3 — 实时推流(0916修:每行打机器标签防哨兵认错机;只tail存在的文件防==>表头污染)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
HOST=$(hostname -s | grep -qi m4 && echo xian-m4 || echo xian-m1)
while true; do
  FILES=()
  [[ -f ~/harvest-cron.log ]] && FILES+=(~/harvest-cron.log)
  [[ -f ~/outreach.log ]] && FILES+=(~/outreach.log)
  if (( ${#FILES} == 0 )); then sleep 60; continue; fi
  tail -F -q -n0 $FILES 2>/dev/null | sed -u "s/^/[$HOST] /" | ssh -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 us-vps "cat >> /opt/openclaw/state/m4-logs/${HOST}-live.log"
  sleep 15
done
