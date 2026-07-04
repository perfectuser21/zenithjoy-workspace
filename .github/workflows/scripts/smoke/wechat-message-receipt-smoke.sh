#!/usr/bin/env bash
# smoke: POST /api/wechat/messages/:id/receipt — Line04 送达回执台账端点
# 验证路由已接线且防护分支真实生效（无身份 403 / 非法 id 400）。
# happy path（draft 行翻 delivered）依赖真实草稿数据，由 vitest 单测
# （wechat-message-receipt.test.ts / contact-memory.test.ts）覆盖。
set -euo pipefail

BASE="${API_BASE:-http://localhost:3000}"

echo "[wechat-message-receipt-smoke] === 非法 id → 400 ==="
STATUS=$(curl -s -o /tmp/receipt-bad-id.json -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"ok":true}' \
  "$BASE/api/wechat/messages/abc/receipt")
if [ "$STATUS" != "400" ]; then
  echo "FAIL: 非法 id 期望 400，实际 $STATUS"; cat /tmp/receipt-bad-id.json; exit 1
fi
grep -q "BAD_MESSAGE_ID" /tmp/receipt-bad-id.json || { echo "FAIL: 缺 BAD_MESSAGE_ID 错误码"; exit 1; }
echo "非法 id OK: 400 BAD_MESSAGE_ID"

echo "[wechat-message-receipt-smoke] === 负数 id → 400 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"ok":true}' \
  "$BASE/api/wechat/messages/-1/receipt")
[ "$STATUS" = "400" ] || { echo "FAIL: 负数 id 期望 400，实际 $STATUS"; exit 1; }
echo "负数 id OK: 400"

echo "[wechat-message-receipt-smoke] === 无身份 → 403 ==="
STATUS=$(curl -s -o /tmp/receipt-no-id.json -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"ok":true}' \
  "$BASE/api/wechat/messages/999999/receipt")
if [ "$STATUS" != "403" ]; then
  echo "FAIL: 无身份期望 403，实际 $STATUS"; cat /tmp/receipt-no-id.json; exit 1
fi
grep -q "NO_CS_IDENTITY" /tmp/receipt-no-id.json || { echo "FAIL: 缺 NO_CS_IDENTITY 错误码"; exit 1; }
echo "无身份 OK: 403 NO_CS_IDENTITY"

echo "[wechat-message-receipt-smoke] ALL PASSED"
