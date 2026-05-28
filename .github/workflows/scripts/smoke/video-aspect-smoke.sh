#!/usr/bin/env bash
# video-aspect-smoke.sh — WS3 API smoke: target_aspect + detected_aspect field support
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:3001}"
LICENSE_KEY="${ZJ_E2E_LICENSE_KEY:-ZJ-F-FBFYTLFR}" # gitleaks:allow — E2E test license
ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

echo "=== video-aspect-smoke ==="

# Step 1: create job with target_aspect=9:16
RESP=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $LICENSE_KEY" \
  -d '{"local_path":"C:\\test.mp4","topic":"smoke test","target_aspect":"9:16"}') \
  || fail "create job with target_aspect failed" 1

JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ok "created job $JOB_ID with target_aspect=9:16"

# Step 2: verify target_aspect stored
FIELD=$(curl -sf "$API_BASE/api/ai-video/jobs/$JOB_ID" \
  -H "Authorization: Bearer $LICENSE_KEY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('target_aspect',''))")
[ "$FIELD" = "9:16" ] || fail "target_aspect not persisted, got: $FIELD" 2
ok "target_aspect=9:16 persisted correctly"

# Step 3: PATCH detected_aspect via progress endpoint
curl -sf -X PATCH "$API_BASE/api/ai-video/jobs/$JOB_ID/progress" \
  -H 'Content-Type: application/json' \
  -d '{"detected_aspect":"16:9"}' > /dev/null \
  || fail "PATCH detected_aspect failed" 3
ok "PATCH detected_aspect succeeded"

# Step 4: verify detected_aspect stored
DA=$(curl -sf "$API_BASE/api/ai-video/jobs/$JOB_ID" \
  -H "Authorization: Bearer $LICENSE_KEY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('detected_aspect',''))")
[ "$DA" = "16:9" ] || fail "detected_aspect not persisted, got: $DA" 4
ok "detected_aspect=16:9 persisted correctly"

# Step 5: create job without target_aspect (null default)
RESP2=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $LICENSE_KEY" \
  -d '{"local_path":"C:\\test2.mp4"}') \
  || fail "create job without target_aspect failed" 5

JOB_ID2=$(echo "$RESP2" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
TA2=$(curl -sf "$API_BASE/api/ai-video/jobs/$JOB_ID2" \
  -H "Authorization: Bearer $LICENSE_KEY" \
  | python3 -c "import sys,json; v=json.load(sys.stdin).get('target_aspect'); print(v if v is not None else 'null')")
[ "$TA2" = "null" ] || [ "$TA2" = "None" ] || fail "target_aspect should be null when not specified, got: $TA2" 5
ok "target_aspect null default works"

echo "=== video-aspect-smoke PASSED ==="
