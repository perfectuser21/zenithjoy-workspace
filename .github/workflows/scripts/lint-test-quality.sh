#!/usr/bin/env bash
# lint-test-quality.sh (ZenithJoy)
# 拦"假测试 stub"：
#   Rule A: readFileSync(src/) grep 占主导 + 无 await fn() 业务调用 → fail
#   Rule B: 完全没 expect → fail
#   Rule C: 全 .skip → fail
#
# 用法：bash lint-test-quality.sh [BASE_REF]
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-test-quality — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

NEW_TESTS=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.(js|ts)$' \
  || true)

if [ -z "$NEW_TESTS" ]; then
  echo "⏭️  无新增 test 文件，跳过"
  exit 0
fi

BAD_STUB=(); BAD_EMPTY=(); BAD_SKIPPED=()

while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  [ ! -f "$tf" ] && continue

  # Rule A: stub 签名（读 src 文件 grep + 无 await 业务调用）
  HAS_FS_SRC=$(grep -cE "readFileSync\s*\([^)]*src/" "$tf" 2>/dev/null || true)
  HAS_FS_SRC="${HAS_FS_SRC:-0}"
  HAS_AWAIT_CALL=$(grep -E "(const|let|var)\s+\w+\s*=\s*await\s|^\s+await\s+[a-zA-Z_]" "$tf" 2>/dev/null \
    | grep -vE "await\s+import\s*\(" \
    | wc -l | tr -d ' ') || true
  HAS_AWAIT_CALL="${HAS_AWAIT_CALL:-0}"

  if [ "$HAS_FS_SRC" -gt 0 ] && [ "$HAS_AWAIT_CALL" -eq 0 ]; then
    BAD_STUB+=("$tf  (readFileSync(src/)=$HAS_FS_SRC, await fn()=0)")
    continue
  fi

  # Rule B: 完全无 expect
  EXPECTS=$(grep -cE "expect\s*\(" "$tf" 2>/dev/null || true)
  EXPECTS="${EXPECTS:-0}"
  if [ "$EXPECTS" -eq 0 ]; then
    BAD_EMPTY+=("$tf")
    continue
  fi

  # Rule C: 全 .skip（it.skip/test.skip 计入 IT_TEST 总数）
  IT_TEST=$(grep -cE "(^|[^a-zA-Z\.])(it|test)(\s*\(|\.skip\s*\()" "$tf" 2>/dev/null || true)
  IT_TEST="${IT_TEST:-0}"
  SKIPS=$(grep -cE "(it|test|describe)\.skip\s*\(" "$tf" 2>/dev/null || true)
  SKIPS="${SKIPS:-0}"
  if [ "$IT_TEST" -gt 0 ] && [ "$SKIPS" -ge "$IT_TEST" ]; then
    BAD_SKIPPED+=("$tf")
    continue
  fi
done <<< "$NEW_TESTS"

FAILED=0

if [ "${#BAD_STUB[@]}" -gt 0 ]; then
  echo ""; echo "::error::lint-test-quality 失败 — Rule A stub（readFileSync(src/) + 无 await fn()）"
  printf "  ❌ %s\n" "${BAD_STUB[@]}"
  FAILED=1
fi

if [ "${#BAD_EMPTY[@]}" -gt 0 ]; then
  echo ""; echo "::error::lint-test-quality 失败 — Rule B 完全无 expect"
  printf "  ❌ %s\n" "${BAD_EMPTY[@]}"
  FAILED=1
fi

if [ "${#BAD_SKIPPED[@]}" -gt 0 ]; then
  echo ""; echo "::error::lint-test-quality 失败 — Rule C 100% .skip"
  printf "  ❌ %s\n" "${BAD_SKIPPED[@]}"
  FAILED=1
fi

[ "$FAILED" -eq 1 ] && exit 1

COUNT=$(echo "$NEW_TESTS" | wc -l | tr -d ' ')
echo "✅ lint-test-quality 通过（${COUNT} 个新增 test 全部含真行为断言）"
