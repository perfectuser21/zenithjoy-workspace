#!/usr/bin/env bash
# mashup-history-smoke.sh
#
# 批量混剪历史记录（GP line05/batch_mashup 横切）smoke：真库 + 真 API 进程，
# 锁 GET /api/mashup/runs 的两件事——
#   1. 租户隔离：A 租户的凭据看不到 B 租户的 run（与 materials 同口径，
#      这是整条链上最关键的闸）
#   2. stage 与库里事实一致：selected_candidate_id + contents.export_url
#      决定「已完成」，而不是 mashup_runs.status（后者无 CHECK 约束、
#      应用层随便写，用它判会把被安全 Gate 拦下的 run 显示成已完成）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

for bin in psql curl; do
  command -v "$bin" >/dev/null 2>&1 || fail "缺少必需命令：$bin"
done

if [ -n "${E2E_DATABASE_URL:-}" ]; then
  PGURL="$E2E_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  PGURL="$DATABASE_URL"
else
  PGURL="postgresql://${DATABASE_USER:-cecelia}:${DATABASE_PASSWORD:-cecelia}@${DATABASE_HOST:-localhost}:${DATABASE_PORT:-5432}/${DATABASE_NAME:-cecelia}"
fi
API_BASE="${API_BASE:-http://localhost:5200}"

psql_q() { psql "$PGURL" -t -A -q -c "$1"; }

psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 || fail "数据库连不上：$PGURL"
curl -sf "$API_BASE/health" >/dev/null 2>&1 || fail "API 没起来：$API_BASE"

SFX=$(date +%s)$RANDOM
KEY_A="ZJ-F-MHSA$SFX"
KEY_B="ZJ-F-MHSB$SFX"

seed_tenant() {  # $1=name
  psql_q "INSERT INTO zenithjoy.tenants (name, license_key, plan) \
    VALUES ('$1', 'mhs-lk-$1', 'free') RETURNING id"
}
TENANT_A=$(seed_tenant "mhs-a-$SFX")
TENANT_B=$(seed_tenant "mhs-b-$SFX")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] || fail "测试租户未建成"

seed_license() {
  psql_q "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, tenant_id, status, expires_at) \
    VALUES ('$1', 'free', 5, '$2', 'active', NOW() + INTERVAL '1 day') RETURNING id"
}
LIC_A=$(seed_license "$KEY_A" "$TENANT_A")
LIC_B=$(seed_license "$KEY_B" "$TENANT_B")
[ -n "$LIC_A" ] && [ -n "$LIC_B" ] || fail "测试凭据未建成"
ok "两个租户的凭据已就位"

TMPL_ID=$(psql_q "SELECT id FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL LIMIT 1")
[ -n "$TMPL_ID" ] || fail "内置模板未找到，migration 未生效"

seed_run() {  # $1=tenant
  psql_q "INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) \
    VALUES ('$1', '$TMPL_ID', 'completed') RETURNING id"
}
RUN_A_PENDING=$(seed_run "$TENANT_A")
RUN_A_GATED=$(seed_run "$TENANT_A")
RUN_B=$(seed_run "$TENANT_B")

seed_candidate() {  # $1=run_id $2=tenant
  psql_q "INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature) \
    VALUES ('$1', '$2', '{}'::jsonb, 1.0, 'sig-$1') RETURNING id"
}
CAND_PENDING=$(seed_candidate "$RUN_A_PENDING" "$TENANT_A")
CAND_GATED=$(seed_candidate "$RUN_A_GATED" "$TENANT_A")
[ -n "$CAND_PENDING" ] && [ -n "$CAND_GATED" ] || fail "候选未建成"

# RUN_A_GATED：选了候选、渲染跑完，但安全 Gate 没过 → export_url 为 NULL
psql_q "UPDATE zenithjoy.mashup_runs SET selected_candidate_id = '$CAND_GATED' WHERE id = '$RUN_A_GATED'" >/dev/null
psql_q "INSERT INTO zenithjoy.contents (tenant_id, type, source_candidate_id, safety_check_status, watermark_check_status, export_url) \
  VALUES ('$TENANT_A', 'video', '$CAND_GATED', 'failed_pending_review', 'passed', NULL)" >/dev/null
ok "种子 run 已建成（候选待选定 1 条、被 Gate 拦下 1 条、B 租户 1 条）"

BODY_A=$(curl -sf -H "X-Upload-Token: $KEY_A" "$API_BASE/api/mashup/runs") || fail "GET /api/mashup/runs 请求失败"

echo "$BODY_A" | grep -q "$RUN_A_PENDING" || fail "A 租户看不到自己的 run $RUN_A_PENDING"
ok "A 租户看得到自己的 run"

echo "$BODY_A" | grep -q "$RUN_B" && fail "租户隔离破了：A 的凭据看到了 B 的 run $RUN_B"
ok "A 租户看不到 B 租户的 run（租户隔离成立）"

STAGE_GATED=$(echo "$BODY_A" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const r=d.data.items.find(i=>i.runId==='$RUN_A_GATED');
process.stdout.write(r?r.stage:'MISSING');
")
[ "$STAGE_GATED" = "rendering" ] \
  || fail "被安全 Gate 拦下的 run 应为 rendering（export_url 为空），实际 $STAGE_GATED"
ok "status=completed 但 export_url 为空 → stage=rendering，没被误报成已完成"

STAGE_PENDING=$(echo "$BODY_A" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const r=d.data.items.find(i=>i.runId==='$RUN_A_PENDING');
process.stdout.write(r?r.stage:'MISSING');
")
[ "$STAGE_PENDING" = "candidates_pending" ] \
  || fail "有候选未选定的 run 应为 candidates_pending，实际 $STAGE_PENDING"
ok "有候选未选定 → stage=candidates_pending"

curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/mashup/runs" | grep -q '^401$' \
  || fail "无凭据访问应回 401"
ok "无凭据 → 401"

psql_q "DELETE FROM zenithjoy.contents WHERE tenant_id IN ('$TENANT_A','$TENANT_B')" >/dev/null
psql_q "DELETE FROM zenithjoy.mashup_runs WHERE tenant_id IN ('$TENANT_A','$TENANT_B')" >/dev/null
psql_q "DELETE FROM zenithjoy.licenses WHERE license_key IN ('$KEY_A','$KEY_B')" >/dev/null
psql_q "DELETE FROM zenithjoy.tenants WHERE id IN ('$TENANT_A','$TENANT_B')" >/dev/null

echo "✅ PASS: mashup-history-smoke"
