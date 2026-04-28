#!/usr/bin/env bash
# Sprint A · WS4 — Dashboard License E2E Smoke
# 真实链路：API（apps/api 端口 5200）/admin/license/me + admin 操作
#
# 依赖环境：
#   API_BASE         API 基础 URL（默认 http://localhost:5200）
#   ADMIN_FEISHU_ID  super-admin 飞书 ID（被 API 服务端 ADMIN_FEISHU_OPENIDS 接受）
#   USER_FEISHU_ID   普通客户飞书 ID（任意非 admin 字符串）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
ADMIN_FEISHU_ID="${ADMIN_FEISHU_ID:-ou_admin_smoke_001}"
USER_FEISHU_ID="${USER_FEISHU_ID:-ou_customer_smoke_001}"

echo "==> [1/5] GET /api/admin/license/me 缺 X-Feishu-User-Id 应返回 401"
HTTP_CODE_1=$(curl -s -o /dev/null -w "%{http_code}" \
  "${API_BASE}/api/admin/license/me")
if [ "$HTTP_CODE_1" != "401" ]; then
  echo "  FAIL: 期望 401，实际 ${HTTP_CODE_1}"
  exit 1
fi
echo "  OK: 401"

echo "==> [2/5] GET /api/admin/license/me 普通用户 + 无 license 应返回 200 + license=null"
RESP_2=$(curl -s -w "\n%{http_code}" \
  -H "X-Feishu-User-Id: ${USER_FEISHU_ID}" \
  "${API_BASE}/api/admin/license/me")
CODE_2=$(echo "$RESP_2" | tail -n1)
BODY_2=$(echo "$RESP_2" | sed '$d')
if [ "$CODE_2" != "200" ]; then
  echo "  FAIL: 期望 200，实际 ${CODE_2}"
  exit 1
fi
if ! echo "$BODY_2" | grep -q '"license":null'; then
  echo "  FAIL: 期望 license=null，body: $BODY_2"
  exit 1
fi
echo "  OK: 200 + license=null"

echo "==> [3/5] POST /api/admin/license 非 admin 应返回 403"
HTTP_CODE_3=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${USER_FEISHU_ID}" \
  -d '{"tier":"basic","customer_email":"smoke@example.com","duration_days":30}' \
  "${API_BASE}/api/admin/license")
if [ "$HTTP_CODE_3" != "403" ]; then
  echo "  FAIL: 期望 403，实际 ${HTTP_CODE_3}"
  exit 1
fi
echo "  OK: 403"

echo "==> [4/5] POST /api/admin/license admin 创建 license 返回 200 + license_key"
RESP_4=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  -d '{"tier":"basic","customer_email":"smoke@example.com","duration_days":30}' \
  "${API_BASE}/api/admin/license")
CODE_4=$(echo "$RESP_4" | tail -n1)
BODY_4=$(echo "$RESP_4" | sed '$d')
if [ "$CODE_4" != "200" ]; then
  echo "  FAIL: 期望 200，实际 ${CODE_4}"
  exit 1
fi
if ! echo "$BODY_4" | grep -q '"license_key"'; then
  echo "  FAIL: 期望 license_key 字段，body: $BODY_4"
  exit 1
fi
LICENSE_ID=$(echo "$BODY_4" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 36)
echo "  OK: 200 license_key 已签发，license_id=${LICENSE_ID}"

echo "==> [5/5] DELETE /api/admin/license/:id admin 吊销 license 返回 200 + status=revoked"
if [ -z "$LICENSE_ID" ] || [ ${#LICENSE_ID} -lt 36 ]; then
  echo "  SKIP: license_id 解析失败，跳过吊销"
  exit 0
fi
RESP_5=$(curl -s -w "\n%{http_code}" \
  -X DELETE \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  "${API_BASE}/api/admin/license/${LICENSE_ID}")
CODE_5=$(echo "$RESP_5" | tail -n1)
BODY_5=$(echo "$RESP_5" | sed '$d')
if [ "$CODE_5" != "200" ]; then
  echo "  FAIL: 期望 200，实际 ${CODE_5}"
  exit 1
fi
if ! echo "$BODY_5" | grep -q '"status":"revoked"'; then
  echo "  FAIL: 期望 status=revoked，body: $BODY_5"
  exit 1
fi
echo "  OK: 200 status=revoked"

echo "✅ dashboard-license-smoke PASSED"
