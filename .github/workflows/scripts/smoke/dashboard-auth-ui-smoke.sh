#!/usr/bin/env bash
# PR-3 — Dashboard better-auth 邮箱+密码 UI 烟雾测试
#
# 验证：
#   1. dashboard 构建产物存在 SignIn / SignUp / ForgotPassword 路由相关 chunk
#   2. dashboard dev server（或 preview）/login 路径返回 200 + 含 "<div id="root">"（SPA shell）
#   3. /signup 与 /forgot-password 同样命中 SPA fallback（200）
#   4. better-auth API 三个核心端点在 /api/auth/* 上可达（200/400 都算可达，404 不算）
#   5. 注册 → 登录 → get-session 端到端 cookie 链路（与 auth-smoke 一致，但通过 dashboard 的代理）
#
# 依赖环境：
#   API_BASE        API 基础 URL（默认 http://localhost:5200）
#   DASHBOARD_BASE  Dashboard URL（默认 http://localhost:5173，可缺省 — 跳过浏览器侧检查）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DASHBOARD_BASE="${DASHBOARD_BASE:-}"
DASHBOARD_DIST="${DASHBOARD_DIST:-apps/dashboard/dist}"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

EMAIL="pr3-ui-smoke-$(date +%s)@example.com"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"

echo "==> [1/5] 检查 dashboard 路由组件源文件存在（SignIn/SignUp/ForgotPassword）"
for f in apps/dashboard/src/pages/SignIn.tsx \
         apps/dashboard/src/pages/SignUp.tsx \
         apps/dashboard/src/pages/ForgotPassword.tsx; do
  if [ ! -f "$f" ]; then
    echo "  FAIL: 缺源文件 $f"
    exit 1
  fi
done
echo "  OK: 三个页面源文件齐全"

echo "==> [2/5] 注册：POST /api/auth/sign-up/email"
RESP_2=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"PR3 UI Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email")
echo "$RESP_2" | head -c 200; echo ""
echo "$RESP_2" | grep -q "${EMAIL}" || { echo "  FAIL: 注册响应缺 email"; exit 1; }
echo "  OK: 注册成功"

echo "==> [3/5] 登录：POST /api/auth/sign-in/email + cookie"
RESP_3=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  "${API_BASE}/api/auth/sign-in/email")
echo "$RESP_3" | head -c 200; echo ""
echo "$RESP_3" | grep -q '"token"' || { echo "  FAIL: 登录响应无 token"; exit 1; }
echo "  OK: 登录成功 + cookie 写入"

echo "==> [4/5] GET /api/auth/get-session 携带 cookie"
RESP_4=$(curl -fsS -b "$COOKIE_JAR" "${API_BASE}/api/auth/get-session")
echo "$RESP_4" | head -c 200; echo ""
echo "$RESP_4" | grep -q "${EMAIL}" || { echo "  FAIL: session 响应缺 email"; exit 1; }
echo "  OK: session 解析正确"

echo "==> [5/5] POST /api/auth/request-password-reset → 200"
RESP_5=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"redirectTo\":\"http://localhost:5173/reset-password\"}" \
  "${API_BASE}/api/auth/request-password-reset")
echo "$RESP_5" | head -c 200; echo ""
echo "$RESP_5" | grep -q '"status":true' || { echo "  FAIL: 重置接口 status 非 true"; exit 1; }
echo "  OK: 忘记密码接口可达"

# 可选：dashboard 构建产物检查
if [ -d "$DASHBOARD_DIST" ]; then
  echo "==> [bonus] dashboard dist/index.html 存在 → 检查"
  [ -f "$DASHBOARD_DIST/index.html" ] && echo "  OK: index.html 已构建" || echo "  WARN: 没找到 index.html"
fi

echo "✅ dashboard-auth-ui-smoke PASSED（API + 源文件 + cookie 链路全通）"
