#!/bin/bash
# bypass-report.sh —— 动手机旁路上报（派发总闸 H「旁路报警」，Brain 任务 865b502c）
#
# 为什么有它：手机活应当经 Brain 派发（Brain 选机器/手机/账号再下派，决策 23cc0951）。执行机 crontab、
#   ZenithJoy 领单器等旁路仍会直接动手机。douyin-phone-adb 在领锁成功、对外动作点击前后台调用本脚本，
#   把「谁（run/持有者）在哪台手机做了什么」报给 Brain；是否关联 Brain 任务由 Brain 侧判定，只记旁路。
#   先只告警不拦截：本脚本永远退出 0，Brain 不可用/没配置一律静默。
#
# 用法：bypass-report.sh <kind> <serial> <owner> <action> <command>
#   kind = phone_lock | phone_outward
# 环境：BRAIN_URL / BRAIN_INTERNAL_TOKEN 优先；缺了从 ${BRAIN_LOCK_ENV:-~/.credentials/brain.env} 补（同 brain-lock.sh）。
#   BRAIN_TASK_ID / BRAIN_RUN_ID 存在则一并带上（Brain 派发的活会注入，仅留痕，关联仍以 Brain 侧判定为准）。
set -u
kind="${1:-}" serial="${2:-}" owner="${3:-}" action="${4:-}" command="${5:-}"
[[ -n "$kind" ]] || exit 0

u="${BRAIN_URL:-}" t="${BRAIN_INTERNAL_TOKEN:-}"
f="${BRAIN_LOCK_ENV:-$HOME/.credentials/brain.env}"
if [[ -z "$u" || -z "$t" ]] && [[ -r "$f" ]]; then
  # shellcheck disable=SC1090
  . "$f" 2>/dev/null
  [[ -n "$u" ]] && BRAIN_URL="$u"
  [[ -n "$t" ]] && BRAIN_INTERNAL_TOKEN="$t"
fi
BRAIN_URL="${BRAIN_URL:-}"; BRAIN_URL="${BRAIN_URL%/}"
[[ -n "$BRAIN_URL" ]] || exit 0

body=$(python3 -c 'import json,sys,os
k,s,o,a,c,h=sys.argv[1:7]
d={"kind":k,"device":s,"owner":o,"action":a,"command":c,"host":h,"source":"phone-adb-controller"}
for env,key in (("BRAIN_TASK_ID","task_id"),("BRAIN_RUN_ID","run_id")):
    v=os.environ.get(env,"").strip()
    if v: d[key]=v
print(json.dumps(d))' "$kind" "$serial" "$owner" "$action" "$command" "$(/bin/hostname -s 2>/dev/null || echo unknown)" 2>/dev/null) || exit 0

curl -sS --connect-timeout 3 -m 5 -o /dev/null -X POST "$BRAIN_URL/api/brain/bypass-actions/report" \
  -H "Authorization: Bearer ${BRAIN_INTERNAL_TOKEN:-}" -H 'Content-Type: application/json' \
  --data-binary "$body" >/dev/null 2>&1
exit 0
