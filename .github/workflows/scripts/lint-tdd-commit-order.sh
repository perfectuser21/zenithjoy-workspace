#!/usr/bin/env bash
# lint-tdd-commit-order.sh (ZenithJoy)
# 验证：含 apps/*/src/*.ts 改动的 commit 之前必须有 *.test.ts commit（TDD 纪律）
#
# 算法：按时间顺序扫 PR commits（旧→新）
#   - 看到 *.test.ts commit → SEEN_TEST=1
#   - 看到 apps/*/src/*.ts（非 test）且 SEEN_TEST=0 → 失败
#   - 同 commit 内 test + src 共存视为通过
#
# 用法：bash lint-tdd-commit-order.sh [BASE_REF]
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-tdd-commit-order — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

COMMITS=$(git log --reverse --pretty=%H "${BASE_REF}..HEAD" 2>/dev/null || true)
if [ -z "$COMMITS" ]; then
  echo "⏭️  PR 无新 commit，跳过"
  exit 0
fi

SEEN_TEST=0
FIRST_BAD_SHA=""
FIRST_BAD_FILES=""

while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  CHANGED=$(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null || true)

  HAS_TEST=$(echo "$CHANGED" | grep -E '\.(test|spec)\.ts$|/__tests__/|/tests/' || true)
  HAS_SRC=$(echo "$CHANGED" \
    | grep -E '^apps/[^/]+/src/.*\.ts$' \
    | grep -vE '\.(test|spec)\.ts$|/__tests__/' \
    || true)

  if [ -n "$HAS_TEST" ]; then
    REAL_TEST_FOUND=0
    while IFS= read -r tf; do
      [ -z "$tf" ] && continue
      [ ! -f "$tf" ] && continue
      ADDED=$(git show "$sha" -- "$tf" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+')
      if echo "$ADDED" | grep -qE "(^|[^a-zA-Z\.])(it|test)\s*\("; then
        ADDED_NONSKIP=$(echo "$ADDED" | grep -cE "(^|[^a-zA-Z\.])(it|test)\s*\(" || true)
        ADDED_SKIPS=$(echo "$ADDED" | grep -cE "(it|test|describe)\.skip\s*\(" || true)
        ADDED_NONSKIP="${ADDED_NONSKIP:-0}"
        ADDED_SKIPS="${ADDED_SKIPS:-0}"
        if [ "$ADDED_NONSKIP" -gt 0 ] && [ "$ADDED_SKIPS" -lt "$ADDED_NONSKIP" ]; then
          REAL_TEST_FOUND=1
          break
        fi
      fi
    done <<< "$HAS_TEST"
    [ "$REAL_TEST_FOUND" -eq 1 ] && SEEN_TEST=1
  fi

  if [ -n "$HAS_SRC" ] && [ "$SEEN_TEST" -eq 0 ]; then
    FIRST_BAD_SHA="$sha"
    FIRST_BAD_FILES="$HAS_SRC"
    break
  fi
done <<< "$COMMITS"

if [ -n "$FIRST_BAD_SHA" ]; then
  echo "::error::lint-tdd-commit-order 失败 — TDD 纪律违反"
  echo "  commit $FIRST_BAD_SHA 含 apps/*/src/*.ts 改动，但此前无 *.test.ts commit"
  echo "  TDD iron law: NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"
  echo "  src 文件:"; echo "$FIRST_BAD_FILES" | sed 's/^/    /'
  echo "  修复: git rebase -i ${BASE_REF}  # 调整 commit 顺序，让 fail-test commit 在前"
  echo "  PR commit 历史:"; git log --oneline "${BASE_REF}..HEAD"
  exit 1
fi

echo "✅ lint-tdd-commit-order 通过"
