#!/bin/bash
# Clips Smoke Test — 真实环境验证
# 用途：部署后确认整条链路通（API → content-service → OCR → DB）
# 运行：bash scripts/smoke/clips-smoke.sh
set -euo pipefail

API="${API_URL:-https://autopilot.zenjoymedia.media}"
SESSION_COOKIE="${SMOKE_SESSION_COOKIE:-}"
WAIT_SECONDS="${CLIP_WAIT:-40}"

if [ -z "$SESSION_COOKIE" ]; then
  echo "⚠️  SMOKE_SESSION_COOKIE 未设置，跳过需要登录的测试"
  echo "   设置方法：export SMOKE_SESSION_COOKIE='better-auth.session_token=xxxxx'"
  exit 0
fi

echo "=== Clips Smoke Test ==="
echo "API: $API"
echo ""

# ─── Step 1: 提交链接 ─────────────────────────────────────────────────────────
echo "Step 1: 提交链接..."
DOUYIN_URL="https://v.douyin.com/MO0fBe7llaU/"

SUBMIT=$(curl -sf -X POST "$API/api/clips" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d "{\"url\": \"$DOUYIN_URL\"}" 2>&1) || {
  echo "FAIL: 提交请求失败: $SUBMIT"
  exit 1
}

CLIP_ID=$(echo "$SUBMIT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -z "$CLIP_ID" ]; then
  echo "FAIL: 返回数据无 id。响应：$SUBMIT"
  exit 1
fi
echo "  Clip ID: $CLIP_ID，Status: $(echo "$SUBMIT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")"

# ─── Step 2: 等待处理 ─────────────────────────────────────────────────────────
echo "Step 2: 等待 ${WAIT_SECONDS}s..."
sleep "$WAIT_SECONDS"

# ─── Step 3: 验证结果 ─────────────────────────────────────────────────────────
echo "Step 3: 验证结果..."
RESULT=$(curl -sf "$API/api/clips/$CLIP_ID" -H "Cookie: $SESSION_COOKIE")
FINAL_STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
HAS_OCR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('ocr_text') else 'no')")

echo "  status:  $FINAL_STATUS"
echo "  ocr_text: $HAS_OCR"

[ "$FINAL_STATUS" = "done" ] || { echo "FAIL: status=$FINAL_STATUS"; exit 1; }
[ "$HAS_OCR" = "yes" ] || { echo "FAIL: ocr_text 为空"; exit 1; }

# ─── Step 4: 重复提交不报错 ───────────────────────────────────────────────────
echo "Step 4: 重复提交验证..."
RETRY=$(curl -sf -X POST "$API/api/clips" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d "{\"url\": \"$DOUYIN_URL\"}")
RETRY_STATUS=$(echo "$RETRY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
[ "$RETRY_STATUS" = "pending" ] || [ "$RETRY_STATUS" = "processing" ] || {
  echo "FAIL: 重复提交应返回 pending，实际 $RETRY_STATUS"
  exit 1
}

echo ""
echo "✅ Smoke test passed"
