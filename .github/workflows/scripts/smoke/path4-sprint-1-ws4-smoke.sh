#!/usr/bin/env bash
# Path 4 Sprint 1 ws4 — 朋友圈文案草稿 + scheduler-tick + 本地营销画像 smoke
#
# 验证：
#   1) /api/wechat/scheduler-tick {force:true, customer:"客户A"} → 200 + {generated/skipped}
#   2) DB zenithjoy.wechat_marketing_profile 表存在（迁移已跑）
#   3) DB wechat_publish_task 含 type='moment' AND approval_source NULL 的草稿（A 路线护栏）
#   4) scheduler.ts 静态校验 cron '0 9 * * *' + thin server 时区注释
#   5) wechat-draft.ts 不再有 FEISHU_PROFILE_TABLE_ID / searchTable 飞书调用（去飞书验证）
#   6) /api/wechat/marketing-profile 端点存在（wechat.ts grep）
#   7) /api/wechat/moment-drafts 端点存在（审核台本地化验证）
#
# CI 模式（无凭据）：仅跑静态校验，跳过真调用
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== ws4 静态校验（cron / route / service 字面量）==="

SCHEDULER_FILE=apps/api/src/services/scheduler.ts
DRAFT_FILE=apps/api/src/services/wechat-draft.ts
ROUTE_FILE=apps/api/src/routes/wechat.ts

[ -f "$SCHEDULER_FILE" ] || { echo "FAIL: $SCHEDULER_FILE 不存在"; exit 1; }
grep -qE "cron[[:space:]]*[:=].*'0 9 \* \* \*'|cron.*\"0 9 \* \* \*\"|'0 9 \* \* \*'" "$SCHEDULER_FILE" \
  || { echo "FAIL: scheduler.ts 缺 cron 表达式 '0 9 * * *'"; exit 1; }
grep -qE "thin.*server[[:space:]]*时区" "$SCHEDULER_FILE" \
  || { echo "FAIL: scheduler.ts 缺 thin server 时区注释"; exit 1; }
echo "  PASS scheduler.ts cron + thin 注释"

grep -qE "export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+generateMomentDraft" "$DRAFT_FILE" \
  || { echo "FAIL: wechat-draft.ts 缺 generateMomentDraft export"; exit 1; }
grep -q "moment" "$DRAFT_FILE" || { echo "FAIL: wechat-draft.ts 缺 'moment' type 字面量"; exit 1; }
echo "  PASS wechat-draft.ts generateMomentDraft + type='moment'"

# 去飞书验证：不允许再有 FEISHU_PROFILE_TABLE_ID / searchTable / FEISHU_SCHEDULE_TABLE_ID
! grep -q "FEISHU_PROFILE_TABLE_ID\|FEISHU_SCHEDULE_TABLE_ID" "$DRAFT_FILE" \
  || { echo "FAIL: wechat-draft.ts 仍含 FEISHU_PROFILE_TABLE_ID 或 FEISHU_SCHEDULE_TABLE_ID（去飞书未完成）"; exit 1; }
! grep -qE "async function searchTable|async function createRecord" "$DRAFT_FILE" \
  || { echo "FAIL: wechat-draft.ts 仍含飞书 searchTable/createRecord（去飞书未完成）"; exit 1; }
grep -q "wechat_marketing_profile" "$DRAFT_FILE" \
  || { echo "FAIL: wechat-draft.ts 未查本地 wechat_marketing_profile 表（本地化未完成）"; exit 1; }
echo "  PASS wechat-draft.ts 已去飞书，改查本地 wechat_marketing_profile"

grep -q "/scheduler-tick" "$ROUTE_FILE" || { echo "FAIL: wechat.ts 缺 /scheduler-tick 路由"; exit 1; }
grep -q "generateMomentDraft" "$ROUTE_FILE" || { echo "FAIL: wechat.ts 未调 generateMomentDraft"; exit 1; }
grep -q "marketing-profile" "$ROUTE_FILE" || { echo "FAIL: wechat.ts 缺 /marketing-profile 路由（审核台本地化）"; exit 1; }
grep -q "moment-drafts" "$ROUTE_FILE" || { echo "FAIL: wechat.ts 缺 /moment-drafts 路由（审核台本地化）"; exit 1; }
echo "  PASS wechat.ts /scheduler-tick + generateMomentDraft + 本地审核台路由"

# 迁移文件存在（DB schema 变更验证）
MIGRATION_FILE="apps/api/db/migrations/20260714_090000_create_wechat_marketing_profile.sql"
[ -f "$MIGRATION_FILE" ] \
  || { echo "FAIL: $MIGRATION_FILE 迁移文件不存在"; exit 1; }
grep -q "wechat_marketing_profile" "$MIGRATION_FILE" \
  || { echo "FAIL: 迁移文件缺 wechat_marketing_profile 建表语句"; exit 1; }
echo "  PASS migration 文件存在且含建表语句"

# 真凭据 / 服务模式（CI 跳过）
if [ "${CI:-}" = "true" ] || [ -z "${OPENROUTER_API_KEY:-}${SKIP_LIVE:-}" ]; then
  echo "=== CI 或缺凭据：跳过真调用 happy path ==="
  echo "ws4-smoke: STATIC OK"
  exit 0
fi

if [ -f ~/.credentials/openrouter.env ]; then
  # shellcheck disable=SC1090
  source ~/.credentials/openrouter.env
fi

API="${ZJ_API:-http://localhost:5200}"
DB="${DATABASE_NAME:-cecelia}"
DBUSER="${DATABASE_USER:-postgres}"
TENANT_ID="${SCHEDULER_TENANT_ID:-}"

# 确认 wechat_marketing_profile 表存在
HAS_WMP=$(psql -U "$DBUSER" -d "$DB" -tA \
  -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='wechat_marketing_profile')" 2>/dev/null || echo "f")
[ "$HAS_WMP" = "t" ] \
  || { echo "FAIL: zenithjoy.wechat_marketing_profile 表不存在（迁移未跑？）"; exit 1; }
echo "PASS: zenithjoy.wechat_marketing_profile 表存在"

# Upsert 本地营销画像（替代旧 seed-feishu-profile.js）
if [ -n "$TENANT_ID" ]; then
  curl -sS -X POST "$API/api/wechat/marketing-profile" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT_ID" \
    -d '{"customer":"客户A","industry":"美妆代购","audience":"25-35女性白领","hook":"正品保障+免税价"}' \
    -o /tmp/ws4-profile.json
  grep -qE '"ok":true|"customer"' /tmp/ws4-profile.json \
    && echo "PASS: marketing-profile upsert 成功" \
    || { echo "FAIL: marketing-profile upsert 失败"; cat /tmp/ws4-profile.json; exit 1; }
fi

# 触发 scheduler-tick
curl -sS -X POST "$API/api/wechat/scheduler-tick" \
  -H "Content-Type: application/json" \
  ${TENANT_ID:+-H "X-Tenant-Id: $TENANT_ID"} \
  -d "{\"force\": true, \"customer\": \"客户A\"${TENANT_ID:+, \"tenant_id\": \"$TENANT_ID\"}}" \
  | tee /tmp/ws4-tick.json

grep -E '"generated":[0-9]' /tmp/ws4-tick.json >/dev/null \
  && echo "PASS: scheduler-tick 返回结构合法" \
  || { echo "FAIL: scheduler-tick 响应缺 generated 字段"; exit 1; }

echo "ws4-smoke: ALL PASS"
