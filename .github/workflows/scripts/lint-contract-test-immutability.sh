#!/usr/bin/env bash
# lint-contract-test-immutability.sh
# 检查 sprints/*/tests/**/*.test.ts 在 PR 内首次出现的 commit 之后不得再被修改。
# 调用方式: bash lint-contract-test-immutability.sh origin/main

set -euo pipefail

BASE_REF="${1:-origin/main}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Lint — Contract Test Immutability"
echo "  Base: $BASE_REF"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 本 PR 改动的所有 sprint 测试文件
TEST_FILES=$(git diff --name-only "$BASE_REF...HEAD" 2>/dev/null \
  | grep -E '^sprints/.+/tests/.+\.test\.ts$' || true)

if [ -z "$TEST_FILES" ]; then
  echo "本 PR 未涉及 sprints/*/tests/**/*.test.ts，跳过检查"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✅ Contract Test Immutability PASSED (no sprint tests)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

echo "检测到以下 sprint 测试文件改动："
echo "$TEST_FILES" | sed 's/^/  - /'
echo ""

FAILED=false

while IFS= read -r FILE; do
  # 在 PR 内首次引入（Added）此文件的 commit（最早的那个）
  FIRST_COMMIT=$(git log --reverse --diff-filter=A --format="%H" "$BASE_REF..HEAD" -- "$FILE" 2>/dev/null | head -1 || true)

  if [ -z "$FIRST_COMMIT" ]; then
    # 文件在 PR 之前就存在，本 PR 对它做了修改 → 直接 FAIL
    echo "❌ FAIL: $FILE 在 PR 之前已存在，但本 PR 仍对其做了修改"
    echo "   合同测试文件一旦落盘不可更改（CI 机械闸）"
    echo ""
    FAILED=true
    continue
  fi

  # 首次引入之后是否还有修改
  LATER_MODS=$(git log --format="%H %s" "${FIRST_COMMIT}..HEAD" -- "$FILE" 2>/dev/null || true)

  if [ -n "$LATER_MODS" ]; then
    echo "❌ FAIL: $FILE 在首次引入后被再次修改"
    echo "   首次引入 commit: $FIRST_COMMIT"
    echo "   后续修改 commit:"
    echo "$LATER_MODS" | sed 's/^/     /'
    echo ""
    echo "   合同测试文件（sprints/*/tests/**/*.test.ts）一旦在 PR 内首次出现，"
    echo "   后续 commit 不得再对其做任何修改。"
    echo "   如需修正测试，必须关闭本 PR，重新走合同评审流程。"
    echo ""
    FAILED=true
  else
    echo "✅ OK: ${FILE}（首次引入后未再修改）"
  fi
done <<< "$TEST_FILES"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAILED" = "true" ]; then
  echo "  ❌ Contract Test Immutability FAILED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo "  ✅ Contract Test Immutability PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
