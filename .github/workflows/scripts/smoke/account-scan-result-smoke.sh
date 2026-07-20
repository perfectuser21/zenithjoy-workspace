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

  # 3. 手动触发闭环回归（真机段等价断言，TODO：真机验证手机心跳不再重复扫描同一 publish_tasks 行）
  #    bug: getQueuedTasks() 选 status IN (pending,queued,dispatched)，account-scan-result 若不推进
  #    publish_tasks 终态，同一行会被每 ~30s 心跳无限重复下发 → 手机无限重扫。
  #    这里验证：request_id 对应真实 queued 行时，回传后行被推进为 done，且二次回传幂等短路。
  SEEDED_TASK_ID=$(psql "$DB" -At -c \
    "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
       VALUES ('${SEEDED_AGENT_ID}', 'douyin', 'queued', 'account_scan', '{}'::jsonb, '${SEEDED_TENANT_ID}', NOW(), NOW())
       RETURNING id" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")

  if [ -n "$SEEDED_TASK_ID" ]; then
    TMP3=$(mktemp)
    HTTP=$(curl -s -o "$TMP3" -w "%{http_code}" --max-time 15 \
      -X POST "${API_BASE}/api/agent/burner/account-scan-result" \
      -H "Content-Type: application/json" \
      -d "{\"agent_id\":\"${SEEDED_AGENT_ID}\",\"request_id\":\"${SEEDED_TASK_ID}\",\"ok\":true,\"account_ids\":[\"smoke昵称3\"]}")
    [ "$HTTP" = "200" ] || fail "手动触发闭环回传期望 200，得 $HTTP：$(cat "$TMP3")"
    TASK_STATUS=$(psql "$DB" -At -c \
      "SELECT status FROM zenithjoy.publish_tasks WHERE id='${SEEDED_TASK_ID}'" 2>/dev/null || echo "")
    [ "$TASK_STATUS" = "done" ] || fail "期望 publish_tasks 行被推进为 done（防无限重复派发），得 $TASK_STATUS"
    ok "手动触发闭环：request_id 命中真实 queued 行 → 推进为 done（不再被心跳重复下发）"

    # 二次回传（模拟重复心跳上报）→ 幂等短路，不重复写
    TMP4=$(mktemp)
    HTTP=$(curl -s -o "$TMP4" -w "%{http_code}" --max-time 15 \
      -X POST "${API_BASE}/api/agent/burner/account-scan-result" \
      -H "Content-Type: application/json" \
      -d "{\"agent_id\":\"${SEEDED_AGENT_ID}\",\"request_id\":\"${SEEDED_TASK_ID}\",\"ok\":true,\"account_ids\":[\"smoke昵称3\"]}")
    [ "$HTTP" = "200" ] || fail "重复回传期望 200，得 $HTTP：$(cat "$TMP4")"
    IDEMPOTENT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP4','utf8')).data.idempotent === true)")
    [ "$IDEMPOTENT" = "true" ] || fail "期望重复回传幂等短路 idempotent:true，得 $(cat "$TMP4")"
    ok "重复回传（模拟心跳再次上报同一 request_id）→ 幂等短路"
    rm -f "$TMP3" "$TMP4"
  else
    echo "⏭️  publish_tasks seed 失败，跳过闭环回归校验"
  fi

  # 4. 内部定时循环触发场景（request_id 从未入库）→ 不 404，照常写 session（不能破坏既有上报流程）
  TMP5=$(mktemp)
  HTTP=$(curl -s -o "$TMP5" -w "%{http_code}" --max-time 15 \
    -X POST "${API_BASE}/api/agent/burner/account-scan-result" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"${SEEDED_AGENT_ID}\",\"request_id\":\"scan-smokeloop$$\",\"ok\":true,\"account_ids\":[\"smoke昵称4\"]}")
  [ "$HTTP" = "200" ] || fail "内部循环 requestId 查无行期望 200（不 404），得 $HTTP：$(cat "$TMP5")"
  ok "内部定时循环 requestId 查无 publish_tasks 行 → 不 404，照常写 session（向后兼容）"
  rm -f "$TMP5"
else
  echo "⏭️  未提供 DB 或 seed 失败，跳过真库落地校验（仅验证 400 分支）"
fi

rm -f "$TMP"
echo "✅ account-scan-result smoke PASS"
