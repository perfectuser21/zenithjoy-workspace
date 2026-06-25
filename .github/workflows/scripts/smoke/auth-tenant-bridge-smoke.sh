#!/usr/bin/env bash
# Better-auth → tenant_members 桥接 E2E Smoke (PR-2)
#
# 验证：
#   1. Bootstrap：建 tenant + 有效 license（idempotent psql）
#   2. 注册带 license_key → POST /api/auth/sign-up/email → 200
#   3. tenant_members 表插入了一行（feishu_user_id = better-auth user.id）
#   4. 用注册返回的 cookie GET /api/works → 200（不是 403 NO_TENANT）
#   5. 注册不带 license_key → 200，但 tenant_members 无新行 → 调 /api/works 应 403
#   6. 注册带无效 license_key → 200（不阻塞），但 tenant_members 无新行 → /api/works 应 403
#
# 依赖：API_BASE 默认 http://localhost:5200，better-auth + tenant_members 已建表

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
TENANT_BR_ID="cccccccc-1111-2222-3333-555555555555"
LICENSE_KEY="ZJ-PR2BRIDGE-VALID-001"
INVALID_LICENSE="ZJ-PR2BRIDGE-FAKE-XXXX"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

EMAIL_VALID="pr2-bridge-valid-$(date +%s)@example.com"
EMAIL_NOLIC="pr2-bridge-nolic-$(date +%s)@example.com"
EMAIL_INVALID="pr2-bridge-invalid-$(date +%s)@example.com"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Bb2"
COOKIE_VALID=$(mktemp)
COOKIE_NOLIC=$(mktemp)
COOKIE_INVALID=$(mktemp)

trap 'rm -f "$COOKIE_VALID" "$COOKIE_NOLIC" "$COOKIE_INVALID"' EXIT

echo "==> [bootstrap] 建 tenant + active license（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_BR_ID}', 'TenantBridge-Smoke', '${LICENSE_KEY}', 'matrix')
ON CONFLICT (license_key) DO NOTHING;

-- Gap2：模拟真实付费 license——admin 预先发放、customer_id 尚未回填（NULL，待客户注册认领）。
INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES ('${LICENSE_KEY}', 'matrix', 3, NULL, now() + interval '365 days', '${TENANT_BR_ID}', 'active')
ON CONFLICT (license_key) DO NOTHING;
-- 幂等重跑：把 customer_id 复位成 NULL（上轮已被回填时也能重测 Gap2）。
UPDATE zenithjoy.licenses SET customer_id = NULL WHERE license_key = '${LICENSE_KEY}';
EOF
echo "  OK: bootstrap 完成"

echo "==> [1/6] 注册带有效 license_key → POST /api/auth/sign-up/email"
RESP_1=$(curl -fsS -c "$COOKIE_VALID" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_VALID}\",\"password\":\"${PASSWORD}\",\"name\":\"PR2 Bridge Valid\",\"license_key\":\"${LICENSE_KEY}\"}" \
  "${API_BASE}/api/auth/sign-up/email")
USER_ID_VALID=$(echo "$RESP_1" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 64)
[ -n "$USER_ID_VALID" ] || { echo "  FAIL: 注册响应无 user.id  body=$RESP_1"; exit 1; }
echo "  OK: 注册成功 user.id=$USER_ID_VALID"

echo "==> [2/6] tenant_members 表应有新行（feishu_user_id = ${USER_ID_VALID}）"
COUNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenant_members WHERE tenant_id = '${TENANT_BR_ID}' AND feishu_user_id = '${USER_ID_VALID}';")
[ "$COUNT" = "1" ] || { echo "  FAIL: 期望 tenant_members 1 行，实际 ${COUNT}"; exit 1; }
echo "  OK: tenant_members 行已插入"

echo "==> [2b/6] Gap2：付费注册回填 licenses.customer_id = user.id（否则 download/account-me 按 customer_id 查不到 → 503）"
CID=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT customer_id FROM zenithjoy.licenses WHERE license_key = '${LICENSE_KEY}';")
[ "${CID}" = "${USER_ID_VALID}" ] || { echo "  FAIL: 期望 licenses.customer_id=${USER_ID_VALID} 实际 '${CID}'（Gap2 回填未生效）"; exit 1; }
echo "  OK: licenses.customer_id 已回填为 ${CID}（付费客户能下载 agent、Account 显示 license）"

echo "==> [2c/6] Gap4：付费注册即 owner（否则配不了自己客服机：cs/setup 要 owner/admin）"
# (a) DB：tenant_members.role 必须是 owner（不是 member）
ROLE=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT role FROM zenithjoy.tenant_members WHERE tenant_id = '${TENANT_BR_ID}' AND feishu_user_id = '${USER_ID_VALID}';")
[ "${ROLE}" = "owner" ] || { echo "  FAIL: 期望 tenant_members.role=owner 实际 '${ROLE}'（Gap4 未生效，付费客户配不了自己客服机）"; exit 1; }
echo "  OK: 付费用户 role=owner"
# (b) 行为：付费用户 cookie 调 cs/setup（owner/admin 闸）不得 403 NOT_ADMIN。
#     机器未注册 → setupCSByMachine 抛 SETUP_FAILED（400），证明已过了管理员角色闸（member 会先被 403 NOT_ADMIN 挡掉）。
SETUP_CODE=$(curl -s -o /tmp/cs-setup-gap4.json -w "%{http_code}" -b "$COOKIE_VALID" \
  -X PUT "${API_BASE}/api/wechat/cs/setup/mc_gap4_unreg_$$" \
  -H 'Content-Type: application/json' -d '{"persona":{}}')
NOT_ADMIN=$(jq -r '.error.code // .error // ""' /tmp/cs-setup-gap4.json 2>/dev/null || echo "")
[ "$SETUP_CODE" != "403" ] || { echo "  FAIL: 付费 owner 调 cs/setup 仍 403（${NOT_ADMIN}）——Gap4 角色闸没过"; cat /tmp/cs-setup-gap4.json; exit 1; }
echo "  OK: 付费 owner 过了 cs/setup 管理员闸（HTTP=${SETUP_CODE}，非 403 NOT_ADMIN）"

echo "==> [3/6] 用 cookie 调 GET /api/works → 应 200（不是 403 NO_TENANT）"
HTTP_3=$(curl -s -o /tmp/works-valid.json -w "%{http_code}" -b "$COOKIE_VALID" "${API_BASE}/api/works")
[ "$HTTP_3" = "200" ] || { echo "  FAIL: 期望 200 实际 ${HTTP_3} body=$(cat /tmp/works-valid.json)"; exit 1; }
echo "  OK: GET /api/works 返回 200"

echo "==> [4/6] 注册不带 license_key → PR-B 自动建 free tenant，用户为 owner"
RESP_4=$(curl -fsS -c "$COOKIE_NOLIC" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_NOLIC}\",\"password\":\"${PASSWORD}\",\"name\":\"PR2 Bridge NoLic\"}" \
  "${API_BASE}/api/auth/sign-up/email")
USER_ID_NOLIC=$(echo "$RESP_4" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 64)
[ -n "$USER_ID_NOLIC" ] || { echo "  FAIL: 无 license 注册响应无 user.id"; exit 1; }
# PR-B 改了行为：无 license 自动建 free tenant + owner role
COUNT_NOLIC=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenant_members WHERE feishu_user_id = '${USER_ID_NOLIC}' AND role = 'owner';")
[ "$COUNT_NOLIC" = "1" ] || { echo "  FAIL: 期望 free tenant owner 1 行，实际 ${COUNT_NOLIC} 行"; exit 1; }
HTTP_4B=$(curl -s -o /tmp/works-nolic.json -w "%{http_code}" -b "$COOKIE_NOLIC" "${API_BASE}/api/works")
[ "$HTTP_4B" = "200" ] || { echo "  FAIL: 期望 200 (free tenant) 实际 ${HTTP_4B}"; exit 1; }
echo "  OK: 无 license 自动 free tenant + owner，GET /api/works 200"

echo "==> [5/6] 注册带无效 license_key → 走 free fallback（不阻塞）"
RESP_5=$(curl -fsS -c "$COOKIE_INVALID" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_INVALID}\",\"password\":\"${PASSWORD}\",\"name\":\"PR2 Bridge Invalid\",\"license_key\":\"${INVALID_LICENSE}\"}" \
  "${API_BASE}/api/auth/sign-up/email")
USER_ID_INVALID=$(echo "$RESP_5" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 64)
[ -n "$USER_ID_INVALID" ] || { echo "  FAIL: 无效 license 应不阻塞注册"; exit 1; }
# PR-B 改了行为：无效 license 也走 free fallback
COUNT_INVALID=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenant_members WHERE feishu_user_id = '${USER_ID_INVALID}' AND role = 'owner';")
[ "$COUNT_INVALID" = "1" ] || { echo "  FAIL: 期望 free tenant owner 1 行，实际 ${COUNT_INVALID} 行"; exit 1; }
echo "  OK: 无效 license 走 free fallback（owner of free tenant）"

echo "==> [6/6] 向后兼容：用 X-Feishu-User-Id 头（无 cookie session）仍能访问"
# 注：这里用 multi-tenant-smoke 已建好的 Alice
ALICE_FEISHU_ID="ou_alice_smoke_001"
HTTP_6=$(curl -s -o /tmp/works-feishu.json -w "%{http_code}" \
  -H "X-Feishu-User-Id: ${ALICE_FEISHU_ID}" "${API_BASE}/api/works")
# Alice 可能 200 或 403（取决于 multi-tenant-smoke 是否在本次 CI 已跑过 bootstrap）
# 接受 200/403，但绝不能是 401（旧通道仍工作）
[ "$HTTP_6" != "401" ] || { echo "  FAIL: X-Feishu-User-Id 旧通道被破坏（401）"; exit 1; }
echo "  OK: X-Feishu-User-Id 旧通道仍工作（HTTP=$HTTP_6 != 401）"

echo "PASS auth-tenant-bridge-smoke (PR-2)"
