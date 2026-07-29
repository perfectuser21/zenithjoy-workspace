#!/usr/bin/env bash
# account-scan-realmachine-smoke.terminal-assert.test.sh — TDD Red 阶段
#
# round 2 新增（GAN round 1 Verification Oracle 完整性问题修复）：
# 验证 account-scan-realmachine-smoke.sh 的两段式终态断言函数 assert_task_terminal_success
# 不会退化成"只要 account_ids 非空就判绿"（PRD 原始 bug 复现场景：Step30 历史 bug 的翻版）。
#
# 三个 case：
#   A（反例，最贴近原始 bug）: status=failed 但 account_ids 恰好非空（脏数据/上次运行残留）→ 必须判红
#   B（对照/happy path）: status=done 且 account_ids 非空 → 必须判绿（证明函数不是恒失败）
#   C（对照）: status=done 但 account_ids 为空数组（未真读到账号）→ 必须判红
#
# 脚本需支持 `source account-scan-realmachine-smoke.sh --source-only` 只加载函数定义，
# 不触发真机主流程（source-guard: `[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"`）。
#
# Generator 落地时把本文件复制/迁移到 .github/workflows/scripts/__tests__/
# account-scan-realmachine-smoke.terminal-assert.test.sh
#
# 用法: bash account-scan-realmachine-smoke.terminal-assert.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  assert_task_terminal_success 两段式联合断言测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

# shellcheck disable=SC1090
source "$SCRIPT" --source-only 2>/dev/null
if ! declare -F assert_task_terminal_success > /dev/null; then
  echo "❌ RED（预期）: assert_task_terminal_success 函数未定义 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

PASSED=0
FAILED=0

# Case A（反例，PRD 原始 bug 复现场景）：status=failed 但 account_ids 非空 → 必须判红
set +e
assert_task_terminal_success "failed" '{"account_ids":["acc-stale-1"],"error_code":"MUTEX_BUSY"}'
CODE_A=$?
set -e
if [ "$CODE_A" -ne 0 ]; then
  echo "✅ PASS [A] status=failed 但 account_ids 非空 → 正确判红 (exit $CODE_A)"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL [A] status=failed 但 account_ids 非空却判绿 (exit $CODE_A) —— 退化成'只查account_ids'的假绿模式"
  FAILED=$((FAILED+1))
fi

# Case B（对照/happy path）：status=done 且 account_ids 非空 → 必须判绿
set +e
assert_task_terminal_success "done" '{"account_ids":["acc1"]}'
CODE_B=$?
set -e
if [ "$CODE_B" -eq 0 ]; then
  echo "✅ PASS [B] status=done 且 account_ids 非空 → 正确判绿 (exit $CODE_B)"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL [B] status=done 且 account_ids 非空却判红 (exit $CODE_B) —— 函数恒失败，非真实联合判断"
  FAILED=$((FAILED+1))
fi

# Case C（对照）：status=done 但 account_ids 为空数组 → 必须判红
set +e
assert_task_terminal_success "done" '{"account_ids":[]}'
CODE_C=$?
set -e
if [ "$CODE_C" -ne 0 ]; then
  echo "✅ PASS [C] status=done 但 account_ids 为空 → 正确判红 (exit $CODE_C)"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL [C] status=done 但 account_ids 为空却判绿 (exit $CODE_C)"
  FAILED=$((FAILED+1))
fi

echo ""
echo "assert_task_terminal_success: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
