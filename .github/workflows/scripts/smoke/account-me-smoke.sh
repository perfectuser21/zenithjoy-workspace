#!/usr/bin/env bash
# account-me-smoke.sh
# Walking Skeleton #1 — license loop 修复：客户注册后能在 Dashboard 看到自己的 license
#
# 验证链路：
#   1. POST /api/auth/sign-up/email             注册（auth-bridge 自动建 free license）
#   2. GET  /api/account/me                     带 cookie → 返 license.license_key
#   3. SQL 反查 zenithjoy.licenses              确认 max_machines=1（free=0 → 1 已生效）
#
# 退出码：
#   0  全过
#   1  Step 1 register 失败
#   2  Step 2 /api/account/me 401 / 没拿到 license_key
#   3  Step 3 max_machines 不是 1
#
# 依赖：
#   API_BASE 默认 http://localhost:5200
#   PG* 凭据：从环境变量 PGUSER/PGPASSWORD/PGHOST/PGDATABASE 读取
#
# 安全说明（DeepSeek-clarification）：
#   这是 dev/CI 用的 smoke 脚本，PG 凭据通过**环境变量**传入（不是硬编码）。
#   ":-cecelia" 只是 zenithjoy 本地开发栈的默认值（CI runner 的 docker-compose
#   pg 默认账号）。生产环境跑此脚本必须 export PGUSER/PGPASSWORD/PGHOST 真凭据，
#   defaults 不会触达任何生产/客户数据。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
# 从 env vars 读取，dev 默认值见上方安全说明
PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

TS=$(date +%s)
EMAIL="account-me-${TS}@zenithjoy.test"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

run_psql() {
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 -t -A "$@"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Walking Skeleton #1 — /api/account/me license loop smoke"
echo "  email=${EMAIL}"
echo "  API_BASE=${API_BASE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Step 1：注册（cookie 落到 jar，better-auth autoSignIn=true）
echo "▶ [1/3] POST /api/auth/sign-up/email"
RESP_1=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"AcctMe Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email" 2>/tmp/account-me-step1.err) || {
  echo "  FAIL: sign-up HTTP failed"
  cat /tmp/account-me-step1.err
  exit 1
}
USER_ID=$(echo "$RESP_1" | python3 -c "import sys,json;d=json.load(sys.stdin);u=d.get('user') or d;print(u.get('id') or '')" 2>/dev/null || true)
[ -z "$USER_ID" ] && { echo "  FAIL: sign-up 响应无 user.id ($RESP_1)"; exit 1; }
# 给 hooks.after 跑完
sleep 1
echo "  OK: user_id=${USER_ID:0:8}…"

# ─── Step 2：/api/account/me 带 cookie 取 license（产品断点本体）
echo "▶ [2/3] GET /api/account/me（带 cookie）"
RESP_2=$(curl -fsS -b "$COOKIE_JAR" -X GET \
  -H "Accept: application/json" \
  "${API_BASE}/api/account/me" 2>/tmp/account-me-step2.err) || {
  echo "  FAIL: /api/account/me HTTP failed"
  cat /tmp/account-me-step2.err
  exit 2
}
LICENSE_KEY=$(echo "$RESP_2" | python3 -c "import sys,json;d=json.load(sys.stdin);l=d.get('license') or {};print(l.get('license_key') or '')" 2>/dev/null || true)
TIER=$(echo "$RESP_2" | python3 -c "import sys,json;d=json.load(sys.stdin);l=d.get('license') or {};print(l.get('tier') or '')" 2>/dev/null || true)
MAX_MACHINES=$(echo "$RESP_2" | python3 -c "import sys,json;d=json.load(sys.stdin);l=d.get('license') or {};print(l.get('max_machines') or '')" 2>/dev/null || true)
if [ -z "$LICENSE_KEY" ]; then
  echo "  FAIL: /api/account/me 响应无 license.license_key"
  echo "  body=$RESP_2"
  exit 2
fi
echo "  OK: license_key=${LICENSE_KEY} tier=${TIER} max_machines=${MAX_MACHINES}"

# 二次断言：tier=free + max_machines=1（产品断点 #2 已修）
[ "$TIER" = "free" ] || { echo "  FAIL: 期望 tier=free，实际 ${TIER}"; exit 2; }
[ "$MAX_MACHINES" = "1" ] || { echo "  FAIL: 期望 max_machines=1，实际 ${MAX_MACHINES}（migration 未跑？）"; exit 3; }

# ─── Step 3：DB 二次校验（防 API 撒谎）
echo "▶ [3/3] SQL 反查 zenithjoy.licenses 校验 max_machines=1"
DB_MAX=$(run_psql -c "SELECT max_machines FROM zenithjoy.licenses WHERE customer_id='${USER_ID}' AND tier='free' ORDER BY created_at DESC LIMIT 1;")
[ "$DB_MAX" = "1" ] || { echo "  FAIL: DB max_machines='${DB_MAX}'，期望 1"; exit 3; }
echo "  OK: DB max_machines=${DB_MAX}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Walking Skeleton #1 license loop PASS"
echo "  Dashboard 现在能拿到客户的 free license_key + Agent 装机配额=1"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
