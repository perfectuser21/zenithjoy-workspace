#!/usr/bin/env bash
# PR-A — 超管会员管理 /admin/users E2E Smoke
#
# 验证：
#   1. 缺鉴权 → 401
#   2. 非 super-admin → 403
#   3. Bootstrap 一个 tenant + 通过 better-auth 注册一个用户
#   4. super-admin GET /api/admin/users → 200，结果含刚注册的 user
#   5. POST /api/admin/users/:userId/tenant-members → 200 + tenants 含新加 tenant
#   6. DELETE /api/admin/users/:userId/tenant-members/:tenantId → 200，DB 中无此行
#   7. DELETE /api/admin/users/:userId → 200，user 表无此行
#
# 依赖：
#   API_BASE         API 基础 URL（默认 http://localhost:5200）
#   ADMIN_FEISHU_ID  super-admin 飞书 ID（被 ADMIN_FEISHU_OPENIDS 接受）
#   PG{HOST,USER,PASSWORD,DATABASE} — psql 连接

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
ADMIN_FEISHU_ID="${ADMIN_FEISHU_ID:-ou_admin_smoke_999}"
USER_FEISHU_ID="${USER_FEISHU_ID:-ou_customer_smoke_001}"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

TENANT_ID="dddddddd-aaaa-bbbb-cccc-eeeeeeeeeeee"
LICENSE_KEY="ZJ-PR-A-ADMIN-USERS-SMK"
EMAIL="adminusers-smoke-$(date +%s)@example.com"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"

COOKIE_FILE=$(mktemp)
trap 'rm -f "$COOKIE_FILE"' EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PR-A admin-users smoke"
echo "  API: $API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "==> [1/7] GET /api/admin/users 缺鉴权 → 401"
HTTP_1=$(curl -s -o /tmp/au-1.json -w "%{http_code}" "${API_BASE}/api/admin/users")
[ "$HTTP_1" = "401" ] || { echo "  FAIL: 期望 401 实际 ${HTTP_1} body=$(cat /tmp/au-1.json)"; exit 1; }
echo "  OK: 401"

echo "==> [2/7] GET /api/admin/users 非 admin → 403"
HTTP_2=$(curl -s -o /tmp/au-2.json -w "%{http_code}" \
  -H "X-Feishu-User-Id: ${USER_FEISHU_ID}" \
  "${API_BASE}/api/admin/users")
[ "$HTTP_2" = "403" ] || { echo "  FAIL: 期望 403 实际 ${HTTP_2} body=$(cat /tmp/au-2.json)"; exit 1; }
echo "  OK: 403"

echo "==> [3/7] Bootstrap tenant + active license（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_ID}', 'AdminUsers-Smoke', '${LICENSE_KEY}', 'pro')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES ('${LICENSE_KEY}', 'matrix', 3, '', now() + interval '365 days', '${TENANT_ID}', 'active')
ON CONFLICT (license_key) DO NOTHING;
EOF
echo "  OK"

echo "==> [4/7] better-auth 注册新用户（不带 license_key，确保是裸用户）"
RESP_REG=$(curl -fsS -c "$COOKIE_FILE" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"AU Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email")
echo "  signup-resp: $RESP_REG"
USER_ID=$(echo "$RESP_REG" | python3 -c "import sys,json;d=json.load(sys.stdin);u=d.get('user') or d;print(u.get('id',''))")
[ -n "$USER_ID" ] || { echo "  FAIL: 注册响应无 user.id"; exit 1; }
echo "  OK: user.id=$USER_ID"

echo "==> [5/7] super-admin GET /api/admin/users?q=adminusers-smoke → 200 + users 含刚注册"
RESP_LIST=$(curl -fsS \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  "${API_BASE}/api/admin/users?q=adminusers-smoke")
echo "$RESP_LIST" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['success'], 'success != true'
emails=[u['email'] for u in d['data']['users']]
assert any('${EMAIL}' in e for e in emails), 'new user not in list: '+repr(emails)
print('  OK list:', d['data']['total'], 'matched, contains', '${EMAIL}')
"

echo "==> [6/7] POST /api/admin/users/:userId/tenant-members → 200，tenants 含 ${TENANT_ID}"
RESP_ADD=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  -d "{\"tenant_id\":\"${TENANT_ID}\",\"role\":\"member\"}" \
  "${API_BASE}/api/admin/users/${USER_ID}/tenant-members")
echo "  add-resp: $RESP_ADD"
echo "$RESP_ADD" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['success'], 'success!=true'
ts=[t['tenant_id'] for t in d['data']['tenants']]
assert '${TENANT_ID}' in ts, 'tenant not added: '+repr(ts)
print('  OK joined tenant')
"

# DB 校验
COUNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenant_members WHERE tenant_id='${TENANT_ID}' AND feishu_user_id='${USER_ID}';")
[ "$COUNT" = "1" ] || { echo "  FAIL: tenant_members 期望 1 行实际 ${COUNT}"; exit 1; }

echo "==> [7/7] DELETE tenant-member + DELETE user → 200，DB 无残留"
HTTP_DEL_TM=$(curl -s -o /tmp/au-7a.json -w "%{http_code}" -X DELETE \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  "${API_BASE}/api/admin/users/${USER_ID}/tenant-members/${TENANT_ID}")
[ "$HTTP_DEL_TM" = "200" ] || { echo "  FAIL: tenant-member DELETE 期望 200 实际 ${HTTP_DEL_TM}"; exit 1; }

COUNT2=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenant_members WHERE tenant_id='${TENANT_ID}' AND feishu_user_id='${USER_ID}';")
[ "$COUNT2" = "0" ] || { echo "  FAIL: 移除后期望 0 行实际 ${COUNT2}"; exit 1; }

HTTP_DEL_U=$(curl -s -o /tmp/au-7b.json -w "%{http_code}" -X DELETE \
  -H "X-Feishu-User-Id: ${ADMIN_FEISHU_ID}" \
  "${API_BASE}/api/admin/users/${USER_ID}")
[ "$HTTP_DEL_U" = "200" ] || { echo "  FAIL: user DELETE 期望 200 实际 ${HTTP_DEL_U} body=$(cat /tmp/au-7b.json)"; exit 1; }

COUNT3=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM \"user\" WHERE id='${USER_ID}';")
[ "$COUNT3" = "0" ] || { echo "  FAIL: user 删除后期望 0 行实际 ${COUNT3}"; exit 1; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  All admin-users smoke scenarios passed (7/7)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
