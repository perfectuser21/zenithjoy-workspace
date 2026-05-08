#!/usr/bin/env bash
# sprint-2-1b-douyin-video-real-publish-smoke.sh
# Sprint 2.1b — 验证 publish-douyin-video.cjs 5 个抽出函数已 export + selector 通用化
set -euo pipefail

SCRIPT="services/agent/publishers/douyin-publisher/publish-douyin-video.cjs"
TEST_FILE="services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs"

echo "[smoke] step 1: 文件存在"
test -f "$SCRIPT" || { echo "FAIL $SCRIPT not found"; exit 1; }
test -f "$TEST_FILE" || { echo "FAIL $TEST_FILE not found"; exit 1; }

echo "[smoke] step 2: 5 个 selector 函数 export 检查"
node -e "const m = require(process.cwd() + '/$SCRIPT'); ['uploadVideoFile','waitForUploadProcessed','fillTitle','clickPublishButton','extractPublishedUrl'].forEach(fn => { if (typeof m[fn] !== 'function') { console.error('missing export: ' + fn); process.exit(1); } }); console.log('all 5 fns exported')" || exit 1

echo "[smoke] step 3: selector 字符串不含 xian-pc 特化"
grep -E "xian-pc|xuxia|100\.97\.|WINDOWS_BASE_DIR|xian-mac|jinnuoshengyuan|windows_ed" "$SCRIPT" && { echo "FAIL: $SCRIPT 含 xian-pc 特化字符串"; exit 1; } || true

echo "[smoke] step 4: vitest unit 跑通"
(cd services/agent && npx vitest run "publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs") || exit 1

echo "[smoke] step 5: 占位段已删（thin 减肥）"
grep -E "PENDING_LEAD_VERIFICATION|TODO lead 自验填 selectors" "$SCRIPT" && { echo "FAIL: thin 占位段未删干净"; exit 1; } || true

echo "[smoke] OK"
