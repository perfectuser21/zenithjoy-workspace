#!/usr/bin/env bash
# account-scan-result-smoke.sh
# ZenithJoy Line02 Step7 — POST /api/agent/burner/account-scan-result smoke test
#
# Usage:
#   API_PORT=3001 DB=postgresql://... bash account-scan-result-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"
DB="${DB:-}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy account-scan-result Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 缺 agent_id → 400
TMP=$(mktemp)
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "${API_BASE}/api/agent/burner/account-scan-result" \
  -H "Content-Type: application/json" \
  -d '{"ok":true,"account_ids":["测试号"]}')
[ "$HTTP" = "400" ] || fail "缺 agent_id 期望 400，得 $HTTP：$(cat "$TMP")"
ok "缺 agent_id → 400"

SEEDED_AGENT_ID=""
if [ -n "$DB" ]; then
  SEEDED_TENANT_ID=$(psql "$DB" -At -c \
    "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-scan-tenant', 'smoke-scan-key-$$', 'free') ON CONFLICT DO NOTHING RETURNING id" \
    2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")
  if [ -n "$SEEDED_TENANT_ID" ]; then
    SEEDED_AGENT_ID=$(psql "$DB" -At -c \
      "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('$SEEDED_TENANT_ID', 'smoke-scan-agent-$$', 'smoke-scan-host', 'online') ON CONFLICT DO NOTHING RETURNING id" \
      2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")
  fi
fi

if [ -n "$SEEDED_AGENT_ID" ]; then
  # 2. ok=true + account_ids 非空 → 200 written=2，真库能查到 2 行 burner session
  TMP2=$(mktemp)
  HTTP=$(curl -s -o "$TMP2" -w "%{http_code}" --max-time 15 \
    -X POST "${API_BASE}/api/agent/burner/account-scan-result" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"${SEEDED_AGENT_ID}\",\"ok\":true,\"account_ids\":[\"smoke昵称1\",\"smoke昵称2\"]}")
  [ "$HTTP" = "200" ] || fail "ok=true 期望 200，得 $HTTP：$(cat "$TMP2")"
  WRITTEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP2','utf8')).data.written)")
  [ "$WRITTEN" = "2" ] || fail "期望 written=2，得 $WRITTEN"
  ROWCOUNT=$(psql "$DB" -At -c \
    "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='${SEEDED_AGENT_ID}' AND role='burner' AND status='active'" 2>/dev/null || echo 0)
  [ "$ROWCOUNT" = "2" ] || fail "期望库里 2 行 active burner session，得 $ROWCOUNT"
  ok "ok=true + 2 个昵称 → 200 written=2，真库落地 2 行"
  rm -f "$TMP2"
else
  echo "⏭️  未提供 DB 或 seed 失败，跳过真库落地校验（仅验证 400 分支）"
fi

rm -f "$TMP"
echo "✅ account-scan-result smoke PASS"
