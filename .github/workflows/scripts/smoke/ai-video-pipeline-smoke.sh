#!/usr/bin/env bash
# Smoke test: AI Video Pipeline — API 端点 + Windows Agent 接入点
# Path 1 Step 5 smoke
set -e
BASE="${BASE_URL:-http://autopilot.zenjoymedia.media}"

echo "=== ai-video-pipeline smoke (Path 1 Step 5) ==="

# 1. POST /api/ai-video/jobs — no file → 400
echo "[1] POST /api/ai-video/jobs (no file) → expect 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ai-video/jobs")
[ "$STATUS" = "400" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 2. GET pending jobs → 200 + data array
echo "[2] GET /api/ai-video/jobs?status=pending → expect 200"
RESP=$(curl -s "$BASE/api/ai-video/jobs?status=pending")
echo "$RESP" | grep -q '"data"' || { echo "FAIL: no data field in response"; exit 1; }

# 3. PATCH /:id/progress (nonexistent job) → 500 (internal) or 404
echo "[3] PATCH /api/ai-video/jobs/invalid/progress → expect 4xx/5xx"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"progress":5,"status":"processing"}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/progress")
[ "$STATUS" -ge 400 ] || { echo "FAIL: got $STATUS"; exit 1; }

# 4. GET /:id/source (nonexistent) → 404
echo "[4] GET /api/ai-video/jobs/invalid/source → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/source")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 5. POST /:id/transcribe (nonexistent) → 404
echo "[5] POST /api/ai-video/jobs/invalid/transcribe → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/transcribe")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 6. POST /:id/design (nonexistent) → 404
echo "[6] POST /api/ai-video/jobs/invalid/design → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"transcript":"test","segments":[],"duration":10}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/design")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 7. POST /:id/compose-html (nonexistent) → 404
echo "[7] POST /api/ai-video/jobs/invalid/compose-html → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"scenes":[],"duration":10}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/compose-html")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 8. POST /:id/bgm (nonexistent) → 404
echo "[8] POST /api/ai-video/jobs/invalid/bgm → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"style":"tech corporate"}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/bgm")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 9. POST /:id/upload-output (nonexistent) → 404
echo "[9] POST /api/ai-video/jobs/invalid/upload-output → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/upload-output")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

echo "=== ALL PASS (9/9 endpoints verified) ==="
