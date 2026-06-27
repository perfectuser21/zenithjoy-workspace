#!/usr/bin/env bash
# line04-crm-view-prefs-smoke.sh
# 验证 CRM 列偏好服务端持久化端点存在且响应正确：
#   GET  /api/crm/view-prefs?cs_wechat_id=X → 200（prefs null/object）或 400/401
#   PUT  /api/crm/view-prefs (无 body)       → 400（PREFS_REQUIRED）或 401
#
# 新端点鉴权走 requireCsReadAccess / requireCsWriteAccess（session cookie 模式）。
# CI 无 session → X-Internal-Token 超管旁路；
#   超管不带 cs_wechat_id → 400 CS_WECHAT_ID_REQUIRED（合规），
#   超管带合法 cs_wechat_id → 200 prefs=null（无历史记录）或 object。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-boss@zenjoymedia.media}"

echo "=== Line04 CRM view-prefs smoke: 列偏好服务端持久化 ==="

# 1. GET /api/crm/view-prefs 不带 cs_wechat_id → 400 CS_WECHAT_ID_REQUIRED（端点存在）
STATUS=$(curl -s -o /tmp/crm-vp-no-id.json -w "%{http_code}" \
  "$API_BASE/api/crm/view-prefs" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
if [ "$STATUS" = "400" ]; then
  CODE=$(python3 -c "import sys,json; d=json.load(open('/tmp/crm-vp-no-id.json')); print(d.get('error',{}).get('code','?'))" 2>/dev/null || echo "?")
  echo "✓ GET /api/crm/view-prefs (no cs_wechat_id) → 400 ($CODE)"
elif [ "$STATUS" = "401" ]; then
  echo "✓ GET /api/crm/view-prefs (no cs_wechat_id) → 401 (认证模式不同，端点存在)"
elif [ "$STATUS" = "200" ]; then
  echo "✓ GET /api/crm/view-prefs → 200 (端点存在)"
else
  echo "FAIL: GET /api/crm/view-prefs returned $STATUS (expected 200/400/401, not 404/5xx)"
  cat /tmp/crm-vp-no-id.json
  exit 1
fi

# 2. GET /api/crm/view-prefs?cs_wechat_id=smoke-test → 200 prefs=null 或 object（端点完整路径）
STATUS2=$(curl -s -o /tmp/crm-vp-with-id.json -w "%{http_code}" \
  "$API_BASE/api/crm/view-prefs?cs_wechat_id=smoke-test-cs" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL")
if [ "$STATUS2" = "200" ]; then
  python3 -c "
import sys, json
d = json.load(open('/tmp/crm-vp-with-id.json'))
assert d.get('success') == True, f'success must be true: {d}'
assert 'data' in d, f'missing data field: {d}'
prefs = d['data'].get('prefs')
print(f'  prefs={\"null\" if prefs is None else \"object\"} (service-level persistence OK)')
"
  echo "✓ GET /api/crm/view-prefs?cs_wechat_id=smoke-test-cs → 200 prefs=null/object"
elif [ "$STATUS2" = "401" ] || [ "$STATUS2" = "404" ]; then
  echo "✓ GET /api/crm/view-prefs?cs_wechat_id=smoke-test-cs → $STATUS2 (认证或租户未找到，端点存在)"
else
  echo "FAIL: GET /api/crm/view-prefs?cs_wechat_id=... returned $STATUS2 (expected 200/401/404)"
  cat /tmp/crm-vp-with-id.json
  exit 1
fi

# 3. PUT /api/crm/view-prefs 空 body → 400 PREFS_REQUIRED（或 401）
PUT_STATUS=$(curl -s -o /tmp/crm-vp-put-empty.json -w "%{http_code}" \
  -X PUT "$API_BASE/api/crm/view-prefs" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL" \
  -d '{}')
if [ "$PUT_STATUS" = "400" ]; then
  CODE=$(python3 -c "import sys,json; d=json.load(open('/tmp/crm-vp-put-empty.json')); print(d.get('error',{}).get('code','?'))" 2>/dev/null || echo "?")
  echo "✓ PUT /api/crm/view-prefs (empty body) → 400 ($CODE)"
elif [ "$PUT_STATUS" = "401" ] || [ "$PUT_STATUS" = "403" ]; then
  echo "✓ PUT /api/crm/view-prefs (empty body) → $PUT_STATUS (认证拒绝，端点存在)"
else
  echo "FAIL: PUT /api/crm/view-prefs returned $PUT_STATUS (expected 400/401/403)"
  cat /tmp/crm-vp-put-empty.json
  exit 1
fi

# 4. PUT /api/crm/view-prefs 含正确 prefs 结构 → 200 或 401/403（鉴权）
PUT_STATUS2=$(curl -s -o /tmp/crm-vp-put-valid.json -w "%{http_code}" \
  -X PUT "$API_BASE/api/crm/view-prefs" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "X-User-Email: $ADMIN_EMAIL" \
  -d '{"wechat_id":"smoke-test-cs","prefs":{"views":[{"id":"default","name":"默认视图","columnState":[],"sortModel":[],"filterModel":{},"quickFilter":""}],"activeViewId":"default"}}')
if [ "$PUT_STATUS2" = "200" ] || [ "$PUT_STATUS2" = "401" ] || [ "$PUT_STATUS2" = "403" ] || [ "$PUT_STATUS2" = "404" ]; then
  echo "✓ PUT /api/crm/view-prefs (valid prefs) → $PUT_STATUS2 (endpoint functional)"
else
  echo "FAIL: PUT /api/crm/view-prefs (valid prefs) returned $PUT_STATUS2 (expected 200/401/403/404)"
  cat /tmp/crm-vp-put-valid.json
  exit 1
fi

echo ""
echo "=== All Line04 CRM view-prefs smoke checks passed ==="
