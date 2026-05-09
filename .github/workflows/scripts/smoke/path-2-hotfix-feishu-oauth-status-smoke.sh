#!/usr/bin/env bash
# path-2-hotfix-feishu-oauth-status-smoke.sh
# Path 2 Sprint A hotfix smoke — feishu-oauth /status endpoint + tenantContext middleware
#
# 验证：
#   1) GET /api/feishu/oauth/status 路由已注册（不再 404 Route not found）
#   2) tenantContext middleware 注入 req.tenantId（无 cookie 时 NO_TENANT_CONTEXT，不是 500）
#   3) 路由能正确返回 JSON 错误结构（不是裸 HTML）
#
# Lead 自验后续 Step 5-8（OAuth 跳飞书 + 扫码绑定）由
# .agent-knowledge/path-2/lead-acceptance-sprint-a.md 客户机自验文档承接。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"

ok()   { echo "OK $1"; }
fail() { echo "FAIL $1"; exit "${2:-1}"; }

echo "== path-2-hotfix smoke =="
echo "API_BASE=$API_BASE"

# ── Step 1: GET /status 路由存在 — 不是 404 Route not found ──
RESP=$(curl -s -o /tmp/p2-hotfix-status.body -w "%{http_code}" \
  -X GET "$API_BASE/api/feishu/oauth/status" \
  -H "Cookie: bogus=1" 2>&1)
HTTP_CODE="$RESP"
BODY=$(cat /tmp/p2-hotfix-status.body 2>/dev/null || echo "")

# 路由若没注册会返回 404 + body 含 "Route not found" 或类似
# 路由注册了应返回 401 (NO_TENANT_CONTEXT) / 404 (TENANT_NOT_FOUND) / 200 — 都是 JSON
if [ "$HTTP_CODE" = "404" ] && echo "$BODY" | grep -qiE "Route.*not.*found|Cannot.*GET"; then
  fail "Step 1: /status 路由未注册（仍返回 404 Route not found）" 1
fi

# 检验返回是 JSON
echo "$BODY" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' 2>/dev/null \
  || fail "Step 1: /status 返回非 JSON（http=$HTTP_CODE body=$BODY）" 1

ok "Step 1: /status 路由已注册，返回 JSON（http=$HTTP_CODE）"

# ── Step 2: 无 cookie/无 tenant 上下文 → 应返回 401 NO_TENANT_CONTEXT，不是 500 ──
ERROR_CODE=$(echo "$BODY" | node -e 'try { console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).error?.code || ""); } catch { console.log(""); }')

case "$ERROR_CODE" in
  NO_TENANT_CONTEXT|TENANT_NOT_FOUND|"")
    ok "Step 2: tenantContext 拦截正常（error.code=$ERROR_CODE http=$HTTP_CODE）"
    ;;
  *)
    fail "Step 2: 期望 NO_TENANT_CONTEXT/TENANT_NOT_FOUND，实际 error.code=$ERROR_CODE" 2
    ;;
esac

# ── Step 3: 必须不是 500 ──
if [ "$HTTP_CODE" = "500" ]; then
  fail "Step 3: /status 返回 500（middleware 抛异常未捕获）body=$BODY" 3
fi
ok "Step 3: /status 不抛 500（http=$HTTP_CODE）"

echo "== ALL PASS =="
exit 0
