#!/usr/bin/env bash
# kuaishou-publish-ui-smoke.sh
# 验 dashboard PublishPage 快手平台选择器：platform radio + kuaishou mutation + vitest 通过
set -euo pipefail

PAGE_FILE="apps/dashboard/src/pages/PublishPage.tsx"
TEST_FILE="apps/dashboard/src/pages/__tests__/PublishPage.test.tsx"

echo "[smoke] step 1: 文件存在"
test -f "$PAGE_FILE" || { echo "FAIL $PAGE_FILE not found"; exit 1; }
test -f "$TEST_FILE" || { echo "FAIL $TEST_FILE not found"; exit 1; }

echo "[smoke] step 2: PublishPage 含 platform state（含 kuaishou 选项）"
grep -qE "kuaishou" "$PAGE_FILE" || {
  echo "FAIL: PublishPage 没有快手平台"; exit 1
}

echo "[smoke] step 3: PublishPage 含 platform radio（name=platform）"
grep -qE "name=\"platform\"|name='platform'" "$PAGE_FILE" || {
  echo "FAIL: PublishPage 没有平台 radio"; exit 1
}

echo "[smoke] step 4: mutation 不再硬编码 platform: 'douyin'"
grep -qE "platform:\s*'douyin'" "$PAGE_FILE" && {
  echo "FAIL: mutation 仍硬编码 douyin"; exit 1
} || true

echo "[smoke] step 5: 测试文件含快手用例"
grep -qE "kuaishou|快手" "$TEST_FILE" || {
  echo "FAIL: 测试文件没有快手相关用例"; exit 1
}

echo "[smoke] step 6: dashboard vitest PublishPage 全部通过"
(cd apps/dashboard && npx vitest run src/pages/__tests__/PublishPage.test.tsx 2>&1 | tail -5) || exit 1

echo "[smoke] OK"
