#!/usr/bin/env bash
# sprint-2-1c-dashboard-type-radio-smoke.sh
# Sprint 2.1c — 验 dashboard PublishPage 加 type radio + walking-skeleton-1.api PublishTaskBody 含 type
set -euo pipefail

API_FILE="apps/dashboard/src/api/walking-skeleton-1.api.ts"
PAGE_FILE="apps/dashboard/src/pages/PublishPage.tsx"
TEST_FILE="apps/dashboard/src/pages/__tests__/PublishPage.test.tsx"

echo "[smoke] step 1: 文件存在"
test -f "$API_FILE" || { echo "FAIL $API_FILE not found"; exit 1; }
test -f "$PAGE_FILE" || { echo "FAIL $PAGE_FILE not found"; exit 1; }
test -f "$TEST_FILE" || { echo "FAIL $TEST_FILE not found"; exit 1; }

echo "[smoke] step 2: PublishTaskBody 含 type 字段"
grep -E "type\?:.*'image'.*'video'.*'article'" "$API_FILE" || { echo "FAIL: PublishTaskBody 没 type 字段"; exit 1; }

echo "[smoke] step 3: PublishPage 含 publishType state"
grep -E "publishType|setPublishType" "$PAGE_FILE" >/dev/null || { echo "FAIL: PublishPage 没 publishType state"; exit 1; }

echo "[smoke] step 4: PublishPage 含 image/video/article radio"
grep -qE "'image', 'video', 'article'" "$PAGE_FILE" || { echo "FAIL: PublishPage 没 type radio"; exit 1; }

echo "[smoke] step 5: PublishPage mutation 传 type"
grep -E "type:\s*publishType" "$PAGE_FILE" >/dev/null || { echo "FAIL: mutation 没传 type"; exit 1; }

echo "[smoke] step 6: dashboard vitest PublishPage 测试 pass"
(cd apps/dashboard && npx vitest run src/pages/__tests__/PublishPage.test.tsx 2>&1 | tail -3) || exit 1

echo "[smoke] OK"
