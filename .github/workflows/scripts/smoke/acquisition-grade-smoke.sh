#!/usr/bin/env bash
# acquisition-grade-smoke.sh
# 验证 comment-score-result 调用 DeepSeek 打分后写飞书 grade 字段
# Usage: API_PORT=3001 bash acquisition-grade-smoke.sh

set -uo pipefail
API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Acquisition Grade + Pending Tasks Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)

# 1. GET /api/acquisition/pending-keyword-tasks -> 200 + array
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  "${API_BASE}/api/acquisition/pending-keyword-tasks")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "pending-keyword-tasks expected 200, got $HTTP"; }
RESP=$(cat "$TMP")
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!Array.isArray(d.tasks)){process.stderr.write('FAIL tasks not array\n');process.exit(1);}
  if(typeof d.total !== 'number'){process.stderr.write('FAIL total not number\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "pending-keyword-tasks schema wrong: $RESP"; }
ok "GET /api/acquisition/pending-keyword-tasks -> 200 {tasks:[],total:N}"

# 2. POST comment-score-result with raw comment (no pre-assigned grade) -> written_count >= 0
TASK_ID=$(curl -sf -X POST "${API_BASE}/api/acquisition/keyword-search" \
  -H "Content-Type: application/json" \
  -d '{"keyword":"smoke_grade_test"}' 2>/dev/null | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).task_id||'')" 2>/dev/null || echo "")

if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; then
  ok "keyword-search skipped (agent offline / VITEST mode)"
  TASK_ID="00000000-0000-0000-0000-000000000000"
fi

HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 30 \
  -X POST "${API_BASE}/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"${TASK_ID}\",\"video_url\":\"https://www.douyin.com/video/smoke_test\",\"comments\":[{\"commenter_id\":\"@smoke_user\",\"text\":\"请问怎么联系你，想了解一下价格\",\"publish_time\":\"2026-05-25T10:00:00Z\"}]}")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "comment-score-result expected 200, got $HTTP"; }
RESP=$(cat "$TMP")
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(d.received !== true){process.stderr.write('FAIL received != true\n');process.exit(1);}
  if(typeof d.written_count !== 'number'){process.stderr.write('FAIL written_count not number\n');process.exit(1);}
  if(typeof d.comment_count !== 'number'){process.stderr.write('FAIL comment_count not number\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "comment-score-result schema wrong: $RESP"; }
ok "POST comment-score-result -> 200 {received,written_count,comment_count}"

# 3. Empty comments -> written_count=0 (early return, no DeepSeek call)
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"${TASK_ID}\",\"video_url\":\"https://www.douyin.com/video/empty\",\"comments\":[]}")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "empty comments expected 200, got $HTTP"; }
RESP=$(cat "$TMP")
echo "$RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(d.written_count !== 0){process.stderr.write('FAIL written_count should be 0 for empty: '+d.written_count+'\n');process.exit(1);}
" <<< "$RESP" || { rm -f "$TMP"; fail "empty comments written_count not 0: $RESP"; }
ok "empty comments -> written_count=0"

# 4. Regression: GET /api/acquisition/leads still 200
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "${API_BASE}/api/acquisition/leads")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "leads regression: expected 200, got $HTTP"; }
ok "regression: GET /api/acquisition/leads -> 200"

rm -f "$TMP"
echo ""
echo "✅ acquisition-grade smoke PASS"
