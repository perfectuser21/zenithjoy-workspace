#!/usr/bin/env bash
# 素材直传 smoke：验单测证明不了的三件事。
#
# 1. 服务端签出来的 URL，COS 真的认 —— 单测里的内存实现返回 memory://put/...
#    假串，证明不了真 COS 接受。
# 2. 一个零签名能力的客户端真能传上去 —— iOS 快捷指令没有算 HMAC 签名的动作，
#    如果 COS 要求额外的头或签名，方案就废了。
# 3. 篡改签名会被拒 —— 而且是被 COS 拒，不是被我们的代码拒。
#
# 用法：
#   API_BASE=http://localhost:5200 bash material-direct-upload-smoke.sh
#
# 前置：服务端必须真配置了 COS（COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/
# COS_REGION），否则会回落到内存实现——presignPut 签出的是 memory://put/...
# 假串，PUT 上去测不出真东西，本脚本探测到后明确 SKIP（不是失败，是"这条
# 环境测不出东西"）。CI 的 PR job 还没接 COS 生产凭据，走的就是这条路径。
#
# 自适应种子：同 material-upload-smoke.sh 的约定——未传 LICENSE_KEY 时，
# 若 DATABASE_URL/PG* 可用就自己种一条 tenant + license；连 DB 都摸不到就
# 明确打印 SKIP 并 exit 0（不假绿：这不是"通过"，是"没法跑"）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }
skip() { echo "SKIP: $*"; exit 0; }

# ── API 可达性 ────────────────────────────────────────────────────────
curl -sf -o /dev/null "${API_BASE}/health" || skip "API（${API_BASE}）不可达，跳过"

# ── 种子 ──────────────────────────────────────────────────────────────
if [ -z "${LICENSE_KEY:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
    skip "未传 LICENSE_KEY，且找不到 DATABASE_URL/PGHOST 可自种子——本环境没有可用 DB"
  fi
  echo "[seed] 未传 LICENSE_KEY，自种一条 tenant + license"
  PSQL=(psql -tA -v ON_ERROR_STOP=1)
  [ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "${DATABASE_URL}")
  UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  TENANT_ID=$("${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('material-direct-smoke-${RANDOM}', 'mds-key-${RANDOM}', 'free') RETURNING id" \
    | grep -oE "${UUID_RE}" | head -1)
  [ -n "${TENANT_ID}" ] || fail "种 tenant 失败"
  LICENSE_KEY="ZJ-F-SMK${RANDOM}"
  "${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
     VALUES ('${LICENSE_KEY}','free',5,'active','${TENANT_ID}', now()+interval '1 day')" >/dev/null
  echo "[seed] tenant=${TENANT_ID} license=${LICENSE_KEY}"
fi

TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "${TMPDIR_LOCAL}"' EXIT
IMG="${TMPDIR_LOCAL}/a.jpg"
# 最小合法 JPEG 头 + 一点内容，够端点识别类型
printf '\xff\xd8\xff\xe0\x00\x10JFIF-direct-upload-smoke' > "${IMG}"
SIZE_BYTES=$(wc -c < "${IMG}" | tr -d ' ')

UPLOAD_URLS_EP="${API_BASE}/api/materials/upload-urls"
COMPLETE_EP="${API_BASE}/api/materials/complete"

echo "[1] 换预签名 URL"
R1=$(curl -s -w '\n%{http_code}' -X POST "${UPLOAD_URLS_EP}" \
  -H "X-Upload-Token: ${LICENSE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"files\":[{\"file_name\":\"a.jpg\",\"mime_type\":\"image/jpeg\",\"size_bytes\":${SIZE_BYTES}}]}")
C1=$(echo "${R1}" | tail -1)
BODY1=$(echo "${R1}" | sed '$d')
[ "${C1}" = "200" ] || fail "换预签名 URL expected 200 got ${C1}：${BODY1}"

UPLOAD_URL=$(echo "${BODY1}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["files"][0]["upload_url"])') \
  || fail "响应里没有 upload_url：${BODY1}"
STORAGE_KEY=$(echo "${BODY1}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["files"][0]["storage_key"])') \
  || fail "响应里没有 storage_key：${BODY1}"
MATERIAL_ID=$(echo "${BODY1}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["files"][0]["material_id"])') \
  || fail "响应里没有 material_id：${BODY1}"
echo "    storage_key=${STORAGE_KEY} material_id=${MATERIAL_ID}"

# 服务端没配真 COS 时会回落到内存实现（memory://put/...），后面几步 PUT/HEAD
# 全测不出真东西——明确 SKIP，不要在假地址上硬闯出假结论。
case "${UPLOAD_URL}" in
  https://*) : ;;
  *) skip "服务端未配置真实 COS（upload_url=${UPLOAD_URL}），回落到内存实现，本环境验不出真链路" ;;
esac

echo "[2] 【核心】零签名客户端裸 PUT —— 模拟 iOS 快捷指令：不带任何鉴权头"
PUT2_BODY="${TMPDIR_LOCAL}/put2.body"
C2=$(curl -s -o "${PUT2_BODY}" -w '%{http_code}' -X PUT --data-binary "@${IMG}" "${UPLOAD_URL}")
[ "${C2}" = "200" ] || fail "裸 PUT expected 200 got ${C2}（零签名客户端传不上去，方案不成立）：$(head -c 300 "${PUT2_BODY}" 2>/dev/null)"
echo "    裸 PUT 200 ✓"

echo "[3] 篡改签名必须被 COS 拒"
TAMPERED_URL="${UPLOAD_URL}tampered"
PUT3_BODY="${TMPDIR_LOCAL}/put3.body"
C3=$(curl -s -o "${PUT3_BODY}" -X PUT --data-binary "@${IMG}" -w '%{http_code}' "${TAMPERED_URL}")
[ "${C3}" = "403" ] || fail "篡改签名 expected 403 got ${C3}：$(head -c 300 "${PUT3_BODY}" 2>/dev/null)"
echo "    篡改签名 403 ✓"

echo "[4] complete 落库"
R4=$(curl -s -w '\n%{http_code}' -X POST "${COMPLETE_EP}" \
  -H "X-Upload-Token: ${LICENSE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"files\":[{\"storage_key\":\"${STORAGE_KEY}\",\"material_id\":\"${MATERIAL_ID}\",\"file_name\":\"a.jpg\",\"mime_type\":\"image/jpeg\",\"size_bytes\":${SIZE_BYTES}}]}")
C4=$(echo "${R4}" | tail -1)
BODY4=$(echo "${R4}" | sed '$d')
[ "${C4}" = "200" ] || fail "complete expected 200 got ${C4}：${BODY4}"
CONTENT_ID=$(echo "${BODY4}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["content_id"])') \
  || fail "响应里没有 content_id：${BODY4}"
echo "    content_id=${CONTENT_ID}"

echo "[5] 【HEAD 校验的守卫】没传却说传好了 → 400 OBJECT_NOT_FOUND"
FAKE_MATERIAL_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
FAKE_STORAGE_KEY="${STORAGE_KEY%/*}/never-uploaded-${RANDOM}.jpg"
R5=$(curl -s -w '\n%{http_code}' -X POST "${COMPLETE_EP}" \
  -H "X-Upload-Token: ${LICENSE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"files\":[{\"storage_key\":\"${FAKE_STORAGE_KEY}\",\"material_id\":\"${FAKE_MATERIAL_ID}\",\"file_name\":\"never.jpg\",\"mime_type\":\"image/jpeg\",\"size_bytes\":${SIZE_BYTES}}]}")
C5=$(echo "${R5}" | tail -1)
BODY5=$(echo "${R5}" | sed '$d')
[ "${C5}" = "400" ] || fail "没传却 complete expected 400 got ${C5}：${BODY5}"
echo "${BODY5}" | grep -q 'OBJECT_NOT_FOUND' || fail "expected error.code=OBJECT_NOT_FOUND，实际：${BODY5}"
echo "    没传却 complete 被挡（400 OBJECT_NOT_FOUND）✓"

echo "[6] 查库确认"
if [ -n "${DATABASE_URL:-}" ] || [ -n "${PGHOST:-}" ]; then
  PSQL=(psql -tA -v ON_ERROR_STOP=1)
  [ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "${DATABASE_URL}")
  ROW=$("${PSQL[@]}" -c \
    "SELECT storage_key || '|' || COALESCE(uploaded_by_license_id::text, '') FROM zenithjoy.materials WHERE id = '${MATERIAL_ID}'")
  DB_STORAGE_KEY="${ROW%%|*}"
  DB_LICENSE_ID="${ROW##*|}"
  [ "${DB_STORAGE_KEY}" = "${STORAGE_KEY}" ] || fail "落库 storage_key 与签发时不一致：库=${DB_STORAGE_KEY} 签发=${STORAGE_KEY}"
  TENANT_PREFIX="${DB_STORAGE_KEY%%/*}"
  [ -n "${TENANT_PREFIX}" ] && [ "${TENANT_PREFIX}" != "${DB_STORAGE_KEY}" ] || fail "storage_key 没有租户前缀分段：${DB_STORAGE_KEY}"
  [ -n "${DB_LICENSE_ID}" ] || fail "uploaded_by_license_id 为空"
  echo "    storage_key=${DB_STORAGE_KEY}（租户前缀=${TENANT_PREFIX}）uploaded_by_license_id=${DB_LICENSE_ID} ✓"
else
  echo "    SKIP: 无 DB 连接，跳过落库校验"
fi

echo "✅ material-direct-upload smoke PASS"
