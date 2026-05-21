#!/usr/bin/env bash
# analyze-transcript-smoke.sh
# 验证 POST /api/ai-video/jobs/:id/analyze-transcript 端点：
#   - 接收 segments 数组
#   - 返回带 keep: boolean 标记的 segments
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
echo "🔍 smoke: analyze-transcript — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. 创建测试 job
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"local_path":"C:\\smoke\\test.mp4","topic":"smoke test analyze-transcript"}')
[ "$HTTP" = "201" ] || { echo "❌ createJob expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
JOB_ID=$(cat "$TMPFILE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] || { echo "❌ createJob: no id in response"; exit 1; }
echo "✅ createJob OK — id=$JOB_ID"

# 2. 调用 analyze-transcript，输入 3 个片段（含 1 个明显废话）
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 60 \
  -X POST "$BASE_URL/api/ai-video/jobs/$JOB_ID/analyze-transcript" \
  -H "Content-Type: application/json" \
  -d '{
    "segments": [
      {"start": 0.0, "end": 4.2, "text": "今天来聊一个非常重要的话题"},
      {"start": 4.2, "end": 6.0, "text": "嗯对对对，你那边声音好点了吗"},
      {"start": 6.0, "end": 12.5, "text": "我们产品的核心功能是帮助用户提高工作效率"}
    ],
    "duration": 12.5,
    "topic": "产品介绍"
  }')
[ "$HTTP" = "200" ] || { echo "❌ analyze-transcript expected 200, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "✅ analyze-transcript HTTP 200"

# 3. 验证返回 segments 数组，数量与输入一致
RES=$(cat "$TMPFILE")
echo "analyze response: $RES"

SEG_COUNT=$(echo "$RES" | grep -o '"start"' | wc -l | tr -d ' ')
[ "$SEG_COUNT" = "3" ] || { echo "❌ expected 3 segments in response, got $SEG_COUNT"; exit 1; }
echo "✅ segments count = 3"

# 4. 验证每个 segment 有 keep 字段
KEEP_COUNT=$(echo "$RES" | grep -o '"keep"' | wc -l | tr -d ' ')
[ "$KEEP_COUNT" = "3" ] || { echo "❌ expected 3 keep fields, got $KEEP_COUNT"; exit 1; }
echo "✅ all segments have keep field"

# 5. 验证废话片段被标记为 false（片段1含"声音好点了吗"=跑题）
KEEP_FALSE=$(echo "$RES" | grep -o '"keep":false' | wc -l | tr -d ' ')
[ "$KEEP_FALSE" -ge "1" ] || { echo "❌ expected at least 1 keep:false (废话 segment), got 0"; exit 1; }
echo "✅ at least 1 segment marked keep:false (废话检测正常)"

# 6. 清理 job
curl -s -o /dev/null --max-time 15 \
  -X PUT "$BASE_URL/api/ai-video/jobs/$JOB_ID/complete" \
  -H "Content-Type: application/json" \
  -d '{"error_msg":"smoke test cleanup"}' || true

echo ""
echo "✅ analyze-transcript smoke PASSED"
