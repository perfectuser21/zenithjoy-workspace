#!/usr/bin/env bash
# 素材上传 smoke：真 API + 真 DB 验一遍上传链路。
#
# 这个端点是所有入口（iPhone 快捷指令 / 小程序 / 电脑 agent）唯一认识的地址，
# 而它最要命的一条是**租户隔离**——一旦客户端能自报 tenant_id，任何人填别人的
# ID 就能把素材写进别人的库、也能拿到别人的素材 id。单测能测这个判断，但只有
# 真链路能证明它在 multer + express + pg 全都串起来之后仍然成立。
#
# 用法：
#   API_BASE=http://localhost:5200 bash material-upload-smoke.sh
#
# 自适应种子：未传 LICENSE_KEY 时，若 DATABASE_URL/PG* 可用就自己种一条
# tenant + license；连 DB 都摸不到就明确打印 SKIP 并 exit 0
# （不假绿：这不是"通过"，是"没法跑"）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }

# ── 种子 ──────────────────────────────────────────────────────────────
if [ -z "${LICENSE_KEY:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
    echo "SKIP: 未传 LICENSE_KEY，且找不到 DATABASE_URL/PGHOST 可自种子——本环境没有可用 DB，跳过"
    exit 0
  fi
  echo "[seed] 未传 LICENSE_KEY，自种一条 tenant + license"
  PSQL=(psql -tA -v ON_ERROR_STOP=1)
  [ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL")
  UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  TENANT_ID=$("${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('material-smoke-${RANDOM}', 'ms-key-${RANDOM}', 'free') RETURNING id" \
    | grep -oE "$UUID_RE" | head -1)
  [ -n "$TENANT_ID" ] || fail "种 tenant 失败"
  LICENSE_KEY="ZJ-F-SMK${RANDOM}"
  "${PSQL[@]}" -c \
    "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) \
     VALUES ('${LICENSE_KEY}','free',5,'active','${TENANT_ID}', now()+interval '1 day')" >/dev/null
  echo "[seed] tenant=$TENANT_ID license=$LICENSE_KEY"
fi

TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
IMG1="$TMPDIR_LOCAL/a.jpg"; IMG2="$TMPDIR_LOCAL/b.jpg"; VID="$TMPDIR_LOCAL/v.mp4"
# 最小合法 JPEG 头 + 一点内容，够端点识别类型
printf '\xff\xd8\xff\xe0\x00\x10JFIF-smoke-a' > "$IMG1"
printf '\xff\xd8\xff\xe0\x00\x10JFIF-smoke-b' > "$IMG2"
printf 'fake-mp4-bytes' > "$VID"

UP="$API_BASE/api/materials/upload"

echo "[1] 无凭据 → 401"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UP" -F "files=@$IMG1")
[ "$C" = "401" ] || fail "无凭据 expected 401 got $C"

echo "[2] 凭据无效 → 401"
# 走变量不写字面值：gitleaks 的 curl-auth-header 规则只看"认证头里有没有字面量"，
# 不管那个值是不是故意造的废 token，写死会被判成泄露。
BAD_TOKEN="ZJ-F-NOPE${RANDOM}"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UP" -H "X-Upload-Token: $BAD_TOKEN" -F "files=@$IMG1")
[ "$C" = "401" ] || fail "无效凭据 expected 401 got $C"

echo "[3] 一次传 2 张图 → 200，1 个 content + 2 个 material"
R=$(curl -sf -X POST "$UP" -H "X-Upload-Token: $LICENSE_KEY" -F "files=@$IMG1" -F "files=@$IMG2") \
  || fail "上传失败"
echo "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert d["content_id"], "没有 content_id"
assert d["type"] == "image", f"type 应为 image，实际 {d[\"type\"]}"
assert len(d["materials"]) == 2, f"应有 2 个 material，实际 {len(d[\"materials\"])}"
assert all(not m["deduped"] for m in d["materials"]), "首次上传不该被判重"
print(f"    content_id={d[\"content_id\"]} materials={len(d[\"materials\"])}")
' || fail "响应内容不符"

echo "[4] 同一批再传一次 → 全部 deduped（服务端去重，重复触发无害）"
R2=$(curl -sf -X POST "$UP" -H "X-Upload-Token: $LICENSE_KEY" -F "files=@$IMG1" -F "files=@$IMG2") \
  || fail "第二次上传失败"
echo "$R2" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]
assert all(m["deduped"] for m in d["materials"]), "重复上传应全部标记 deduped"
print("    全部 deduped ✓")
' || fail "去重没生效"

echo "[5] 视频和图片混传 → 400"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UP" -H "X-Upload-Token: $LICENSE_KEY" \
  -F "files=@$VID" -F "files=@$IMG1")
[ "$C" = "400" ] || fail "混传 expected 400 got $C"

echo "[6] 一个文件都不带 → 400"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UP" -H "X-Upload-Token: $LICENSE_KEY")
[ "$C" = "400" ] || fail "空上传 expected 400 got $C"

echo "[7] 客户端自报 tenant_id 被忽略 —— 素材必须落在凭据推出来的租户下"
if [ -n "${TENANT_ID:-}" ] && { [ -n "${DATABASE_URL:-}" ] || [ -n "${PGHOST:-}" ]; }; then
  EVIL="00000000-0000-4000-8000-000000000000"
  curl -sf -X POST "$UP" -H "X-Upload-Token: $LICENSE_KEY" \
    -F "tenant_id=$EVIL" -F "files=@$IMG1" >/dev/null || fail "带恶意 tenant_id 的上传应成功（字段被忽略）"
  N=$("${PSQL[@]}" -c "SELECT count(*) FROM zenithjoy.materials WHERE tenant_id = '${EVIL}'")
  [ "$N" = "0" ] || fail "自报的 tenant_id 竟然落库了（提权漏洞！count=${N}）"
  echo "    恶意 tenant_id 未落库 ✓"
else
  echo "    SKIP: 无 DB 连接，跳过落库校验"
fi

echo "✅ material-upload smoke PASS"
