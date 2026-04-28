#!/usr/bin/env bash
# lint-no-fake-test.sh (ZenithJoy)
# 拦弱断言占 100% / mock-heavy + 低 expect 的假覆盖测试：
#   Rule 1: 所有 expect 全是弱断言（toBeDefined/toBeNull/not.toThrow）→ fail
#   Rule 2: vi.mock 数 > 5 且 expect 数 < 3 → fail
#
# 用法：bash lint-no-fake-test.sh [BASE_REF]
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-no-fake-test — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

NEW_TESTS=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.(js|ts)$' \
  || true)

if [ -z "$NEW_TESTS" ]; then
  echo "⏭️  无新增 test 文件，跳过"
  exit 0
fi

BAD_WEAK=(); BAD_MOCK_LOW_EXPECT=()

while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  [ ! -f "$tf" ] && continue

  # 用 grep -o 计次数而非行数，避免同行多 expect/mock 被误算为 1
  EXPECTS=$(grep -oE "expect\s*\(" "$tf" 2>/dev/null | wc -l | tr -d ' ' || true)
  EXPECTS="${EXPECTS:-0}"
  [ "$EXPECTS" -eq 0 ] && continue  # lint-test-quality 的 Rule B 接管

  WEAK=$(grep -oE "\.(toBeDefined|toBeNull|toBeUndefined)\s*\(\s*\)|\.toEqual\s*\(\s*(null|undefined)\s*\)|\.not\.toThrow\s*\(" "$tf" 2>/dev/null | wc -l | tr -d ' ' || true)
  WEAK="${WEAK:-0}"

  if [ "$WEAK" -ge "$EXPECTS" ]; then
    BAD_WEAK+=("$tf  (expect=$EXPECTS weak=$WEAK)")
    continue
  fi

  MOCKS=$(grep -oE "vi\.mock\s*\(" "$tf" 2>/dev/null | wc -l | tr -d ' ' || true)
  MOCKS="${MOCKS:-0}"
  if [ "$MOCKS" -gt 5 ] && [ "$EXPECTS" -lt 3 ]; then
    BAD_MOCK_LOW_EXPECT+=("$tf  (vi.mock=$MOCKS expect=$EXPECTS)")
    continue
  fi
done <<< "$NEW_TESTS"

FAILED=0

if [ "${#BAD_WEAK[@]}" -gt 0 ]; then
  echo ""; echo "::error::lint-no-fake-test 失败 — Rule 1 全弱断言（toBeDefined/toBeNull/not.toThrow）"
  printf "  ❌ %s\n" "${BAD_WEAK[@]}"
  echo "  说明：弱断言让 coverage 100% 但 prod 改坏不挂 — 假覆盖。"
  FAILED=1
fi

if [ "${#BAD_MOCK_LOW_EXPECT[@]}" -gt 0 ]; then
  echo ""; echo "::error::lint-no-fake-test 失败 — Rule 2 mock>5 但 expect<3"
  printf "  ❌ %s\n" "${BAD_MOCK_LOW_EXPECT[@]}"
  echo "  说明：mock 一堆但几乎不断言 = 走过场测试。"
  FAILED=1
fi

[ "$FAILED" -eq 1 ] && exit 1

COUNT=$(echo "$NEW_TESTS" | wc -l | tr -d ' ')
echo "✅ lint-no-fake-test 通过（${COUNT} 个新增 test 全部含真断言）"
