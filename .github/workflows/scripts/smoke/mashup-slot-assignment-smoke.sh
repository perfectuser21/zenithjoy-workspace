#!/usr/bin/env bash
# mashup-slot-assignment-smoke.sh
#
# 批量混剪 S2（GP f6f96e17）槽位模板分配 smoke：真 DB，锁定 assignSlots 的
# 三条确定性状态转换路径：
#   1. 必填槽位命中已打标签素材 → assigned，run 状态 completed
#   2. 必填槽位无匹配素材（补拍未配置，决策 98d1fab1）→ reshoot_skipped，
#      run 状态 completed_partial
#   3. 模板不存在 → loud-fail 抛异常
#
# 不覆盖真实 HTTP 端点（routes/mashup.ts 的鉴权/租户隔离已由 vitest 契约测试
# 覆盖，此处只锁服务层真库落库路径，与 material-tagging-smoke.sh 同分工）。
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

if [ ! -f apps/api/dist/services/mashup-slot-assignment.js ]; then
  echo "  dist 缺失，现场构建（CI 正常路径已 build 过，这里兜本地直跑）"
  ( cd apps/api && npm run build >/dev/null 2>&1 ) || fail "apps/api build 失败"
fi

TMPL_ID=$(psql_q "SELECT id FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL AND name = '标准四槽位（钩子/产品/证据/CTA）'")
[ -n "$TMPL_ID" ] || fail "内置标准四槽位模板未找到，migration 未生效"
ok "内置标准四槽位模板已就位 id=$TMPL_ID"

SFX=$(date +%s)$RANDOM
TENANT="mss-tenant-$SFX"

seed_material() {
  # $1=dedupe后缀 $2=ai_tags(jsonb字面量)
  psql_q "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, tag_status, ai_tags) \
    VALUES ('$TENANT', 'mss-key-$1', 'smoke-$1.mp4', 'video/mp4', 1024, 'mss-dedupe-$1', 'tagged', '$2'::jsonb) RETURNING id"
}

MAT_PRODUCT=$(seed_material "product-$SFX" '["产品特写","细节"]')
MAT_CTA=$(seed_material "cta-$SFX" '["行动号召","结尾"]')
[ -n "$MAT_PRODUCT" ] && [ -n "$MAT_CTA" ] || fail "种子素材未建成"
ok "种子素材已建成（product/cta 两条，故意不给 hook/evidence 留匹配素材）"

cleanup() {
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.materials WHERE tenant_id = '$TENANT'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1. 部分槽位命中 + 必填槽位缺素材 → reshoot_skipped，run 状态 completed_partial =="
RESULT=$(env -u SEEDANCE_API_KEY -u HAPPYHORSE_API_KEY node -e "
const { assignSlots } = require('./apps/api/dist/services/mashup-slot-assignment.js');
const pool = require('./apps/api/dist/db/connection.js').default;
assignSlots({ tenantId: '$TENANT', templateId: '$TMPL_ID', materialIds: ['$MAT_PRODUCT', '$MAT_CTA'] })
  .then((r) => { console.log('RESULT_JSON:' + JSON.stringify(r)); })
  .catch((err) => { console.error('意外异常: ' + err.message); process.exitCode = 1; })
  .finally(() => pool.end());
" | grep '^RESULT_JSON:' | sed 's/^RESULT_JSON://') || fail "assignSlots 调用失败"
[ -n "$RESULT" ] || fail "未取得调用结果（node 进程异常退出？）"
echo "  返回: $RESULT"
grep -q '"status":"completed_partial"' <<< "$RESULT" || fail "期望 run 状态 completed_partial，实际 $RESULT"
grep -q '"slotKey":"hook"' <<< "$RESULT" || fail "缺 hook 槽位分配记录"
grep -q '"reason":"reshoot_service_not_configured"' <<< "$RESULT" || fail "hook 槽位期望 reason=reshoot_service_not_configured"
ok "hook 槽位落 reshoot_skipped(reshoot_service_not_configured)，run 状态 completed_partial"

RUN_ID=$(grep -oE '"runId":"[^"]+"' <<< "$RESULT" | sed 's/"runId":"//;s/"$//')
[ -n "$RUN_ID" ] || fail "未取得 runId"
DB_RUN_STATUS=$(psql_q "SELECT status FROM zenithjoy.mashup_runs WHERE id = '$RUN_ID'")
[ "$DB_RUN_STATUS" = "completed_partial" ] || fail "DB mashup_runs.status 未回写，got=$DB_RUN_STATUS"
ok "DB mashup_runs.status 已真的回写为 completed_partial"

ASSIGN_COUNT=$(psql_q "SELECT count(*) FROM zenithjoy.mashup_slot_assignments WHERE run_id = '$RUN_ID'")
[ "$ASSIGN_COUNT" = "4" ] || fail "期望落库 4 条槽位分配记录，实际 $ASSIGN_COUNT"
ok "DB mashup_slot_assignments 已落库 4 条槽位记录"

echo "== 2. 模板不存在 → loud-fail 抛异常 =="
node -e "
const { assignSlots } = require('./apps/api/dist/services/mashup-slot-assignment.js');
const pool = require('./apps/api/dist/db/connection.js').default;
assignSlots({ tenantId: '$TENANT', templateId: '00000000-0000-4000-8000-000000000000', materialIds: [] })
  .then(() => { console.error('未抛异常'); process.exitCode = 1; })
  .catch((err) => {
    if (!/template not found/.test(err.message)) { console.error('异常信息不符: ' + err.message); process.exitCode = 1; return; }
    console.log('抛出预期异常: ' + err.message);
  })
  .finally(() => pool.end());
" || fail "不存在模板未 loud-fail"
ok "不存在模板 loud-fail"

echo "✅ mashup-slot-assignment smoke 全部通过"
