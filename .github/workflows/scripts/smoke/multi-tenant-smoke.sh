#!/usr/bin/env bash
# Tenant 统一隔离 E2E Smoke (v2 — 2026-04-28 主理人决策)
#
# 验证：
#   1. 同 tenant 内多个用户共享作品（Alice 创作 → Bob 看得到）
#   2. 跨 tenant 隔离（公司 B 的 Carol 看不到公司 A 的作品）
#   3. 缺鉴权 401 / 用户无 tenant 关联 403 NO_TENANT
#   4. super-admin X-Bypass-Tenant=true 看到全部
#
# Bootstrap（idempotent）：用 psql 创建 2 tenant + 2 license + 3 tenant_member
#   - Tenant A：Alice (owner) + Bob (member) 共享
#   - Tenant B：Carol (owner) 独享
#   - Dave：注册过但未关联任何 tenant（验证 NO_TENANT 错误）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
ADMIN_FEISHU_ID="${ADMIN_FEISHU_ID:-ou_admin_smoke_999}"
ALICE_FEISHU_ID="ou_alice_tu_001"
BOB_FEISHU_ID="ou_bob_tu_002"
CAROL_FEISHU_ID="ou_carol_tu_003"
DAVE_FEISHU_ID="ou_dave_tu_004"
TENANT_A_ID="aaaaaaaa-1111-2222-3333-444444444444"
TENANT_B_ID="bbbbbbbb-1111-2222-3333-444444444444"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

echo "==> [bootstrap] 创建 2 tenant + 2 license + 3 member（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES
  ('${TENANT_A_ID}', 'TenantA-Smoke', 'ZJ-TUSMOKE-A0000001', 'matrix'),
  ('${TENANT_B_ID}', 'TenantB-Smoke', 'ZJ-TUSMOKE-B0000001', 'matrix')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES
  ('ZJ-TUSMOKE-A0000001', 'matrix', 3, '${ALICE_FEISHU_ID}', now() + interval '365 days', '${TENANT_A_ID}', 'active'),
  ('ZJ-TUSMOKE-B0000001', 'matrix', 3, '${CAROL_FEISHU_ID}', now() + interval '365 days', '${TENANT_B_ID}', 'active')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES
  ('${TENANT_A_ID}', '${ALICE_FEISHU_ID}', 'owner'),
  ('${TENANT_A_ID}', '${BOB_FEISHU_ID}', 'member'),
  ('${TENANT_B_ID}', '${CAROL_FEISHU_ID}', 'owner')
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;
EOF
echo "  OK: bootstrap 完成"

echo "==> [1/8] 缺 X-Feishu-User-Id 头 → 401"
HTTP_1=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/works")
[ "$HTTP_1" = "401" ] || { echo "  FAIL: 期望 401 实际 ${HTTP_1}"; exit 1; }
echo "  OK: 401"

echo "==> [2/8] 未关联 tenant 的用户 (Dave) → 403 NO_TENANT"
RESP_2=$(curl -s -w "\n%{http_code}" -H "X-Feishu-User-Id: ${DAVE_FEISHU_ID}" "${API_BASE}/api/works")
CODE_2=$(echo "$RESP_2" | tail -n1)
BODY_2=$(echo "$RESP_2" | sed '$d')
[ "$CODE_2" = "403" ] || { echo "  FAIL: 期望 403 实际 ${CODE_2} body=${BODY_2}"; exit 1; }
echo "$BODY_2" | grep -q "NO_TENANT" || { echo "  FAIL: 期望 error.code=NO_TENANT body=${BODY_2}"; exit 1; }
echo "  OK: 403 NO_TENANT"

echo "==> [3/8] Alice 创建作品（Tenant A）"
RESP_3=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${ALICE_FEISHU_ID}" \
  -d '{"title":"Alice TUSmoke 作品","content_type":"video","body":"alice"}' \
  "${API_BASE}/api/works")
A_WORK_ID=$(echo "$RESP_3" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 36)
[ -n "$A_WORK_ID" ] || { echo "  FAIL: 创建后无 id"; exit 1; }
echo "  OK: A_WORK_ID=$A_WORK_ID"
echo "$RESP_3" | grep -q "${ALICE_FEISHU_ID}" || { echo "  FAIL: owner_id 应是 Alice"; exit 1; }
echo "$RESP_3" | grep -q "${TENANT_A_ID}" || { echo "  FAIL: tenant_id 应是 Tenant A"; exit 1; }
echo "  OK: owner_id=Alice tenant_id=A"

echo "==> [4/8] Bob（同 tenant 不同用户）应该看到 Alice 的作品"
RESP_4=$(curl -fsS -H "X-Feishu-User-Id: ${BOB_FEISHU_ID}" "${API_BASE}/api/works?limit=50")
echo "$RESP_4" | grep -q "Alice TUSmoke" || { echo "  FAIL: Bob 应看到 Alice 的作品（同 tenant）"; exit 1; }
echo "  OK: Bob 看到 Alice 的作品（tenant 共享 ✓）"

echo "==> [5/8] Carol（不同 tenant）应该看不到 Alice 的作品"
RESP_5=$(curl -fsS -H "X-Feishu-User-Id: ${CAROL_FEISHU_ID}" "${API_BASE}/api/works?limit=50")
if echo "$RESP_5" | grep -q "Alice TUSmoke"; then
  echo "  FAIL: Carol 不应看到 Alice 的作品（跨 tenant 泄漏）"
  exit 1
fi
echo "  OK: Carol 看不到 Alice 的作品（跨 tenant 隔离 ✓）"

echo "==> [6/8] Carol GET /api/works/<Alice 的 id> 应 404（不暴露存在性）"
HTTP_6=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Feishu-User-Id: ${CAROL_FEISHU_ID}" \
  "${API_BASE}/api/works/${A_WORK_ID}")
[ "$HTTP_6" = "404" ] || { echo "  FAIL: 期望 404 实际 ${HTTP_6}"; exit 1; }
echo "  OK: 跨 tenant GET-by-id 返回 404"

echo "==> [7/8] Carol 创建作品（Tenant B）+ Bob 看不到"
curl -fsS -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${CAROL_FEISHU_ID}" \
  -d '{"title":"Carol TUSmoke 作品","content_type":"video","body":"carol"}' \
  "${API_BASE}/api/works" >/dev/null
RESP_7B=$(curl -fsS -H "X-Feishu-User-Id: ${BOB_FEISHU_ID}" "${API_BASE}/api/works?limit=50")
if echo "$RESP_7B" | grep -q "Carol TUSmoke"; then
  echo "  FAIL: Bob 不应看到 Carol 的作品"
  exit 1
fi
echo "  OK: Bob 看不到 Carol 的作品"

echo "==> [8/8] super-admin X-Bypass-Tenant=true 看到全部"
RESP_8=$(curl -fsS \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  -H "X-Bypass-Tenant: true" \
  "${API_BASE}/api/works?limit=50")
echo "$RESP_8" | grep -q "Alice TUSmoke" || { echo "  FAIL: bypass 未看到 Alice"; exit 1; }
echo "$RESP_8" | grep -q "Carol TUSmoke" || { echo "  FAIL: bypass 未看到 Carol"; exit 1; }
echo "  OK: bypass 看到 A+B 全部"

echo "✅ multi-tenant-smoke (v2 tenant-level) PASSED"
