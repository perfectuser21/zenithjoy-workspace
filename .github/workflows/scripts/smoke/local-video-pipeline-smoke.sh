#!/usr/bin/env bash
# Smoke test: Local Video Pipeline page + upload API
# Tests: page loads, upload endpoint rejects missing file with 400
set -euo pipefail

BASE_URL="${BASE_URL:-http://autopilot.zenjoymedia.media}"
echo "=== local-video-pipeline smoke ==="
echo "BASE_URL: $BASE_URL"

# 1. Dashboard page loads (HTML returned, not 502)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${BASE_URL}/")
echo "GET / → $HTTP"
[ "$HTTP" = "200" ] || { echo "FAIL: dashboard not reachable ($HTTP)"; exit 1; }

# 2. Upload endpoint exists — missing file returns 400, not 404/502
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${BASE_URL}/api/ai-video/upload")
echo "POST /api/ai-video/upload (no body) → $HTTP"
[ "$HTTP" = "400" ] || { echo "FAIL: upload endpoint returned $HTTP, expected 400"; exit 1; }

# 3. Task status endpoint exists — unknown id returns 404, not 502
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "${BASE_URL}/api/ai-video/task/smoke-test-nonexistent-id")
echo "GET /api/ai-video/task/smoke-test-nonexistent-id → $HTTP"
[ "$HTTP" = "404" ] || { echo "FAIL: task endpoint returned $HTTP, expected 404"; exit 1; }

echo "=== local-video-pipeline smoke PASS ==="
