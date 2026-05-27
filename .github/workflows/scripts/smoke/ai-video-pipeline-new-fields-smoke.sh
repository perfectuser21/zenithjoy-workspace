#!/usr/bin/env bash
# ai-video-pipeline-new-fields-smoke.sh
# WS1 smoke: original_script / target_aspect / detected_aspect 三字段契约
# run-20260527-2037
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
AUTH_HDR="Authorization: Bearer ZJ-F-FBFYTLFR" # gitleaks:allow
TS=$(date +%s)
echo "🔍 smoke: ai-video-pipeline-new-fields — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. POST 含 original_script + target_aspect → 201，响应原样返回
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HDR" \
  -d "{\"local_path\":\"/tmp/nf-smoke.mp4\",\"original_script\":\"script-${TS}\",\"target_aspect\":\"9:16\"}")
[ "$HTTP" = "201" ] || { echo "❌ POST expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "✅ POST 201 OK"

RES=$(cat "$TMPFILE")
JOB_ID=$(echo "$RES" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{process.exit(1)}})" 2>/dev/null) \
  || { echo "❌ POST response is not valid JSON"; exit 1; }
[ -n "$JOB_ID" ] || { echo "❌ POST response missing id"; exit 1; }
echo "✅ job id=$JOB_ID"

# 2. original_script 原样返回
echo "$RES" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);if(o.original_script!=='script-${TS}'){console.error('FAIL original_script');process.exit(1)};console.log('ok')})" 2>/dev/null \
  || { echo "❌ original_script 未原样返回"; exit 1; }
echo "✅ original_script returned"

# 3. target_aspect 原样返回
echo "$RES" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);if(o.target_aspect!=='9:16'){console.error('FAIL target_aspect');process.exit(1)};console.log('ok')})" 2>/dev/null \
  || { echo "❌ target_aspect 未原样返回"; exit 1; }
echo "✅ target_aspect returned"

# 4. detected_aspect 初始为 null
echo "$RES" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);if(o.detected_aspect!==null){console.error('FAIL detected_aspect not null');process.exit(1)};console.log('ok')})" 2>/dev/null \
  || { echo "❌ detected_aspect 初始值应为 null"; exit 1; }
echo "✅ detected_aspect is null"

# 5. GET /{id} response 含三字段
HTTP2=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  "$BASE_URL/api/ai-video-pipeline/$JOB_ID" \
  -H "$AUTH_HDR")
[ "$HTTP2" = "200" ] || { echo "❌ GET expected 200, got $HTTP2"; cat "$TMPFILE"; exit 1; }
for field in '"original_script"' '"target_aspect"' '"detected_aspect"'; do
  grep -q "$field" "$TMPFILE" || { echo "❌ GET response missing field: $field"; exit 1; }
done
echo "✅ GET 200 含三字段"

# 6. 禁用字段不存在
for banned in aspectRatio aspect_ratio raw_script source_script; do
  grep -q "\"${banned}\"" "$TMPFILE" && { echo "❌ 禁用字段 ${banned} 存在"; exit 1; } || true
done
echo "✅ 无禁用字段"

echo ""
echo "✅ ai-video-pipeline-new-fields smoke 全部通过"
