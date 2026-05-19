#!/usr/bin/env bash
# template-c-r-smoke.sh — C + R 模板 compose-template E2E smoke
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:3001}"
ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

echo "=== template-c-r smoke ==="

for TMPL in C R; do
  RESP=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
    -H 'Content-Type: application/json' \
    -d "{\"local_path\":\"C:\\\\test.mp4\",\"template_id\":\"$TMPL\"}") \
    || fail "create $TMPL job failed" 1
  JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  ok "created $TMPL job $JOB_ID"

  FIELD=$(curl -sf "$API_BASE/api/ai-video/jobs/$JOB_ID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('template_id',''))")
  [ "$FIELD" = "$TMPL" ] || fail "template_id not persisted for $TMPL, got: $FIELD" 2
  ok "template_id=$TMPL persisted"

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/api/ai-video/jobs/$JOB_ID/compose-template" \
    -H 'Content-Type: application/json' \
    -d "{\"transcript\":\"${TMPL}模板测试文案\",\"duration\":10}")
  [ "$STATUS" = "200" ] || fail "$TMPL compose-template should return 200, got: $STATUS" 3
  ok "$TMPL compose-template returns 200"
done

echo "=== template-c-r smoke PASS ==="
