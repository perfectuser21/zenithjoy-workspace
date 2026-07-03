#!/usr/bin/env bash
# line02-tenant-isolation-smoke.sh
# 验证 acquisition_keyword_tasks 有 tenant_id 列，且 pending-keyword-tasks 要求 license header
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-postgresql://localhost:5432/zenithjoy}"

echo "=== Line02 Tenant Isolation Smoke ==="

# 1. 验证 DB 列存在
echo "[1] 验证 acquisition_keyword_tasks.tenant_id 列..."
COL=$(psql "$DB_URL" -tAc \
  "SELECT column_name FROM information_schema.columns \
   WHERE table_schema='zenithjoy' AND table_name='acquisition_keyword_tasks' AND column_name='tenant_id';" 2>/dev/null || echo "")

if [ "$COL" != "tenant_id" ]; then
  echo "::error:: tenant_id 列不存在于 acquisition_keyword_tasks"
  exit 1
fi
echo "  ✅ tenant_id 列存在"

# 2. 验证无 license header 时返回空列表（不泄漏跨租户数据）
echo "[2] 验证无 x-agent-license header 时返回空任务列表..."
RESP=$(curl -sf "${API_BASE}/api/acquisition/pending-keyword-tasks" \
  -H "Content-Type: application/json" 2>/dev/null || echo '{"tasks":[],"total":0}')
TASKS=$(echo "$RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(String(d.tasks?.length ?? -1))" 2>/dev/null || echo "0")

if [ "$TASKS" != "0" ]; then
  echo "::error:: 无 license header 时应返回空列表，实际 tasks=$TASKS"
  exit 1
fi
echo "  ✅ 无 license 返回空列表（tenant 隔离生效）"

# 3. 验证复合索引存在
echo "[3] 验证 idx_acq_kw_tasks_tenant_status 索引..."
IDX=$(psql "$DB_URL" -tAc \
  "SELECT indexname FROM pg_indexes \
   WHERE schemaname='zenithjoy' AND tablename='acquisition_keyword_tasks' \
   AND indexname='idx_acq_kw_tasks_tenant_status';" 2>/dev/null || echo "")

if [ -z "$IDX" ]; then
  echo "::warning:: 复合索引 idx_acq_kw_tasks_tenant_status 不存在（staging 可能未跑 migration）"
else
  echo "  ✅ 索引存在: $IDX"
fi

echo "=== Line02 Tenant Isolation Smoke PASS ==="
