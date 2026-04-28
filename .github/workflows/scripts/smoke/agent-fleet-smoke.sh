#!/usr/bin/env bash
# Smoke test: Agent Fleet DB persistence endpoints
# Requires: API server running at $API_URL (default http://localhost:3000)
# Requires: ZENITHJOY_INTERNAL_TOKEN env var (or unset for dev passthrough)

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc (expected=$expected actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

auth_header() {
  if [ -n "$TOKEN" ]; then
    echo "-H 'Authorization: Bearer $TOKEN'"
  fi
}

echo "=== Agent Fleet Smoke Test: $API_URL ==="

# 1. Health check
echo "[1] API health"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" || echo "000")
check "GET /health returns 200" "200" "$STATUS"

# 2. Create tenant (internal auth required)
echo "[2] Create tenant"
TENANT_RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_URL/api/tenants" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"name":"SmokeTestCo","plan":"free"}' || echo "{}\n000")
HTTP_CODE=$(echo "$TENANT_RESP" | tail -1)
BODY=$(echo "$TENANT_RESP" | head -1)
# In dev mode (no token set), passthrough; in prod, expect 201
if [ -z "$TOKEN" ]; then
  check "POST /api/tenants returns 201 (dev mode)" "201" "$HTTP_CODE"
else
  check "POST /api/tenants returns 201 (with auth)" "201" "$HTTP_CODE"
fi

TENANT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
LICENSE_KEY=$(echo "$BODY" | grep -o '"license_key":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
check "license_key starts with ZJ-" "0" "$(echo "$LICENSE_KEY" | grep -v '^ZJ-' | wc -l | tr -d ' ')"

# 3. Create task via REST API (requires tenant)
echo "[3] Create task"
if [ -n "$TENANT_ID" ]; then
  TASK_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "$API_URL/api/agent/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"skill\":\"wechat_draft\",\"params\":{\"title\":\"smoke test\"}}" || echo "{}\n000")
  TASK_HTTP=$(echo "$TASK_RESP" | tail -1)
  TASK_BODY=$(echo "$TASK_RESP" | head -1)
  check "POST /api/agent/tasks returns 201" "201" "$TASK_HTTP"

  TASK_ID=$(echo "$TASK_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

  # 4. Fetch task by ID with correct tenantId
  if [ -n "$TASK_ID" ]; then
    echo "[4] Fetch task by ID"
    GET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      "$API_URL/api/agent/tasks/$TASK_ID?tenantId=$TENANT_ID" || echo "000")
    check "GET /api/agent/tasks/:id with correct tenantId returns 200" "200" "$GET_STATUS"

    # 5. IDOR check: wrong tenantId → 403
    echo "[5] IDOR guard"
    IDOR_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      "$API_URL/api/agent/tasks/$TASK_ID?tenantId=00000000-0000-0000-0000-000000000000" || echo "000")
    check "GET /api/agent/tasks/:id with wrong tenantId returns 403" "403" "$IDOR_STATUS"

    # 6. List tasks for tenant
    echo "[6] List tasks"
    LIST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      "$API_URL/api/agent/tasks?tenantId=$TENANT_ID" || echo "000")
    check "GET /api/agent/tasks?tenantId= returns 200" "200" "$LIST_STATUS"
  else
    echo "  ! Skipping task fetch tests (no TASK_ID)"
    FAIL=$((FAIL + 3))
  fi
else
  echo "  ! Skipping task tests (no TENANT_ID)"
  FAIL=$((FAIL + 4))
fi

# 7. Missing tenantId → 400
echo "[7] Validation"
MISSING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_URL/api/agent/tasks" || echo "000")
check "GET /api/agent/tasks without tenantId returns 400" "400" "$MISSING_STATUS"

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
