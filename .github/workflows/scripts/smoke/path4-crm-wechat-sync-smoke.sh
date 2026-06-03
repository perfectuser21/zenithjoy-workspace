#!/usr/bin/env bash
# path4-crm-wechat-sync-smoke.sh — Path 4 Step 2 CRM 打通 E2E Smoke
#
# 验证：
#   1. POST /api/crm/init (mode=create) → 200 + {success:true, table_id}
#   2. POST /api/crm/init (mode=detect) → 200 + table_id 含 existing
#   3. POST /api/crm/init (无 tenant_id) → 400
#   4. GET  /api/crm/wechat-contacts → 200 + contacts 精确 5 条 + wechat_id/nickname 字段
#   5. GET  /api/crm/match-preview → 200 + matched/pending/unmatched 三字段
#   6. POST /api/crm/daily-analysis (dry_run=true) → 200 + customers + webhook_sent
#
# 依赖：
#   API_BASE   API 基础 URL（默认 http://localhost:5200）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
TENANT_ID="smoke_tenant_$(date +%s)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  path4-crm-wechat-sync smoke"
echo "  API: $API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. POST /api/crm/init mode=create → 200 + success + table_id
echo "[1] POST /api/crm/init (mode=create) — 200 + table_id"
RESP=$(curl -sf -X POST "${API_BASE}/api/crm/init" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_ID}\",\"platform\":\"feishu\",\"mode\":\"create\"}") \
  || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e ".success == true" > /dev/null || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e ".table_id | type == \"string\"" > /dev/null || { echo "FAIL: table_id missing"; exit 1; }
echo "  ✅ PASS"

# 2. POST /api/crm/init mode=detect → 200 + existing
echo "[2] POST /api/crm/init (mode=detect) — 200 + table_id 含 existing"
RESP=$(curl -sf -X POST "${API_BASE}/api/crm/init" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_ID}\",\"platform\":\"notion\",\"mode\":\"detect\"}") \
  || { echo "FAIL: detect 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.table_id | contains("existing")' > /dev/null || { echo "FAIL: table_id 不含 existing"; exit 1; }
echo "  ✅ PASS"

# 3. POST /api/crm/init 无 tenant_id → 400
echo "[3] POST /api/crm/init (无 tenant_id) — 400"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/api/crm/init" \
  -H "Content-Type: application/json" -d '{}')
[ "$HTTP_CODE" = "400" ] || { echo "FAIL: 期望 400，实际 ${HTTP_CODE}"; exit 1; }
echo "  ✅ PASS"

# 4. GET /api/crm/wechat-contacts → 200 + 精确 5 条
echo "[4] GET /api/crm/wechat-contacts — 200 + contacts.length==5"
RESP=$(curl -sf "${API_BASE}/api/crm/wechat-contacts?tenant_id=${TENANT_ID}") \
  || { echo "FAIL: wechat-contacts 端点未返回 200"; exit 1; }
COUNT=$(echo "$RESP" | jq '.contacts | length')
[ "$COUNT" = "5" ] || { echo "FAIL: contacts 不是 5 条（实际 ${COUNT}）"; exit 1; }
echo "$RESP" | jq -e '.contacts[0].wechat_id | type == "string"' > /dev/null || { echo "FAIL: wechat_id 缺失"; exit 1; }
echo "$RESP" | jq -e '.contacts[0].nickname | type == "string"' > /dev/null || { echo "FAIL: nickname 缺失"; exit 1; }
echo "  ✅ PASS"

# 5. GET /api/crm/match-preview → 200 + matched/pending/unmatched
echo "[5] GET /api/crm/match-preview — 200 + 三字段"
RESP=$(curl -sf "${API_BASE}/api/crm/match-preview?tenant_id=${TENANT_ID}") \
  || { echo "FAIL: match-preview 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.matched | type == "array"' > /dev/null || { echo "FAIL: matched 缺失"; exit 1; }
echo "$RESP" | jq -e '.pending | type == "array"' > /dev/null || { echo "FAIL: pending 缺失"; exit 1; }
echo "$RESP" | jq -e '.unmatched | type == "array"' > /dev/null || { echo "FAIL: unmatched 缺失"; exit 1; }
echo "  ✅ PASS"

# 6. POST /api/crm/daily-analysis dry_run=true → 200 + customers + webhook_sent
echo "[6] POST /api/crm/daily-analysis (dry_run=true) — 200 + customers + webhook_sent"
RESP=$(curl -sf -X POST "${API_BASE}/api/crm/daily-analysis" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_ID}\",\"dry_run\":true}") \
  || { echo "FAIL: daily-analysis 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.customers | type == "array"' > /dev/null || { echo "FAIL: customers 缺失"; exit 1; }
echo "$RESP" | jq -e '.webhook_sent | type == "boolean"' > /dev/null || { echo "FAIL: webhook_sent 缺失"; exit 1; }
echo "  ✅ PASS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ ALL 6 checks PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
