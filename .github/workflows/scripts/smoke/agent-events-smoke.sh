#!/usr/bin/env bash
# agent-events-smoke.sh
# Line02/Agent 观测端点 smoke：
#   POST /api/agent/events                 agent 上报（x-license-key 鉴权 + tenant 来自 license）
#   GET  /api/agent/machines/:id/events     dashboard 读（tenantContextOptional）
#
# 通过标准：POST 用真 license 头落库返回 id；GET 无认证 → 401（绝不全表/越权）。
# 任一断言失败 → exit 非 0。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 前置：建测试 tenant + license（license_key UNIQUE，加 RANDOM 防重）──
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('evt-smoke-${RANDOM}-$$', 'evt-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
LICENSE_KEY="evt-lic-${RANDOM}-$$"
LICENSE_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.licenses (license_key, tenant_id, status, expires_at) VALUES ('$LICENSE_KEY', '$TENANT_ID', 'active', NOW() + interval '1 year') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$LICENSE_ID" ] || fail "前置：建 license 失败" 99
echo "    [TENANT_ID=$TENANT_ID LICENSE_KEY=$LICENSE_KEY]"

# ── 1. POST /api/agent/events（带 license 头，上报 1 条 upgrade 进度）──
POST_RESP=$(curl -fsS -X POST "$API_BASE/api/agent/events" \
  -H "Content-Type: application/json" -H "x-license-key: $LICENSE_KEY" \
  -d '{"agent_id":"smoke-agent-1","kind":"upgrade","module":"line04","phase":"download","percent":42,"message":"下载中"}')
echo "$POST_RESP" | jq -er '.success == true and (.data.id | type == "string")' >/dev/null \
  || fail "POST events 结构错（应 success=true + data.id 字符串）— $POST_RESP" 1
EVENT_ID=$(echo "$POST_RESP" | jq -r '.data.id')
ok "POST /api/agent/events 上报成功 id=$EVENT_ID"

# 落库校验：tenant_id 来自 license，不信客户端
DB_TENANT=$(psql "$DB" -At -c "SELECT tenant_id FROM zenithjoy.agent_events WHERE id='$EVENT_ID'")
[ "$DB_TENANT" = "$TENANT_ID" ] || fail "落库 tenant_id 应来自 license（want=$TENANT_ID got=$DB_TENANT）" 1
ok "agent_events.tenant_id 来自 license 校验通过"

# ── 2. POST 批量 {events:[...]} ──
BATCH_RESP=$(curl -fsS -X POST "$API_BASE/api/agent/events" \
  -H "Content-Type: application/json" -H "x-license-key: $LICENSE_KEY" \
  -d '{"events":[{"agent_id":"smoke-agent-1","kind":"log","level":"error","message":"崩了"},{"agent_id":"smoke-agent-1","kind":"upgrade","phase":"done","percent":100}]}')
echo "$BATCH_RESP" | jq -er '.success == true and .data.count == 2' >/dev/null \
  || fail "POST 批量 events 应 count=2 — $BATCH_RESP" 1
ok "POST /api/agent/events 批量上报 count=2"

# ── 3. license 无效 → 401 ──
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/agent/events" \
  -H "Content-Type: application/json" -H "x-license-key: BAD-KEY-NOPE" \
  -d '{"agent_id":"x","kind":"log","message":"x"}')
[ "$CODE" = "401" ] || fail "license 无效应 401，实得 $CODE" 1
ok "license 无效 → 401"

# ── 4. GET /api/agent/machines/:id/events 无认证 → 401（不越权）──
SOME_UUID="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
GET_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/agent/machines/$SOME_UUID/events")
[ "$GET_CODE" = "401" ] || fail "GET events 无认证应 401，实得 $GET_CODE" 1
ok "GET /api/agent/machines/:id/events 无认证 → 401"

# ── 清理 ──
psql "$DB" -c "DELETE FROM zenithjoy.agent_events WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.licenses WHERE id='$LICENSE_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null 2>&1 || true

echo "✅ agent-events smoke ALL PASS"
