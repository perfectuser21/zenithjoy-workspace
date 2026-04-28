#!/usr/bin/env bash
# Sprint B · WS3 — 多租户隔离 E2E Smoke
#
# 验证：
#   1. 客户 A 创建作品 → 只 A 能看到
#   2. 客户 B 创建作品 → 只 B 能看到
#   3. A 不能看到 B 的（GET 列表只返回 A 的，按 id 直查 B 的返回 404）
#   4. super-admin X-Bypass-Tenant=true 看到全部
#
# 依赖：
#   API_BASE          API 基础 URL（默认 http://localhost:5200）
#   ALICE_FEISHU_ID   客户 A 飞书 ID
#   BOB_FEISHU_ID     客户 B 飞书 ID
#   ADMIN_FEISHU_ID   super-admin 飞书 ID（被 ADMIN_FEISHU_OPENIDS 接受）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
ALICE_FEISHU_ID="${ALICE_FEISHU_ID:-ou_alice_smoke_001}"
BOB_FEISHU_ID="${BOB_FEISHU_ID:-ou_bob_smoke_002}"
ADMIN_FEISHU_ID="${ADMIN_FEISHU_ID:-ou_admin_smoke_999}"

echo "==> [1/6] A 创建作品"
RESP_A_POST=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${ALICE_FEISHU_ID}" \
  -d '{"title":"Alice MTSmoke 作品","content_type":"article","body":"alice smoke"}' \
  "${API_BASE}/api/works")
echo "$RESP_A_POST" | head -c 400
A_WORK_ID=$(echo "$RESP_A_POST" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 36)
echo ""
if [ -z "$A_WORK_ID" ]; then echo "  FAIL: A 创建作品后无 id 返回"; exit 1; fi
echo "  OK: A_WORK_ID=$A_WORK_ID"

echo "==> [2/6] B 创建作品"
RESP_B_POST=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${BOB_FEISHU_ID}" \
  -d '{"title":"Bob MTSmoke 作品","content_type":"article","body":"bob smoke"}' \
  "${API_BASE}/api/works")
echo "$RESP_B_POST" | head -c 400
B_WORK_ID=$(echo "$RESP_B_POST" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 36)
echo ""
if [ -z "$B_WORK_ID" ]; then echo "  FAIL: B 创建作品后无 id 返回"; exit 1; fi
echo "  OK: B_WORK_ID=$B_WORK_ID"

echo "==> [3/6] A GET /api/works 应不含 B 的 title"
RESP_A_LIST=$(curl -fsS \
  -H "X-Feishu-User-Id: ${ALICE_FEISHU_ID}" \
  "${API_BASE}/api/works?limit=50")
if echo "$RESP_A_LIST" | grep -q "Bob MTSmoke"; then
  echo "  FAIL: A 的列表包含 B 的作品 — 多租户隔离失败"
  echo "$RESP_A_LIST" | head -c 800
  exit 1
fi
if ! echo "$RESP_A_LIST" | grep -q "Alice MTSmoke"; then
  echo "  FAIL: A 的列表不含 A 自己的作品"
  exit 1
fi
echo "  OK: A 列表只含 A 的作品"

echo "==> [4/6] A GET /api/works/<B 的 id> 应返回 404"
HTTP_CODE_4=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Feishu-User-Id: ${ALICE_FEISHU_ID}" \
  "${API_BASE}/api/works/${B_WORK_ID}")
if [ "$HTTP_CODE_4" != "404" ]; then
  echo "  FAIL: 期望 404 实际 ${HTTP_CODE_4}"
  exit 1
fi
echo "  OK: 跨租户 GET-by-id 返回 404"

echo "==> [5/6] 缺 X-Feishu-User-Id 应返回 401"
HTTP_CODE_5=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/works")
if [ "$HTTP_CODE_5" != "401" ]; then
  echo "  FAIL: 期望 401 实际 ${HTTP_CODE_5}"
  exit 1
fi
echo "  OK: 缺鉴权 返回 401"

echo "==> [6/6] super-admin X-Bypass-Tenant=true 看到 A 与 B 的作品"
RESP_BYPASS=$(curl -fsS \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  -H "X-Bypass-Tenant: true" \
  "${API_BASE}/api/works?limit=50")
if ! echo "$RESP_BYPASS" | grep -q "Alice MTSmoke"; then
  echo "  FAIL: bypass 模式未看到 A 的作品"
  exit 1
fi
if ! echo "$RESP_BYPASS" | grep -q "Bob MTSmoke"; then
  echo "  FAIL: bypass 模式未看到 B 的作品"
  exit 1
fi
echo "  OK: bypass 模式看到 A 与 B 全部作品"

echo "✅ multi-tenant-smoke PASSED"
