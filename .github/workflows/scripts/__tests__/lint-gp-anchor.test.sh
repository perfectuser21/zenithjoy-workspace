#!/usr/bin/env bash
# lint-gp-anchor.test.sh — GP锚定闭环刀2 lint脚本测试
# 与 lint-feature-has-smoke.test.sh 不同：本脚本读取"当前真实repo"的
# product-map/generated/product-map.json + 相对origin/main的真实diff，
# 不需要隔离tmp git repo（格式/id校验与git历史无关，diff触碰测试就要用
# 本分支相对origin/main的真实变更——这正是刀2自身要验收的"自举"场景）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
LINT=".github/workflows/scripts/lint-gp-anchor.sh"

PASSED=0; FAILED=0

check() {
  local name="$1" expect_fail="$2" body="$3"
  set +e
  PR_BODY="$body" bash "$LINT" origin/main > /tmp/lint-gpa-out.txt 2>&1
  local rc=$?
  set -e
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got_rc=$rc"; cat /tmp/lint-gpa-out.txt; FAILED=$((FAILED+1))
  fi
}

check_contains() {
  local name="$1" needle="$2"
  if grep -q "$needle" /tmp/lint-gpa-out.txt; then
    echo "  PASS [$name: contains $needle]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name: missing $needle]"; cat /tmp/lint-gpa-out.txt; FAILED=$((FAILED+1))
  fi
}

# A: 空body → FAIL + GP-ANCHOR-MISSING
check "empty-body" 1 ""
check_contains "empty-body" "GP-ANCHOR-MISSING"

# B: 无GP-Anchor行 → FAIL + GP-ANCHOR-MISSING
check "no-anchor-line" 1 "just some random PR description"
check_contains "no-anchor-line" "GP-ANCHOR-MISSING"

# C: 多行GP-Anchor声明 → FAIL + GP-ANCHOR-MULTIPLE
check "multiple-anchor-lines" 1 "$(printf 'GP-Anchor: a\nGP-Anchor: b')"
check_contains "multiple-anchor-lines" "GP-ANCHOR-MULTIPLE"

# D: 不存在的line/gp id → FAIL + GP-ANCHOR-ID-NOTFOUND
check "nonexistent-id" 1 "GP-Anchor: line99/nonexistent_gp#step1"
check_contains "nonexistent-id" "GP-ANCHOR-ID-NOTFOUND"

# E: 合法推进声明(本刀自身,自举验收) → PASS
check "self-bootstrap-progressing" 0 "GP-Anchor: line00/gp_anchor_enforcement#step2"

# F: 合法keep-green声明(不查diff) → PASS
check "keep-green" 0 "GP-Anchor: line01/customer_first_success keep-green"

# G: 合法none(docs)豁免 → PASS
check "none-docs" 0 "GP-Anchor: none(docs)"

# H: none(白名单外类别) → FAIL
check "none-invalid-category" 1 "GP-Anchor: none(random_made_up_category)"

echo ""; echo "lint-gp-anchor: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
