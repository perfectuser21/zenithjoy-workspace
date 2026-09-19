#!/usr/bin/env bash
# mashup-render-smoke.sh
#
# 批量混剪 S4（GP f6f96e17）高清成片渲染 smoke：真 DB + 真 ffmpeg，锁定
# renderCandidate 的确定性路径：
#   1. 候选不存在 → loud-fail
#   2. 真 ffmpeg 合成：多段素材统一缩放到 1920x1080（A2 断言的分辨率要求）
#   3. 未配置 TOAPIS_API_KEY → 内容安全审核跳过，落 failed_pending_review，
#      不给 export_url/download_url（fail-closed，A1）
#
# 不覆盖"安全审核通过→真上传成片"路径——那条依赖真调 Gemini，成本高且外部
# 服务抖动会让基线闸假红，与 golden-path-2-smoke.sh Step 8c/23b、
# material-tagging-smoke.sh 同样只在有 TOAPIS_API_KEY 的专门 job 里跑真调用
# 的口径一致，这里不重复背这个不确定性。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

for bin in psql node ffmpeg ffprobe; do
  command -v "$bin" >/dev/null 2>&1 || fail "缺少必需命令：$bin"
done

if [ -n "${E2E_DATABASE_URL:-}" ]; then
  PGURL="$E2E_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  PGURL="$DATABASE_URL"
else
  PGURL="postgresql://${DATABASE_USER:-cecelia}:${DATABASE_PASSWORD:-cecelia}@${DATABASE_HOST:-localhost}:${DATABASE_PORT:-5432}/${DATABASE_NAME:-cecelia}"
fi

psql_q() { psql "$PGURL" -t -A -q -c "$1"; }

psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 \
  || fail "数据库连不上：$PGURL"

if [ ! -f apps/api/dist/services/mashup-render.js ]; then
  echo "  dist 缺失，现场构建（CI 正常路径已 build 过，这里兜本地直跑）"
  ( cd apps/api && npm run build >/dev/null 2>&1 ) || fail "apps/api build 失败"
fi

COLCOUNT=$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='contents' AND column_name IN ('safety_check_status','watermark_check_status','export_url','download_url')")
[ "$COLCOUNT" = "4" ] || fail "contents 表缺 S4 四个字段，migration 未生效（实际=${COLCOUNT}）"
ok "contents.safety_check_status/watermark_check_status/export_url/download_url 已就位"

echo "== 1. ffmpeg 合成层真机验证：多段不同分辨率素材统一到 1920x1080 =="
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
ffmpeg -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" -y "$WORKDIR/a.mp4" >/dev/null 2>&1 \
  || fail "ffmpeg 造测试素材失败"
ffmpeg -f lavfi -i "testsrc2=duration=1:size=640x480:rate=10" -y "$WORKDIR/b.mp4" >/dev/null 2>&1 \
  || fail "ffmpeg 造测试素材失败"

RENDER_OK=$(node -e "
const { concatAndScale } = require('./apps/api/dist/services/mashup-render-ffmpeg.js');
console.log(concatAndScale(['$WORKDIR/a.mp4', '$WORKDIR/b.mp4'], '$WORKDIR/out.mp4') ? 'yes' : 'no');
")
[ "$RENDER_OK" = "yes" ] || fail "concatAndScale 返回 false"
[ -s "$WORKDIR/out.mp4" ] || fail "输出文件未生成"
DIMS=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$WORKDIR/out.mp4")
[ "$DIMS" = "1920,1080" ] || fail "输出分辨率不是 1920x1080，实际=${DIMS}（违反 A2 断言）"
ok "ffmpeg 真机合成验证通过：输出 1920x1080"

echo "== 2. renderCandidate 端到端（真库）：未配置 TOAPIS_API_KEY → fail-closed =="
SFX=$(date +%s)$RANDOM
TENANT="mrs-tenant-$SFX"

TMPL_ID=$(psql_q "SELECT id FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL AND name = '标准四槽位（钩子/产品/证据/CTA）'")
[ -n "$TMPL_ID" ] || fail "内置标准四槽位模板未找到"

seed_material() {
  psql_q "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, tag_status, ai_tags) \
    VALUES ('$TENANT', 'mrs-key-$1', 'smoke-$1.mp4', 'video/mp4', 1024, 'mrs-dedupe-$1', 'tagged', '$2'::jsonb) RETURNING id"
}
MAT_HOOK=$(seed_material "hook-$SFX" '["开场"]')
MAT_PRODUCT=$(seed_material "product-$SFX" '["产品特写"]')
MAT_CTA=$(seed_material "cta-$SFX" '["行动号召"]')

cleanup() {
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.materials WHERE tenant_id = '$TENANT'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

RUN_ID=$(node -e "
const { assignSlots } = require('./apps/api/dist/services/mashup-slot-assignment.js');
const pool = require('./apps/api/dist/db/connection.js').default;
assignSlots({ tenantId: '$TENANT', templateId: '$TMPL_ID', materialIds: ['$MAT_HOOK', '$MAT_PRODUCT', '$MAT_CTA'] })
  .then((r) => { console.log('RUN_ID:' + r.runId); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RUN_ID:' | sed 's/^RUN_ID://') || fail "assignSlots 调用失败"

CAND_RESULT=$(node -e "
const { generateCandidates } = require('./apps/api/dist/services/mashup-candidate-generation.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateCandidates({ tenantId: '$TENANT', runId: '$RUN_ID' })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "generateCandidates 调用失败"
CAND_ID=$(node -e "console.log(JSON.parse(process.argv[1]).candidates[0].id)" "$CAND_RESULT")
[ -n "$CAND_ID" ] || fail "未取得候选 id"
ok "候选已就位 candidateId=${CAND_ID}"

# 素材下载走 InMemoryMaterialStorage 兜底（本 smoke 不配 COS），signed url 会打到
# 一个假地址——为了真正跑到 ffmpeg 合成这一步，用真实可下载的本地 http server
# 顶替（同 material-tagging-smoke.sh 造本地 http server 的思路）。
HTTP_PORT=$((19000 + RANDOM % 2000))
(cd "$WORKDIR" && python3 -m http.server "$HTTP_PORT" >/dev/null 2>&1) &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true; rm -rf "$WORKDIR"; cleanup' EXIT
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:$HTTP_PORT/a.mp4" -o /dev/null 2>&1 && break
  sleep 0.5
done

RESULT=$(env -u TOAPIS_API_KEY node -e "
const { renderCandidate } = require('./apps/api/dist/services/mashup-render.js');
const pool = require('./apps/api/dist/db/connection.js').default;
const storage = { getSignedUrl: async () => 'http://127.0.0.1:$HTTP_PORT/a.mp4', putObject: async () => {}, deleteObject: async () => {}, presignPut: async () => '', headObject: async () => null };
renderCandidate({ tenantId: '$TENANT', candidateId: '$CAND_ID' }, { storage })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "renderCandidate 调用失败"
[ -n "$RESULT" ] || fail "未取得调用结果"
echo "  返回: $RESULT"
grep -q '"safetyCheckStatus":"failed_pending_review"' <<< "$RESULT" || fail "期望 failed_pending_review，实际 $RESULT"
grep -q '"exportUrl"' <<< "$RESULT" && fail "未配置 TOAPIS_API_KEY 时不应给 exportUrl（fail-closed 违规）"
ok "未配置 TOAPIS_API_KEY 时落 failed_pending_review，exportUrl/downloadUrl 均缺省"

CONTENT_ID=$(node -e "console.log(JSON.parse(process.argv[1]).contentId)" "$RESULT")
DB_EXPORT_URL=$(psql_q "SELECT export_url FROM zenithjoy.contents WHERE id = '$CONTENT_ID'")
[ -z "$DB_EXPORT_URL" ] || fail "DB export_url 应为 NULL，实际=${DB_EXPORT_URL}（A1 fail-closed 违规）"
ok "DB contents.export_url 确认为 NULL（A1 fail-closed 落库层验证）"

echo "== 3. 候选不存在 → loud-fail =="
node -e "
const { renderCandidate } = require('./apps/api/dist/services/mashup-render.js');
const pool = require('./apps/api/dist/db/connection.js').default;
const storage = { getSignedUrl: async () => '', putObject: async () => {}, deleteObject: async () => {}, presignPut: async () => '', headObject: async () => null };
renderCandidate({ tenantId: '$TENANT', candidateId: '00000000-0000-4000-8000-000000000000' }, { storage })
  .then(() => { console.error('未抛异常'); process.exitCode = 1; })
  .catch((err) => {
    if (!/candidate not found/.test(err.message)) { console.error('异常信息不符: ' + err.message); process.exitCode = 1; return; }
    console.log('抛出预期异常: ' + err.message);
  })
  .finally(() => pool.end());
" || fail "不存在候选未 loud-fail"
ok "不存在候选 loud-fail"

echo "== 4. 启动期二进制依赖自检（0919 真机事故：镜像漏 ffmpeg，渲染静默 fail-closed）=="
BIN_CHECK=$(node -e "
const { verifyStartupBinaries } = require('./apps/api/dist/startup-check.js');
console.log(JSON.stringify(verifyStartupBinaries()));
")
echo "  当前环境（应装了 ffmpeg）自检结果: $BIN_CHECK"
grep -q '"ok":true' <<< "$BIN_CHECK" || fail "本 CI 环境已装 ffmpeg 却自检不通过：$BIN_CHECK"
grep -q '"present":\["ffmpeg"\]' <<< "$BIN_CHECK" || fail "自检结果未把 ffmpeg 列为 present：$BIN_CHECK"
ok "verifyStartupBinaries() 在真实装了 ffmpeg 的环境里正确判定 ok=true"

MISSING_CHECK=$(node -e "
const { verifyStartupBinaries } = require('./apps/api/dist/startup-check.js');
const fakeMissing = () => { throw new Error('ENOENT: 模拟找不到可执行文件'); };
console.log(JSON.stringify(verifyStartupBinaries([{ name: 'ffmpeg', versionArgs: ['-version'], consequence: 'x' }], fakeMissing)));
")
grep -q '"ok":false' <<< "$MISSING_CHECK" || fail "模拟 ffmpeg 缺失时应判定 ok=false：$MISSING_CHECK"
grep -q '"missing":\["ffmpeg"\]' <<< "$MISSING_CHECK" || fail "模拟缺失时 missing 未含 ffmpeg：$MISSING_CHECK"
ok "verifyStartupBinaries() 在二进制缺失时正确判定 ok=false（这就是 0919 真机复现的路径）"

echo "✅ mashup-render smoke 全部通过"
