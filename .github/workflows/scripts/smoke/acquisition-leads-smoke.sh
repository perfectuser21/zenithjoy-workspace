#!/usr/bin/env bash
# acquisition-leads-smoke.sh
# ZenithJoy Smart Acquisition — GET /api/acquisition/leads smoke test
#
# Usage:
#   bash .github/workflows/scripts/smoke/acquisition-leads-smoke.sh
#   API_PORT=3001 bash acquisition-leads-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Acquisition Leads Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)

# 1. GET /api/acquisition/leads -> 200 (VITEST mode returns empty list)
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10   "${API_BASE}/api/acquisition/leads")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "GET /api/acquisition/leads expected 200, got $HTTP"; }
ok "GET /api/acquisition/leads -> 200"

# 2. Response has leads array and total field
RESP=$(cat "$TMP")
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!Array.isArray(d.leads)){process.stderr.write('FAIL leads not array\n');process.exit(1);}
  if(typeof d.total !== 'number'){process.stderr.write('FAIL total not number\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "leads array or total missing — got: $RESP"; }
ok "leads=array, total=number"

# 3. Schema keys correct
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const keys=Object.keys(d).sort().join(',');
  if(keys!=='leads,total'){process.stderr.write('FAIL schema keys: '+keys+'\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "schema keys mismatch — got: $RESP"; }
ok "schema keys = [leads,total]"

# 4. Invalid grade -> 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10   "${API_BASE}/api/acquisition/leads?grade=INVALID")
[ "$HTTP" = "400" ] || { rm -f "$TMP"; fail "invalid grade expected 400, got $HTTP"; }
ok "?grade=INVALID -> 400"

# 5. Valid grade filter -> 200
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10   "${API_BASE}/api/acquisition/leads?grade=%E6%84%9F%E5%85%B4%E8%B6%A3")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "valid grade expected 200, got $HTTP"; }
ok "?grade=感兴趣 -> 200"

# 6. Regression — GET /api/acquisition/overview still works
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10   "${API_BASE}/api/acquisition/overview")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "overview regression: expected 200, got $HTTP"; }
ok "regression: GET /api/acquisition/overview -> 200"

rm -f "$TMP"
echo ""
echo "✅ acquisition-leads smoke PASS"
