#!/usr/bin/env bash
# keyword-search-smoke.sh
# ZenithJoy Smart Acquisition — POST /api/acquisition/keyword-search smoke test
#
# Usage:
#   bash .github/workflows/scripts/smoke/keyword-search-smoke.sh
#   API_PORT=3001 DB=postgresql://... bash keyword-search-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"
TEST_TOKEN="${TEST_TOKEN:-}"
DB="${DB:-}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Acquisition keyword-search Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)
SEEDED_SESSION_ID=""

# Seed: insert test agent session so endpoint does not return 503 AGENT_OFFLINE
if [ -n "$DB" ]; then
  SEEDED_SESSION_ID=$(psql "$DB" -tA -c \
    "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, status, role)
     VALUES ('smoke-kw-agent', 'douyin', 'active', 'main')
     ON CONFLICT DO NOTHING RETURNING id" 2>/dev/null | tr -d ' ' || echo "")
fi

cleanup() {
  rm -f "$TMP"
  if [ -n "$SEEDED_SESSION_ID" ] && [ -n "$DB" ]; then
    psql "$DB" -c \
      "DELETE FROM zenithjoy.agent_platform_sessions WHERE id='${SEEDED_SESSION_ID}'" \
      2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. POST /api/acquisition/keyword-search → 200 + schema keys
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "${API_BASE}/api/acquisition/keyword-search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_TOKEN}" \
  -d '{"keyword":"装修"}')
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "POST keyword-search expected 200, got $HTTP"; }
ok "POST /api/acquisition/keyword-search → 200"

# 2. Schema keys precisely ["keywords","task_id"]
KEYS=$(node -e "const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));process.stdout.write(Object.keys(d).sort().join(','))")
[ "$KEYS" = "keywords,task_id" ] || { fail "schema keys='$KEYS' expected 'keywords,task_id'"; }
ok "schema keys = [keywords,task_id]"

# 3. task_id is UUID, keywords.length == 5
TASK_ID=$(node -e "const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));process.stdout.write(d.task_id)")
KW_LEN=$(node -e "const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));process.stdout.write(String(d.keywords.length))")
[[ "$TASK_ID" =~ ^[0-9a-f-]{36}$ ]] || { fail "task_id='$TASK_ID' is not a UUID"; }
[ "$KW_LEN" = "5" ] || { fail "keywords.length=$KW_LEN expected 5"; }
ok "task_id=UUID, keywords.length=5"

# 4. No banned fields: result/data/expanded/variants/id/job_id
node -e "
const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));
for(const f of ['result','data','expanded','variants','id','job_id']){
  if(f in d){process.stderr.write('FAIL: banned field '+f+' present\n');process.exit(1);}
}
" || { fail "banned field present in response"; }
ok "no banned fields"

# 5. Missing keyword → 400 + MISSING_KEYWORD
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/keyword-search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_TOKEN}" \
  -d '{}')
[ "$HTTP" = "400" ] || { cat "$TMP"; fail "missing keyword: expected 400, got $HTTP"; }
ERR=$(node -e "const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));process.stdout.write(d.error||'')")
[ "$ERR" = "MISSING_KEYWORD" ] || { fail "error='$ERR' expected 'MISSING_KEYWORD'"; }
ok "missing keyword → 400 MISSING_KEYWORD"

echo ""
echo "✅ keyword-search smoke PASS"
