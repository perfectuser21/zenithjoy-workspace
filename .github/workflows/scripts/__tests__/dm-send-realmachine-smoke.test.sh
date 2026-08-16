#!/usr/bin/env bash
# dm-send-realmachine-smoke.test.sh
#
# dm-send-realmachine-smoke.sh 的判定纯函数自测（无需真机，CI linux runner 可跑）。
# source --source-only 加载 classify_dm_outcome / dm_outcome_verdict，喂 mock logcat
# 输出做变异测试：确认 SENT→绿 / LIMITED→环境态 / FAILED/NONE→红 各走对分支，
# 防止"广播发出去就判绿"或"把 FAILED 当 SENT"的退化。
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/dm-send-realmachine-smoke.sh"
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; \
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}
verdict_code() { dm_outcome_verdict "$1"; echo $?; }

echo "== classify_dm_outcome：从 logcat 提取终态 =="

DUMP_SENT='I/DouyinDmOutreachService(25625): warmup follow: -> click=true
I/DouyinDmOutreachService(25625): dm_outreach outcome=SENT taskId= error='
check "SENT 全链" "SENT" "$(classify_dm_outcome "$DUMP_SENT")"

DUMP_LIMITED='I/DouyinDmOutreachService(25625): dm_outreach outcome=LIMITED taskId= error=RATE_LIMIT'
check "LIMITED 频控" "LIMITED" "$(classify_dm_outcome "$DUMP_LIMITED")"

DUMP_FAILED='I/DouyinDmOutreachService(25625): dm_outreach outcome=FAILED taskId= error=NO_DM_ENTRY'
check "FAILED 发送失败" "FAILED" "$(classify_dm_outcome "$DUMP_FAILED")"

DUMP_NOMATCH='I/DouyinDmOutreachService(25625): dm_outreach outcome=NO_MATCH taskId= error='
check "NO_MATCH 找不到主页" "NO_MATCH" "$(classify_dm_outcome "$DUMP_NOMATCH")"

# 只有热身、没跑到终态（超时场景）→ NONE
DUMP_NONE='I/DouyinDmOutreachService(25625): warmup follow: -> click=true
I/DouyinDmOutreachService(25625): commitText via SET_TEXT fallback, len=10'
check "无终态(超时)→NONE" "NONE" "$(classify_dm_outcome "$DUMP_NONE")"

# 完全无关日志 → NONE（不能误判成任何 outcome）
DUMP_NOISE='D/IPACM(2301): DeleteRoutingHdl
I/MR2ServiceImpl(2644): registerRouter2'
check "纯噪音→NONE" "NONE" "$(classify_dm_outcome "$DUMP_NOISE")"

# 多条终态取最后一条（同设备连跑）
DUMP_MULTI='I/DouyinDmOutreachService: dm_outreach outcome=FAILED taskId= error=
I/DouyinDmOutreachService: dm_outreach outcome=SENT taskId= error='
check "多终态取最后一条" "SENT" "$(classify_dm_outcome "$DUMP_MULTI")"

echo "== dm_outcome_verdict：三态退出码 =="
check "SENT→0(绿)"      "0" "$(verdict_code SENT)"
check "LIMITED→3(环境)" "3" "$(verdict_code LIMITED)"
check "FAILED→1(红)"    "1" "$(verdict_code FAILED)"
check "NO_MATCH→1(红)"  "1" "$(verdict_code NO_MATCH)"
check "NONE→1(红)"      "1" "$(verdict_code NONE)"
check "未知token→1(红)" "1" "$(verdict_code WHATEVER)"

echo ""
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ 全部通过"
