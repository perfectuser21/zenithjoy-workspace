#!/bin/zsh
# harvest-fallback.sh PROFILE SERIAL BIZ N PUSH —— 采收保底扳机(xian-m4 crontab 22:15/02:15/06:15 等,派发总闸D dd7767b8)
# 主路径 = OpenClaw 定时→Commander;保底只在该手机空闲时补跑(网关挂了也不丢批,决策 7f842d12)。
# 以前判"空闲"只靠 crontab 里一句 pgrep:Brain 派下来的手机活(秋米任务/调度单)看不见,保底可能和它同机开打。
# 现在:先向 Brain 领该手机设备锁(owner=harvest-fallback:<机器>:<时间>:<pid>),领不到 = 有别的 run 在用 → 本次跳过;
#   pgrep 保留为第二道(Commander 主路径的采收还不领 Brain 锁,只能靠它看见);
#   采收跑多久锁就心跳续租多久,结束/失败/被 TERM 都放锁(brain-lock.sh run 的 trap)。
# Brain 不可用 → 降级为旧行为(只看 pgrep),不停业务。参数原样透传给 harvest-cron.sh。
set -u
DIR="${0:A:h}"
LOG="${HARVEST_FALLBACK_LOG:-$HOME/harvest-cron.log}"
PROFILE="${1:-}"; SERIAL="${2:-}"
if [[ -z "$PROFILE" || -z "$SERIAL" ]]; then
  print -- "[$(date +%m%d-%H:%M:%S)] 保底: 缺 PROFILE/SERIAL 参数,跳过" >> "$LOG"; exit 64
fi
OWNER="harvest-fallback:$(hostname -s):$(date +%Y%m%dT%H%M%S):$$"
out=$(/bin/bash "$DIR/brain-lock.sh" run "$SERIAL" "$OWNER" --ttl 15 --interval 240 --log "$LOG" \
  --skip-if-pgrep "^/bin/zsh .*(wf-run|harvest-cron)\\.sh .*$SERIAL" \
  -- /bin/zsh "$DIR/harvest-cron.sh" "$@" 2>&1)
rc=$?
if print -r -- "$out" | grep -q '本轮跳过'; then
  print -- "[$(date +%m%d-%H:%M:%S)] 保底($PROFILE/$SERIAL): 手机正被别的 run 使用,本次保底跳过" >> "$LOG"
fi
exit $rc
