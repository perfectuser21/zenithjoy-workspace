#!/usr/bin/env bash
# ai-video-pipeline-local-smoke.sh
# 验证本地优先架构：createJob 接 JSON body，不接文件上传
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
echo "🔍 smoke: ai-video-pipeline-local — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. createJob 接受 JSON body（local_path + topic），期望返回 201
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"local_path":"C:\\Users\\test\\video.mp4","topic":"smoke test"}')
[ "$HTTP" = "201" ] || { echo "❌ createJob expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
RES=$(cat "$TMPFILE")
echo "createJob response: $RES"
JOB_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] || { echo "❌ createJob: no id in response"; exit 1; }
echo "✅ createJob OK — id=$JOB_ID"

# 2. src_video 存的是本地路径（包含盘符 C:\\）
SRC=$(echo "$RES" | grep -o '"src_video":"[^"]*"' | cut -d'"' -f4)
echo "src_video: $SRC"
[[ "$SRC" == *"video.mp4"* ]] || { echo "❌ src_video 不含预期文件名"; exit 1; }
echo "✅ src_video 包含本地路径"

# 3. /source 端点已删除（404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  "$BASE_URL/api/ai-video/jobs/$JOB_ID/source")
[ "$STATUS" = "404" ] && echo "✅ /source 已删除(404)" || { echo "❌ /source 还存在($STATUS)"; exit 1; }

# 4. /upload-output 端点已删除（404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -X POST "$BASE_URL/api/ai-video/jobs/$JOB_ID/upload-output")
[ "$STATUS" = "404" ] && echo "✅ /upload-output 已删除(404)" || { echo "❌ /upload-output 还存在($STATUS)"; exit 1; }

# 5. /output/:file 端点已删除（404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  "$BASE_URL/api/ai-video/jobs/$JOB_ID/output/9_16.mp4")
[ "$STATUS" = "404" ] && echo "✅ /output/:file 已删除(404)" || { echo "❌ /output/:file 还存在($STATUS)"; exit 1; }

# 6. completeJob 接受 output_dir，返回含 output_dir 字段的 job
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X PUT "$BASE_URL/api/ai-video/jobs/$JOB_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{\"output_dir\":\"C:\\\\Users\\\\test\\\\zenithjoy-output\\\\$JOB_ID\"}")
[ "$HTTP" = "200" ] || { echo "❌ completeJob expected 200, got $HTTP"; cat "$TMPFILE"; exit 1; }
COMPLETE=$(cat "$TMPFILE")
echo "completeJob response: $COMPLETE"
OUT_DIR=$(echo "$COMPLETE" | grep -o '"output_dir":"[^"]*"' | cut -d'"' -f4)
[[ "$OUT_DIR" == *"$JOB_ID"* ]] || { echo "❌ completeJob output_dir 未包含 job id (got: $OUT_DIR)"; exit 1; }
echo "✅ completeJob output_dir OK"

echo ""
echo "✅ ai-video-pipeline-local smoke 全部通过"
