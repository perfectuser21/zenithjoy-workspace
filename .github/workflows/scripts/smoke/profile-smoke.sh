#!/usr/bin/env bash
# profile-smoke.sh
# ZenithJoy Step 3 — 画像诊断 /api/profile 独立 smoke
#
# 用法：
#   bash .github/workflows/scripts/smoke/profile-smoke.sh
#   API_BASE=http://autopilot.zenjoymedia.media bash profile-smoke.sh
#
# DoD：POST /api/profile → 201 + 三字段写入；GET /api/profile → 三字段读回

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Profile Smoke (Step 3)"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TS=$(date +%s)
EMAIL="smoke-profile-${TS}@zenithjoy.test"
P3_TMP=$(mktemp)
P3_COOKIES=$(mktemp)

# 1. 注册
HTTP=$(curl -s -o "$P3_TMP" -w "%{http_code}" --max-time 30 \
  -c "$P3_COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"SmokeTest2026x\",\"name\":\"smoke\"}")
[ "$HTTP" = "200" ] || { rm -f "$P3_TMP" "$P3_COOKIES"; fail "sign-up expected 200, got $HTTP" 1; }
ok "sign-up → 200"

# 2. POST /api/profile → 201
HTTP=$(curl -s -o "$P3_TMP" -w "%{http_code}" --max-time 15 \
  -b "$P3_COOKIES" \
  -X POST "$API_BASE/api/profile" \
  -H "Content-Type: application/json" \
  -d '{"industry":"电商","audience":"18-35岁","style":"活泼"}')
[ "$HTTP" = "201" ] || { rm -f "$P3_TMP" "$P3_COOKIES"; fail "POST /api/profile expected 201, got $HTTP" 2; }
INDUSTRY=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['industry'])" "$P3_TMP" 2>/dev/null)
[ "$INDUSTRY" = "电商" ] || { rm -f "$P3_TMP" "$P3_COOKIES"; fail "POST profile industry='$INDUSTRY' expected '电商'" 2; }
ok "POST /api/profile → 201, industry 已写入"

# 3. GET /api/profile → 三字段读回
HTTP=$(curl -s -o "$P3_TMP" -w "%{http_code}" --max-time 15 \
  -b "$P3_COOKIES" \
  "$API_BASE/api/profile")
[ "$HTTP" = "200" ] || { rm -f "$P3_TMP" "$P3_COOKIES"; fail "GET /api/profile expected 200, got $HTTP" 3; }
IND=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['industry'])" "$P3_TMP" 2>/dev/null)
AUD=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['audience'])" "$P3_TMP" 2>/dev/null)
STY=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['style'])" "$P3_TMP" 2>/dev/null)
rm -f "$P3_TMP" "$P3_COOKIES"
[ "$IND" = "电商" ] && [ "$AUD" = "18-35岁" ] && [ "$STY" = "活泼" ] \
  || fail "GET /api/profile 三字段不一致 (industry=$IND audience=$AUD style=$STY)" 3
ok "GET /api/profile → 三字段读回一致"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Profile smoke PASS ✅"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
