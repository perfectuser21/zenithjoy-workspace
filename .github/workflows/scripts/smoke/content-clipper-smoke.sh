#!/usr/bin/env bash
# content-clipper-smoke.sh
# Content Clipper — 验证 /api/clips 端点可正常工作
#
# 验证链路：
#   1. GET /api/clips/settings        未登录 → 401
#   2. GET /health                    服务正常运行
#   3. POST /api/clips                未登录 → 401
#
# 退出码：
#   0  全过
#   1  健康检查失败
#   2  端点鉴权异常（期望 401 但得到其他）
#
# 依赖：
#   API_BASE 默认 http://localhost:5200

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"

echo "=== content-clipper smoke ==="
echo "API_BASE=$API_BASE"

# Step 1: Health check
echo ""
echo "Step 1: Health check"
HEALTH=$(curl -sf "${API_BASE}/health" | grep -o '"status":"ok"' || true)
if [ -z "$HEALTH" ]; then
  echo "FAIL: /health returned unexpected response"
  exit 1
fi
echo "PASS: /health ok"

# Step 2: GET /api/clips/settings — 未认证应返回 401
echo ""
echo "Step 2: GET /api/clips/settings (unauthenticated → 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/clips/settings")
if [ "$STATUS" != "401" ]; then
  echo "FAIL: expected 401 but got $STATUS"
  exit 2
fi
echo "PASS: got 401 as expected"

# Step 3: POST /api/clips — 未认证应返回 401
echo ""
echo "Step 3: POST /api/clips (unauthenticated → 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/test/"}' \
  "${API_BASE}/api/clips")
if [ "$STATUS" != "401" ]; then
  echo "FAIL: expected 401 but got $STATUS"
  exit 2
fi
echo "PASS: got 401 as expected"

echo ""
echo "=== content-clipper smoke PASSED ==="
exit 0
