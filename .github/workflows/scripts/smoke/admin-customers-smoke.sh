#!/usr/bin/env bash
# admin-customers-smoke.sh — /api/admin/customers 端点 E2E Smoke
#
# 验证：
#   1. GET /api/admin/customers → 200 + {success:true, data:array, total:number}
#   2. 顶层 keys 精确等于 [data, success, total]，禁用字段不出现
#   3. GET /api/admin/customers/platform-sessions → 200 + correct schema
#   4. GET /api/admin/customers/publish-logs → 200 + correct schema + tenant_id 筛选有效
#   5. 非超管（X-Feishu-User-Id: not-an-admin）返回 403
#
# 依赖：
#   API_BASE   API 基础 URL（默认 http://localhost:5200）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  admin-customers smoke"
echo "  API: $API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. GET /api/admin/customers → 200 + schema
echo "[1] GET /api/admin/customers — 200 + success:true"
RESP=$(curl -sf "${API_BASE}/api/admin/customers") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e ".success == true" > /dev/null || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e ".data | type == \"array\"" > /dev/null || { echo "FAIL: data not array"; exit 1; }
echo "$RESP" | jq -e ".total | type == \"number\"" > /dev/null || { echo "FAIL: total not number"; exit 1; }
echo "  ✅ PASS"

# 2. schema completeness + 禁用字段
echo "[2] schema 完整性检查"
echo "$RESP" | jq -e 'keys | sort | . == ["data","success","total"]' > /dev/null || { echo "FAIL: schema keys mismatch"; exit 1; }
for F in users clients members result; do
  echo "$RESP" | jq -e "has(\"$F\") | not" > /dev/null || { echo "FAIL: 禁用字段 $F 出现"; exit 1; }
done
echo "  ✅ PASS"

# 3. GET /api/admin/customers/platform-sessions
echo "[3] GET /api/admin/customers/platform-sessions — 200 + schema"
RESP2=$(curl -sf "${API_BASE}/api/admin/customers/platform-sessions") || { echo "FAIL: platform-sessions 端点未返回 200"; exit 1; }
echo "$RESP2" | jq -e ".success == true" > /dev/null || { echo "FAIL: success"; exit 1; }
echo "$RESP2" | jq -e ".data | type == \"array\"" > /dev/null || { echo "FAIL: data type"; exit 1; }
echo "$RESP2" | jq -e 'keys | sort | . == ["data","success","total"]' > /dev/null || { echo "FAIL: platform-sessions schema keys"; exit 1; }
echo "  ✅ PASS"

# 4. GET /api/admin/customers/publish-logs + tenant_id filter
echo "[4] GET /api/admin/customers/publish-logs — 200 + tenant_id 筛选"
RESP3=$(curl -sf "${API_BASE}/api/admin/customers/publish-logs") || { echo "FAIL: publish-logs 未返回 200"; exit 1; }
echo "$RESP3" | jq -e ".success == true" > /dev/null || { echo "FAIL: success"; exit 1; }
echo "$RESP3" | jq -e 'keys | sort | . == ["data","success","total"]' > /dev/null || { echo "FAIL: publish-logs schema keys"; exit 1; }
FILT=$(curl -sf "${API_BASE}/api/admin/customers/publish-logs?tenant_id=00000000-0000-0000-0000-000000000000") || { echo "FAIL: tenant_id 筛选失败"; exit 1; }
echo "$FILT" | jq -e ".success == true" > /dev/null || { echo "FAIL: 筛选 success"; exit 1; }
echo "  ✅ PASS"

# 5. 非超管 → 403
echo "[5] 非超管 X-Feishu-User-Id: not-an-admin → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Feishu-User-Id: not-an-admin" "${API_BASE}/api/admin/customers")
[ "$CODE" = "403" ] || { echo "FAIL: 非超管应返回 403 实际 HTTP=$CODE"; exit 1; }
echo "  ✅ PASS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ admin-customers smoke PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
