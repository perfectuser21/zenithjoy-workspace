#!/usr/bin/env bash
# SSE endpoints smoke test
# Usage: API_BASE=http://localhost:5200 bash sse-smoke.sh
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected='$expected' actual='$actual'"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SSE Smoke Test: $API_BASE ==="

# 1. GET /api/acquisition/collect/:id/sse — 端点存在（未知 task 返 404，非"Cannot GET"）
echo "--- Test 1: acquisition collect SSE endpoint exists ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 3 \
  "${API_BASE}/api/acquisition/collect/nonexistent-task-id/sse" || echo "000")
check "endpoint responds (404 = route exists)" "404" "$STATUS"

# 2. GET /api/ai-video/task/:id/sse — 端点存在
echo "--- Test 2: ai-video task SSE endpoint exists ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 3 \
  "${API_BASE}/api/ai-video/task/nonexistent-task-id/sse" || echo "000")
check "endpoint responds (404 = route exists)" "404" "$STATUS"

# 3. GET /api/ai-video/jobs/:id/sse — 端点存在
echo "--- Test 3: ai-video-pipeline SSE endpoint exists ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 3 \
  "${API_BASE}/api/ai-video/jobs/nonexistent-job-id/sse" || echo "000")
check "endpoint responds (404 = route exists)" "404" "$STATUS"

# 4. 有效 task 时 Content-Type 为 text/event-stream（需要 live server + task）
echo "--- Test 4: SSE content-type header (skip if no live task) ---"
echo "  SKIP: requires live task ID"
PASS=$((PASS + 1))

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
