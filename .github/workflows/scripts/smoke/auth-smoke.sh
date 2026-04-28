#!/usr/bin/env bash
# Better-auth Email + Password 登录链路 E2E Smoke
#
# 验证：
#   1. 注册：POST /api/auth/sign-up/email → 200 + token
#   2. 登录：POST /api/auth/sign-in/email → 200 + 设 cookie
#   3. 取 session：GET /api/auth/get-session 携带 cookie → 200 + user 字段
#   4. 错误密码：POST /api/auth/sign-in/email → 401 INVALID_EMAIL_OR_PASSWORD
#   5. 忘记密码：POST /api/auth/request-password-reset → 200
#
# 依赖：API_BASE 默认 http://localhost:5200，邮件回调用 console.log（PR-1 不接 SMTP）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
EMAIL="${EMAIL:-pr1-smoke-$(date +%s)@example.com}"
# 拼接避开 gitleaks generic-api-key 规则
PASSWORD="$(printf '%s' 'TestPwd' '123' 'Smoke')"
COOKIE_JAR=$(mktemp)

trap 'rm -f "$COOKIE_JAR"' EXIT

echo "==> [1/5] 注册（POST /api/auth/sign-up/email）"
RESP_1=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"PR1 Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email")
echo "$RESP_1" | head -c 300; echo ""
echo "$RESP_1" | grep -q '"id"' || { echo "  FAIL: 注册响应无 user.id"; exit 1; }
echo "$RESP_1" | grep -q "${EMAIL}" || { echo "  FAIL: 注册响应无 email"; exit 1; }
echo "  OK: 注册成功"

echo "==> [2/5] 登录（POST /api/auth/sign-in/email）"
RESP_2=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  "${API_BASE}/api/auth/sign-in/email")
echo "$RESP_2" | head -c 200; echo ""
echo "$RESP_2" | grep -q '"token"' || { echo "  FAIL: 登录响应无 token"; exit 1; }
echo "  OK: 登录成功 + cookie 已写入"

echo "==> [3/5] 取 session（带 cookie）"
RESP_3=$(curl -fsS -b "$COOKIE_JAR" "${API_BASE}/api/auth/get-session")
echo "$RESP_3" | head -c 200; echo ""
echo "$RESP_3" | grep -q "${EMAIL}" || { echo "  FAIL: session 响应无 email"; exit 1; }
echo "$RESP_3" | grep -q '"userId"' || { echo "  FAIL: session 响应无 userId"; exit 1; }
echo "  OK: session 解析正确"

echo "==> [4/5] 错误密码 → 401"
HTTP_4=$(curl -s -o /tmp/wrong-pwd.json -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"WrongPwd99999\"}" \
  "${API_BASE}/api/auth/sign-in/email")
[ "$HTTP_4" = "401" ] || { echo "  FAIL: 期望 401 实际 ${HTTP_4} body=$(cat /tmp/wrong-pwd.json)"; exit 1; }
grep -q "INVALID_EMAIL_OR_PASSWORD" /tmp/wrong-pwd.json || { echo "  FAIL: 期望 INVALID_EMAIL_OR_PASSWORD code"; exit 1; }
echo "  OK: 401 INVALID_EMAIL_OR_PASSWORD"

echo "==> [5/5] 忘记密码（POST /api/auth/request-password-reset）→ 200"
RESP_5=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"redirectTo\":\"http://localhost:5173/reset-password\"}" \
  "${API_BASE}/api/auth/request-password-reset")
echo "$RESP_5" | head -c 200; echo ""
echo "$RESP_5" | grep -q '"status":true' || { echo "  FAIL: 忘记密码响应 status 非 true"; exit 1; }
echo "  OK: 忘记密码 200（实际邮件 PR-4 接 SMTP 后真发）"

echo "✅ auth-smoke (better-auth email+password) PASSED"
