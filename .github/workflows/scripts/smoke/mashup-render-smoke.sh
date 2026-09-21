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
#
# 配音字幕刀（GP line05/batch_mashup#step4）扩展——原版剪出的是横屏哑片，客户
# 实际打开发现没法发抖音，本刀在渲染管线上补齐横竖屏可选/裁剪对齐/挂音轨/烧字幕。
# 新增守卫覆盖：
#   7. renderMashupWithAudio 横竖屏/每段裁剪时长/挂音轨真机验证
#   8. 字幕烧录"静默失效"守卫——光断言 ffmpeg 退出码 0 是假绿（P0 issue 357861c4
#      真机实测：容器有 subtitles 滤镜但没字体，Fontconfig 报错、退出码仍 0、
#      文件仍生成，字节数与不烧字幕完全一致）。用"烧字幕 vs 不烧字幕产物字节数
#      是否不同"做判据——只要字幕真的画上了像素，输出文件必然变化。
#   9. 启动期字体自检（同 Step 4 二进制自检同一道闸）
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

echo "== 5. Step3 候选真实轻量预览（决策 623a81d7）：renderPreview 真机验证 =="
PREVIEW_OUT="$WORKDIR/preview-captured.mp4"
PREVIEW_RESULT=$(node -e "
const { renderPreview } = require('./apps/api/dist/services/mashup-preview-render.js');
const pool = require('./apps/api/dist/db/connection.js').default;
const fs = require('fs');
const storage = {
  getSignedUrl: async () => 'http://127.0.0.1:$HTTP_PORT/a.mp4',
  putObject: async ({ filePath }) => { fs.copyFileSync(filePath, '$PREVIEW_OUT'); },
  deleteObject: async () => {}, presignPut: async () => '', headObject: async () => null,
};
renderPreview({ tenantId: '$TENANT', candidateId: '$CAND_ID' }, { storage })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "renderPreview 调用失败"
[ -n "$PREVIEW_RESULT" ] || fail "未取得调用结果"
echo "  返回: $PREVIEW_RESULT"
grep -q '"previewUrl"' <<< "$PREVIEW_RESULT" || fail "期望产出 previewUrl，实际 $PREVIEW_RESULT"
[ -s "$PREVIEW_OUT" ] || fail "预览产物未落盘"
PREVIEW_DIMS=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$PREVIEW_OUT")
[ "$PREVIEW_DIMS" != "1920,1080" ] || fail "预览档位输出分辨率与终版相同(1920x1080)，轻量档位未生效"
ok "预览真实产出 previewUrl，输出分辨率=${PREVIEW_DIMS}（轻量档位，非终版 1920x1080）"

echo "== 6. 候选真实轻量预览队列：真实入队并落库 preview_status =="
QUEUE_RESULT=$(node -e "
const { enqueuePreview } = require('./apps/api/dist/services/mashup-preview-queue.js');
const pool = require('./apps/api/dist/db/connection.js').default;
enqueuePreview({ tenantId: '$TENANT', candidateId: '$CAND_ID' }, { render: async () => ({ previewUrl: 'https://smoke.example/p.mp4' }) })
  .then(async (r) => {
    console.log('RESULT_JSON:' + JSON.stringify(r));
    // enqueuePreview 内部渲染是 fire-and-forget（不 await 后台 runItem），入队 promise
    // resolve 时后台 DB 落态还没写完——留时间窗让它跑完，否则 pool.end() 在它前头把
    // 连接关了，落库永远追不上（这是踩过的坑，不是真实业务逻辑的 bug）。
    await new Promise((res) => setTimeout(res, 800));
  })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "enqueuePreview 调用失败"
echo "  返回: $QUEUE_RESULT"
grep -q '"previewStatus":"generating"' <<< "$QUEUE_RESULT" || fail "期望入队后立即回 generating，实际 $QUEUE_RESULT"
DB_PREVIEW_STATUS=$(psql_q "SELECT preview_status FROM zenithjoy.mashup_candidates WHERE id = '$CAND_ID'")
[ "$DB_PREVIEW_STATUS" = "ready" ] || fail "队列异步渲染完成后 preview_status 应落库为 ready，实际=$DB_PREVIEW_STATUS"
ok "预览队列真实入队→异步渲染→落库 preview_status=ready"

echo "== 7. renderMashupWithAudio 真机验证：横竖屏可选 + 每段裁剪时长 + 挂音轨 =="
SUBWORK=$(mktemp -d)
trap 'rm -rf "$SUBWORK"' EXIT
ffmpeg -f lavfi -i "testsrc=duration=2:size=640x480:rate=10" -y "${SUBWORK}/seg-a.mp4" >/dev/null 2>&1 \
  || fail "造测试素材失败"
ffmpeg -f lavfi -i "testsrc2=duration=2:size=640x480:rate=10" -y "${SUBWORK}/seg-b.mp4" >/dev/null 2>&1 \
  || fail "造测试素材失败"
ffmpeg -f lavfi -i "anullsrc=r=44100:cl=mono" -t 3 -y "${SUBWORK}/voice.mp3" >/dev/null 2>&1 \
  || fail "造测试配音素材失败"

PORTRAIT_OUT="${SUBWORK}/portrait.mp4"
PORTRAIT_OK=$(node -e "
const { renderMashupWithAudio } = require('./apps/api/dist/services/mashup-render-ffmpeg.js');
console.log(renderMashupWithAudio(
  [{ path: '${SUBWORK}/seg-a.mp4', durationSec: 1 }, { path: '${SUBWORK}/seg-b.mp4', durationSec: 1.2 }],
  '${PORTRAIT_OUT}',
  { width: 1080, height: 1920, audioPath: '${SUBWORK}/voice.mp3' },
) ? 'yes' : 'no');
")
[ "$PORTRAIT_OK" = "yes" ] || fail "renderMashupWithAudio(竖屏+裁剪+音轨) 返回 false"
[ -s "$PORTRAIT_OUT" ] || fail "竖屏输出文件未生成"

PORTRAIT_DIMS=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$PORTRAIT_OUT")
[ "$PORTRAIT_DIMS" = "1080,1920" ] || fail "竖屏参数(1080x1920)未生效，实际=${PORTRAIT_DIMS}"
ok "横竖屏可选生效：opts.width/height=1080x1920 → 输出=${PORTRAIT_DIMS}"

PORTRAIT_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PORTRAIT_OUT")
# 期望时长 ≈ 1 + 1.2 = 2.2s（每段按 durationSec 裁剪后拼接，允许编码误差）
awk -v d="$PORTRAIT_DUR" 'BEGIN { if (d < 1.9 || d > 2.6) exit 1 }' \
  || fail "每段裁剪时长未生效，期望约 2.2s，实际=${PORTRAIT_DUR}"
ok "每段按 durationSec 裁剪对齐生效：合成总时长=${PORTRAIT_DUR}s（期望约 2.2s）"

AUDIO_STREAM=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$PORTRAIT_OUT")
[ "$AUDIO_STREAM" = "audio" ] || fail "传入 audioPath 后输出应含音轨，实际未探测到音频流"
ok "挂音轨生效：输出含音频流（codec_type=audio）"

NOAUDIO_OUT="${SUBWORK}/noaudio.mp4"
NOAUDIO_OK=$(node -e "
const { renderMashupWithAudio } = require('./apps/api/dist/services/mashup-render-ffmpeg.js');
console.log(renderMashupWithAudio([{ path: '${SUBWORK}/seg-a.mp4' }], '${NOAUDIO_OUT}') ? 'yes' : 'no');
")
[ "$NOAUDIO_OK" = "yes" ] || fail "renderMashupWithAudio(默认无音轨) 返回 false"
NOAUDIO_STREAM_COUNT=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$NOAUDIO_OUT" | grep -c audio || true)
[ "$NOAUDIO_STREAM_COUNT" = "0" ] || fail "未传 audioPath 时不应有音轨（向后兼容行为被破坏）"
ok "未传 audioPath 时保持无音轨（向后兼容）"

echo "== 8. 字幕烧录静默失效守卫（P0 issue 357861c4）：烧字幕 vs 不烧字幕产物字节数必须不同 =="
if ! ffmpeg -filters 2>/dev/null | grep -q subtitles; then
  echo "::warning::当前 ffmpeg 未编译 subtitles 滤镜（未装 libass），跳过字幕守卫——这是环境限制，不是本刀要修的字体问题"
else
  cat > "${SUBWORK}/sub.srt" <<'SRTEOF'
1
00:00:00,000 --> 00:00:01,000
测试字幕
SRTEOF

  NOSUB_OUT="${SUBWORK}/nosub.mp4"
  SUB_OUT="${SUBWORK}/withsub.mp4"

  NOSUB_OK=$(node -e "
const { renderMashupWithAudio } = require('./apps/api/dist/services/mashup-render-ffmpeg.js');
console.log(renderMashupWithAudio([{ path: '${SUBWORK}/seg-a.mp4', durationSec: 1 }], '${NOSUB_OUT}') ? 'yes' : 'no');
")
  [ "$NOSUB_OK" = "yes" ] || fail "不烧字幕对照组渲染失败"

  SUB_OK=$(node -e "
const { renderMashupWithAudio } = require('./apps/api/dist/services/mashup-render-ffmpeg.js');
console.log(renderMashupWithAudio(
  [{ path: '${SUBWORK}/seg-a.mp4', durationSec: 1 }],
  '${SUB_OUT}',
  { srtPath: '${SUBWORK}/sub.srt' },
) ? 'yes' : 'no');
")
  # 只断言"调用返回 true 且文件存在"是不够的——退出码 0、文件存在，正是 357861c4
  # 复现的假绿现场；真正的判据在下面的字节数对比。
  [ "$SUB_OK" = "yes" ] || fail "烧字幕渲染调用失败（返回 false）"
  [ -s "$SUB_OUT" ] || fail "烧字幕产物未生成"

  NOSUB_BYTES=$(wc -c < "$NOSUB_OUT" | tr -d ' ')
  SUB_BYTES=$(wc -c < "$SUB_OUT" | tr -d ' ')
  echo "  不烧字幕字节数=${NOSUB_BYTES}  烧字幕字节数=${SUB_BYTES}"

  if [ "$NOSUB_BYTES" = "$SUB_BYTES" ]; then
    fail "字幕烧录静默失效：烧字幕与不烧字幕产物字节数完全一致(${SUB_BYTES})——ffmpeg 退出码 0/文件存在但字幕没画上（P0 357861c4 同类假绿，多半是部署镜像缺字体/fontconfig）"
  fi
  ok "字幕真实画上了像素：烧字幕产物字节数(${SUB_BYTES})与不烧字幕(${NOSUB_BYTES})不同"
fi

echo "== 9. 启动期字体自检（P0 issue 357861c4：容器有 subtitles 滤镜但没字体，字幕静默不画）=="
FONT_CHECK=$(node -e "
const { verifyStartupFonts } = require('./apps/api/dist/startup-check.js');
console.log(JSON.stringify(verifyStartupFonts()));
")
echo "  当前环境字体自检结果: $FONT_CHECK"
grep -q '"ok":true' <<< "$FONT_CHECK" \
  || fail "当前环境 fc-list 返回 0 条字体（字幕烧录会静默失效），需检查部署镜像是否装了 fontconfig+中文字体包：${FONT_CHECK}"
ok "verifyStartupFonts() 判定 ok=true（fc-list 已注册字体）"

FONT_MISSING_CHECK=$(node -e "
const { verifyStartupFonts } = require('./apps/api/dist/startup-check.js');
const fakeEmpty = () => ({ status: 0, stdout: '' });
console.log(JSON.stringify(verifyStartupFonts(fakeEmpty)));
")
grep -q '"ok":false' <<< "$FONT_MISSING_CHECK" || fail "模拟 fc-list 空输出时应判定 ok=false：$FONT_MISSING_CHECK"
grep -q '"count":0' <<< "$FONT_MISSING_CHECK" || fail "模拟 fc-list 空输出时 count 应为 0：$FONT_MISSING_CHECK"
ok "verifyStartupFonts() 在 0 条字体时正确判定 ok=false（这就是 357861c4 真机复现的路径）"

echo "✅ mashup-render smoke 全部通过（含 Step3 候选真实轻量预览 + 配音字幕刀 Step7-9）"
