#!/usr/bin/env bash
# ai-video-pipeline-ws1-smoke.sh
# WS1 smoke: original_script 字段 + createJob API 响应契约
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
AUTH_HDR="Authorization: Bearer ZJ-F-FBFYTLFR" # gitleaks:allow
echo "🔍 smoke: ai-video-pipeline-ws1 — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. POST 含 original_script → 201
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HDR" \
  -d '{"local_path":"/tmp/ws1-smoke.mp4","original_script":"smoke test 原始文案"}')
[ "$HTTP" = "201" ] || { echo "❌ POST expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "✅ POST 201 OK"

RES=$(cat "$TMPFILE")
JOB_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] || { echo "❌ POST response missing id field"; exit 1; }
echo "✅ job id=$JOB_ID"

# 2. 响应含 original_script 字段
echo "$RES" | grep -q '"original_script"' || { echo "❌ POST response missing original_script"; exit 1; }
echo "✅ original_script present in POST response"

# 3. 禁用字段不存在
echo "$RES" | grep -qE '"script":|"raw_script":|"source_script":|"input_script":' \
  && { echo "❌ forbidden field found in POST response"; exit 1; } || true
echo "✅ no forbidden fields in POST response"

# 4. GET /{id} 返回 5 PRD 必填字段（id/status/detected_aspect/original_script/target_aspect）
HTTP2=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  "$BASE_URL/api/ai-video-pipeline/$JOB_ID" \
  -H "$AUTH_HDR")
[ "$HTTP2" = "200" ] || { echo "❌ GET expected 200, got $HTTP2"; cat "$TMPFILE"; exit 1; }
for field in '"id"' '"status"' '"detected_aspect"' '"original_script"' '"target_aspect"'; do
  grep -q "$field" "$TMPFILE" || { echo "❌ GET response missing field: $field"; exit 1; }
done
echo "✅ GET 200 全部 5 字段完整"

# 5. error path — 缺 local_path → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -d '{"original_script":"no local_path"}')
[ "$CODE" = "400" ] || { echo "❌ missing local_path should return 400, got $CODE"; exit 1; }
echo "✅ 400 on missing local_path"

echo ""
echo "✅ ai-video-pipeline-ws1 smoke 全部通过"
