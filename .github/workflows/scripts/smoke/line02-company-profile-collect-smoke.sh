#!/usr/bin/env bash
# smoke: Line02 公司信息页 + 采集任务 Table API smoke test
# 验证 GET/PUT /api/company-profile + GET /api/line02/account-status + collect/start
set -euo pipefail

API="${API_URL:-http://localhost:3000}"
TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"

echo "=== Line02 Company Profile & Collect Smoke ==="
echo "API: $API"

# 1. PUT /api/company-profile
echo "[1] PUT /api/company-profile..."
RESP=$(curl -sf -X PUT "$API/api/company-profile" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d '{"company_name":"Smoke公司","city":"西安","industry":"餐饮","description":"测试","products":["产品A"],"key_advantages":["优势1"],"customer_problem":"问题","customer_portrait":"画像","qa_list":[{"q":"Q","a":"A"}]}')
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: PUT company-profile"; exit 1; }
echo "$RESP" | jq -e '.data.updated == true' > /dev/null || { echo "FAIL: PUT updated!=true"; exit 1; }
echo "PASS: PUT company-profile"

# 2. GET /api/company-profile
echo "[2] GET /api/company-profile..."
RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET company-profile"; exit 1; }
echo "$RESP" | jq -e '.data.company_name != ""' > /dev/null || { echo "FAIL: GET company_name empty"; exit 1; }
echo "PASS: GET company-profile"

# 3. GET /api/line02/account-status
echo "[3] GET /api/line02/account-status..."
RESP=$(curl -sf "$API/api/line02/account-status" -H "X-Tenant-Id: $TENANT")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET account-status"; exit 1; }
echo "$RESP" | jq -e '.data | has("accounts")' > /dev/null || { echo "FAIL: accounts key missing"; exit 1; }
echo "PASS: GET account-status"

# 4. POST /api/acquisition/collect/start (已存在端点)
echo "[4] POST /api/acquisition/collect/start..."
RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d '{"keywords":["smoke-line02"]}')
echo "$RESP" | jq -e '.success == true and .data.status == "pending"' > /dev/null || { echo "FAIL: collect/start"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
echo "PASS: collect/start task_id=$TASK_ID"

# 5. GET /api/acquisition/collect/:task_id
echo "[5] GET /api/acquisition/collect/$TASK_ID..."
RESP=$(curl -sf "$API/api/acquisition/collect/$TASK_ID")
echo "$RESP" | jq -e '.success == true' > /dev/null || { echo "FAIL: GET task"; exit 1; }
echo "$RESP" | jq -e '.data | has("task_id") and has("status") and has("video_count") and has("lead_count_raw") and has("created_at") and has("ended_at")' > /dev/null || { echo "FAIL: task response missing fields"; exit 1; }
echo "PASS: GET task"

echo ""
echo "=== Line02 Company Profile & Collect Smoke PASSED ==="
