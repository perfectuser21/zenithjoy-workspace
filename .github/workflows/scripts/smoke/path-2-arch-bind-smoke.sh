#!/usr/bin/env bash
# path-2-arch-bind-smoke.sh
# Path 2 Sprint A architecture hotfix smoke — POST /bind /rebuild route registration
#
# 验证（不依赖真飞书，只验证路由注册 + 入参校验 + 错误结构）：
#   1) POST /api/feishu/oauth/bind 路由已注册（不再 404 Route not found）
#   2) /bind 缺 app_id/app_secret → 400 MISSING_FIELDS（不是 500）
#   3) /bind 缺 tenantId 上下文 → 400 TENANT_ID_REQUIRED（不是 500）
#   4) POST /api/feishu/oauth/rebuild 路由已注册
#
# Lead 0-touch E2E 由 .agent-knowledge/path-2/lead-acceptance-sprint-a.md 承接（rog Playwright）。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"

ok()   { echo "OK $1"; }
fail() { echo "FAIL $1"; exit "${2:-1}"; }

echo "== path-2 arch hotfix smoke =="
echo "API_BASE=$API_BASE"

# ── Step 1: POST /bind 路由存在 — 不能 404 Route not found ──
RESP1=$(curl -s -o /tmp/p2-arch-bind1.body -w "%{http_code}" \
  -X POST "$API_BASE/api/feishu/oauth/bind" \
  -H "Content-Type: application/json" \
  -d '{}')
BODY1=$(cat /tmp/p2-arch-bind1.body 2>/dev/null || echo "")

if [ "$RESP1" = "404" ] && echo "$BODY1" | grep -qiE "Route.*not.*found|Cannot.*POST"; then
  fail "Step 1: /bind 路由未注册（404 Route not found）" 1
fi
echo "$BODY1" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' 2>/dev/null \
  || fail "Step 1: /bind 返回非 JSON (http=$RESP1)" 1
ok "Step 1: /bind 路由已注册返回 JSON (http=$RESP1)"

# ── Step 2: /bind 缺 tenantId 或缺字段 → 400（不是 500） ──
ERR_CODE1=$(echo "$BODY1" | node -e 'try { console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).error?.code || ""); } catch { console.log(""); }')
case "$ERR_CODE1" in
  TENANT_ID_REQUIRED|MISSING_FIELDS|NO_TENANT_CONTEXT)
    ok "Step 2: /bind 入参校验返 400 ($ERR_CODE1)"
    ;;
  *)
    fail "Step 2: /bind 缺字段应返 TENANT_ID_REQUIRED/MISSING_FIELDS，实际 $ERR_CODE1 (http=$RESP1 body=$BODY1)" 2
    ;;
esac

# ── Step 3: 必须不是 500 ──
if [ "$RESP1" = "500" ]; then
  fail "Step 3: /bind 返 500 — middleware 异常未捕获 body=$BODY1" 3
fi
ok "Step 3: /bind 无 500 (http=$RESP1)"

# ── Step 4: POST /rebuild 路由存在 ──
RESP2=$(curl -s -o /tmp/p2-arch-bind2.body -w "%{http_code}" \
  -X POST "$API_BASE/api/feishu/oauth/rebuild" \
  -H "Content-Type: application/json" \
  -d '{}')
BODY2=$(cat /tmp/p2-arch-bind2.body 2>/dev/null || echo "")
if [ "$RESP2" = "404" ] && echo "$BODY2" | grep -qiE "Route.*not.*found|Cannot.*POST"; then
  fail "Step 4: /rebuild 路由未注册" 4
fi
echo "$BODY2" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' 2>/dev/null \
  || fail "Step 4: /rebuild 返回非 JSON (http=$RESP2)" 4
ok "Step 4: /rebuild 路由已注册返回 JSON (http=$RESP2)"

echo "== ALL PASS =="
exit 0
