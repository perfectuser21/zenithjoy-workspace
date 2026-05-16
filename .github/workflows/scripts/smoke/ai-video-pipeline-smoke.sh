#!/usr/bin/env bash
set -e
BASE="${BASE_URL:-http://autopilot.zenjoymedia.media}"

echo "=== ai-video-pipeline smoke ==="

# 1. Upload endpoint 存在
echo "[1] POST /api/ai-video/jobs - expect 400 (no file)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ai-video/jobs")
[ "$STATUS" = "400" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 2. Transcribe endpoint 存在
echo "[2] POST /api/ai-video/jobs/fake-id/transcribe - expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/transcribe")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 3. Design endpoint 存在
echo "[3] POST /api/ai-video/jobs/fake-id/design - expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"transcript":"test","segments":[],"duration":10}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/design")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 4. Compose-html endpoint 存在
echo "[4] POST /api/ai-video/jobs/fake-id/compose-html - expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"scenes":[],"duration":10}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/compose-html")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 5. BGM endpoint 存在
echo "[5] POST /api/ai-video/jobs/fake-id/bgm - expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"style":"tech corporate"}' \
  "$BASE/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/bgm")
[ "$STATUS" = "404" ] || { echo "FAIL: got $STATUS"; exit 1; }

# 6. List pending jobs endpoint 存在
echo "[6] GET /api/ai-video/jobs?status=pending - expect 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ai-video/jobs?status=pending")
[ "$STATUS" = "200" ] || { echo "FAIL: got $STATUS"; exit 1; }

echo "=== ALL PASS ==="
