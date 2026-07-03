#!/usr/bin/env bash
# line02-account-role-unify-smoke.sh
# GOLDEN_SMOKE_ABILITY_SLUG: line02-account-role-unify
# GOLDEN_SMOKE_TARGET_ENV: local_api
#
# Sprint: 07032332-line02-account-role-unify
# 验证：
#   Scenario 1 — GET /api/agent/burner/sessions 含 agent_hostname/agent_nickname/agent_status
#   Scenario 2 — DouyinBurnerBindPage.tsx 已物理删除，navigation.config + AreaHubPage 已清理
#   Scenario 3 — 迁移脚本 --dry-run 退出码 0 + 输出日志
#   Scenario 4 — 多租户隔离：租户 B 不见租户 A 的 sessions
#   Scenario 5 — cutover 三值映射 ok→active / expired→expired / unknown→pending

set -uo pipefail

API_BASE="${API_BASE:-${BRAIN_URL:-http://localhost:3000}}"
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

TS=$(date +%s)

# ── Scenario 1: api-sessions-has-agent-hostname ──────────────────────────────
TENANT_ID=$(psql "$DB" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-role-${TS}', 'sk-${TS}', 'free') RETURNING id" | tr -d ' \n')
[ -n "$TENANT_ID" ] || fail "Scenario 1: 无法创建测试租户" 99

AID=$(psql "$DB" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, nickname, status) VALUES ('${TENANT_ID}', 'mac-smoke-${TS}', 'smoke-host', 'smoke-nick', 'online') RETURNING id" | tr -d ' \n')
[ -n "$AID" ] || fail "Scenario 1: 无法创建测试 agent" 99

psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, created_at, bound_at) VALUES ('${AID}','douyin','smoke-label','burner','active',NOW(),NOW())"

RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "${API_BASE}/api/agent/burner/sessions") || {
  psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='${AID}'"
  psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='${AID}'"
  psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='${TENANT_ID}'"
  fail "Scenario 1: GET /sessions 未返回 200" 1
}

echo "$RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.success)process.exit(1)" || fail "Scenario 1: success!=true" 1
COUNT=$(echo "$RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.data.sessions.length))")

if [ "$COUNT" -gt 0 ]; then
  echo "$RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const s=d.data.sessions[0];['agent_hostname','agent_nickname','agent_status'].forEach(k=>{if(!(k in s)){console.error('FAIL: 缺'+k);process.exit(1);}});if(s.role!=='burner'){console.error('FAIL: role!=burner');process.exit(1);}if('hostname' in s){console.error('FAIL: 禁用字段 hostname 出现');process.exit(1);}" || fail "Scenario 1: 字段断言失败" 1
fi

psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='${AID}'"
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='${AID}'"
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='${TENANT_ID}'"
ok "Scenario 1: api-sessions-has-agent-hostname (count=$COUNT)"

# ── Scenario 2: old-route-deleted-and-file-gone ──────────────────────────────
test ! -f "apps/dashboard/src/pages/DouyinBurnerBindPage.tsx" || fail "Scenario 2: DouyinBurnerBindPage.tsx 未删除" 1
grep -q "DouyinBurnerBind" "apps/dashboard/src/config/navigation.config.ts" && fail "Scenario 2: navigation.config 仍有 DouyinBurnerBind 引用" 1 || true
grep -q "douyin-burner-bind" "apps/dashboard/src/config/navigation.config.ts" && fail "Scenario 2: navigation.config 仍有 douyin-burner-bind 路径" 1 || true
grep -q "douyin-burner-bind" "apps/dashboard/src/pages/AreaHubPage.tsx" && fail "Scenario 2: AreaHubPage 仍有旧链接" 1 || true
ok "Scenario 2: old-route-deleted-and-file-gone"

# ── Scenario 3: migration-dry-run-exits-zero ─────────────────────────────────
grep -q "dry-run\|dryRun" "apps/api/scripts/account-role-migrate.js" || fail "Scenario 3: 迁移脚本缺 dry-run 参数处理" 1
grep -q "active\|pending" "apps/api/scripts/account-role-migrate.js" || fail "Scenario 3: 迁移脚本缺三值映射逻辑" 1
DATABASE_URL="${DB}" node apps/api/scripts/account-role-migrate.js --dry-run > /tmp/dry-run-smoke.log 2>&1
EC=$?; [ $EC -eq 0 ] || { echo "FAIL: dry-run 退出非零"; cat /tmp/dry-run-smoke.log; exit 1; }
grep -qE "dry.run|conflict|ok|complete|0 row|完成" /tmp/dry-run-smoke.log || { echo "FAIL: 日志无可识别输出"; cat /tmp/dry-run-smoke.log; exit 1; }
ok "Scenario 3: migration-dry-run-exits-zero"

# ── Scenario 4: multi-tenant-isolation ──────────────────────────────────────
TA=$(psql "$DB" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('iso-a-${TS}', 'ka-${TS}', 'free') RETURNING id" | tr -d ' \n')
TB=$(psql "$DB" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('iso-b-${TS}', 'kb-${TS}', 'free') RETURNING id" | tr -d ' \n')
A_AID=$(psql "$DB" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('${TA}', 'mac-iso-${TS}', 'host-a', 'online') RETURNING id" | tr -d ' \n')
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, created_at, bound_at) VALUES ('${A_AID}', 'douyin', 'iso-label', 'burner', 'active', NOW(), NOW())"

RESP_B=$(curl -sf -H "X-Tenant-Id: ${TB}" "${API_BASE}/api/agent/burner/sessions") || fail "Scenario 4: 租户 B GET /sessions 失败" 1
CNT=$(echo "$RESP_B" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.data.sessions.length))")
[ "$CNT" -eq 0 ] || fail "Scenario 4: 跨租户泄露，B 看到 ${CNT} 条 A 的 sessions" 1

psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='${A_AID}'"
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='${A_AID}'"
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id IN ('${TA}','${TB}')"
ok "Scenario 4: multi-tenant-isolation"

# ── Scenario 5: cutover-health-mapping ──────────────────────────────────────
CTID=$(psql "$DB" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cut-${TS}', 'ck-${TS}', 'free') RETURNING id" | tr -d ' \n')
CAID=$(psql "$DB" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('${CTID}', 'mac-c-${TS}', 'cut-host', 'online') RETURNING id" | tr -d ' \n')
psql "$DB" -c "INSERT INTO zenithjoy.line02_account_sessions (agent_id, platform, account_label, health, tenant_id) VALUES ('${CAID}','douyin','ok-${TS}','ok','${CTID}'), ('${CAID}','douyin','exp-${TS}','expired','${CTID}'), ('${CAID}','douyin','unk-${TS}','unknown','${CTID}')"

DATABASE_URL="${DB}" node apps/api/scripts/account-role-migrate.js > /tmp/cut-smoke.log 2>&1
[ $? -eq 0 ] || { echo "FAIL: cutover exit non-zero"; cat /tmp/cut-smoke.log; exit 1; }

C_OK=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='${CAID}' AND account_label='ok-${TS}' AND status='active' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_OK" -eq 1 ] || fail "Scenario 5: ok→active count=${C_OK}" 1
C_EXP=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='${CAID}' AND account_label='exp-${TS}' AND status='expired' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_EXP" -eq 1 ] || fail "Scenario 5: expired→expired count=${C_EXP}" 1
C_UNK=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='${CAID}' AND account_label='unk-${TS}' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_UNK" -eq 1 ] || fail "Scenario 5: unknown→pending count=${C_UNK}" 1

psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='${CAID}'" 2>/dev/null || true
psql "$DB" -c "DELETE FROM zenithjoy.line02_account_sessions WHERE agent_id='${CAID}'" 2>/dev/null || true
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='${CAID}'" 2>/dev/null || true
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='${CTID}'" 2>/dev/null || true
ok "Scenario 5: cutover-health-mapping (ok→active, expired→expired, unknown→pending)"

echo ""
echo "✅ line02-account-role-unify smoke 全部通过"
