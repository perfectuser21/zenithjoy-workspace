#!/usr/bin/env bash
# 作品→发布任务派发接缝 smoke：真 API + 真 DB 走一遍
# 上传素材 → 一键派发 → 列表可见 → 领发布包（标题/文案/签名URL）。
#
# 这是「标题文案写一次→执行器替你发」闭环的地基；单测 mock 了 pg 和事务，
# 只有真链路能证明 拆任务/置状态/领单现签 在 express+pg 串起来后仍成立。
#
# 用法：API_BASE=http://localhost:5200 bash content-publish-dispatch-smoke.sh
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }

if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "SKIP: 找不到 DATABASE_URL/PGHOST——本环境没有可用 DB，跳过"
  exit 0
fi
PSQL=(psql -tA -v ON_ERROR_STOP=1)
[ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL")
UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

echo "[seed] tenant + license + 活跃 agent"
TENANT_ID=$("${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cpd-smoke-${RANDOM}', 'cpd-key-${RANDOM}', 'free') RETURNING id" \
  | grep -oE "$UUID_RE" | head -1)
[ -n "$TENANT_ID" ] || fail "种 tenant 失败"
LICENSE_KEY="ZJ-F-CPD${RANDOM}"
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
   VALUES ('${LICENSE_KEY}','free',5,'active','${TENANT_ID}', now()+interval '1 day')" >/dev/null
# dispatch 要求租户 10 分钟内有活跃 agent
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ('${TENANT_ID}', 'cpd-smoke-agent-${RANDOM}', 'smoke-host', 'online', now())" >/dev/null
echo "[seed] tenant=$TENANT_ID license=$LICENSE_KEY"

TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
IMG="$TMPDIR_LOCAL/a.jpg"
printf '\xff\xd8\xff\xe0\x00\x10JFIF-cpd-smoke' > "$IMG"

echo "[1] 传素材建作品（带标题/文案/平台）"
R=$(curl -sf -X POST "$API_BASE/api/materials/upload" \
  -H "X-Upload-Token: $LICENSE_KEY" \
  -F "files=@$IMG" \
  -F "title=今日份的治愈色" \
  -F "body=生活需要一点渐变" \
  -F "platforms=douyin,weibo") || fail "上传失败"
CONTENT_ID=$(echo "$R" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["content_id"])') \
  || fail "上传响应解析失败"
[ -n "$CONTENT_ID" ] || fail "没拿到 content_id"

echo "[2] 无凭据派发 → 401"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/contents/$CONTENT_ID/publish")
[ "$C" = "401" ] || fail "无凭据 expected 401 got $C"

echo "[3] 一键派发 → 2 平台 2 条任务"
R=$(curl -sf -X POST "$API_BASE/api/contents/$CONTENT_ID/publish" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}') || fail "派发失败"
TASK_ID=$(echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert len(d["tasks"]) == 2, "应拆 2 条任务，实际 " + str(len(d["tasks"]))
plats = sorted(t["platform"] for t in d["tasks"])
assert plats == ["douyin", "weibo"], "平台不符: " + str(plats)
print(d["tasks"][0]["id"])
') || fail "派发响应不符"

echo "[4] 重复派发 → 409 ALREADY_QUEUED"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/contents/$CONTENT_ID/publish" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}')
[ "$C" = "409" ] || fail "重复派发 expected 409 got $C"

echo "[5] 作业单列表可见"
R=$(curl -sf "$API_BASE/api/publish-tasks?status=queued" -H "X-Upload-Token: $LICENSE_KEY") || fail "列表失败"
echo "$R" | python3 -c '
import sys, json
items = json.load(sys.stdin)["data"]["items"]
assert len(items) == 2, "列表应有 2 条，实际 " + str(len(items))
' || fail "列表内容不符"

echo "[6] 领发布包：标题/文案/签名 URL 齐"
R=$(curl -sf "$API_BASE/api/publish-tasks/$TASK_ID/package" -H "X-Upload-Token: $LICENSE_KEY") || fail "领单失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["title"] == "今日份的治愈色", "标题不符: " + str(d["title"])
assert d["body"] == "生活需要一点渐变", "文案不符: " + str(d["body"])
assert d["content_type"] == "image"
assert len(d["media"]) == 1 and d["media"][0]["url"], "media 签名 URL 缺失"
print("    package: title/body/media ✓")
' || fail "发布包内容不符"

echo "[6b] agent 认领（刀A）：POST claim CAS queued→dispatched，抢到 claimed=true"
R=$(curl -sf -X POST "$API_BASE/api/publish-tasks/$TASK_ID/claim" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}') || fail "claim 失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["claimed"] is True, "首次 claim 应抢到 claimed=true，实际 " + str(d)
' || fail "claim 响应不符"
DB_STATUS=$("${PSQL[@]}" -c "SELECT status FROM zenithjoy.publish_tasks WHERE id = '${TASK_ID}'")
[ "$DB_STATUS" = "dispatched" ] || fail "DB 断言失败：claim 后 status expected dispatched got $DB_STATUS"
echo "    claim: claimed=true，DB status=dispatched ✓"

echo "[6c] 重复 claim → claimed=false + 当前 status（正常竞争语义，200 不是 409）"
R=$(curl -sf -X POST "$API_BASE/api/publish-tasks/$TASK_ID/claim" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}') || fail "重复 claim 请求失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["claimed"] is False, "重复 claim 应 claimed=false，实际 " + str(d)
assert d["status"] == "dispatched", "重复 claim 应带当前 status=dispatched，实际 " + str(d)
' || fail "重复 claim 响应不符"
DB_STATUS=$("${PSQL[@]}" -c "SELECT status FROM zenithjoy.publish_tasks WHERE id = '${TASK_ID}'")
[ "$DB_STATUS" = "dispatched" ] || fail "DB 断言失败：重复 claim 后 status 应仍是 dispatched，实际 $DB_STATUS"
echo "    重复 claim 不改状态 ✓"

echo "[7] 真调旧 agent 心跳通道 → 确认 getQueuedTasks 排除 content_publish 生效"
# 种子 agent 用 hostname='smoke-host'、未带 machine_id 注册；心跳走同一 hostname、
# 同 license（=同租户）且不带 machine_id/agent_uuid，会命中 resolveAgentIdentityKey
# 的 hostname 兜底路径，精确落回这台种子 agent（walking-skeleton.service.ts
# upsertAgentByHeartbeat 的「原有路径：按 (tenant_id, hostname) 去重」分支），
# 而不是新建一台幽灵 agent——这样 queued_tasks 才是这台 agent 真实能拉到的任务。
R=$(curl -sf -X POST "$API_BASE/api/agent/heartbeat" \
  -H "X-License-Key: $LICENSE_KEY" -H 'Content-Type: application/json' \
  -d '{"hostname":"smoke-host"}') || fail "旧 agent 心跳失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)
assert d.get("ok") is True, "心跳未成功: " + str(d)
ids = [t.get("task_id") for t in d.get("queued_tasks", [])]
assert "'"$TASK_ID"'" not in ids, \
    "旧 agent 心跳看到了 content_publish 任务（排除逻辑失效）: " + str(ids)
' || fail "心跳响应不符——旧 agent 通道能看见 content_publish 任务"
echo "    heartbeat queued_tasks 不含 content_publish 任务 ✓"

echo "[7b] 回执：PATCH receipt result=success → 该任务 status=done"
R=$(curl -sf -X PATCH "$API_BASE/api/publish-tasks/$TASK_ID/receipt" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' \
  -d '{"result":"success","detail":"smoke 真机模拟发布成功"}') || fail "回执失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["status"] == "done", "回执后 status 应为 done，实际 " + str(d["status"])
'
DB_STATUS=$("${PSQL[@]}" -c "SELECT status FROM zenithjoy.publish_tasks WHERE id = '${TASK_ID}'")
[ "$DB_STATUS" = "done" ] || fail "DB 断言失败：publish_tasks.status expected done got $DB_STATUS"
echo "    receipt: status=done（API+DB 均已确认）✓"

echo "[7c] 重复回执 → 200 且 status 仍 done（幂等，不再改写）"
R=$(curl -sf -X PATCH "$API_BASE/api/publish-tasks/$TASK_ID/receipt" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' \
  -d '{"result":"failed","detail":"重复回执不应生效"}') || fail "重复回执失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["status"] == "done", "重复回执应幂等返回 done，实际 " + str(d["status"])
'
DB_STATUS=$("${PSQL[@]}" -c "SELECT status FROM zenithjoy.publish_tasks WHERE id = '${TASK_ID}'")
[ "$DB_STATUS" = "done" ] || fail "DB 断言失败：重复回执后 status 应仍是 done，实际 $DB_STATUS"
echo "    重复回执幂等 ✓"

echo "[8] 跨租户领单 → 404"
TENANT_B=$("${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cpd-smoke-b-${RANDOM}', 'cpd-keyb-${RANDOM}', 'free') RETURNING id" \
  | grep -oE "$UUID_RE" | head -1)
LICENSE_B="ZJ-F-CPB${RANDOM}"
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
   VALUES ('${LICENSE_B}','free',5,'active','${TENANT_B}', now()+interval '1 day')" >/dev/null
C=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/publish-tasks/$TASK_ID/package" -H "X-Upload-Token: $LICENSE_B")
[ "$C" = "404" ] || fail "跨租户 expected 404 got $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/publish-tasks/$TASK_ID/claim" \
  -H "X-Upload-Token: $LICENSE_B" -H 'Content-Type: application/json' -d '{}')
[ "$C" = "404" ] || fail "跨租户 claim expected 404 got $C"

echo "✅ content-publish-dispatch smoke PASS"
