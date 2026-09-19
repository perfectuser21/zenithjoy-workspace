#!/usr/bin/env bash
# mashup-candidate-generation-smoke.sh
#
# 批量混剪 S3（GP f6f96e17）候选生成 smoke：真 DB + 真本地 embedding 模型
# （@xenova/transformers，首次跑会现下模型，~20s，缓存到 ~/.cache/huggingface），
# 锁定：
#   1. 语义相似度真的能分辨"相关"与"不相关"素材（Gate0 实测结论=B 的落地验证，
#      决策 98d1fab1——这条线要是哪天悄悄崩了，S3 整条候选生成会退化成瞎排）
#   2. generateCandidates 端到端真跑：候选落库、S2 reshoot_skipped 槽位在候选里
#      原样透传为空、run 不存在 loud-fail
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

for bin in psql node; do
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

if [ ! -f apps/api/dist/services/mashup-candidate-generation.js ]; then
  echo "  dist 缺失，现场构建（CI 正常路径已 build 过，这里兜本地直跑）"
  ( cd apps/api && npm run build >/dev/null 2>&1 ) || fail "apps/api build 失败"
fi

TMPL_ID=$(psql_q "SELECT id FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL AND name = '标准四槽位（钩子/产品/证据/CTA）'")
[ -n "$TMPL_ID" ] || fail "内置标准四槽位模板未找到，migration 未生效"

echo "== 1. 语义判别力真机验证（Gate0 结论=B 的落地依据，决策 98d1fab1）=="
SIM_RESULT=$(node -e "
const { embedText, cosineSimilarity } = require('./apps/api/dist/services/embedding.js');
(async () => {
  const a = await embedText('产品特写，厨房场景，暖色调');
  const b = await embedText('厨房产品展示镜头');
  const c = await embedText('行动号召，下单购买');
  console.log('RESULT_JSON:' + JSON.stringify({ related: cosineSimilarity(a, b), unrelated: cosineSimilarity(a, c) }));
})().catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; });
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "embedding 调用失败"
[ -n "$SIM_RESULT" ] || fail "未取得相似度结果"
echo "  返回: $SIM_RESULT"
RELATED=$(node -e "console.log(JSON.parse(process.argv[1]).related)" "$SIM_RESULT")
UNRELATED=$(node -e "console.log(JSON.parse(process.argv[1]).unrelated)" "$SIM_RESULT")
node -e "process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 0 : 1)" "$RELATED" "$UNRELATED" \
  || fail "语义判别力失效：相关文本相似度($RELATED)未明显高于不相关文本($UNRELATED)"
ok "语义判别力正常：相关=$RELATED > 不相关=$UNRELATED"

echo "== 2. generateCandidates 端到端真跑 =="
SFX=$(date +%s)$RANDOM
TENANT="mcg-tenant-$SFX"

seed_material() {
  psql_q "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, tag_status, ai_tags) \
    VALUES ('$TENANT', 'mcg-key-$1', 'smoke-$1.mp4', 'video/mp4', 1024, 'mcg-dedupe-$1', 'tagged', '$2'::jsonb) RETURNING id"
}

MAT_HOOK=$(seed_material "hook-$SFX" '["开场","悬念"]')
MAT_PRODUCT=$(seed_material "product-$SFX" '["产品特写","细节"]')
MAT_CTA=$(seed_material "cta-$SFX" '["行动号召","结尾"]')
[ -n "$MAT_HOOK" ] && [ -n "$MAT_PRODUCT" ] && [ -n "$MAT_CTA" ] || fail "种子素材未建成"

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
" | grep '^RUN_ID:' | sed 's/^RUN_ID://') || fail "assignSlots 调用失败（S3 依赖 S2 先产出 run）"
[ -n "$RUN_ID" ] || fail "未取得 runId"
ok "S2 run 已产出 runId=${RUN_ID}（hook/product 应 assigned，evidence 应 unfilled，cta 应 assigned）"

RESULT=$(node -e "
const { generateCandidates } = require('./apps/api/dist/services/mashup-candidate-generation.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateCandidates({ tenantId: '$TENANT', runId: '$RUN_ID' })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "generateCandidates 调用失败"
[ -n "$RESULT" ] || fail "未取得调用结果"
echo "  返回: $RESULT"

CAND_COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).candidates.length)" "$RESULT")
[ "$CAND_COUNT" -ge 1 ] || fail "期望至少 1 条候选，实际 $CAND_COUNT"
ok "候选已生成 $CAND_COUNT 条"

DB_CAND_COUNT=$(psql_q "SELECT count(*) FROM zenithjoy.mashup_candidates WHERE run_id = '$RUN_ID'")
[ "$DB_CAND_COUNT" = "$CAND_COUNT" ] || fail "DB 落库候选数($DB_CAND_COUNT)与返回数($CAND_COUNT)不一致"
ok "DB mashup_candidates 已真的落库 $DB_CAND_COUNT 条"

EVIDENCE_FILLED=$(node -e "
const r = JSON.parse(process.argv[1]);
const has = r.candidates.some((c) => c.slotFill && c.slotFill.evidence !== undefined);
console.log(has ? 'yes' : 'no');
" "$RESULT")
[ "$EVIDENCE_FILLED" = "no" ] || fail "evidence 槽位在 S2 判定 unfilled，候选里不应该被填上"
ok "S2 unfilled 的 evidence 槽位在所有候选里正确透传为空"

echo "== 3. run 不存在 → loud-fail =="
node -e "
const { generateCandidates } = require('./apps/api/dist/services/mashup-candidate-generation.js');
const pool = require('./apps/api/dist/db/connection.js').default;
generateCandidates({ tenantId: '$TENANT', runId: '00000000-0000-4000-8000-000000000000' })
  .then(() => { console.error('未抛异常'); process.exitCode = 1; })
  .catch((err) => {
    if (!/run not found/.test(err.message)) { console.error('异常信息不符: ' + err.message); process.exitCode = 1; return; }
    console.log('抛出预期异常: ' + err.message);
  })
  .finally(() => pool.end());
" || fail "不存在 run 未 loud-fail"
ok "不存在 run loud-fail"

echo "✅ mashup-candidate-generation smoke 全部通过"
