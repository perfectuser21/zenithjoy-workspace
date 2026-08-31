#!/usr/bin/env bash
# worker 活动协议 smoke（决策 e14297d4）：开始任务→上报 2 步→failed 缺三件套 400→推 2 帧→live 出帧→activity 校验→complete。
# 用法：API_BASE=http://localhost:5200 AGENT_ID=<zenithjoy.agents.id> FEISHU_USER_ID=<tenant_members.feishu_user_id> [ZENITHJOY_INTERNAL_TOKEN=...] bash worker-activity-smoke.sh
# 读面（live/activity）挂的是严格 tenantContext：只认 better-auth session 或 X-Feishu-User-Id → tenant_members 反查，
# 不认客户端自报的 X-Tenant-Id。调用方须先在 zenithjoy.tenant_members 种一条 (tenant_id, feishu_user_id) 再把该 id 传进来。
#
# 自适应种子（进 smoke-baseline.txt 后被 ci-smoke-glob-runner.yml 的 glob runner 裸跑，
# 不像 ci-l4-e2e-smoke.yml 那样有专属 step 先手动种 tenant/agent/tenant_members）：
#   - 若调用方已传 AGENT_ID/FEISHU_USER_ID → 直接用（ci-l4-e2e-smoke.yml 现状不变）。
#   - 若未传但 DATABASE_URL 或 PG* 可用（glob runner 有真 Postgres）→ 自己种一条
#     tenant + agent + tenant_members，种子逻辑照抄 ci-l4-e2e-smoke.yml 里那段。
#   - 若连 DB 都摸不到 → 明确打印 SKIP 并 exit 0（不假绿：这不是"通过"，是"没法跑"）。
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5200}"

if [ -z "${AGENT_ID:-}" ] || [ -z "${FEISHU_USER_ID:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
    echo "SKIP: 未传 AGENT_ID/FEISHU_USER_ID，且找不到 DATABASE_URL/PGHOST 可自种子——本环境没有可用 DB，跳过"
    exit 0
  fi
  echo "[seed] 未传 AGENT_ID/FEISHU_USER_ID，用本机可用的 Postgres 自种一条 tenant+agent+tenant_members"
  PSQL=(psql -tA -v ON_ERROR_STOP=1)
  [ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL")
  TENANT_ID=$("${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('worker-activity-smoke-${RANDOM}', 'wa-smoke-key-${RANDOM}', 'free') RETURNING id" \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  AGENT_ID=$("${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, os_type, status) VALUES ('${TENANT_ID}', 'smoke-worker-${RANDOM}', 'SMOKE-ANDROID', 'android', 'online') RETURNING id" \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  FEISHU_USER_ID="ou_worker_activity_smoke_${RANDOM}"
  "${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('${TENANT_ID}', '${FEISHU_USER_ID}', 'owner')" >/dev/null
  echo "[seed] tenant=$TENANT_ID agent=$AGENT_ID member=$FEISHU_USER_ID"
  export AGENT_ID FEISHU_USER_ID
fi

AUTH=(); [ -n "${ZENITHJOY_INTERNAL_TOKEN:-}" ] && AUTH=(-H "X-Internal-Token: $ZENITHJOY_INTERNAL_TOKEN")
TEN=(-H "X-Feishu-User-Id: $FEISHU_USER_ID")
J='Content-Type: application/json'
fail(){ echo "❌ $*"; exit 1; }
echo "[1] start task"
R=$(curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/$AGENT_ID/tasks" -d '{"title":"smoke 发布","steps":["打开","选视频","发布"],"executor_id":"smoke"}') || fail "start task"
TID=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["task_id"])'); echo "    task=$TID"
echo "[2] second start on same worker → 409"
C=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/$AGENT_ID/tasks" -d '{"title":"x","steps":["a"],"executor_id":"smoke2"}'); [ "$C" = "409" ] || fail "expected 409 got $C"
echo "[3] report steps + failed without scene → 400"
for i in 0 1; do curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/steps" -d "{\"step_index\":$i,\"status\":\"done\",\"executor_id\":\"smoke\"}" >/dev/null || fail "step $i"; done
C=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/steps" -d '{"step_index":2,"status":"failed","executor_id":"smoke"}'); [ "$C" = "400" ] || fail "failed without scene expected 400 got $C"
echo "[4] push 2 frames + live has ≥1 frame"
TMP=$(mktemp)
# base64 -d 在 macOS 是 base64 -D/--decode，跨平台改走 python3 解码，避免 CI(Linux) 与本机(macOS) 行为不一致
python3 -c "import base64,sys;sys.stdout.buffer.write(base64.b64decode(sys.argv[1]))" \
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=' > "$TMP"
for i in 1 2; do curl -sf "${AUTH[@]}" -H 'Content-Type: image/jpeg' --data-binary "@$TMP" "$API_BASE/api/workers/$AGENT_ID/frame" >/dev/null || fail "frame $i"; done
( curl -s -m 4 "${TEN[@]}" "$API_BASE/api/workers/$AGENT_ID/live" > "$TMP.live" ) || true
N=$(grep -a -c -- '--frame' "$TMP.live" || true); [ "$N" -ge 1 ] || fail "live frames=$N"
echo "[4c] POST 鉴权二选一：agent 自带 license 放行 / 跨租户 403 / 不认识的 license 401 / 无凭据 401"
# 客户机 agent 只有装机 license_key，拿不到内部编排 token，但要能推自己的屏幕帧。
# 两个前提缺一则本段断言不成立 —— 明确 SKIP 不假绿：
#   ① 服务端未设 ZENITHJOY_INTERNAL_TOKEN 时 POST 面整体 dev 放行，任何请求都 202，测不出鉴权；
#   ② 没有 DB 就种不出 license 行。
if [ -z "${ZENITHJOY_INTERNAL_TOKEN:-}" ]; then
  echo "    SKIP: 未设 ZENITHJOY_INTERNAL_TOKEN → POST 面处于 dev 放行，鉴权断言无意义"
elif [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "    SKIP: 无 DATABASE_URL/PGHOST，种不出 license 行"
else
  LPSQL=(psql -tA -v ON_ERROR_STOP=1)
  [ -n "${DATABASE_URL:-}" ] && LPSQL=(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL")
  UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  OWN_TENANT=$("${LPSQL[@]}" -c "SELECT tenant_id FROM zenithjoy.agents WHERE id = '${AGENT_ID}'" | grep -oE "$UUID_RE" | head -1)
  [ -n "$OWN_TENANT" ] || fail "查不到 agent ${AGENT_ID} 的 tenant_id"
  OWN_KEY="ZJ-WASMOKE-OWN${RANDOM}"
  OTHER_KEY="ZJ-WASMOKE-OTH${RANDOM}"
  "${LPSQL[@]}" -c "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) VALUES ('${OWN_KEY}','free',5,'active','${OWN_TENANT}', now()+interval '1 day')" >/dev/null
  OTHER_TENANT=$("${LPSQL[@]}" -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('wa-smoke-other-${RANDOM}', 'wa-smoke-other-key-${RANDOM}', 'free') RETURNING id" | grep -oE "$UUID_RE" | head -1)
  "${LPSQL[@]}" -c "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) VALUES ('${OTHER_KEY}','free',5,'active','${OTHER_TENANT}', now()+interval '1 day')" >/dev/null
  push_frame_as(){ curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: image/jpeg' "$@" --data-binary "@$TMP" "$API_BASE/api/workers/$AGENT_ID/frame"; }
  C=$(push_frame_as -H "X-Agent-License: $OWN_KEY");   [ "$C" = "202" ] || fail "同租户 license 推帧 expected 202 got $C"
  C=$(push_frame_as -H "X-Agent-License: $OTHER_KEY"); [ "$C" = "403" ] || fail "跨租户 license expected 403 got $C"
  C=$(push_frame_as -H "X-Agent-License: ZJ-WASMOKE-NOSUCH0000"); [ "$C" = "401" ] || fail "不存在的 license expected 401 got $C"
  C=$(push_frame_as);                                  [ "$C" = "401" ] || fail "无任何凭据 expected 401 got $C"
  echo "    own=202 cross-tenant=403 unknown=401 none=401"
fi
echo "[4b] read-side auth: no identity → 401; client-claimed X-Tenant-Id alone → 401"
C=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/workers/$AGENT_ID/activity"); [ "$C" = "401" ] || fail "activity without identity expected 401 got $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Tenant-Id: 00000000-0000-4000-8000-000000000000" "$API_BASE/api/workers/$AGENT_ID/activity"); [ "$C" = "401" ] || fail "activity with only X-Tenant-Id expected 401 got $C"
echo "[5] activity shows current task with 2 done + frame_age_ms"
A=$(curl -sf "${TEN[@]}" "$API_BASE/api/workers/$AGENT_ID/activity") || fail "activity"
echo "$A" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];assert d["current"]["title"]=="smoke 发布";assert sum(1 for s in d["steps"] if s["status"]=="done")==2;assert d["frame_age_ms"] is not None' || fail "activity content"
echo "[6] complete"
curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/complete" -d '{"outcome":"completed","executor_id":"smoke"}' >/dev/null || fail "complete"
echo "✅ worker-activity smoke PASS"
