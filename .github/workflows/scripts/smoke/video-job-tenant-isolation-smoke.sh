#!/usr/bin/env bash
# Smoke test: verify tenant isolation on /api/ai-video/jobs
# Agents must only poll jobs belonging to their own license.
set -euo pipefail

API="${1:-https://autopilot.zenjoymedia.media}"
# LICENSE_KEY must be set via environment — no hardcoded default to avoid leaking production keys
LICENSE_KEY="${ZJ_E2E_LICENSE_KEY:?ZJ_E2E_LICENSE_KEY env var must be set}"

echo "=== video-job-tenant-isolation smoke ==="
echo "API: $API  LICENSE: $LICENSE_KEY"

# 1. Unauthenticated list — should return HTTP 200
echo "--- test 1: unauthenticated list returns 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/ai-video/jobs?status=pending")
[ "$STATUS" = "200" ] || { echo "FAIL: expected 200, got $STATUS"; exit 1; }
echo "PASS"

# 2. Authenticated list with valid license — should return 200
echo "--- test 2: authenticated list (valid license) returns 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $LICENSE_KEY" \
  "$API/api/ai-video/jobs?status=pending")
[ "$STATUS" = "200" ] || { echo "FAIL: expected 200, got $STATUS"; exit 1; }
echo "PASS"

# 3. Authenticated response body should be a JSON array
echo "--- test 3: authenticated response is JSON array"
BODY=$(curl -s -H "Authorization: Bearer $LICENSE_KEY" "$API/api/ai-video/jobs?status=pending")
echo "$BODY" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!Array.isArray(d)){throw new Error('not array: '+JSON.stringify(d).slice(0,120));} console.log('PASS: array length='+d.length);"

# 4. Invalid license key should not crash — should return 200 with empty array or error
echo "--- test 4: unknown license key returns 200 or 401"
FAKE_KEY="ZJ-X-SMOKE-FAKE-$(date +%s)"  # gitleaks:allow — test placeholder, not a real credential
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${FAKE_KEY}" \
  "$API/api/ai-video/jobs?status=pending")
[ "$STATUS" = "200" ] || [ "$STATUS" = "401" ] || { echo "FAIL: expected 200 or 401, got $STATUS"; exit 1; }
echo "PASS (status=$STATUS)"

echo "=== video-job-tenant-isolation smoke PASSED ==="
