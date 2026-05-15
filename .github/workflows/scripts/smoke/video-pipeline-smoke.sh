#!/usr/bin/env bash
# E2E smoke: video-pipeline upload → process → download
# Usage: BASE_URL=http://autopilot.zenjoymedia.media bash video-pipeline-smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://autopilot.zenjoymedia.media}"
API="$BASE_URL/api/ai-video"

TMP_DIR=$(mktemp -d)
TEST_VIDEO="$TMP_DIR/test.mp4"
TEST_SCRIPT="这是一段测试视频，用于验证 AI 视频剪辑流水线。"
trap "rm -rf $TMP_DIR" EXIT

echo "[smoke] Generating 2-second test video..."
ffmpeg -f lavfi -i color=black:size=640x360:duration=2 -r 25 \
  -f lavfi -i aevalsrc=0:duration=2 -shortest -y "$TEST_VIDEO" 2>/dev/null
[ -f "$TEST_VIDEO" ] || { echo "FAIL: could not generate test video"; exit 1; }

echo "[smoke] Uploading to $API/upload ..."
UPLOAD_RESP=$(curl -s -X POST "$API/upload" \
  -F "video=@$TEST_VIDEO;type=video/mp4" \
  -F "script=$TEST_SCRIPT" \
  -F "platform=9:16,16:9")
echo "Upload response: $UPLOAD_RESP"

JOB_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
[ -n "$JOB_ID" ] || { echo "FAIL: no job_id in upload response"; exit 1; }
echo "[smoke] Job ID: $JOB_ID"

echo "[smoke] Polling job status (max 5 min)..."
MAX_WAIT=300
ELAPSED=0
STATUS=""
TASK="{}"
while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  TASK=$(curl -s "$API/task/$JOB_ID")
  STATUS=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  PROGRESS=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('progress',0))" 2>/dev/null)
  echo "[smoke] status=$STATUS progress=$PROGRESS (${ELAPSED}s)"
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ]    && { echo "FAIL: job failed: $TASK"; exit 1; }
  sleep 5
  ELAPSED=$((ELAPSED+5))
done

[ "$STATUS" = "completed" ] || { echo "FAIL: timed out (status=$STATUS)"; exit 1; }

OUTPUT_916=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('output_9_16_url',''))" 2>/dev/null)
OUTPUT_169=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('output_16_9_url',''))" 2>/dev/null)
echo "[smoke] output_9_16_url=$OUTPUT_916"
echo "[smoke] output_16_9_url=$OUTPUT_169"
[ -n "$OUTPUT_916" ] || { echo "FAIL: missing output_9_16_url"; exit 1; }
[ -n "$OUTPUT_169" ] || { echo "FAIL: missing output_16_9_url"; exit 1; }

HTTP_916=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$OUTPUT_916")
HTTP_169=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$OUTPUT_169")
[ "$HTTP_916" = "200" ] || { echo "FAIL: 9:16 download returned $HTTP_916"; exit 1; }
[ "$HTTP_169" = "200" ] || { echo "FAIL: 16:9 download returned $HTTP_169"; exit 1; }

echo "[smoke] PASS: video-pipeline upload→process→download"
