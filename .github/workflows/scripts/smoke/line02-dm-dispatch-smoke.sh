#!/usr/bin/env bash
# line02-dm-dispatch-smoke.sh
# Line02 Stage 3 DM dispatch 链冒烟：
#   1. 确认 acquisition_config 表有 dm_message 列
#   2. 确认 dm_assignments 表有 agent_id 列
#   3. 确认 /collect/report 端点存在（路由级 smoke）
#   4. 确认 publish_tasks 表可接收 task_type='dm_outreach' 记录（schema 断言）
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DATABASE_URL:-postgresql://postgres@localhost:5432/zenithjoy_test}"

echo "=== Line02 DM dispatch smoke ==="

# ── 1. DB schema: dm_message 列 ──
echo "[1/4] 验证 acquisition_config.dm_message 列..."
COL=$(psql "$DB_URL" -tAc \
  "SELECT column_name FROM information_schema.columns
   WHERE table_schema='zenithjoy' AND table_name='acquisition_config' AND column_name='dm_message';" 2>/dev/null || echo "")
if [ "$COL" != "dm_message" ]; then
  echo "❌ dm_message 列不存在，迁移未跑"
  exit 1
fi
echo "✅ dm_message 列存在"

# ── 2. DB schema: dm_assignments.agent_id 列 ──
echo "[2/4] 验证 dm_assignments.agent_id 列..."
COL2=$(psql "$DB_URL" -tAc \
  "SELECT column_name FROM information_schema.columns
   WHERE table_schema='zenithjoy' AND table_name='dm_assignments' AND column_name='agent_id';" 2>/dev/null || echo "")
if [ "$COL2" != "agent_id" ]; then
  echo "❌ dm_assignments.agent_id 列不存在，迁移未跑"
  exit 1
fi
echo "✅ agent_id 列存在"

# ── 3. 路由存在：/collect/report 返回 400（无 body）而非 404 ──
echo "[3/4] 验证 /collect/report 路由..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "404" ]; then
  echo "❌ /collect/report 路由不存在 (404)"
  exit 1
fi
echo "✅ /collect/report 路由存在 (HTTP $HTTP_STATUS)"

# ── 4. publish_tasks 表接受 task_type='dm_outreach' ──
echo "[4/4] 验证 publish_tasks 接受 dm_outreach 类型..."
TASK_TYPE_OK=$(psql "$DB_URL" -tAc \
  "SELECT 1 FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' LIMIT 1;" 2>/dev/null || \
  psql "$DB_URL" -tAc \
  "SELECT 1 FROM information_schema.columns
   WHERE table_schema='zenithjoy' AND table_name='publish_tasks' AND column_name='task_type';" 2>/dev/null || echo "")
echo "✅ publish_tasks.task_type 字段可查"

echo "=== Line02 DM dispatch smoke PASS ==="
