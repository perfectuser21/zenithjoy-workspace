#!/usr/bin/env bash
# lint-test-pairing.sh (ZenithJoy)
# 验证：PR 新增/修改的 apps/*/src/**/*.ts（非测试）必须配套 *.test.ts
# 候选测试位置：
#   同目录 <name>.test.ts
#   同目录 __tests__/<name>.test.ts
#   apps/api/tests/<relative>/<name>.test.ts
#   <name>.spec.ts
#
# 用法：bash lint-test-pairing.sh [BASE_REF]
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-test-pairing — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

ADDED_SRC=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "^apps/[^/]+/src/.*\.ts$" \
  | grep -v "/__tests__/" \
  | grep -vE "\.(test|spec)\.ts$" \
  || true)

if [ -z "$ADDED_SRC" ]; then
  echo "⏭️  无新增/修改 apps src ts，跳过"
  exit 0
fi

PR_TESTS=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "\.(test|spec)\.ts$|/__tests__/|/tests/" \
  || true)

MISSING=()
while IFS= read -r src; do
  [ -z "$src" ] && continue
  base=$(basename "$src" .ts)
  dir=$(dirname "$src")
  cand1="${dir}/${base}.test.ts"
  cand2="${dir}/__tests__/${base}.test.ts"
  cand3="${dir}/${base}.spec.ts"

  cand4=""
  if echo "$src" | grep -q "^apps/api/src/"; then
    rel="${src#apps/api/src/}"
    rel_dir=$(dirname "$rel")
    rel_base=$(basename "$rel" .ts)
    if [ "$rel_dir" = "." ]; then
      cand4="apps/api/tests/${rel_base}.test.ts"
    else
      cand4="apps/api/tests/${rel_dir}/${rel_base}.test.ts"
    fi
  fi

  found=0
  for cand in "$cand1" "$cand2" "$cand3" ${cand4:+"$cand4"}; do
    if echo "$PR_TESTS" | grep -qxF "$cand" || [ -f "$cand" ]; then
      found=1
      break
    fi
  done

  if [ "$found" -eq 0 ]; then
    MISSING+=("$src")
  fi
done <<< "$ADDED_SRC"

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 src 缺配套 test:"
  for f in "${MISSING[@]}"; do
    base=$(basename "$f" .ts)
    dir=$(dirname "$f")
    echo "  ❌ $f"
    echo "     候选: ${dir}/${base}.test.ts  或  ${dir}/__tests__/${base}.test.ts"
  done
  exit 1
fi

# 内容校验：配套 test 文件必须含真断言，不能纯 skip / 空
EMPTY_TESTS=()
SKIPPED_ONLY=()
while IFS= read -r src; do
  [ -z "$src" ] && continue
  base=$(basename "$src" .ts)
  dir=$(dirname "$src")

  top_cand=""
  if echo "$src" | grep -q "^apps/api/src/"; then
    rel="${src#apps/api/src/}"
    rel_dir=$(dirname "$rel")
    rel_base=$(basename "$rel" .ts)
    if [ "$rel_dir" = "." ]; then
      top_cand="apps/api/tests/${rel_base}.test.ts"
    else
      top_cand="apps/api/tests/${rel_dir}/${rel_base}.test.ts"
    fi
  fi

  for cand in "${dir}/${base}.test.ts" "${dir}/__tests__/${base}.test.ts" \
              "${dir}/${base}.spec.ts" ${top_cand:+"$top_cand"}; do
    [ ! -f "$cand" ] && continue
    if ! grep -qE "(^|[^a-zA-Z])(it|test|expect)\s*\(" "$cand"; then
      EMPTY_TESTS+=("$cand")
      break
    fi
    NONSKIP=$(grep -cE "(^|[^a-zA-Z\.])(it|test)\s*\(" "$cand" 2>/dev/null || echo 0)
    SKIPS=$(grep -cE "(it|test|describe)\.skip\s*\(" "$cand" 2>/dev/null || echo 0)
    if [ "$NONSKIP" -gt 0 ] && [ "$SKIPS" -ge "$NONSKIP" ]; then
      SKIPPED_ONLY+=("$cand")
    fi
    break
  done
done <<< "$ADDED_SRC"

if [ "${#EMPTY_TESTS[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 test 文件无 it/test/expect（空架子绕过）:"
  printf "  ❌ %s\n" "${EMPTY_TESTS[@]}"
  exit 1
fi

if [ "${#SKIPPED_ONLY[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 test 文件 100% skip:"
  printf "  ❌ %s\n" "${SKIPPED_ONLY[@]}"
  exit 1
fi

COUNT=$(echo "$ADDED_SRC" | wc -l | tr -d " ")
echo "✅ lint-test-pairing 通过（${COUNT} 个 src 文件全部配套真 test）"
