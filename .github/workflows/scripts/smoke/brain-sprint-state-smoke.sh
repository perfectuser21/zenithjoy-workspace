#!/usr/bin/env bash
# brain-sprint-state-smoke.sh
# Brain Sprint State API smoke test
# Tests: POST /api/brain/sprint-state, POST /api/brain/journey-steps, GET /api/brain/journey-steps
#
# Usage:
#   ZENITHJOY_INTERNAL_TOKEN=<token> bash brain-sprint-state-smoke.sh
#   API_PORT=3001 ZENITHJOY_INTERNAL_TOKEN=xxx bash brain-sprint-state-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"
TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Brain Sprint State Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

AUTH_HEADER=""
if [ -n "$TOKEN" ]; then
  AUTH_HEADER="-H Authorization: Bearer $TOKEN"
fi

TMP=$(mktemp)

# 1. POST /api/brain/sprint-state — 写快照，返回 id
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "${API_BASE}/api/brain/sprint-state" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"journey_id":"smoke-test","sprint_id":"sprint-smoke-001","snapshot":{"steps":[],"features":[]}}')
[ "$HTTP" = "201" ] || { rm -f "$TMP"; fail "POST /api/brain/sprint-state expected 201, got $HTTP — $(cat $TMP)"; }
RESP=$(cat "$TMP")
echo "$RESP" | node --input-type=commonjs -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!d.success){process.stderr.write('FAIL success!=true: '+JSON.stringify(d)+'\n');process.exit(1);}
  if(!d.data||!d.data.id){process.stderr.write('FAIL no id: '+JSON.stringify(d)+'\n');process.exit(1);}
" || { rm -f "$TMP"; fail "POST sprint-state bad response: $RESP"; }
ok "POST /api/brain/sprint-state → 201 with uuid id"

# 2. POST /api/brain/journey-steps — upsert step
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "${API_BASE}/api/brain/journey-steps" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"journey_id":"smoke-test","step_id":"smoke-S1","step_order":1,"status":"passing","shared":false}')
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "POST /api/brain/journey-steps expected 200, got $HTTP — $(cat $TMP)"; }
RESP=$(cat "$TMP")
echo "$RESP" | node --input-type=commonjs -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!d.success){process.stderr.write('FAIL: '+JSON.stringify(d)+'\n');process.exit(1);}
  if(d.data.step_id!=='smoke-S1'){process.stderr.write('FAIL step_id: '+JSON.stringify(d)+'\n');process.exit(1);}
  if(d.data.status!=='passing'){process.stderr.write('FAIL status: '+JSON.stringify(d)+'\n');process.exit(1);}
" || { rm -f "$TMP"; fail "POST journey-steps bad response: $RESP"; }
ok "POST /api/brain/journey-steps → 200 with step_id+status"

# 3. POST again — upsert updates status
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "${API_BASE}/api/brain/journey-steps" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"journey_id":"smoke-test","step_id":"smoke-S1","step_order":1,"status":"done","shared":false}')
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "upsert expected 200, got $HTTP — $(cat $TMP)"; }
RESP=$(cat "$TMP")
echo "$RESP" | node --input-type=commonjs -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(d.data.status!=='done'){process.stderr.write('FAIL upsert status: '+JSON.stringify(d)+'\n');process.exit(1);}
" || { rm -f "$TMP"; fail "upsert status not updated: $RESP"; }
ok "POST journey-steps upsert → status updated to done"

# 4. GET /api/brain/journey-steps?journey_id=smoke-test
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  "${API_BASE}/api/brain/journey-steps?journey_id=smoke-test")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "GET journey-steps expected 200, got $HTTP — $(cat $TMP)"; }
RESP=$(cat "$TMP")
echo "$RESP" | node --input-type=commonjs -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!d.success){process.stderr.write('FAIL: '+JSON.stringify(d)+'\n');process.exit(1);}
  if(!Array.isArray(d.data)){process.stderr.write('FAIL not array: '+JSON.stringify(d)+'\n');process.exit(1);}
  const s1=d.data.find(s=>s.step_id==='smoke-S1');
  if(!s1){process.stderr.write('FAIL smoke-S1 not found\n');process.exit(1);}
  if(s1.status!=='done'){process.stderr.write('FAIL status: '+JSON.stringify(s1)+'\n');process.exit(1);}
" || { rm -f "$TMP"; fail "GET journey-steps bad response: $RESP"; }
ok "GET /api/brain/journey-steps → 200 with sorted data including updated step"

# 5. GET without journey_id → 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  "${API_BASE}/api/brain/journey-steps")
[ "$HTTP" = "400" ] || { rm -f "$TMP"; fail "missing journey_id expected 400, got $HTTP"; }
ok "GET /api/brain/journey-steps (no journey_id) → 400"

# 6. POST sprint-state missing fields → 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/brain/sprint-state" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"journey_id":"smoke-test"}')
[ "$HTTP" = "400" ] || { rm -f "$TMP"; fail "missing fields expected 400, got $HTTP"; }
ok "POST /api/brain/sprint-state (missing fields) → 400"

rm -f "$TMP"
echo ""
echo "✅ brain-sprint-state smoke PASS"
