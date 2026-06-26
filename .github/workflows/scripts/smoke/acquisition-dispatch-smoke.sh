#!/usr/bin/env bash
# acquisition-dispatch-smoke.sh
# 刀1：Line02 智能获客「分析+指派」中台大脑 smoke（架构 A — 薄指挥放中台）
#   GET/PUT /api/acquisition/config            读/写配置（数值范围校验）
#   POST    /api/acquisition/dispatch/build     scoreLeads + buildAssignments
#   GET     /api/acquisition/dispatch/plan      指派计划（谁×哪个号×何时×状态）
#   POST    /api/acquisition/dispatch/run       dispatchDue 执行到期
#   GET     /api/acquisition/cookie-health      各号健康分类
#
# 端到端：建租户 → PUT config → 建 burner 小号 session + 评分 leads → build 见指派 → run 出真发日志。
# 任一断言失败 → exit 非 0。租户上下文走 X-Tenant-Id 头（tenantContextOptional），绝不信 query.tenant_id。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 前置：建测试 tenant ─────────────────────────────────────────────────────
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('dsp-smoke-${RANDOM}-$$', 'dsp-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
echo "    [TENANT_ID=$TENANT_ID]"
H_TENANT=(-H "X-Tenant-Id: $TENANT_ID")

# ── 1. GET config 无认证 → 401（不越权）──
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/acquisition/config")
[ "$NOAUTH" = "401" ] || fail "GET config 无认证应 401，实得 $NOAUTH" 1
ok "GET /api/acquisition/config 无认证 → 401"

# ── 2. GET config（无配置行 → 返默认）──
CFG=$(curl -fsS "${H_TENANT[@]}" "$API_BASE/api/acquisition/config")
echo "$CFG" | jq -er '.success == true and .data.dm_per_day == 30 and .data.burner_count == 3' >/dev/null \
  || fail "GET config 默认值错（应 dm_per_day=30 burner_count=3）— $CFG" 1
ok "GET config 返默认（dm_per_day=30 burner_count=3）"

# ── 3. PUT config 非法 → 400 ──
BAD=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${H_TENANT[@]}" -H "Content-Type: application/json" \
  -d '{"dm_per_day":99999}' "$API_BASE/api/acquisition/config")
[ "$BAD" = "400" ] || fail "PUT config 非法 dm_per_day 应 400，实得 $BAD" 1
ok "PUT config 非法数值 → 400"

# ── 4. PUT config 合法（窄时段 + 高预算便于 build/run 出货）──
PUTR=$(curl -fsS -X PUT "${H_TENANT[@]}" -H "Content-Type: application/json" \
  -d '{"dm_per_day":30,"dm_per_hour":10,"burner_count":2,"dm_active_start":"00:00","dm_active_end":"23:59","dm_interval_min_sec":1,"dm_interval_max_sec":2}' \
  "$API_BASE/api/acquisition/config")
echo "$PUTR" | jq -er '.data.dm_per_hour == 10 and .data.burner_count == 2' >/dev/null \
  || fail "PUT config 合法应回写 dm_per_hour=10 burner_count=2 — $PUTR" 1
# 落库校验
DB_HOUR=$(psql "$DB" -At -c "SELECT dm_per_hour FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID'")
[ "$DB_HOUR" = "10" ] || fail "config 落库 dm_per_hour 应=10，实得 $DB_HOUR" 1
ok "PUT config 合法 → upsert 落库 dm_per_hour=10"

# ── 前置数据：建 agent + 2 个 active burner 小号 + 评分 leads ──
AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, status) VALUES ('$TENANT_ID', 'dsp-agent-$$', 'online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$AGENT_ID" ] || fail "前置：建 agent 失败" 99
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at) VALUES ('$AGENT_ID','douyin','burner-1','burner','active', NOW()), ('$AGENT_ID','douyin','burner-2','burner','active', NOW()), ('$AGENT_ID','douyin','main-1','main','active', NOW())" >/dev/null || fail "前置：建 sessions 失败" 99
# 3 条 leads（含一条 partial 低分），全部已建（relevance_score 由 build 内 scoreLeads 打）
psql "$DB" -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, profile_url, partial) VALUES ('$TENANT_ID','sec_a','客户A','https://www.douyin.com/user/sec_a',false), ('$TENANT_ID','sec_b','客户B','https://www.douyin.com/user/sec_b',false), ('$TENANT_ID',NULL,'残缺C',NULL,true)" >/dev/null || fail "前置：建 leads 失败" 99
ok "前置：2 active burner + 3 leads 就绪"

# ── 5. POST dispatch/build（scoreLeads + buildAssignments）──
BUILD=$(curl -fsS -X POST "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/build")
echo "$BUILD" | jq -er '.success == true and .data.scored == 3 and .data.assigned >= 1' >/dev/null \
  || fail "build 应 scored=3 assigned>=1 — $BUILD" 1
ASSIGNED=$(echo "$BUILD" | jq -r '.data.assigned')
ok "POST dispatch/build → scored=3 assigned=$ASSIGNED"

# 落库校验：dm_assignments 有 queued 行 + relevance_score 已写
DB_ASSIGN=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID'")
[ "$DB_ASSIGN" -ge 1 ] || fail "dm_assignments 应有>=1 行，实得 $DB_ASSIGN" 1
DB_SCORED=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND relevance_score IS NOT NULL")
[ "$DB_SCORED" = "3" ] || fail "3 条 leads 应全部已评分，实得 $DB_SCORED" 1
ok "落库：dm_assignments=$DB_ASSIGN 行 + 3 leads 全评分"

# ── 6. GET dispatch/plan（见指派：客户×号×排期×状态）──
PLAN=$(curl -fsS "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/plan")
echo "$PLAN" | jq -er '.data.total >= 1 and (.data.plan[0] | has("account_label") and has("scheduled_for") and has("nickname"))' >/dev/null \
  || fail "plan 应含 account_label/scheduled_for/nickname — $PLAN" 1
ok "GET dispatch/plan → total=$(echo "$PLAN" | jq -r '.data.total')"

# ── 7. POST dispatch/run（执行到期指派 → 真发日志）──
# 把已排期指派提前到过去，确保 scheduled_for<=now 到期可发
psql "$DB" -c "UPDATE zenithjoy.dm_assignments SET scheduled_for = NOW() - interval '1 minute' WHERE tenant_id='$TENANT_ID' AND status='queued'" >/dev/null
RUN=$(curl -fsS -X POST "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/run")
echo "$RUN" | jq -er '.success == true and .data.dispatched >= 1' >/dev/null \
  || fail "run 应 dispatched>=1 — $RUN" 1
ok "POST dispatch/run → dispatched=$(echo "$RUN" | jq -r '.data.dispatched')"

# 落库校验：dm_outreach_log 有记录 + 指派状态变 dispatched
DB_LOG=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$TENANT_ID'")
[ "$DB_LOG" -ge 1 ] || fail "dm_outreach_log 应有>=1 真发记录，实得 $DB_LOG" 1
ok "落库：dm_outreach_log=$DB_LOG 条真发记录"

# ── 8. GET cookie-health（main+burner 分类）──
CK=$(curl -fsS "${H_TENANT[@]}" "$API_BASE/api/acquisition/cookie-health")
echo "$CK" | jq -er '.success == true and (.data.items | length >= 3) and (.data | has("alert_count"))' >/dev/null \
  || fail "cookie-health 应含>=3 items + alert_count — $CK" 1
# 刚 bound_at=NOW() 的号应 healthy
HEALTHY=$(echo "$CK" | jq -r '[.data.items[] | select(.status=="healthy")] | length')
[ "$HEALTHY" -ge 1 ] || fail "应至少 1 个 healthy 号（刚绑定），实得 $HEALTHY — $CK" 1
ok "GET cookie-health → items=$(echo "$CK" | jq -r '.data.items|length') healthy=$HEALTHY"

# ── 清理 ──
psql "$DB" -c "DELETE FROM zenithjoy.dm_outreach_log   WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments    WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null 2>&1 || true

echo "✅ acquisition-dispatch smoke ALL PASS"
