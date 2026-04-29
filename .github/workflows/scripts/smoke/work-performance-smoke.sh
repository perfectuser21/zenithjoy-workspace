#!/usr/bin/env bash
# E2E smoke: work performance API
set -euo pipefail

API="http://localhost:5200"
WORK_ID="${TEST_WORK_ID:-}"

echo "=== Work Performance Smoke Test ==="

echo "[1] Health check..."
curl -sf "$API/health" | grep -q '"status":"ok"'
echo "  ✅ API healthy"

echo "[2] Ingest test snapshot with saves..."
INGEST=$(curl -sf -X POST "$API/api/snapshots/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "douyin",
    "items": [{
      "content_id": "smoke-test-001",
      "scraped_date": "2026-04-20",
      "title": "Smoke Test Video",
      "views": 9999,
      "likes": 888,
      "comments": 77,
      "shares": 66,
      "saves": 555
    }]
  }')
echo "  Ingest response: $INGEST"
echo "$INGEST" | grep -q '"success":true'
echo "  ✅ Ingest with saves OK"

if [ -n "$WORK_ID" ]; then
  echo "[3] GET /api/works/$WORK_ID/performance..."
  PERF=$(curl -sf "$API/api/works/$WORK_ID/performance")
  echo "$PERF" | grep -q '"platforms"'
  echo "  ✅ /performance endpoint OK"

  echo "[4] GET /api/works/$WORK_ID/performance/douyin..."
  PERF_P=$(curl -sf "$API/api/works/$WORK_ID/performance/douyin")
  echo "$PERF_P" | grep -q '"data"'
  echo "  ✅ /performance/:platform endpoint OK"
else
  echo "[3] SKIPPED (no TEST_WORK_ID set)"
fi

echo ""
echo "=== ✅ Work Performance smoke PASSED ==="
