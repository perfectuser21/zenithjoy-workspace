#!/usr/bin/env bash
# zj2-ws3-video-comment-smoke.sh
# ZenithJoy Sprint zj2 WS3 — video-search-result + comment-score-result smoke test
#
# Usage:
#   bash .github/workflows/scripts/smoke/zj2-ws3-video-comment-smoke.sh
#   API_PORT=5200 DB=postgresql://cecelia:cecelia@localhost:5432/cecelia bash zj2-ws3-video-comment-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-3001}"
API_BASE="http://localhost:${API_PORT}"
DB="${DB:-}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy WS3 Video/Comment Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)
SEEDED_KW_TASK_ID=""

# Seed: insert test acquisition_keyword_tasks row so FK constraint is satisfied
if [ -n "$DB" ]; then
  SEEDED_KW_TASK_ID=$(psql "$DB" -tA -c \
    "INSERT INTO zenithjoy.acquisition_keyword_tasks (keyword, expanded_keywords, status)
     VALUES ('ws3-smoke', '[]', 'dispatched')
     RETURNING id" 2>/dev/null | tr -d ' ' || echo "")
fi

TASK_ID="${SEEDED_KW_TASK_ID:-00000000-0000-0000-0000-000000000001}"

cleanup() {
  rm -f "$TMP"
  if [ -n "$SEEDED_KW_TASK_ID" ] && [ -n "$DB" ]; then
    psql "$DB" -c \
      "DELETE FROM zenithjoy.acquisition_keyword_tasks WHERE id='${SEEDED_KW_TASK_ID}'" \
      2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. POST /api/acquisition/video-search-result → 200 + received=true
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/video-search-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"${TASK_ID}\",\"keyword\":\"ws3-smoke\",\"videos\":[{\"video_url\":\"https://www.douyin.com/video/smoke001\"}]}")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "video-search-result: expected 200, got $HTTP"; }
RECEIVED=$(cat "$TMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).received))" 2>/dev/null || echo "")
[ "$RECEIVED" = "true" ] || { rm -f "$TMP"; fail "video-search-result: received not true, got: $(cat $TMP)"; }
ok "POST /api/acquisition/video-search-result → 200 received=true"

# 2. acquisition_videos DB write (skip when no DB)
if [ -n "$DB" ] && [ -n "$SEEDED_KW_TASK_ID" ]; then
  COUNT=$(psql "$DB" -t -c \
    "SELECT count(*) FROM zenithjoy.acquisition_videos WHERE keyword_task_id='${SEEDED_KW_TASK_ID}' AND created_at > NOW() - interval '5 minutes'" \
    2>/dev/null | tr -d ' ' || echo "0")
  [ "${COUNT:-0}" -ge 1 ] || { fail "acquisition_videos: no DB record found for task_id=${SEEDED_KW_TASK_ID}"; }
  ok "acquisition_videos: record inserted (count=${COUNT})"
fi

# 3. video-search-result missing keyword_task_id → 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/video-search-result" \
  -H "Content-Type: application/json" \
  -d '{"videos":[]}')
[ "$HTTP" = "400" ] || { fail "video-search-result missing id: expected 400, got $HTTP"; }
ok "POST /api/acquisition/video-search-result (no keyword_task_id) → 400"

# 4. POST /api/acquisition/comment-score-result → 200 + received=true + written_count>=0
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"${TASK_ID}\",\"video_url\":\"https://www.douyin.com/video/smoke001\",\"comments\":[{\"commenter_id\":\"@u1\",\"text\":\"怎么联系\",\"publish_time\":\"2026-05-24T10:00:00Z\"}]}")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "comment-score-result: expected 200, got $HTTP"; }
WRITTEN=$(cat "$TMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log(r.received===true&&r.written_count>=0?'ok':'fail:'+JSON.stringify(r))})" 2>/dev/null || echo "fail")
[ "$WRITTEN" = "ok" ] || { rm -f "$TMP"; fail "comment-score-result: received/written_count check failed: $WRITTEN"; }
ok "POST /api/acquisition/comment-score-result → 200 received=true written_count>=0"

# 5. empty comments → written_count=0
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 10 \
  -X POST "${API_BASE}/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"${TASK_ID}\",\"video_url\":\"https://www.douyin.com/video/smoke001\",\"comments\":[]}")
[ "$HTTP" = "200" ] || { rm -f "$TMP"; fail "comment-score-result empty: expected 200, got $HTTP"; }
WC=$(cat "$TMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).written_count))" 2>/dev/null || echo "")
[ "$WC" = "0" ] || { rm -f "$TMP"; fail "comment-score-result empty: written_count expected 0, got $WC"; }
ok "POST /api/acquisition/comment-score-result (empty comments) → written_count=0"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ WS3 Video/Comment Smoke PASS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
