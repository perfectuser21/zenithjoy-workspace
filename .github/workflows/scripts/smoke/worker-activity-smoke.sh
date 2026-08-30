#!/usr/bin/env bash
# worker 活动协议 smoke（决策 e14297d4）：开始任务→上报 2 步→failed 缺三件套 400→推 2 帧→live 出帧→activity 校验→complete。
# 用法：API_BASE=http://localhost:5200 AGENT_ID=<zenithjoy.agents.id> FEISHU_USER_ID=<tenant_members.feishu_user_id> [ZENITHJOY_INTERNAL_TOKEN=...] bash worker-activity-smoke.sh
# 读面（live/activity）挂的是严格 tenantContext：只认 better-auth session 或 X-Feishu-User-Id → tenant_members 反查，
# 不认客户端自报的 X-Tenant-Id。调用方须先在 zenithjoy.tenant_members 种一条 (tenant_id, feishu_user_id) 再把该 id 传进来。
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5200}"
AGENT_ID="${AGENT_ID:?need AGENT_ID (zenithjoy.agents.id)}"
FEISHU_USER_ID="${FEISHU_USER_ID:?need FEISHU_USER_ID (zenithjoy.tenant_members.feishu_user_id，该行须属于 AGENT_ID 所在租户)}"
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
echo "[4b] read-side auth: no identity → 401; client-claimed X-Tenant-Id alone → 401"
C=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/workers/$AGENT_ID/activity"); [ "$C" = "401" ] || fail "activity without identity expected 401 got $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Tenant-Id: 00000000-0000-4000-8000-000000000000" "$API_BASE/api/workers/$AGENT_ID/activity"); [ "$C" = "401" ] || fail "activity with only X-Tenant-Id expected 401 got $C"
echo "[5] activity shows current task with 2 done + frame_age_ms"
A=$(curl -sf "${TEN[@]}" "$API_BASE/api/workers/$AGENT_ID/activity") || fail "activity"
echo "$A" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];assert d["current"]["title"]=="smoke 发布";assert sum(1 for s in d["steps"] if s["status"]=="done")==2;assert d["frame_age_ms"] is not None' || fail "activity content"
echo "[6] complete"
curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/complete" -d '{"outcome":"completed","executor_id":"smoke"}' >/dev/null || fail "complete"
echo "✅ worker-activity smoke PASS"
