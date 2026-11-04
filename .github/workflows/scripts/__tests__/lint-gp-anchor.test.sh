#!/usr/bin/env bash
# lint-gp-anchor.test.sh — GP锚定闭环刀2 lint脚本测试
# Execute the real lint with a private map copy and controlled Git transport.
# No test depends on the current branch or shares a global /tmp output file.
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/.github/workflows/scripts" "$TEST_ROOT/product-map/generated" "$TEST_ROOT/bin"
cp "$SOURCE_ROOT/.github/workflows/scripts/lint-gp-anchor.sh" "$TEST_ROOT/.github/workflows/scripts/"
cp "$SOURCE_ROOT/product-map/generated/product-map.json" "$TEST_ROOT/product-map/generated/"
cat > "$TEST_ROOT/bin/git" <<'GIT'
#!/bin/sh
case "$1" in
  fetch) exit 0 ;;
  diff) printf '%s\n' "$GP_ANCHOR_TEST_CHANGED" ;;
  *) exit 97 ;;
esac
GIT
chmod +x "$TEST_ROOT/bin/git"
export PATH="$TEST_ROOT/bin:$PATH"
export GP_ANCHOR_TEST_CHANGED=".github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh"
cd "$TEST_ROOT"
LINT="$TEST_ROOT/.github/workflows/scripts/lint-gp-anchor.sh"
OUTPUT="$TEST_ROOT/result.log"

PASSED=0; FAILED=0

check() {
  local name="$1" expect_fail="$2" body="$3"
  set +e
  PR_BODY="$body" bash "$LINT" origin/main > "$OUTPUT" 2>&1
  local rc=$?
  set -e
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got_rc=$rc"; cat "$OUTPUT"; FAILED=$((FAILED+1))
  fi
}

check_contains() {
  local name="$1" needle="$2"
  if grep -q "$needle" "$OUTPUT"; then
    echo "  PASS [$name: contains $needle]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name: missing $needle]"; cat "$OUTPUT"; FAILED=$((FAILED+1))
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

# E: unrelated changes must fail; the same declaration with a touched smoke passes.
GP_ANCHOR_TEST_CHANGED="apps/api/src/unrelated.ts"
check "progressing-without-smoke" 1 "GP-Anchor: line00/gp_anchor_enforcement#step2"
check_contains "progressing-without-smoke" "GP-ANCHOR-NOT-TOUCHED"
GP_ANCHOR_TEST_CHANGED=".github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh"
check "progressing-with-smoke" 0 "GP-Anchor: line00/gp_anchor_enforcement#step2"

# F: 合法keep-green声明(不查diff) → PASS
check "keep-green" 0 "GP-Anchor: line01/customer_first_success keep-green"

# G: 合法none(docs)豁免 → PASS
check "none-docs" 0 "GP-Anchor: none(docs)"

# H: none(白名单外类别) → FAIL
check "none-invalid-category" 1 "GP-Anchor: none(random_made_up_category)"

echo ""; echo "lint-gp-anchor: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
