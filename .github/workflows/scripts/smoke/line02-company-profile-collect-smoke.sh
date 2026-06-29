#!/usr/bin/env bash
# smoke: Line02 公司信息页 + 采集任务 Table API smoke test
# 验证 GET/PUT /api/company-profile + GET /api/line02/account-status + collect/start
# 含 psql 时间窗验证（NOW() - interval '5 minutes'）
set -euo pipefail

API="${API_URL:-http://localhost:3000}"
TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
DB_URL="${E2E_DATABASE_URL:-}"

echo "=== Line02 Company Profile & Collect Smoke ==="
echo "API: $API"

# 1. PUT /api/company-profile（全 9 字段）
SMOKE_NAME="smoke-$(date +%s)"
echo "[1] PUT /api/company-profile (company_name=$SMOKE_NAME)..."
RESP=$(curl -sf -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d "{\"company_name\":\"$SMOKE_NAME\",\"city\":\"西安\",\"industry\":\"餐饮\",\"description\":\"测试\",\"products\":[\"产品A\"],\"key_advantages\":[\"优势1\"],\"customer_problem\":\"问题\",\"customer_portrait\":\"画像\",\"qa_list\":[{\"q\":\"Q\",\"a\":\"A\"}]}")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: PUT company-profile success!=true"; exit 1; }
echo "$RESP" | jq -e '.data.updated == true' > /dev/null || { echo "FAIL: PUT company-profile data.updated!=true"; exit 1; }
# 禁用字段不出现
echo "$RESP" | jq -e '.data | has("result") | not' > /dev/null || { echo "FAIL: 禁用字段 result 在 data"; exit 1; }
echo "$RESP" | jq -e '.data | has("profile") | not' > /dev/null || { echo "FAIL: 禁用字段 profile 在 data"; exit 1; }
echo "$RESP" | jq -e '.data | has("saved") | not' > /dev/null || { echo "FAIL: 禁用字段 saved 在 data"; exit 1; }
echo "PASS: PUT company-profile"

# 2. GET /api/company-profile（全 9 字段 + keys 完整性）
echo "[2] GET /api/company-profile..."
RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET company-profile"; exit 1; }
for F in company_name city industry description products key_advantages customer_problem customer_portrait qa_list; do
  echo "$RESP" | jq -e ".data | has(\"$F\")" > /dev/null || { echo "FAIL: 缺字段 $F"; exit 1; }
done
RETURNED=$(echo "$RESP" | jq -r '.data.company_name')
[ "$RETURNED" = "$SMOKE_NAME" ] || { echo "FAIL: company_name=$RETURNED != $SMOKE_NAME"; exit 1; }
echo "PASS: GET company-profile (9 fields)"

# 3. psql 时间窗验证：确认最近 5 分钟内 company_profiles 有新写入（NOW() - interval '5 minutes'）
if [ -n "$DB_URL" ]; then
  echo "[3] psql 时间窗验证..."
  COUNT=$(psql "$DB_URL" -t -A -c "SELECT COUNT(*) FROM company_profiles WHERE updated_at >= NOW() - interval '5 minutes' AND tenant_id = '$TENANT'" 2>/dev/null || echo "0")
  [ "$COUNT" -gt 0 ] || { echo "FAIL: psql 时间窗验证 — 5分钟内无更新记录 (NOW() - interval '5 minutes')"; exit 1; }
  echo "PASS: psql 时间窗验证 (count=$COUNT)"
else
  echo "[3] SKIP: E2E_DATABASE_URL 未设置，跳过 psql 时间窗验证（NOW() - interval '5 minutes'）"
fi

# 4. GET /api/line02/account-status
echo "[4] GET /api/line02/account-status..."
RESP=$(curl -sf "$API/api/line02/account-status" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET account-status"; exit 1; }
echo "$RESP" | jq -e '.data | has("accounts")' > /dev/null || { echo "FAIL: accounts key missing"; exit 1; }
echo "PASS: GET account-status"

# 5. POST /api/acquisition/collect/start
echo "[5] POST /api/acquisition/collect/start..."
RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d '{"keywords":["smoke-line02"]}')
echo "$RESP" | jq -e '.success == true and .data.status == "pending"' > /dev/null || { echo "FAIL: collect/start"; exit 1; }
echo "$RESP" | jq -e '.data.task_id | type == "string"' > /dev/null || { echo "FAIL: task_id 非 string"; exit 1; }
echo "$RESP" | jq -e '.data | has("id") | not' > /dev/null || { echo "FAIL: 禁用字段 id 在 data"; exit 1; }
echo "$RESP" | jq -e '.data | has("taskId") | not' > /dev/null || { echo "FAIL: 禁用字段 taskId 在 data"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
echo "PASS: collect/start task_id=$TASK_ID"

# 6. GET /api/acquisition/collect/:task_id
echo "[6] GET /api/acquisition/collect/$TASK_ID..."
RESP=$(curl -sf "$API/api/acquisition/collect/$TASK_ID" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET task"; exit 1; }
echo "$RESP" | jq -e '.data | has("task_id") and has("status") and has("video_count") and has("lead_count_raw") and has("created_at") and has("ended_at")' > /dev/null || { echo "FAIL: task response missing fields"; exit 1; }
echo "PASS: GET task"

echo ""
echo "=== Line02 Company Profile & Collect Smoke PASSED ==="
