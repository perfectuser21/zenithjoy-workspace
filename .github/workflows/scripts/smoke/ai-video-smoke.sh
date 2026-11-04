#!/usr/bin/env bash
# Real API/DB read contract and upload validation only. Generation success/failure
# is exercised by apps/api/tests/ai-video.test.ts using the real HTTP router and
# an isolated service fixture; this smoke must not issue paid upstream jobs.
set -euo pipefail
API="${API_BASE:-http://localhost:5200}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsS --max-time 20 "$API/api/ai-video/history" -H 'X-Feishu-User-Id: ou_smoke_aiv_001' > "$TMP/history"
jq -e '(.data | type == "array") and (.total | type == "number" and . >= 0)' "$TMP/history" >/dev/null
curl -fsS --max-time 20 "$API/api/ai-video/active" -H 'X-Feishu-User-Id: ou_smoke_aiv_001' > "$TMP/active"
jq -e 'type == "array"' "$TMP/active" >/dev/null
CODE=$(curl -sS --max-time 20 -o "$TMP/upload" -w '%{http_code}' -X POST "$API/api/ai-video/upload" -H 'X-Feishu-User-Id: ou_smoke_aiv_001')
[ "$CODE" = 400 ] || { echo "FAIL: upload without video HTTP $CODE"; exit 1; }
jq -e '.error == "video file is required"' "$TMP/upload" >/dev/null
echo 'PASS: AI video history/active reads and missing-file upload rejection'
