#!/usr/bin/env bash
# template-video-smoke.sh — 模板驱动视频生成 E2E smoke
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:3001}"
ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

echo "=== template-video smoke ==="

# Step 1: create job with template_id=W-G
RESP=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"C:\\test.mp4","template_id":"W-G"}') || fail "create job failed" 1
JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ok "created job $JOB_ID with template_id=W-G"

# Step 2: verify template_id saved
FIELD=$(curl -sf "$API_BASE/api/ai-video/jobs/$JOB_ID" | python3 -c "import sys,json; print(json.load(sys.stdin).get('template_id',''))")
[ "$FIELD" = "W-G" ] || fail "template_id not persisted, got: $FIELD" 2
ok "template_id=W-G persisted"

# Step 3: compose-template W-G returns 200 (JSX bundled in image)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/ai-video/jobs/$JOB_ID/compose-template" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"测试文案","duration":10}')
[ "$STATUS" = "200" ] || fail "W-G compose-template should return 200, got: $STATUS" 3
ok "W-G compose-template returns 200"

# Step 4: create job with template_id=C, verify compose-template returns 200
RESP_C=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"C:\\test.mp4","template_id":"C"}') || fail "create C job failed" 4
JOB_C=$(echo "$RESP_C" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
STATUS_C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/ai-video/jobs/$JOB_C/compose-template" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"克制纪录片测试","duration":10}')
[ "$STATUS_C" = "200" ] || fail "C compose-template should return 200, got: $STATUS_C" 4
ok "C compose-template returns 200"

# Step 5: create job with template_id=R, verify compose-template returns 200
RESP_R=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"C:\\test.mp4","template_id":"R"}') || fail "create R job failed" 5
JOB_R=$(echo "$RESP_R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
STATUS_R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/ai-video/jobs/$JOB_R/compose-template" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"深色徽章测试","duration":10}')
[ "$STATUS_R" = "200" ] || fail "R compose-template should return 200, got: $STATUS_R" 5
ok "R compose-template returns 200"

echo "=== template-video smoke PASS ==="
