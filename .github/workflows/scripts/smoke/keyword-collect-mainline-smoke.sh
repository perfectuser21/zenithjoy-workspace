#!/usr/bin/env bash
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5201}"
DB="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}"
TEN="59532559-5b4e-48a4-9a8c-80ab26ee8beb"   # staging 已有测试租户
LIC="ZJ-F-ZW8DM464"                           # 同租户 license

echo "== 1. 带租户建 keyword 任务 =="
RESP=$(curl -sf -X POST "$API_BASE/api/acquisition/keyword-search" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TEN" \
  -d '{"keyword":"麻婆豆腐SMOKE"}')
echo "$RESP"
TASK_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['task_id'])")
[ -n "$TASK_ID" ] || { echo "FAIL: 无 task_id"; exit 1; }

echo "== 2. 任务 tenant_id 非空且正确 =="
TID=$(psql "$DB" -tAc "SELECT tenant_id FROM zenithjoy.acquisition_keyword_tasks WHERE id='$TASK_ID'")
[ "$TID" = "$TEN" ] || { echo "FAIL: tenant_id=$TID != $TEN"; exit 1; }

echo "== 3. 同租户 agent 拉得到 =="
PEND=$(curl -sf "$API_BASE/api/acquisition/pending-keyword-tasks" -H "x-agent-license: $LIC")
echo "$PEND" | grep -q "麻婆豆腐SMOKE" || { echo "FAIL: agent 拉不到任务"; echo "$PEND"; exit 1; }

echo "== 4. 前端列表端点能看到 =="
curl -sf "$API_BASE/api/acquisition/keyword-tasks" -H "X-Tenant-Id: $TEN" | grep -q "麻婆豆腐SMOKE" \
  || { echo "FAIL: /keyword-tasks 看不到"; exit 1; }

echo "== 5. 清理 =="
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_keyword_tasks WHERE keyword='麻婆豆腐SMOKE'" >/dev/null
echo "✅ keyword-collect-mainline smoke ALL PASS"
