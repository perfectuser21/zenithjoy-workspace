#!/usr/bin/env bash
# material-tagging-smoke.sh
#
# 批量混剪 S1（GP f6f96e17）素材打标签 smoke：真 DB + 真 ffmpeg 抽帧，
# 锁定 tagMaterial 的确定性状态转换路径：
#   1. 素材不存在 → loud-fail 抛异常（不静默返回空结果）
#   2. 无 TOAPIS_API_KEY → 抽帧成功但落 failed_pending_review(no_api_key)，且真的写回 DB
#   3. 抽帧失败（源文件下载不到）→ failed_pending_review(frame_extraction_failed)
#
# 不覆盖 tagged 成功路径 —— 那条依赖真调 Gemini（TOAPIS 代理），成本高且外部
# 服务抖动会让基线闸假红，与 golden-path-2-smoke.sh Step 8c/23b 同样只在有
# TOAPIS_API_KEY 的专门 job 里跑真调用的口径一致，这里不重复背这个不确定性。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

for bin in psql node ffmpeg python3 curl; do
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

if [ ! -f apps/api/dist/services/material-tagging.js ]; then
  echo "  dist 缺失，现场构建（CI 正常路径已 build 过，这里兜本地直跑）"
  ( cd apps/api && npm run build >/dev/null 2>&1 ) || fail "apps/api build 失败"
fi

TAGCOL=$(psql_q "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='materials' AND column_name='tag_status'")
[ "$TAGCOL" = "tag_status" ] || fail "materials.tag_status 列不存在，migration 未生效"
ok "materials.tag_status 列已就位"

SFX=$(date +%s)$RANDOM
MATERIAL_ID=$(psql_q "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key) \
  VALUES ('mts-tenant-$SFX', 'mts-key-$SFX', 'smoke.mp4', 'video/mp4', 1024, 'mts-dedupe-$SFX') RETURNING id")
[ -n "$MATERIAL_ID" ] || fail "种子素材行未建成"
ok "种子素材行已建成 id=$MATERIAL_ID"

WORKDIR=$(mktemp -d)
HTTP_PID=""
cleanup() {
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.materials WHERE id = '$MATERIAL_ID'" >/dev/null 2>&1 || true
  [ -n "$HTTP_PID" ] && kill "$HTTP_PID" 2>/dev/null || true
  rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT

# 造一段确定性测试视频，不依赖外部下载 —— testsrc 是 ffmpeg 自带的合成源
ffmpeg -f lavfi -i "testsrc=duration=1:size=32x32:rate=1" -y "$WORKDIR/test.mp4" >/dev/null 2>&1 \
  || fail "ffmpeg 造测试视频失败（smoke 环境应自带 ffmpeg）"
[ -s "$WORKDIR/test.mp4" ] || fail "测试视频未生成"

HTTP_PORT=$((18000 + RANDOM % 2000))
(cd "$WORKDIR" && python3 -m http.server "$HTTP_PORT" >/dev/null 2>&1) &
HTTP_PID=$!
UP=0
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:$HTTP_PORT/test.mp4" -o /dev/null 2>&1 && { UP=1; break; }
  sleep 0.5
done
[ "$UP" = "1" ] || fail "本地测试视频 http server 未就绪"
ok "本地测试视频已就绪 http://127.0.0.1:$HTTP_PORT/test.mp4"

echo "== 1. 素材不存在 → loud-fail 抛异常 =="
node -e "
const { tagMaterial } = require('./apps/api/dist/services/material-tagging.js');
const pool = require('./apps/api/dist/db/connection.js').default;
tagMaterial('00000000-0000-4000-8000-000000000000', { storage: { getSignedUrl: async () => 'http://127.0.0.1:$HTTP_PORT/test.mp4' } })
  .then(() => { console.error('未抛异常'); process.exitCode = 1; })
  .catch((err) => {
    if (!/material not found/.test(err.message)) { console.error('异常信息不符: ' + err.message); process.exitCode = 1; return; }
    console.log('抛出预期异常: ' + err.message);
  })
  .finally(() => pool.end());
" || fail "不存在素材未 loud-fail"
ok "不存在素材 loud-fail"

echo "== 2. 无 TOAPIS_API_KEY → 抽帧成功但标记 failed_pending_review(no_api_key) =="
RESULT=$(env -u TOAPIS_API_KEY node -e "
const { tagMaterial } = require('./apps/api/dist/services/material-tagging.js');
const pool = require('./apps/api/dist/db/connection.js').default;
tagMaterial('$MATERIAL_ID', { storage: { getSignedUrl: async () => 'http://127.0.0.1:$HTTP_PORT/test.mp4' } })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "tagMaterial 调用失败"
echo "  返回: $RESULT"
[ -n "$RESULT" ] || fail "未取得调用结果（node 进程异常退出？）"
grep -q '"status":"failed_pending_review"' <<< "$RESULT" || fail "期望 failed_pending_review，实际 $RESULT"
grep -q '"reason":"no_api_key"' <<< "$RESULT" || fail "期望 reason=no_api_key，实际 $RESULT"
ok "服务返回 failed_pending_review(no_api_key)"

DB_STATUS=$(psql_q "SELECT tag_status FROM zenithjoy.materials WHERE id = '$MATERIAL_ID'")
[ "$DB_STATUS" = "failed_pending_review" ] || fail "DB tag_status 未回写，got=$DB_STATUS"
ok "DB tag_status 已真的回写为 failed_pending_review"

echo "== 3. 抽帧失败（源文件下载 404）→ failed_pending_review(frame_extraction_failed) =="
psql "$PGURL" -q -c "UPDATE zenithjoy.materials SET tag_status='pending' WHERE id='$MATERIAL_ID'" >/dev/null
RESULT2=$(node -e "
const { tagMaterial } = require('./apps/api/dist/services/material-tagging.js');
const pool = require('./apps/api/dist/db/connection.js').default;
tagMaterial('$MATERIAL_ID', { storage: { getSignedUrl: async () => 'http://127.0.0.1:$HTTP_PORT/not-found.mp4' } })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "tagMaterial 调用失败(第二次)"
echo "  返回: $RESULT2"
[ -n "$RESULT2" ] || fail "未取得第二次调用结果（node 进程异常退出？）"
grep -q '"reason":"frame_extraction_failed"' <<< "$RESULT2" || fail "期望 reason=frame_extraction_failed，实际 $RESULT2"
ok "抽帧失败路径落 failed_pending_review(frame_extraction_failed)"

echo "== 4. 排队器：上传后自动触发这条链（2026-09-21 新接，此前 tagMaterial 全仓无人调用）=="
# 守的是真实事故：tagMaterial 早就写好了，但没有任何地方调用它，素材传上去永远停在
# pending，而选素材页/候选生成只认 tagged —— 整条混剪链对客户完全不可用，客户实际
# 撞到了才暴露。这一步锁三件事：排队器真的会跑 tagMaterial、并发不超上限、
# 打标签抛错绝不冒泡（否则会把上传接口一起带崩）。
psql "$PGURL" -q -c "UPDATE zenithjoy.materials SET tag_status='pending' WHERE id='$MATERIAL_ID'" >/dev/null
QUEUE_OUT=$(node -e "
const { enqueueTagging } = require('./apps/api/dist/services/material-tagging-queue.js');
const pool = require('./apps/api/dist/db/connection.js').default;
let running = 0, peak = 0, ran = 0;
const fakeTag = async () => {
  running++; peak = Math.max(peak, running); ran++;
  await new Promise((r) => setTimeout(r, 40));
  running--;
  return { status: 'tagged', reason: null };
};
const boom = async () => { throw new Error('打标签炸了'); };
// 5 条并发入队 + 1 条必炸：进程不能崩，peak 不能超 2
const ps = [];
for (let i = 0; i < 5; i++) ps.push(enqueueTagging('m' + i, { storage: {}, tagMaterial: fakeTag }));
ps.push(enqueueTagging('m-boom', { storage: {}, tagMaterial: boom }));
// enqueueTagging 自己返回 Promise 且保证不 reject（失败只吞进日志），等它们比定时猜准
Promise.all(ps)
  .then(() => { console.log('QUEUE_JSON:' + JSON.stringify({ ran, peak })); })
  .catch((e) => { console.error('enqueueTagging 竟然 reject 了（不该发生）: ' + e.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^QUEUE_JSON:' | sed 's/^QUEUE_JSON://') || fail "排队器调用失败（进程被未捕获异常带崩？这正是要守的）"
[ -n "$QUEUE_OUT" ] || fail "未取得排队器结果——很可能是打标签抛错冒泡把进程干掉了"
echo "  返回: $QUEUE_OUT"
RAN=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ran))" "$QUEUE_OUT")
PEAK=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).peak))" "$QUEUE_OUT")
[ "$RAN" -ge 5 ] || fail "排队器没把 5 条都跑掉，ran=$RAN（链路又断了）"
ok "排队器真的执行了 $RAN 条打标签任务"
[ "$PEAK" -le 2 ] || fail "并发峰值 $PEAK 超过上限 2——会打爆 ToAPIs 网关（已有 520 事故前科）"
ok "并发峰值 $PEAK ≤ 2，不会打爆网关"
ok "打标签抛错未冒泡，进程存活（上传接口不会被带崩）"

echo "✅ material-tagging smoke 全部通过"
