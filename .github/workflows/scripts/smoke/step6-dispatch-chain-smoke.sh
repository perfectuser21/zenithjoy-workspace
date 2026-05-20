#!/usr/bin/env bash
# step6-dispatch-chain-smoke.sh
# Step 6 dispatch chain standalone CI smoke
# POST /api/works/:id/publish → publish_tasks queued → heartbeat → task-ack → publish_status=success
#
# 独立脚本：不依赖 Steps 1-5，CI 可直接跑（无需 install-pack）。
# golden-path-1-smoke.sh 的 Step 6 提取版，用于 ubuntu CI 快速验证链路。
#
# 退出码：0=全通，6=Step 6 某步失败
#
# 用法：
#   API_BASE=http://localhost:5200 bash step6-dispatch-chain-smoke.sh

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
TEST_PASSWORD="${TEST_PASSWORD:-Smoke!Test2026}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 6; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Step 6 — Dispatch Chain Smoke (CI standalone)"
echo "  API: $API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "▶ Step 6: 中台派任务 + Agent 路由 + dryrun 发布"

# 6.1 注册 + 拿 license_key（独立新用户）
SK_EMAIL="smoke-s6-$(date +%s)@zenithjoy.test"
SIGNUP=$(curl -fsS -c /tmp/sk-step6.cookies -X POST "$API_BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$SK_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"smoke\"}" 2>/dev/null) \
  || fail "Step 6.1 sign-up failed"
ME=$(curl -fsS -b /tmp/sk-step6.cookies "$API_BASE/api/account/me" 2>/dev/null) \
  || fail "Step 6.1 /api/account/me failed"
LICENSE_KEY=$(echo "$ME" | python3 -c "import json,sys;print(json.load(sys.stdin)['license']['license_key'])" 2>/dev/null) \
  || fail "Step 6.1 license_key extract failed"
ok "Step 6.1 注册 + license_key=$LICENSE_KEY ✓"

# 6.2 Agent 心跳 → agent_id
HB=$(curl -fsS -X POST "$API_BASE/api/agent/heartbeat" \
  -H 'content-type: application/json' \
  -H "x-license-key: $LICENSE_KEY" \
  -d "{\"hostname\":\"smoke-step6-ci\",\"version\":\"0.1.0\"}" 2>/dev/null) \
  || fail "Step 6.2 heartbeat failed"
AGENT_ID=$(echo "$HB" | python3 -c "import json,sys;print(json.load(sys.stdin)['agent_id'])" 2>/dev/null) \
  || fail "Step 6.2 agent_id extract failed"
ok "Step 6.2 heartbeat → agent_id=$AGENT_ID ✓"

# 6.3 创建 work
S6_TMP=$(mktemp)
trap 'rm -f "$S6_TMP" /tmp/sk-step6.cookies' EXIT
S6_WORK_HTTP=$(curl -s -o "$S6_TMP" -w "%{http_code}" --max-time 15 \
  -b /tmp/sk-step6.cookies \
  -X POST "$API_BASE/api/works" \
  -H 'content-type: application/json' \
  -d '{"title":"smoke-step6-dispatch","content_type":"video","body":"smoke body"}')
[ "$S6_WORK_HTTP" = "201" ] || { cat "$S6_TMP"; fail "Step 6.3 POST /api/works expected 201, got $S6_WORK_HTTP"; }
WORK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['id'])" "$S6_TMP" 2>/dev/null)
[ -n "$WORK_ID" ] || fail "Step 6.3 no work id in response"
ok "Step 6.3 POST /api/works → work_id=$WORK_ID ✓"

# 6.4 派发 publish 任务
S6_PUBLISH_HTTP=$(curl -s -o "$S6_TMP" -w "%{http_code}" --max-time 15 \
  -b /tmp/sk-step6.cookies \
  -X POST "$API_BASE/api/works/$WORK_ID/publish" \
  -H 'content-type: application/json')
[ "$S6_PUBLISH_HTTP" = "201" ] || { cat "$S6_TMP"; fail "Step 6.4 POST /api/works/:id/publish expected 201, got $S6_PUBLISH_HTTP"; }
TASK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['task_id'])" "$S6_TMP" 2>/dev/null)
S6_QSTATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$S6_TMP" 2>/dev/null)
[ -n "$TASK_ID" ] || fail "Step 6.4 no task_id in publish response"
[ "$S6_QSTATUS" = "queued" ] || fail "Step 6.4 status='$S6_QSTATUS' expected 'queued'"
ok "Step 6.4 POST /api/works/:id/publish → task_id=$TASK_ID status=queued ✓"

# 6.5 验证 works.publish_status = queued
S6_GET_HTTP=$(curl -s -o "$S6_TMP" -w "%{http_code}" --max-time 15 \
  -b /tmp/sk-step6.cookies \
  "$API_BASE/api/works/$WORK_ID")
[ "$S6_GET_HTTP" = "200" ] || fail "Step 6.5 GET /api/works/:id expected 200, got $S6_GET_HTTP"
PUBLISH_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['publish_status'])" "$S6_TMP" 2>/dev/null)
[ "$PUBLISH_STATUS" = "queued" ] || fail "Step 6.5 publish_status='$PUBLISH_STATUS' expected 'queued'"
ok "Step 6.5 GET /api/works/:id → publish_status=queued ✓"

# 6.6 心跳拉取 queued_tasks
HB2=$(curl -fsS -X POST "$API_BASE/api/agent/heartbeat" \
  -H 'content-type: application/json' \
  -H "x-license-key: $LICENSE_KEY" \
  -d "{\"hostname\":\"smoke-step6-ci\"}" 2>/dev/null) \
  || fail "Step 6.6 heartbeat 2 failed"
QUEUED_IDS=$(echo "$HB2" | python3 -c "import json,sys;d=json.load(sys.stdin);print(' '.join(t['task_id'] for t in d.get('queued_tasks',[])))" 2>/dev/null)
echo "$QUEUED_IDS" | grep -qF "$TASK_ID" || fail "Step 6.6 heartbeat queued_tasks 未含 task_id=$TASK_ID (got: $QUEUED_IDS)"
ok "Step 6.6 heartbeat queued_tasks 含 task_id=$TASK_ID ✓"

# 6.7 task-ack 确认执行（dryrun）
S6_ACK_HTTP=$(curl -s -o "$S6_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/task-ack" \
  -H 'content-type: application/json' \
  -H "x-license-key: $LICENSE_KEY" \
  -d "{\"task_id\":\"$TASK_ID\",\"result\":\"dryrun ok\"}")
[ "$S6_ACK_HTTP" = "200" ] || { cat "$S6_TMP"; fail "Step 6.7 POST /api/agent/task-ack expected 200, got $S6_ACK_HTTP"; }
S6_ACK_OK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['ok'])" "$S6_TMP" 2>/dev/null)
[ "$S6_ACK_OK" = "True" ] || fail "Step 6.7 task-ack ok='$S6_ACK_OK' expected True"
ok "Step 6.7 POST /api/agent/task-ack → ok=true ✓"

# 6.8 验证 works.publish_status = success
S6_FINAL_HTTP=$(curl -s -o "$S6_TMP" -w "%{http_code}" --max-time 15 \
  -b /tmp/sk-step6.cookies \
  "$API_BASE/api/works/$WORK_ID")
[ "$S6_FINAL_HTTP" = "200" ] || fail "Step 6.8 GET /api/works/:id expected 200, got $S6_FINAL_HTTP"
PUBLISH_FINAL=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['publish_status'])" "$S6_TMP" 2>/dev/null)
[ "$PUBLISH_FINAL" = "success" ] || fail "Step 6.8 publish_status='$PUBLISH_FINAL' expected 'success'"
ok "Step 6.8 GET /api/works/:id → publish_status=success ✓"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Step 6 Dispatch Chain 全链路验证通过"
echo "   POST /publish → queued → heartbeat → task-ack → success"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
