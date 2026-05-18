#!/usr/bin/env bash
# local-video-path-ui-smoke.sh
# 验证本地视频处理页 UI 变更：createJob 只接 JSON body（local_path），不接 multipart
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
echo "🔍 smoke: local-video-path-ui — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. JSON body 方式（新 UI）→ 201
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"local_path":"C:\\Users\\smoke\\video.mp4","topic":"ui smoke"}')
[ "$HTTP" = "201" ] || { echo "❌ JSON createJob expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
JOB_ID=$(cat "$TMPFILE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] || { echo "❌ no id in response"; exit 1; }
echo "✅ JSON createJob OK — id=$JOB_ID"

# 2. src_video 应等于传入的 local_path
SRC=$(cat "$TMPFILE" | grep -o '"src_video":"[^"]*"' | cut -d'"' -f4)
[[ "$SRC" == *"video.mp4"* ]] || { echo "❌ src_video 未保存路径（got: $SRC）"; exit 1; }
echo "✅ src_video 保存本地路径 OK"

# 3. local_path 缺失 → 400
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"topic":"missing path"}')
[ "$HTTP" = "400" ] || { echo "❌ missing local_path expected 400, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "✅ missing local_path → 400 OK"

# 4. 清理
curl -s -o /dev/null --max-time 15 \
  -X PUT "$BASE_URL/api/ai-video/jobs/$JOB_ID/complete" \
  -H "Content-Type: application/json" \
  -d '{"error_msg":"smoke cleanup"}' || true

echo ""
echo "✅ local-video-path-ui smoke 全部通过"
