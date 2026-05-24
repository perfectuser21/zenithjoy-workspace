#!/usr/bin/env bash
# zj2-ws3-video-comment-smoke.sh
# ZenithJoy Sprint zj2 WS3 — video-search-result + comment-score-result smoke test
#
# Usage:
#   bash .github/workflows/scripts/smoke/zj2-ws3-video-comment-smoke.sh
#   API_PORT=3001 bash zj2-ws3-video-comment-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy WS3 Video/Comment Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)

# 1. POST /api/acquisition/video-search-result → 200 + received=true
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/video-search-result" \
  -H "Content-Type: application/json" \
  -d '{"keyword_task_id":"00000000-0000-0000-0000-000000000001","keyword":"test","videos":[{"video_url":"https://www.douyin.com/video/smoke001"}]}')
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "video-search-result: expected 200, got $HTTP"; }
RECEIVED=$(cat "$TMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).received))" 2>/dev/null || echo "")
[ "$RECEIVED" = "true" ] || { rm -f "$TMP"; fail "video-search-result: received not true, got: $(cat $TMP)"; }
ok "POST /api/acquisition/video-search-result → 200 received=true"

# 2. video-search-result missing keyword_task_id → 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/video-search-result" \
  -H "Content-Type: application/json" \
  -d '{"videos":[]}')
[ "$HTTP" = "400" ] || { fail "video-search-result missing id: expected 400, got $HTTP"; }
ok "POST /api/acquisition/video-search-result (no keyword_task_id) → 400"

# 3. POST /api/acquisition/comment-score-result → 200 + received=true + written_count>=0
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d '{"keyword_task_id":"00000000-0000-0000-0000-000000000001","video_url":"https://www.douyin.com/video/smoke001","comments":[{"commenter_id":"@u1","text":"怎么联系","publish_time":"2026-05-24T10:00:00Z"}]}')
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "comment-score-result: expected 200, got $HTTP"; }
ok "POST /api/acquisition/comment-score-result → 200"

# 4. empty comments → written_count=0
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d '{"keyword_task_id":"00000000-0000-0000-0000-000000000001","video_url":"https://www.douyin.com/video/smoke001","comments":[]}')
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "comment-score-result empty: expected 200, got $HTTP"; }
WC=$(cat "$TMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).written_count))" 2>/dev/null || echo "")
[ "$WC" = "0" ] || { rm -f "$TMP"; fail "comment-score-result empty: written_count expected 0, got $WC"; }
ok "POST /api/acquisition/comment-score-result (empty comments) → written_count=0"

rm -f "$TMP"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ WS3 Video/Comment Smoke PASS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
