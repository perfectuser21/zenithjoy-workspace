#!/usr/bin/env bash
# 「我的作品」API smoke：真 API + 真 DB 走一遍
# 传素材建作品 → 列表能看到（封面+回执聚合）→ 改标题/文案 → 改非法平台拒绝
# → 一键发布 → 排队中锁编辑（EDIT_LOCKED）→ 列表回执出现 douyin/queued。
#
# 这是「我的作品」页（MyWorksPage）的地基；单测 mock 了 pg，
# 只有真链路能证明 列表聚合/编辑锁/发布派发 在 express+pg 串起来后仍成立。
#
# 用法：API_BASE=http://localhost:5200 bash my-works-api-smoke.sh
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
  "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('mw-smoke-${RANDOM}', 'mw-key-${RANDOM}', 'free') RETURNING id" \
  | grep -oE "$UUID_RE" | head -1)
[ -n "$TENANT_ID" ] || fail "种 tenant 失败"
LICENSE_KEY="ZJ-F-MW${RANDOM}"
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
   VALUES ('${LICENSE_KEY}','free',5,'active','${TENANT_ID}', now()+interval '1 day')" >/dev/null
# dispatch 要求租户 10 分钟内有活跃 agent
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ('${TENANT_ID}', 'mw-smoke-agent-${RANDOM}', 'smoke-host', 'online', now())" >/dev/null
echo "[seed] tenant=$TENANT_ID license=$LICENSE_KEY"

TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
IMG="$TMPDIR_LOCAL/a.jpg"
printf '\xff\xd8\xff\xe0\x00\x10JFIF-mw-smoke' > "$IMG"

echo "[1] 传素材建作品（标题/文案/单平台）"
R=$(curl -sf -X POST "$API_BASE/api/materials/upload" \
  -H "X-Upload-Token: $LICENSE_KEY" \
  -F "files=@$IMG" \
  -F "title=初稿标题" \
  -F "body=初稿文案" \
  -F "platforms=douyin") || fail "上传失败"
CONTENT_ID=$(echo "$R" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["content_id"])') \
  || fail "上传响应解析失败"
[ -n "$CONTENT_ID" ] || fail "没拿到 content_id"
echo "    content_id=$CONTENT_ID"

echo "[2] GET /api/contents?status=draft → 该作品可见，封面+回执齐"
R=$(curl -sf "$API_BASE/api/contents?status=draft" -H "X-Upload-Token: $LICENSE_KEY") || fail "列表失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
items = [i for i in d["items"] if i["id"] == "'"$CONTENT_ID"'"]
assert len(items) == 1, "草稿列表里没找到该作品"
item = items[0]
assert len(item["materials"]) == 1, "materials 应有 1 条封面，实际 " + str(item["materials"])
assert item["materials"][0]["file_name"] == "a.jpg", "file_name 不符: " + str(item["materials"][0])
assert item["materials"][0]["preview_url"], "preview_url 应非空"
assert item["receipts"] == [], "新建作品 receipts 应为空数组，实际 " + str(item["receipts"])
' || fail "草稿列表内容不符"
echo "    draft 列表：封面/预览/空回执 ✓"

echo "[3] PATCH title/body → 200，再 GET 确认新标题"
R=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API_BASE/api/contents/$CONTENT_ID" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' \
  -d '{"title":"改后标题","body":"改后文案"}')
[ "$R" = "200" ] || fail "PATCH title/body expected 200 got $R"

R=$(curl -sf "$API_BASE/api/contents?status=draft" -H "X-Upload-Token: $LICENSE_KEY") || fail "复查列表失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
items = [i for i in d["items"] if i["id"] == "'"$CONTENT_ID"'"]
assert len(items) == 1, "复查时没找到该作品"
assert items[0]["title"] == "改后标题", "标题未生效: " + str(items[0]["title"])
assert items[0]["body"] == "改后文案", "文案未生效: " + str(items[0]["body"])
' || fail "PATCH 后标题/文案未生效"
echo "    PATCH title/body 生效 ✓"

echo "[4] PATCH platforms 含非法平台 → 400"
C=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API_BASE/api/contents/$CONTENT_ID" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' \
  -d '{"platforms":["douyin","myspace"]}')
[ "$C" = "400" ] || fail "非法平台 expected 400 got $C"
echo "    非法平台 400 ✓"

echo "[5] POST /:id/publish → 200；随即 PATCH → 409 EDIT_LOCKED"
R=$(curl -sf -X POST "$API_BASE/api/contents/$CONTENT_ID/publish" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' -d '{}') || fail "发布失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert len(d["tasks"]) == 1, "应拆 1 条任务，实际 " + str(len(d["tasks"]))
assert d["tasks"][0]["platform"] == "douyin", "平台不符: " + str(d["tasks"][0])
'

R=$(curl -s -w '\n%{http_code}' -X PATCH "$API_BASE/api/contents/$CONTENT_ID" \
  -H "X-Upload-Token: $LICENSE_KEY" -H 'Content-Type: application/json' \
  -d '{"title":"排队中还想改"}')
CODE=$(echo "$R" | tail -1)
BODY=$(echo "$R" | sed '$d')
[ "$CODE" = "409" ] || fail "排队中 PATCH expected 409 got $CODE"
echo "$BODY" | python3 -c '
import sys, json
d = json.load(sys.stdin)
assert d["error"]["code"] == "EDIT_LOCKED", "错误码不符: " + str(d.get("error"))
' || fail "EDIT_LOCKED 响应体不符"
echo "    发布后编辑锁 EDIT_LOCKED ✓"

echo "[6] GET /api/contents → 该作品 receipts 出现 douyin/queued，status=queued"
R=$(curl -sf "$API_BASE/api/contents" -H "X-Upload-Token: $LICENSE_KEY") || fail "最终列表失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
items = [i for i in d["items"] if i["id"] == "'"$CONTENT_ID"'"]
assert len(items) == 1, "最终列表里没找到该作品"
item = items[0]
assert item["status"] == "queued", "作品状态应为 queued，实际 " + str(item["status"])
assert {"platform": "douyin", "status": "queued"} in item["receipts"], \
    "receipts 未见 douyin/queued: " + str(item["receipts"])
' || fail "最终列表 receipts/status 不符"
echo "    receipts=douyin/queued，status=queued ✓"

echo "✅ my-works-api smoke PASS"
