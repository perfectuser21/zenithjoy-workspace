#!/usr/bin/env bash
# line04-crm-glide-smoke.sh
# 验证 Line04 CRM Glide 运营台前端依赖的所有后端端点可用：
#   GET  /api/crm/customers          → {customers:[], cs_wechat_id}
#   GET  /api/crm/onboarding/:id     → 200 or 404（不 5xx）
#   GET  /api/crm/customers/:id/profile → 200 or 404
#   PUT  /api/crm/customers/status   → 空 body 必须被拒（400/401/403/422）
#   PUT  /api/crm/customers/identity → 空 body 必须被拒
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-boss@zenjoymedia.media}"

echo "=== Line04 CRM Glide smoke: backend endpoints for Glide 运营台 ==="

# 1. GET /api/crm/customers → 必须含 customers 数组 + cs_wechat_id 字段
RESP=$(curl -sf "$API_BASE/api/crm/customers" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'customers' in d, f'missing customers field: {d}'
assert isinstance(d['customers'], list), f'customers must be array'
assert 'cs_wechat_id' in d, f'missing cs_wechat_id field: {d}'
print(f'  customers count={len(d[\"customers\"])} cs_wechat_id={d[\"cs_wechat_id\"]}')
"
echo "✓ GET /api/crm/customers → customers[] + cs_wechat_id"

# 2. GET /api/crm/onboarding/:csWechatId → 200 或 404，不 5xx
ONBOARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_BASE/api/crm/onboarding/smoke-test-wechat-id" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
if [ "$ONBOARD_STATUS" != "200" ] && [ "$ONBOARD_STATUS" != "404" ]; then
  echo "FAIL: GET /api/crm/onboarding/... returned $ONBOARD_STATUS (expected 200 or 404)"
  exit 1
fi
echo "✓ GET /api/crm/onboarding/:csWechatId → $ONBOARD_STATUS (not 5xx)"

# 3. GET /api/crm/customers/:contactKey/profile → 200 or 404 or 400
PROFILE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_BASE/api/crm/customers/smoke-nonexistent-contact/profile" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
if [ "$PROFILE_STATUS" != "200" ] && [ "$PROFILE_STATUS" != "404" ] && [ "$PROFILE_STATUS" != "400" ]; then
  echo "FAIL: GET /api/crm/customers/.../profile returned $PROFILE_STATUS (expected 200/404/400)"
  exit 1
fi
echo "✓ GET /api/crm/customers/:contact/profile → $PROFILE_STATUS (not 5xx)"

# 4. PUT /api/crm/customers/status 空 body → 必须被拒 400/401/403/422
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

# 5. PUT /api/crm/customers/identity 空 body → 必须被拒
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

echo ""
echo "=== All Line04 CRM Glide smoke checks passed ==="
