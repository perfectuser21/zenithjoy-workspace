#!/usr/bin/env bash
# Free Tier 自动 Onboarding E2E Smoke (PR-B)
#
# 主理人 2026-04-29 决策：注册即试用
#   - 不带 license_key 注册 → 自动创建 free license + free tenant
#   - 用户成为该 tenant 的 owner
#   - 调 /api/works 应返回 200（不是 PR-2 的 403 NO_TENANT）
#   - free tier max_machines=0，Agent 注册会被 QUOTA_EXCEEDED 拒绝（PR #226 已实现）
#
# 验证：
#   1. 注册不带 license_key → POST /api/auth/sign-up/email → 200
#   2. licenses 表新增一行 tier='free'，max_machines=0，customer_id=user.id
#   3. tenants 表新增一行 plan='free'，license_key 与 step 2 一致
#   4. tenant_members 表插入一行 role='owner'
#   5. 用 cookie 调 GET /api/works → 200（不是 403 NO_TENANT），data 是数组
#   6. 注册带无效 license_key → 不阻塞，fallback 走 free 流程，仍能访问 /api/works
#
# 依赖：API_BASE 默认 http://localhost:5200，better-auth + tenants/licenses/tenant_members 已建表

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
INVALID_LICENSE="ZJ-FREEONB-NOPE-XXXX"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

EMAIL_FREE="free-onb-$(date +%s)@example.com"
EMAIL_INVALID="free-onb-invalid-$(date +%s)@example.com"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Bb2"
COOKIE_FREE=$(mktemp)
COOKIE_INVALID=$(mktemp)

trap 'rm -f "$COOKIE_FREE" "$COOKIE_INVALID"' EXIT

echo "==> [1/6] 注册不带 license_key → POST /api/auth/sign-up/email"
RESP_1=$(curl -fsS -c "$COOKIE_FREE" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_FREE}\",\"password\":\"${PASSWORD}\",\"name\":\"FreeTier Onb\"}" \
  "${API_BASE}/api/auth/sign-up/email")
USER_ID_FREE=$(echo "$RESP_1" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 64)
[ -n "$USER_ID_FREE" ] || { echo "  FAIL: 注册响应无 user.id  body=$RESP_1"; exit 1; }
echo "  OK: 注册成功 user.id=$USER_ID_FREE"

# 给 hooks.after 一点时间完成桥接（同进程同事务，但 better-auth response 已返回，给保险一秒）
sleep 1

echo "==> [2/6] licenses 表应有 tier='free' max_machines=0 customer_id=$USER_ID_FREE 行"
LIC_COUNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.licenses WHERE tier='free' AND max_machines=0 AND customer_id='${USER_ID_FREE}';")
[ "$LIC_COUNT" = "1" ] || { echo "  FAIL: 期望 1 行 free license，实际 ${LIC_COUNT}"; exit 1; }
LIC_KEY_FREE=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT license_key FROM zenithjoy.licenses WHERE customer_id='${USER_ID_FREE}' AND tier='free' LIMIT 1;")
[[ "$LIC_KEY_FREE" =~ ^ZJ-F-[A-Z2-9]{8}$ ]] || { echo "  FAIL: free key 格式错: $LIC_KEY_FREE"; exit 1; }
echo "  OK: free license 已创建 key=$LIC_KEY_FREE"

echo "==> [3/6] tenants 表应有 plan='free' license_key=$LIC_KEY_FREE 行"
TEN_COUNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenants WHERE plan='free' AND license_key='${LIC_KEY_FREE}';")
[ "$TEN_COUNT" = "1" ] || { echo "  FAIL: 期望 1 行 free tenant，实际 ${TEN_COUNT}"; exit 1; }
TENANT_ID_FREE=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT id FROM zenithjoy.tenants WHERE license_key='${LIC_KEY_FREE}' LIMIT 1;")
echo "  OK: free tenant id=$TENANT_ID_FREE"

echo "==> [4/6] tenant_members 应有 (tenant=$TENANT_ID_FREE, user=$USER_ID_FREE, role='owner') 行"
MEM_COUNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.tenant_members WHERE tenant_id='${TENANT_ID_FREE}' AND feishu_user_id='${USER_ID_FREE}' AND role='owner';")
[ "$MEM_COUNT" = "1" ] || { echo "  FAIL: 期望 1 行 owner tenant_members，实际 ${MEM_COUNT}"; exit 1; }
echo "  OK: 用户作为 owner 加入 free tenant"

echo "==> [5/6] 用 cookie 调 GET /api/works → 应 200（不是 403 NO_TENANT）"
HTTP_5=$(curl -s -o /tmp/works-free.json -w "%{http_code}" -b "$COOKIE_FREE" "${API_BASE}/api/works")
[ "$HTTP_5" = "200" ] || { echo "  FAIL: 期望 200 实际 ${HTTP_5} body=$(cat /tmp/works-free.json)"; exit 1; }
grep -q '"data"' /tmp/works-free.json || { echo "  FAIL: 响应缺 data 字段"; exit 1; }
echo "  OK: GET /api/works 返回 200（free tenant 已可用）"

echo "==> [6/6] 注册带无效 license_key → fallback 走 free 流程"
RESP_6=$(curl -fsS -c "$COOKIE_INVALID" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_INVALID}\",\"password\":\"${PASSWORD}\",\"name\":\"FreeTier Invalid\",\"license_key\":\"${INVALID_LICENSE}\"}" \
  "${API_BASE}/api/auth/sign-up/email")
USER_ID_INVALID=$(echo "$RESP_6" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 64)
[ -n "$USER_ID_INVALID" ] || { echo "  FAIL: 无效 license 应不阻塞注册"; exit 1; }
sleep 1
INV_FREE_COUNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT count(*) FROM zenithjoy.licenses WHERE tier='free' AND customer_id='${USER_ID_INVALID}';")
[ "$INV_FREE_COUNT" = "1" ] || { echo "  FAIL: 无效 license 应 fallback 创建 free，实际 ${INV_FREE_COUNT} 行"; exit 1; }
HTTP_6B=$(curl -s -o /tmp/works-invalid.json -w "%{http_code}" -b "$COOKIE_INVALID" "${API_BASE}/api/works")
[ "$HTTP_6B" = "200" ] || { echo "  FAIL: fallback 后 /api/works 期望 200 实际 ${HTTP_6B}"; exit 1; }
echo "  OK: 无效 license fallback 成功（free tenant 已建）"

echo "PASS free-tier-onboarding-smoke (PR-B)"
