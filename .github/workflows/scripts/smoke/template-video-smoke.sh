#!/usr/bin/env bash
# template-video-smoke.sh — 模板驱动视频生成 E2E smoke
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:3001}"
ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

echo "=== template-video smoke ==="

# Step 1: create job with template_id
RESP=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"C:\\test.mp4","template_id":"W-G"}') || fail "create job failed" 1
JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ok "created job $JOB_ID"

# Step 2: verify template_id saved
FIELD=$(curl -sf "$API_BASE/api/ai-video/jobs/$JOB_ID" | python3 -c "import sys,json; print(json.load(sys.stdin).get('template_id',''))")
[ "$FIELD" = "W-G" ] || fail "template_id not persisted, got: $FIELD" 2
ok "template_id=W-G persisted"

# Step 3: compose-template endpoint exists (returns 200 or 400 not 404)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/ai-video/jobs/$JOB_ID/compose-template" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"测试文案","duration":10}')
[ "$STATUS" != "404" ] || fail "compose-template endpoint not found (404)" 3
ok "compose-template endpoint exists (status=$STATUS)"

echo "=== template-video smoke PASS ==="
