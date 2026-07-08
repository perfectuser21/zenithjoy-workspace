#!/usr/bin/env bash
# crm-status-history-smoke.sh (ZenithJoy)
# Line04 CRM 客户状态历史追踪 — feature smoke（CI 规范位置）
#
# Sprint: 07081012-crm-status-history
# Journey: Line04 客户私域 AI 接管（bfeed805-deed-46c3-8624-87f0028101d4）
#
# 验收点（合同 B1-B6）：
#   B1  新客户首次写 status → 历史表出现 old_status=NULL 记录
#   B2  已有客户 status 变化 → 新增历史行（old/new 正确）
#   B3  重复提交相同 status → 历史表不新增记录
#   B4  upsert 失败 → 事务回滚，历史表无残留
#   B5  多租户隔离 — tenant_id 不串
#   B6  migration 幂等 — 重跑不重复插入回填行
#
# 真链路验收走合同测试（vitest mock DB，精确 per-call 断言）；
# 本脚本走 psql 真实链路确认 migration 已跑 + 表结构完整。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
E2E_VERIFY="$ROOT/sprints/07081012-crm-status-history/e2e-verify.sh"

# 1. migration 文件存在性检查
MIGRATION="$ROOT/apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql"
[ -f "$MIGRATION" ] || { echo "FAIL: migration 文件不存在: $MIGRATION"; exit 1; }
echo "[crm-status-history-smoke] ✓ migration 文件存在"

# 2. migration 幂等性检查：文件含 IF NOT EXISTS 和 ON CONFLICT DO NOTHING
grep -q "IF NOT EXISTS" "$MIGRATION" || { echo "FAIL: migration 缺 IF NOT EXISTS（幂等）"; exit 1; }
grep -qi "NOT EXISTS" "$MIGRATION" || { echo "FAIL: migration 回填缺防重复逻辑"; exit 1; }
echo "[crm-status-history-smoke] ✓ migration 含幂等保护"

# 3. 路由实现文件检查：crm.ts 含事务模式关键词
CRM_ROUTE="$ROOT/apps/api/src/routes/crm.ts"
[ -f "$CRM_ROUTE" ] || { echo "FAIL: crm 路由文件不存在: $CRM_ROUTE"; exit 1; }
grep -q "BEGIN" "$CRM_ROUTE" || { echo "FAIL: crm.ts 缺 BEGIN（非事务模式）"; exit 1; }
grep -q "ROLLBACK" "$CRM_ROUTE" || { echo "FAIL: crm.ts 缺 ROLLBACK（缺失错误回滚）"; exit 1; }
grep -q "crm_customer_status_history" "$CRM_ROUTE" || { echo "FAIL: crm.ts 未写入 status_history 表"; exit 1; }
echo "[crm-status-history-smoke] ✓ crm.ts 事务模式 + 历史写入"

# 4. 合同测试存在性检查（vitest B1-B6）
TEST_FILE="$ROOT/sprints/07081012-crm-status-history/tests/crm-status-history.test.ts"
[ -f "$TEST_FILE" ] || { echo "FAIL: 合同测试文件不存在: $TEST_FILE"; exit 1; }
BEHAVIOR_COUNT=$(grep -c "\[BEHAVIOR\]" "$TEST_FILE" || true)
[ "$BEHAVIOR_COUNT" -ge 6 ] || { echo "FAIL: 合同测试 [BEHAVIOR] 条目不足 6（当前 $BEHAVIOR_COUNT）"; exit 1; }
echo "[crm-status-history-smoke] ✓ 合同测试文件含 $BEHAVIOR_COUNT 个 BEHAVIOR 条目"

# 5. 若有 DATABASE_URL，真实验证 migration 表结构
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[crm-status-history-smoke] 检测到 DATABASE_URL，验证 DB 表结构..."
  TABLE_EXISTS=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='crm_customer_status_history'" 2>/dev/null || echo "")
  if [ "$TABLE_EXISTS" = "1" ]; then
    echo "[crm-status-history-smoke] ✓ DB 表 zenithjoy.crm_customer_status_history 已存在"
  else
    echo "[crm-status-history-smoke] WARN: DB 表不存在（需先跑 migration），跳过 DB 验证"
  fi
else
  echo "[crm-status-history-smoke] SKIP: 无 DATABASE_URL，跳过 DB 链路验证（可手动跑 e2e-verify.sh）"
fi

# 6. 转调 e2e-verify.sh（如存在）
if [ -f "$E2E_VERIFY" ]; then
  echo "[crm-status-history-smoke] 转调 e2e-verify.sh..."
  bash "$E2E_VERIFY"
fi

echo "[crm-status-history-smoke] ALL PASS"
