#!/usr/bin/env bash
# e2e-verify.sh — wechat-cs-reply 判断内核接入 E2E 验收入口
#
# 用法：bash sprints/07081557-wechat-cs-reply-integration/tests/e2e-verify.sh
#
# 触发顺序：
#   1) wechat-draft 单元测试（新增 B-1~B-4 + 原有 4 场景回归）
#   2) wechat-cs-reply-smoke.sh（curl/DB 验证 escalate + stage history + 编造词拦截）
#   3) Migration 幂等验证

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
API="$ROOT/apps/api"
SMOKE="$ROOT/.github/workflows/scripts/smoke"

echo "=== [Step 1/3] wechat-draft vitest（B-1~B-4 新场景 + 原有 4 场景回归）==="
( cd "$API" && npx vitest run tests/services/wechat-draft.test.ts )

echo ""
echo "=== [Step 2/3] wechat-cs-reply-smoke.sh（curl/DB 断言）==="
bash "$SMOKE/wechat-cs-reply-smoke.sh"

echo ""
echo "=== [Step 3/3] Migration 幂等验证（执行两次） ==="
MIGRATION="$API/db/migrations/20260708_130000_crm_status_history_changed_by.sql"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "SKIP: DATABASE_URL 未设置，跳过 migration 验证（CI 中应有值）"
else
  psql "$DATABASE_URL" -f "$MIGRATION" && echo "第一次执行 OK"
  psql "$DATABASE_URL" -f "$MIGRATION" && echo "第二次执行 OK（幂等）"
fi

echo ""
echo "PASS e2e-verify — wechat-cs-reply 判断内核接入"
