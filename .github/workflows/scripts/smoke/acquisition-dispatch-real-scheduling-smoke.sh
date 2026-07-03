#!/usr/bin/env bash
# acquisition-dispatch-real-scheduling-smoke.sh
# Line02 真调度升级 smoke — 在线感知 + dispatch_reason + pending_dispatch + queued_remap
#
# 验证点：
#   1. POST /dispatch/build 响应含 data.pending 字段（number）
#   2. 在线 burner 时 dm_assignments 有 dispatch_reason='least_load' + status='queued'
#   3. 无认证 → 401 + error.code='NO_TENANT'
#   4. 全部 burner 离线（last_heartbeat_at > 2min）→ data.assigned=0, data.pending≥1, DB 有 pending_dispatch 行
#   5. queued_remap：burner 掉线后已排队 queued 行自动重标 pending_dispatch（DB 级验证）
#   6. pending_dispatch 重试：下一轮 burner 恢复在线 → pending 清零，queued 行出现
#
# 端到端：建租户+agent → 在线时 build（验 dispatch_reason/pending 字段）→ 模拟掉线 → 再 build（验 pending_dispatch + queued_remap）→ 恢复在线 → 再 build（验重试清零）

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 前置：建测试 tenant ────────────────────────────────────────────────────────
RAND="${RANDOM}-$$"
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('dsp-rs-${RAND}', 'dsp-rs-key-${RAND}', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
echo "    [TENANT_ID=$TENANT_ID]"
H=(-H "X-Tenant-Id: $TENANT_ID")

# 建 agent + burner session（初始 last_heartbeat_at = NOW = 在线）
AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, status, last_heartbeat_at) VALUES ('$TENANT_ID', 'rs-agent-${RAND}', 'online', NOW()) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$AGENT_ID" ] || fail "前置：建 agent 失败" 99

psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at) VALUES ('$AGENT_ID','douyin','rs-burner-1','burner','active', NOW())" >/dev/null \
  || fail "前置：建 burner session 失败" 99

# 设宽时段 + 高预算 + 极短间隔
psql "$DB" -c "INSERT INTO zenithjoy.acquisition_config (tenant_id, dm_per_day, dm_per_hour, burner_count, dm_active_start, dm_active_end, dm_interval_min_sec, dm_interval_max_sec) VALUES ('$TENANT_ID', 50, 20, 1, '00:00', '23:59', 1, 2) ON CONFLICT (tenant_id) DO UPDATE SET dm_per_day=50, dm_per_hour=20, burner_count=1, dm_active_start='00:00', dm_active_end='23:59', dm_interval_min_sec=1, dm_interval_max_sec=2" >/dev/null \
  || fail "前置：写 acquisition_config 失败" 99

# 2 条已评分 leads
psql "$DB" -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, profile_url, partial, relevance_score) VALUES ('$TENANT_ID','rs_sec_1','客户RS1','https://www.douyin.com/user/rs1',false,80), ('$TENANT_ID','rs_sec_2','客户RS2','https://www.douyin.com/user/rs2',false,70)" >/dev/null \
  || fail "前置：建 leads 失败" 99
ok "前置：tenant + agent(在线) + 1 burner + 2 leads 就绪"

# ── 1. 无认证 → 401 + error.code='NO_TENANT' ──────────────────────────────────
NOAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/acquisition/dispatch/build")
[ "$NOAUTH_CODE" = "401" ] || fail "无 X-Tenant-Id 应 401，实得 $NOAUTH_CODE" 1
NOAUTH_BODY=$(curl -s -X POST "$API_BASE/api/acquisition/dispatch/build")
echo "$NOAUTH_BODY" | jq -er '.error.code == "NO_TENANT"' >/dev/null \
  || fail "无认证 error.code 应='NO_TENANT' — $NOAUTH_BODY" 1
ok "POST /dispatch/build 无认证 → 401 + error.code=NO_TENANT"

# ── 2. 在线 burner 时 build → dispatch_reason='least_load', data.pending=0 ──────
BUILD1=$(curl -fsS -X POST "${H[@]}" "$API_BASE/api/acquisition/dispatch/build")
echo "$BUILD1" | jq -er '.success == true' >/dev/null \
  || fail "build1 success 应=true — $BUILD1" 1

# data.pending 字段必须存在且类型为 number
echo "$BUILD1" | jq -er '(.data.pending | type) == "number"' >/dev/null \
  || fail "data.pending 字段应存在且类型为 number — $BUILD1" 1

ASSIGNED1=$(echo "$BUILD1" | jq -r '.data.assigned')
PENDING1=$(echo "$BUILD1" | jq -r '.data.pending')
[ "$ASSIGNED1" -ge 1 ] 2>/dev/null || fail "在线时 data.assigned 应≥1，实得 $ASSIGNED1" 1
[ "$PENDING1" -eq 0 ] 2>/dev/null || fail "在线时 data.pending 应=0，实得 $PENDING1" 1
ok "POST /dispatch/build (在线) → assigned=$ASSIGNED1 pending=$PENDING1 data.pending=number"

# DB 校验：dispatch_reason='least_load' + status='queued'
DB_REASON=$(psql "$DB" -At -c "SELECT dispatch_reason FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='queued' LIMIT 1")
[ "$DB_REASON" = "least_load" ] || fail "dispatch_reason 应='least_load'，实得 '$DB_REASON'" 1
ok "DB 校验：dm_assignments.dispatch_reason='least_load'"

QUEUED_LABEL=$(psql "$DB" -At -c "SELECT account_label FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='queued' LIMIT 1")
[ "$QUEUED_LABEL" = "rs-burner-1" ] || fail "account_label 应='rs-burner-1'，实得 '$QUEUED_LABEL'" 1
ok "DB 校验：已派给在线小号 rs-burner-1"

# ── 3. queued_remap：模拟 burner 掉线 → 已排队行自动重标 pending_dispatch ────────
# 将 agent 心跳设为 10 分钟前（超过 2 分钟阈值 = 离线）
psql "$DB" -c "UPDATE zenithjoy.agents SET last_heartbeat_at = NOW() - INTERVAL '10 minutes' WHERE id = '$AGENT_ID'" >/dev/null \
  || fail "模拟掉线：更新 last_heartbeat_at 失败" 99
ok "模拟 burner 掉线（last_heartbeat_at - 10min）"

# 再次 build → queued_remap 应发生：已排队行变 pending_dispatch
BUILD2=$(curl -fsS -X POST "${H[@]}" "$API_BASE/api/acquisition/dispatch/build")
echo "$BUILD2" | jq -er '.success == true' >/dev/null \
  || fail "build2 应 success=true — $BUILD2" 1

ASSIGNED2=$(echo "$BUILD2" | jq -r '.data.assigned')
PENDING2=$(echo "$BUILD2" | jq -r '.data.pending')
[ "$ASSIGNED2" -eq 0 ] 2>/dev/null || fail "全离线时 data.assigned 应=0，实得 $ASSIGNED2" 1
[ "$PENDING2" -ge 1 ] 2>/dev/null || fail "全离线时 data.pending 应≥1，实得 $PENDING2" 1
ok "POST /dispatch/build (全离线) → assigned=0 pending=$PENDING2"

# DB 校验：queued 行已重标为 pending_dispatch（queued_remap）
DB_QUEUED_AFTER=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='queued'")
DB_PENDING_AFTER=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='pending_dispatch'")
[ "$DB_QUEUED_AFTER" -eq 0 ] || fail "queued_remap 后 queued 行应=0，实得 $DB_QUEUED_AFTER" 1
[ "$DB_PENDING_AFTER" -ge 1 ] || fail "queued_remap 后 pending_dispatch 行应≥1，实得 $DB_PENDING_AFTER" 1
ok "queued_remap DB 校验：queued=0 pending_dispatch=$DB_PENDING_AFTER（重标成功）"

# 离线 burner account_label 不出现在 queued 行
OFFLINE_IN_QUEUED=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='queued' AND account_label='rs-burner-1'")
[ "$OFFLINE_IN_QUEUED" -eq 0 ] || fail "离线小号 rs-burner-1 不应出现在 queued 行，实得 $OFFLINE_IN_QUEUED 条" 1
ok "离线小号 rs-burner-1 不出现在 queued 行"

# ── 4. pending_dispatch 重试：burner 恢复在线 → pending 清零 ─────────────────────
psql "$DB" -c "UPDATE zenithjoy.agents SET last_heartbeat_at = NOW() WHERE id = '$AGENT_ID'" >/dev/null \
  || fail "恢复在线：更新 last_heartbeat_at 失败" 99
ok "恢复 burner 在线（last_heartbeat_at = NOW）"

BUILD3=$(curl -fsS -X POST "${H[@]}" "$API_BASE/api/acquisition/dispatch/build")
echo "$BUILD3" | jq -er '.success == true' >/dev/null \
  || fail "build3 应 success=true — $BUILD3" 1

ASSIGNED3=$(echo "$BUILD3" | jq -r '.data.assigned')
PENDING3=$(echo "$BUILD3" | jq -r '.data.pending')
[ "$ASSIGNED3" -ge 1 ] 2>/dev/null || fail "恢复在线后 data.assigned 应≥1，实得 $ASSIGNED3" 1
[ "$PENDING3" -eq 0 ] 2>/dev/null || fail "重试后 data.pending 应=0，实得 $PENDING3" 1
ok "POST /dispatch/build (重试) → assigned=$ASSIGNED3 pending=0（pending_dispatch 清零）"

DB_PENDING3=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='pending_dispatch'")
[ "$DB_PENDING3" -eq 0 ] || fail "重试后 pending_dispatch 行应=0，实得 $DB_PENDING3" 1
ok "DB 校验：重试后 pending_dispatch=0，全部升级为 queued"

# ── 清理 ─────────────────────────────────────────────────────────────────────
psql "$DB" -c "DELETE FROM zenithjoy.dm_outreach_log    WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments     WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads  WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null 2>&1 || true

echo "✅ acquisition-dispatch-real-scheduling smoke ALL PASS"
