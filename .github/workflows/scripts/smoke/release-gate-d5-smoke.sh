#!/usr/bin/env bash
# release-gate-d5-smoke.sh — W5 D5 two-column-gate.sh smoke 验收
#
# 验收内容：
#   1. two-column-gate.sh 脚本存在且可执行
#   2. --fixture 模式五情形逐一验证
#   3. promote-all-prod.yml 包含证据③接线
#   4. promote-all-prod.yml promote-dashboard job 包含 inputs.sha 绑定
#
# TASK_ID: 11cc5f4c-9bd0-4612-bf5a-9a6b574756af

set -euo pipefail

SCRIPT="scripts/release-gate/two-column-gate.sh"
FIXTURE_DIR="scripts/release-gate/fixtures"
PROMOTE_SHA="aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee"
PASS=0; FAIL=0

check() {
  local label="$1"; local code="$2"; local expected="$3"
  if [ "$code" -eq "$expected" ]; then
    echo "[PASS] $label (exit $code)"
    PASS=$((PASS+1))
  else
    echo "[FAIL] $label (expected exit $expected, got $code)"
    FAIL=$((FAIL+1))
  fi
}

# ── 1. 脚本存在且可执行 ────────────────────────────────────────────────────
[ -x "$SCRIPT" ] && echo "[PASS] two-column-gate.sh 可执行" && PASS=$((PASS+1)) \
  || { echo "[FAIL] two-column-gate.sh 不存在或不可执行"; FAIL=$((FAIL+1)); }

# ── 2. 五情形 --fixture 验证 ──────────────────────────────────────────────

# 情形1：未定案 → exit 1
set +e; bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-not-finalized.json" 2>/dev/null; C=$?; set -e
check "情形1: 未定案→exit 1" "$C" 1

# 情形2：定案绿 + sha 匹配 → exit 0
set +e; PROMOTE_SHA="$PROMOTE_SHA" bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-green.json" 2>/dev/null; C=$?; set -e
check "情形2: 定案绿+sha匹配→exit 0" "$C" 0

# 情形3：fixture 不存在 → exit 1
set +e; bash "$SCRIPT" --fixture "$FIXTURE_DIR/nonexistent.json" 2>/dev/null; C=$?; set -e
check "情形3: fixture不存在→exit 1" "$C" 1

# 情形4：infra_error + bypass=true → exit 0
set +e; PROMOTE_SHA="$PROMOTE_SHA" BYPASS_TWO_COLUMN_INFRA=true bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-infra-error-bypass.json" 2>/dev/null; C=$?; set -e
check "情形4: infra_error+bypass→exit 0" "$C" 0

# 情形5：cells_red + bypass=true → exit 1
set +e; PROMOTE_SHA="$PROMOTE_SHA" BYPASS_TWO_COLUMN_INFRA=true bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-cells-red-bypass.json" 2>/dev/null; C=$?; set -e
check "情形5: cells_red+bypass→exit 1" "$C" 1

# ── 3. promote-all-prod.yml 证据③接线 ────────────────────────────────────
grep -q "two-column-gate.sh" .github/workflows/promote-all-prod.yml \
  && { echo "[PASS] INV-1: 证据③ two-column-gate.sh 接线存在"; PASS=$((PASS+1)); } \
  || { echo "[FAIL] INV-1: 缺证据③接线"; FAIL=$((FAIL+1)); }

grep -q "release-gate" .github/workflows/promote-all-prod.yml \
  && { echo "[PASS] INV-1: promote-backend needs release-gate"; PASS=$((PASS+1)); } \
  || { echo "[FAIL] INV-1: 缺 release-gate 依赖"; FAIL=$((FAIL+1)); }

# ── 4. promote-dashboard sha 绑定 ────────────────────────────────────────
grep -q "inputs.sha" .github/workflows/promote-all-prod.yml \
  && { echo "[PASS] INV-5: promote-dashboard sha 绑定到 inputs.sha"; PASS=$((PASS+1)); } \
  || { echo "[FAIL] INV-5: promote-dashboard 未绑定 inputs.sha"; FAIL=$((FAIL+1)); }

# ── 5. INV-6: secrets 不硬编码 ──────────────────────────────────────────
if grep -qE "ghp_|token_[a-zA-Z0-9]{20}" "$SCRIPT" 2>/dev/null; then
  echo "[FAIL] INV-6: 发现 token 字面量"
  FAIL=$((FAIL+1))
else
  echo "[PASS] INV-6: 无 token 字面量"
  PASS=$((PASS+1))
fi

# ── 结果汇总 ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════"
echo " release-gate-d5-smoke: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
