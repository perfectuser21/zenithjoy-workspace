#!/usr/bin/env bash
# 删素材 smoke：验单测证明不了的三件事。
#
# 单测里存储是内存实现，"删掉了"只是从一个 Map 里 delete 掉一个键——证明不了：
#   1. COS 里的对象**真的没了** —— 删之前签的预览 URL 必须打不开
#   2. 删别人的素材真的是 404 —— 单测的 SQL 是假的，只有真库能证明
#      `WHERE tenant_id = $2` 这个条件真在起作用
#   3. 被非草稿作品用着的素材真的删不掉 —— 需要真的建一条 published 作品
#
# 用法：
#   API_BASE=http://localhost:5200 bash material-delete-smoke.sh
#
# 前置同 material-direct-upload-smoke.sh：服务端要真配 COS，否则回落内存实现，
# 本脚本探测到后明确 SKIP（不是失败，是"这条环境测不出东西"）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }
skip() { echo "SKIP: $*"; exit 0; }

curl -sf -o /dev/null "${API_BASE}/health" || skip "API（${API_BASE}）不可达，跳过"

if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  skip "找不到 DATABASE_URL/PGHOST——本脚本要真库才能验租户隔离和 in-use 拦截"
fi

PSQL=(psql -tA -v ON_ERROR_STOP=1)
[ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "${DATABASE_URL}")
UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

# 种两个租户：一个自己的，一个别人的。租户隔离必须用真的两个租户验，
# 不能只验"删不存在的 id 回 404"——那条同样返回 404，证明不了隔离在起作用。
seed_tenant() {
  local tag="$1"
  local tid
  tid=$("${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('mdel-${tag}-${RANDOM}', 'mdel-key-${tag}-${RANDOM}', 'free') RETURNING id" \
    | grep -oE "${UUID_RE}" | head -1)
  [ -n "${tid}" ] || fail "种 tenant(${tag}) 失败"
  echo "${tid}"
}
seed_license() {
  local tid="$1" key
  key="ZJ-F-DEL${RANDOM}${RANDOM}"
  "${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
     VALUES ('${key}','free',5,'active','${tid}', now()+interval '1 day')" >/dev/null
  echo "${key}"
}

TENANT_A=$(seed_tenant a); KEY_A=$(seed_license "${TENANT_A}")
TENANT_B=$(seed_tenant b); KEY_B=$(seed_license "${TENANT_B}")
echo "[seed] A=${TENANT_A} B=${TENANT_B}"

TMPD=$(mktemp -d); trap 'rm -rf "${TMPD}"' EXIT
IMG="${TMPD}/a.jpg"
printf '\xff\xd8\xff\xe0\x00\x10JFIF-delete-smoke' > "${IMG}"
SIZE_BYTES=$(wc -c < "${IMG}" | tr -d ' ')

# 传一张进 A 的库，走的是真实三步（和 iPhone 快捷指令同一条路）
upload_one() {
  local key="$1" name="$2" r body upload_url storage_key material_id code
  r=$(curl -s -w '\n%{http_code}' -X POST "${API_BASE}/api/materials/upload-urls" \
    -H "X-Upload-Token: ${key}" -H "Content-Type: application/json" \
    -d "{\"files\":[{\"file_name\":\"${name}\",\"mime_type\":\"image/jpeg\",\"size_bytes\":${SIZE_BYTES}}]}")
  code=$(echo "${r}" | tail -1); body=$(echo "${r}" | sed '$d')
  [ "${code}" = "200" ] || fail "换预签名 URL expected 200 got ${code}：${body}"
  upload_url=$(echo "${body}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["files"][0]["upload_url"])')
  storage_key=$(echo "${body}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["files"][0]["storage_key"])')
  material_id=$(echo "${body}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["files"][0]["material_id"])')
  case "${upload_url}" in
    https://*) : ;;
    *) skip "服务端未配置真实 COS（upload_url=${upload_url}），删不掉真对象，本环境验不出真链路" ;;
  esac
  curl -sf -o /dev/null -X PUT --data-binary "@${IMG}" "${upload_url}" || fail "裸 PUT 失败"
  r=$(curl -s -w '\n%{http_code}' -X POST "${API_BASE}/api/materials/complete" \
    -H "X-Upload-Token: ${key}" -H "Content-Type: application/json" \
    -d "{\"files\":[{\"storage_key\":\"${storage_key}\",\"material_id\":\"${material_id}\",\"file_name\":\"${name}\",\"mime_type\":\"image/jpeg\",\"size_bytes\":${SIZE_BYTES}}]}")
  code=$(echo "${r}" | tail -1)
  [ "${code}" = "200" ] || fail "complete expected 200 got ${code}：$(echo "${r}" | sed '$d')"
  echo "${material_id}"
}

MAT_A=$(upload_one "${KEY_A}" "del-me.jpg")
echo "[1] A 的素材已就位 material_id=${MAT_A}"

echo "[2] 【租户隔离】B 拿自己的凭据删 A 的素材 → 必须 404（不能是 403）"
# 403 等于确认「这个 id 存在」，白送一个探测别人素材 id 的接口
C=$(curl -s -o "${TMPD}/r2" -w '%{http_code}' -X DELETE \
  -H "X-Upload-Token: ${KEY_B}" "${API_BASE}/api/materials/${MAT_A}")
[ "${C}" = "404" ] || fail "B 删 A 的素材 expected 404 got ${C}：$(head -c 300 "${TMPD}/r2")"
# 而且必须真没删掉——只看状态码不够，得确认对象和记录都还在
ROWS=$("${PSQL[@]}" -c "SELECT count(*) FROM zenithjoy.materials WHERE id='${MAT_A}'")
[ "${ROWS}" = "1" ] || fail "B 删 A 的素材竟然真删掉了（库里已经没了）——租户隔离被击穿"
echo "    404 且素材原样还在 ✓"

echo "[3] 【in-use 拦截】把这条素材挂进一条 published 作品 → 删必须 409"
CONTENT_ID=$("${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.contents (tenant_id, title, type, status) \
   VALUES ('${TENANT_A}','删不掉的作品','image','published') RETURNING id" \
  | grep -oE "${UUID_RE}" | head -1)
[ -n "${CONTENT_ID}" ] || fail "建 published 作品失败"
"${PSQL[@]}" -c \
  "INSERT INTO zenithjoy.content_materials (content_id, material_id, sort_order) \
   VALUES ('${CONTENT_ID}','${MAT_A}',0) ON CONFLICT DO NOTHING" >/dev/null

C=$(curl -s -o "${TMPD}/r3" -w '%{http_code}' -X DELETE \
  -H "X-Upload-Token: ${KEY_A}" "${API_BASE}/api/materials/${MAT_A}")
[ "${C}" = "409" ] || fail "被已发布作品用着 expected 409 got ${C}：$(head -c 300 "${TMPD}/r3")"
grep -q 'IN_USE' "${TMPD}/r3" || fail "expected error.code=IN_USE，实际：$(head -c 300 "${TMPD}/r3")"
# 只说「删不掉」等于没说，消息里必须带上是哪个作品挡着
grep -q '删不掉的作品' "${TMPD}/r3" || fail "409 消息里没说是哪个作品挡着：$(head -c 300 "${TMPD}/r3")"
echo "    409 IN_USE 且点名了作品 ✓"

echo "[4] 把作品改回草稿 → 现在可以删了（草稿是上传时自动建的，不该拦人）"
"${PSQL[@]}" -c "UPDATE zenithjoy.contents SET status='draft' WHERE id='${CONTENT_ID}'" >/dev/null

# 删之前先拿一个预览 URL——删完要用它证明 COS 里的对象真没了
LIST=$(curl -sS -H "X-Upload-Token: ${KEY_A}" "${API_BASE}/api/materials?limit=100")
PREVIEW_URL=$(echo "${LIST}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for it in d['data']['items']:
    if it['id'] == '${MAT_A}':
        print(it['preview_url'] or '')
        break
")
[ -n "${PREVIEW_URL}" ] || fail "删之前拿不到预览 URL，没法验对象是否真被删"
curl -sf -o /dev/null "${PREVIEW_URL}" || fail "删之前预览 URL 就打不开，后面的断言没有意义"
echo "    删之前预览 URL 能打开 ✓"

C=$(curl -s -o "${TMPD}/r4" -w '%{http_code}' -X DELETE \
  -H "X-Upload-Token: ${KEY_A}" "${API_BASE}/api/materials/${MAT_A}")
[ "${C}" = "200" ] || fail "删自己的素材 expected 200 got ${C}：$(head -c 300 "${TMPD}/r4")"

echo "[5] 【核心】COS 里的对象真的没了 —— 同一个预览 URL 现在必须打不开"
# 只看 DB 行没了不够：对象留在 COS 里就是永远收不回来的孤儿，一直烧存储费
C5=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${PREVIEW_URL}")
[ "${C5}" != "200" ] || fail "DB 行删了但 COS 对象还在（预览 URL 仍返回 200）——留下孤儿文件"
echo "    预览 URL 现在返回 ${C5}，对象已删 ✓"

echo "[6] 库里也干净了：素材行、关联行都没了"
ROWS=$("${PSQL[@]}" -c "SELECT count(*) FROM zenithjoy.materials WHERE id='${MAT_A}'")
[ "${ROWS}" = "0" ] || fail "素材行还在"
ROWS=$("${PSQL[@]}" -c "SELECT count(*) FROM zenithjoy.content_materials WHERE material_id='${MAT_A}'")
[ "${ROWS}" = "0" ] || fail "关联行还在（ON DELETE CASCADE 没生效）"
echo "    素材行和关联行都没了 ✓"

echo "[7] 再删一次同一个 id → 404，不是 500"
C=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
  -H "X-Upload-Token: ${KEY_A}" "${API_BASE}/api/materials/${MAT_A}")
[ "${C}" = "404" ] || fail "重复删 expected 404 got ${C}"
echo "    重复删 404 ✓"

echo "✅ material-delete smoke PASS"
