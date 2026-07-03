#!/usr/bin/env bash
# line02-machine-burner-routing-smoke.sh
# 方案C+D（docs/handoff-agent-task-routing-cd.md）：
#   GET  /api/agent/machines           机器感知列表（方案C 数据源）
#   GET  /api/agent/burner/sessions    burner 账号列表（补 hostname/nickname，方案D 数据源）
#   POST /api/acquisition/collect/start  account_label 命中 active burner session → 自动路由到绑定机器；
#                                         查不到 → 400 BURNER_SESSION_NOT_FOUND
#
# 端到端：建 tenant + 2 台 agent（1 online 1 offline）+ 1 个 burner session(role=burner,status=active) →
#   验证 /agent/machines 能看到在线状态、/agent/burner/sessions 带机器名 →
#   collect/start 带 account_label 命中 → 落库 agent_id = 那台机器；不存在的 account_label → 400。
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 前置：tenant + 2 台 agent（online / offline）+ license ──
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('mbr-smoke-${RANDOM}-$$', 'mbr-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99

ONLINE_AGENT=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, nickname, status, last_seen)
  VALUES ('$TENANT_ID', 'mbr-agent-online-$$', 'ROG-PC', '西安ROG', 'online', NOW()) RETURNING id")
[ -n "$ONLINE_AGENT" ] || fail "前置：建在线 agent 失败" 99

OFFLINE_AGENT=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_seen)
  VALUES ('$TENANT_ID', 'mbr-agent-offline-$$', 'OLD-MAC', 'offline', NOW() - INTERVAL '1 hour') RETURNING id")
[ -n "$OFFLINE_AGENT" ] || fail "前置：建离线 agent 失败" 99

psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at)
  VALUES ('$ONLINE_AGENT', 'douyin', 'mbr-burner-1', 'burner', 'active', NOW())" >/dev/null \
  || fail "前置：建 burner session 失败" 99

H_TENANT=(-H "X-Tenant-Id: $TENANT_ID")

# ── 1. GET /agent/machines — 能看到 1 online + 1 offline ──
MACHINES=$(curl -fsS "${H_TENANT[@]}" "$API_BASE/api/agent/machines")
echo "$MACHINES" | jq -e '[.data[] | select(.status=="online")] | length == 1' >/dev/null \
  || fail "GET /agent/machines 在线机器数应为 1 — $MACHINES" 1
ok "GET /agent/machines 正确区分 online/offline"

# ── 2. GET /agent/burner/sessions — 带 hostname/nickname ──
SESSIONS=$(curl -fsS "${H_TENANT[@]}" "$API_BASE/api/agent/burner/sessions")
echo "$SESSIONS" | jq -e '.data.sessions[] | select(.account_label=="mbr-burner-1") | .hostname == "ROG-PC" and .nickname == "西安ROG"' >/dev/null \
  || fail "GET /agent/burner/sessions 未带正确 hostname/nickname — $SESSIONS" 1
ok "GET /agent/burner/sessions 带机器 hostname/nickname"

# ── 3. account_label 查不到 active session → 400 BURNER_SESSION_NOT_FOUND ──
C=$(curl -s -o /tmp/mbr-404.json -w '%{http_code}' -X POST "${H_TENANT[@]}" -H "Content-Type: application/json" \
  -d '{"keywords":["装修"],"account_label":"mbr-burner-not-exist"}' "$API_BASE/api/acquisition/collect/start")
[ "$C" = "400" ] && jq -e '.error.code=="BURNER_SESSION_NOT_FOUND"' /tmp/mbr-404.json >/dev/null \
  || fail "account_label 未绑定应 400 BURNER_SESSION_NOT_FOUND，实得 http=$C — $(cat /tmp/mbr-404.json)" 1
ok "account_label 未绑定 session → 400 BURNER_SESSION_NOT_FOUND"

# ── 4. account_label 命中 → 派单落库 agent_id = 绑定的在线机器 ──
START=$(curl -fsS -X POST "${H_TENANT[@]}" -H "Content-Type: application/json" \
  -d '{"keywords":["装修"],"account_label":"mbr-burner-1"}' "$API_BASE/api/acquisition/collect/start")
TASK_ID=$(echo "$START" | jq -r '.data.task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || fail "collect/start 未返 task_id — $START" 1

DB_AGENT_ID=$(psql "$DB" -At -c "SELECT agent_id FROM zenithjoy.acquisition_collect_tasks WHERE id = '$TASK_ID'")
[ "$DB_AGENT_ID" = "mbr-agent-online-$$" ] \
  || fail "任务未路由到 burner session 绑定的机器（期望 mbr-agent-online-$$，实得 $DB_AGENT_ID）" 1
ok "account_label 命中 → 任务自动路由到绑定机器（agent_id 落库正确）"

echo "✅ line02-machine-burner-routing smoke PASS"
