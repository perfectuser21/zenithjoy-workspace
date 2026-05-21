#!/usr/bin/env bash
# acquisition-smoke.sh
# ZenithJoy Smart Acquisition — GET /api/acquisition/overview smoke test
#
# Usage:
#   bash .github/workflows/scripts/smoke/acquisition-smoke.sh
#   API_PORT=3001 bash acquisition-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Acquisition Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)

# 1. GET /api/acquisition/overview → 200
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  "${API_BASE}/api/acquisition/overview")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "expected 200, got $HTTP"; }
ok "GET /api/acquisition/overview → 200"

# 2. enabled=true, feature="smart-acquisition"
RESP=$(cat "$TMP")
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(d.enabled!==true){process.stderr.write('FAIL enabled\n');process.exit(1);}
  if(d.feature!=='smart-acquisition'){process.stderr.write('FAIL feature\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "enabled or feature mismatch — got: $RESP"; }
ok "enabled=true, feature='smart-acquisition'"

# 3. capabilities=["overview"], version="1.0.0"
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(JSON.stringify(d.capabilities)!=='[\"overview\"]'){process.stderr.write('FAIL capabilities\n');process.exit(1);}
  if(d.version!=='1.0.0'){process.stderr.write('FAIL version\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "capabilities or version mismatch — got: $RESP"; }
ok "capabilities=['overview'], version='1.0.0'"

# 4. Schema completeness — exactly these 4 keys
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const keys=Object.keys(d).sort().join(',');
  if(keys!=='capabilities,enabled,feature,version'){process.stderr.write('FAIL schema keys: '+keys+'\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "schema keys mismatch — got: $RESP"; }
ok "schema keys = [capabilities,enabled,feature,version]"

# 5. Banned fields absent
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  for(const f of ['status','data','result','payload','info','meta']){
    if(f in d){process.stderr.write('FAIL banned field: '+f+'\n');process.exit(1);}
  }
" <<< "$RESP" || { rm -f "$TMP"; fail "banned field present — got: $RESP"; }
ok "no banned fields"

# 6. error path → 404
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "${API_BASE}/api/acquisition/nonexistent")
[ "$HTTP" = "404" ] || { rm -f "$TMP"; fail "expected 404 for nonexistent, got $HTTP"; }
ok "/api/acquisition/nonexistent → 404"

rm -f "$TMP"
echo ""
echo "✅ acquisition smoke PASS"
