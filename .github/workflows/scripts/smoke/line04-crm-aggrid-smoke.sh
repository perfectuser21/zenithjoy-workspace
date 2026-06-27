#!/usr/bin/env bash
# line04-crm-aggrid-smoke.sh
# 验证 Line04 CRM AG Grid 运营台前端依赖的所有后端端点存在且响应正确：
#   GET  /api/crm/customers          → 超管无 cs_wechat_id = 400(CS_WECHAT_ID_REQUIRED)；session 租户 = 200
#   GET  /api/crm/onboarding/:id     → 200 or 404（不 5xx）
#   GET  /api/crm/customers/:id/profile → 200 or 404（不 5xx）
#   PUT  /api/crm/customers/status   → 空 body 必须被拒（400/401/403/422）
#   PUT  /api/crm/customers/identity → 空 body 必须被拒
#   POST /api/crm/friend-scan/trigger → 存在且不 404（400/401/403 均可，空 body）
#
# AG Grid 重做说明：前端从 Glide canvas 换成 AG Grid DOM，后端 API 不变，
#   smoke 侧重于验证 AG Grid 行内编辑依赖的 PUT /status + PUT /identity 端点健在。
#
# CI 环境：无 session cookie → 以超管路由（X-User-Email）验存在性；
#   超管无 cs_wechat_id 属于合规校验（决策5），预期 400。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-boss@zenjoymedia.media}"

echo "=== Line04 CRM AG Grid smoke: backend endpoints for AG Grid 运营台 ==="

# 1. GET /api/crm/customers（超管无 cs_wechat_id）
#    → 200（若 CI 数据库有客服机记录）或 400（CS_WECHAT_ID_REQUIRED，符合决策5）
#    拒绝：404（端点未注册）、5xx（崩溃）
STATUS=$(curl -s -o /tmp/crm-aggrid-customers.json -w "%{http_code}" \
  "$API_BASE/api/crm/customers" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
RESP=$(cat /tmp/crm-aggrid-customers.json)
if [ "$STATUS" = "200" ]; then
  echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'customers' in d, f'missing customers field: {d}'
assert isinstance(d['customers'], list), f'customers must be array'
assert 'cs_wechat_id' in d, f'missing cs_wechat_id field: {d}'
print(f'  customers count={len(d[\"customers\"])} cs_wechat_id={d[\"cs_wechat_id\"]}')
"
  echo "✓ GET /api/crm/customers → 200 customers[] + cs_wechat_id"
elif [ "$STATUS" = "400" ]; then
  CODE=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code','?') if isinstance(d,dict) else '?')" 2>/dev/null || echo "?")
  echo "✓ GET /api/crm/customers → 400 ($CODE) — 端点存在且超管无 cs_wechat_id 合规拒绝"
else
  echo "FAIL: GET /api/crm/customers returned HTTP $STATUS (expected 200 or 400, not 404/5xx)"
  echo "$RESP"
  exit 1
fi

# 2. GET /api/crm/onboarding/:csWechatId → 200 或 404，不 5xx
ONBOARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_BASE/api/crm/onboarding/smoke-test-wechat-id" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
if [ "$ONBOARD_STATUS" = "404" ] || [ "$ONBOARD_STATUS" = "200" ] || \
   [ "$ONBOARD_STATUS" = "400" ] || [ "$ONBOARD_STATUS" = "403" ]; then
  echo "✓ GET /api/crm/onboarding/:csWechatId → $ONBOARD_STATUS (not 5xx)"
else
  echo "FAIL: GET /api/crm/onboarding/... returned $ONBOARD_STATUS (expected 200/400/403/404)"
  exit 1
fi

# 3. GET /api/crm/customers/:contactKey/profile → 200 or 404 or 400
PROFILE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_BASE/api/crm/customers/smoke-nonexistent-contact/profile" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
if [ "$PROFILE_STATUS" = "200" ] || [ "$PROFILE_STATUS" = "404" ] || \
   [ "$PROFILE_STATUS" = "400" ] || [ "$PROFILE_STATUS" = "403" ]; then
  echo "✓ GET /api/crm/customers/:contact/profile → $PROFILE_STATUS (not 5xx)"
else
  echo "FAIL: GET /api/crm/customers/.../profile returned $PROFILE_STATUS (expected 200/400/403/404)"
  exit 1
fi

# 4. PUT /api/crm/customers/status 空 body → 必须被拒（AG Grid 行内编辑写回端点）
STATUS_RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$API_BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL" \
  -d '{}')
if [ "$STATUS_RESP" != "400" ] && [ "$STATUS_RESP" != "401" ] && \
   [ "$STATUS_RESP" != "403" ] && [ "$STATUS_RESP" != "422" ]; then
  echo "FAIL: PUT /customers/status empty body returned $STATUS_RESP (expected 400/401/403/422)"
  exit 1
fi
echo "✓ PUT /api/crm/customers/status (empty body) → $STATUS_RESP (validation rejects)"

# 5. PUT /api/crm/customers/identity 空 body → 必须被拒（AG Grid 行内编辑写回端点）
IDENTITY_RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$API_BASE/api/crm/customers/identity" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL" \
  -d '{}')
if [ "$IDENTITY_RESP" != "400" ] && [ "$IDENTITY_RESP" != "401" ] && \
   [ "$IDENTITY_RESP" != "403" ] && [ "$IDENTITY_RESP" != "422" ]; then
  echo "FAIL: PUT /customers/identity empty body returned $IDENTITY_RESP (expected 400/401/403/422)"
  exit 1
fi
echo "✓ PUT /api/crm/customers/identity (empty body) → $IDENTITY_RESP (validation rejects)"

# 6. POST /api/crm/friend-scan/trigger → 端点存在（400/401/403 可，不 404/5xx）
SCAN_RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/api/crm/friend-scan/trigger" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL" \
  -d '{}')
if [ "$SCAN_RESP" = "404" ] || [[ "$SCAN_RESP" == 5* ]]; then
  echo "FAIL: POST /api/crm/friend-scan/trigger returned $SCAN_RESP (endpoint missing or crashed)"
  exit 1
fi
echo "✓ POST /api/crm/friend-scan/trigger → $SCAN_RESP (endpoint exists)"

echo ""
echo "=== All Line04 CRM AG Grid smoke checks passed ==="
