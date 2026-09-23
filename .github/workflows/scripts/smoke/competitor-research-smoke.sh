#!/usr/bin/env bash
# competitor-research-smoke.sh — 竞品调研 smoke（crm_scraping）
# 验证：start job / poll status / results 链路
#
# 2026-09-23（credits-recharge-payment PR）：/start 现在挂了 tenantContext +
# createCreditCharger('competitor_research')（每次扣 10 积分，按租户），
# 未鉴权会 401。照抄 credits-smoke.sh 的写法：psql 幂等 bootstrap 一个专属
# 测试 tenant + tenant_member + 充足积分，用 X-Feishu-User-Id 头鉴权，
# 断言严格 200（而不是放宽成"200 或 402 都算活着"）——因为余额是我们自己
# 灌的、完全可控，没有理由不测完整成功路径。
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

TENANT_ID="eeeeeeee-cccc-dddd-eeee-ffffffffffff"
FEISHU_USER_ID="ou_competitor_research_smoke_001"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

echo "── competitor-research-bootstrap ──"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_ID}', 'Tenant-CompetitorResearchSmoke', 'ZJ-CRSMOKE-COMPRES01', 'free')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES ('${TENANT_ID}', '${FEISHU_USER_ID}', 'owner')
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;

-- 幂等充值：每次跑都重置到固定余额，够多次 /start 调用（每次扣 10）
INSERT INTO zenithjoy.tenant_credits (tenant_id, balance, total_recharged, total_consumed)
VALUES ('${TENANT_ID}', 1000, 1000, 0)
ON CONFLICT (tenant_id) DO UPDATE SET balance = 1000, total_recharged = 1000, total_consumed = 0;
EOF
ok "bootstrap tenant + 充值 1000 积分"

echo "── competitor-research-start ──"
r=$(curl -s -X POST "$API/api/competitor-research/start" \
    -H "Content-Type: application/json" \
    -H "X-Feishu-User-Id: ${FEISHU_USER_ID}" \
    -d '{"query":"smoke test competitor research"}')
echo "$r" | jq -e '.jobId != null' >/dev/null 2>&1 \
  && ok "POST /competitor-research/start 返回 jobId" \
  || fail "POST /competitor-research/start 失败 ($r)"

JOB_ID=$(echo "$r" | jq -r '.jobId // empty')

if [[ -n "$JOB_ID" ]]; then
  echo "── competitor-research-status ──"
  r2=$(curl -s "$API/api/competitor-research/status/$JOB_ID")
  echo "$r2" | jq -e '.status != null' >/dev/null 2>&1 \
    && ok "GET /competitor-research/status/:jobId 返回 status 字段 ($(echo "$r2" | jq -r '.status'))" \
    || fail "GET /competitor-research/status/:jobId 响应异常 ($r2)"

  echo "── competitor-research-results-404-before-done ──"
  # 刚开始的 job 未完成时 results 应返回 404 或空数据，验证端点存在
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/competitor-research/results/$JOB_ID")
  [[ "$http_code" != "000" ]] \
    && ok "GET /competitor-research/results/:jobId 端点可达 (HTTP $http_code)" \
    || fail "GET /competitor-research/results/:jobId 不可达"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ competitor-research smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
