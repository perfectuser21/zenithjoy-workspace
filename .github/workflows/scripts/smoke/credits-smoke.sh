#!/usr/bin/env bash
# Credits Foundation E2E Smoke (PR-C)
#
# 验证：
#   1. 新 tenant + 默认 0 余额（PR-B 才送 100，本 PR 只做基建）
#   2. psql bootstrap 给 tenant 充 100 积分（模拟 PR-B 注册赠送）
#   3. tenant 用户 GET /api/credits/balance → 100
#   4. super-admin POST /api/credits/recharge +50 → 余额 150
#   5. tenant 用户 GET /api/credits/transactions → ≥ 2 条记录
#   6. 非 admin 调 /recharge → 403/401
#   7. 缺鉴权 GET /balance → 401
#
# 前置：
#   - apps/api 已启动监听 ${API_BASE:-http://localhost:5200}
#   - Postgres zenithjoy schema + credits migration 已跑
#   - ADMIN_FEISHU_OPENIDS 已含 ${ADMIN_FEISHU_ID}
#
# 退出码：0 = 全部通过，非 0 = 任一场景失败

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
ADMIN_FEISHU_ID="${ADMIN_FEISHU_ID:-ou_admin_smoke_999}"
TENANT_USER_FEISHU_ID="ou_credits_smoke_user_001"
TENANT_C_ID="cccccccc-1111-2222-3333-555555555555"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Credits Foundation E2E Smoke (PR-C)"
echo "  API: $API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "==> [bootstrap] 创建 tenant + member + 充 100 积分（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_C_ID}', 'TenantC-CreditsSmoke', 'ZJ-CRSMOKE-C0000001', 'free')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES ('${TENANT_C_ID}', '${TENANT_USER_FEISHU_ID}', 'owner')
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;

-- 模拟 PR-B 的 initial_grant：先清 + 重置（idempotent smoke）
DELETE FROM zenithjoy.credit_transactions WHERE tenant_id = '${TENANT_C_ID}';
DELETE FROM zenithjoy.tenant_credits     WHERE tenant_id = '${TENANT_C_ID}';

INSERT INTO zenithjoy.tenant_credits (tenant_id, balance, total_recharged, total_consumed)
VALUES ('${TENANT_C_ID}', 100, 100, 0);

INSERT INTO zenithjoy.credit_transactions (tenant_id, amount, reason)
VALUES ('${TENANT_C_ID}', 100, 'initial_grant');
EOF
echo "  OK: bootstrap 完成（balance=100）"

echo ""
echo "==> [1/6] 缺鉴权 GET /api/credits/balance → 401"
HTTP_1=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/credits/balance")
[ "$HTTP_1" = "401" ] || { echo "  FAIL: 期望 401 实际 ${HTTP_1}"; exit 1; }
echo "  OK: 401"

echo ""
echo "==> [2/6] tenant 用户 GET /api/credits/balance → 200 + balance=100"
RESP_2=$(curl -fsS \
  -H "X-Feishu-User-Id: ${TENANT_USER_FEISHU_ID}" \
  "${API_BASE}/api/credits/balance")
echo "$RESP_2"
echo "$RESP_2" | grep -q '"balance":100' || { echo "  FAIL: 期望 balance=100"; exit 1; }
echo "  OK: balance=100"

echo ""
echo "==> [3/6] 非 admin POST /api/credits/recharge → 403"
HTTP_3=$(curl -s -o /tmp/credits-smoke-403.json -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${TENANT_USER_FEISHU_ID}" \
  -d "{\"tenant_id\":\"${TENANT_C_ID}\",\"amount\":50,\"reason\":\"recharge\"}" \
  "${API_BASE}/api/credits/recharge")
cat /tmp/credits-smoke-403.json
echo ""
[ "$HTTP_3" = "403" ] || { echo "  FAIL: 期望 403 实际 ${HTTP_3}"; exit 1; }
echo "  OK: 非 admin 403"

echo ""
echo "==> [4/6] super-admin POST /api/credits/recharge +50 → 余额 150"
RESP_4=$(curl -fsS \
  -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  -d "{\"tenant_id\":\"${TENANT_C_ID}\",\"amount\":50,\"reason\":\"recharge\"}" \
  "${API_BASE}/api/credits/recharge")
echo "$RESP_4"
echo "$RESP_4" | grep -q '"balance":150' || { echo "  FAIL: 期望 balance=150"; exit 1; }
echo "  OK: balance=150"

echo ""
echo "==> [5/6] tenant 用户 GET /api/credits/balance → 150"
RESP_5=$(curl -fsS \
  -H "X-Feishu-User-Id: ${TENANT_USER_FEISHU_ID}" \
  "${API_BASE}/api/credits/balance")
echo "$RESP_5"
echo "$RESP_5" | grep -q '"balance":150' || { echo "  FAIL: 期望充值后 balance=150"; exit 1; }
echo "  OK: 充值后 balance=150"

echo ""
echo "==> [6/6] tenant 用户 GET /api/credits/transactions → ≥ 2 条记录"
RESP_6=$(curl -fsS \
  -H "X-Feishu-User-Id: ${TENANT_USER_FEISHU_ID}" \
  "${API_BASE}/api/credits/transactions?limit=50")
echo "$RESP_6"
TX_COUNT=$(echo "$RESP_6" | grep -o '"id"' | wc -l | tr -d ' ')
[ "$TX_COUNT" -ge 2 ] || { echo "  FAIL: 期望至少 2 条 transaction，得 ${TX_COUNT}"; exit 1; }
echo "$RESP_6" | grep -q "initial_grant" || { echo "  FAIL: 缺 initial_grant 记录"; exit 1; }
echo "$RESP_6" | grep -q "recharge"      || { echo "  FAIL: 缺 recharge 记录"; exit 1; }
echo "  OK: transactions=${TX_COUNT}（含 initial_grant + recharge）"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Credits smoke PASSED (6/6)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
