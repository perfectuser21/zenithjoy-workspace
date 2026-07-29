#!/usr/bin/env bash
# lint-smoke-mock-honesty.test.sh — TDD Red 阶段
#
# 3 case，跟进 .github/workflows/scripts/__tests__/lint-no-fake-test.test.sh 的 run_case 风格：
#   A: 假 payload 步骤（POST *-result 端点硬编码 error_code，断言读回同值）无 [CI-MOCK] 标记 → FAIL
#   B: 同一假 payload 步骤补上 [CI-MOCK: real-device-only | nightly_ref: X] 标记 → PASS
#   C: 普通真实断言步骤（非 *-result 自我实现假测试模式）无标记 → PASS（不应被误伤）
#
# 迁移自 sprints/07292330-realmachine-verify-lane/tests/lint-smoke-mock-honesty.test.sh
#
# 用法: bash lint-smoke-mock-honesty.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts"
LINT="$SCRIPT_DIR/lint-smoke-mock-honesty.sh"

PASSED=0; FAILED=0

run_case() {
  local name="$1" expect_fail="$2" content="$3"
  local TMPDIR; TMPDIR=$(mktemp -d)
  printf '%s\n' "$content" > "$TMPDIR/golden-path-99-${name}-smoke.sh"

  set +e
  bash "$LINT" "$TMPDIR" > /tmp/lint-smh-out.txt 2>&1
  local rc=$?
  set -e

  rm -rf "$TMPDIR"

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] (期望报红，实得 exit=$rc)"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] (期望放行，实得 exit=$rc)"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got_exit=$rc"; cat /tmp/lint-smh-out.txt; FAILED=$((FAILED+1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  lint-smoke-mock-honesty.sh 测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -x "$LINT" ]; then
  echo "❌ RED（预期）: $LINT 不存在或不可执行 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

# A: 假 payload 无标记 → FAIL（PRD Step30 原始 bug 复现：写死 error_code 再断言读回同值）
run_case "unmarked-fake" 1 '#!/usr/bin/env bash
echo "▶ Step 30: account-scan-result 失败留痕"
RESP=$(curl -fsSk -X POST "$API_BASE/account-scan-result" -d '"'"'{"agent_id":"x","request_id":"y","ok":false,"error_code":"OPEN_PANEL_FAILED"}'"'"')
ROW=$(psql "$DB" -tA -c "SELECT error_code FROM zenithjoy.agent_scan_failures WHERE request_id='"'"'y'"'"'")
[ "$ROW" = "OPEN_PANEL_FAILED" ] || exit 1'

# B: 同一假 payload 步骤加标记 → PASS
run_case "marked-fake" 0 '#!/usr/bin/env bash
# [CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]
echo "▶ Step 30: account-scan-result 失败留痕"
RESP=$(curl -fsSk -X POST "$API_BASE/account-scan-result" -d '"'"'{"agent_id":"x","request_id":"y","ok":false,"error_code":"OPEN_PANEL_FAILED"}'"'"')
ROW=$(psql "$DB" -tA -c "SELECT error_code FROM zenithjoy.agent_scan_failures WHERE request_id='"'"'y'"'"'")
[ "$ROW" = "OPEN_PANEL_FAILED" ] || exit 1'

# C: 普通真实断言（非 *-result 自我实现假测试模式）无标记 → PASS，不应被误伤
run_case "real-assertion" 0 '#!/usr/bin/env bash
echo "▶ Step 1: 健康检查"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/health")
[ "$HTTP" = "200" ] || exit 1'

echo ""; echo "lint-smoke-mock-honesty: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
