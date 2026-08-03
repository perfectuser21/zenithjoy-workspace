#!/usr/bin/env bash
# account-scan-realmachine-smoke.envfail-red.test.sh — TDD Red 阶段
#
# decision 2f11ae25（invariant，用户拍板 2026-08-03）：envfail(exit 3) 必须 job 红+报警，
# 不准映射成 job success(infra-skip)。supersede sprint 07292330 合同"infra-skip 不计绿/红"条款。
# 断言 nightly-real-machine-staging.yml 刀D step：
#   1. 不存在 "-eq 3 → exit 0" 包装分支
#   2. exit "$CODE" 真实退出码保留
#   3. outputs.code 写入保留（nightly-report 靠它区分 envfail 标签）
#   4. nightly-report 红判定仍 key 在 result=failure（不依赖 code，容忍 code 为空）
set -uo pipefail
WF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/nightly-real-machine-staging.yml"
echo "━━ envfail-red 结构性测试 ━━"
[ -f "$WF" ] || { echo "❌ $WF 不存在"; exit 1; }
FAIL=0

# "-eq 3" 条件后 6 行内出现 exit 0 = 包装还在（窗口放宽防中间夹 echo 漏检）
WRAP=$(awk '/-eq 3/{found=NR} found && NR<=found+6 && /exit 0/{print NR; exit}' "$WF")
if [ -n "$WRAP" ]; then
  echo "❌ FAIL: 刀D 仍有 envfail(exit 3)→exit 0 包装 (line $WRAP)——违反 decision 2f11ae25"; FAIL=1
else
  echo "✅ 无 exit 3→exit 0 包装"
fi
grep -q 'exit "\$CODE"' "$WF" || { echo "❌ FAIL: exit \"\$CODE\" 真实退出码丢失"; FAIL=1; }
grep -q 'code=\$CODE.*GITHUB_OUTPUT' "$WF" || { echo "❌ FAIL: outputs.code 写入丢失"; FAIL=1; }
grep -q '"\$ACCOUNT_SCAN" = "failure"' "$WF" || { echo "❌ FAIL: nightly-report 红判定不再 key 在 result=failure"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
