#!/usr/bin/env bash
# agent-v110-stale-recovery-smoke.sh
# 验证 Agent v1.1.0 stale job 恢复：GET /api/ai-video/jobs?status=processing&stale_minutes=N
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
echo "🔍 smoke: agent-v110-stale-recovery — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. 创建一个 job，推进到 processing 状态
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"local_path":"C:\\smoke\\stale-test.mp4","topic":"stale recovery smoke"}')
[ "$HTTP" = "201" ] || { echo "❌ createJob expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
JOB_ID=$(cat "$TMPFILE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] || { echo "❌ createJob: no id"; exit 1; }
echo "✅ createJob OK — id=$JOB_ID"

# 2. 推进到 processing（模拟 Agent 开始处理）
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X PATCH "$BASE_URL/api/ai-video/jobs/$JOB_ID/progress" \
  -H "Content-Type: application/json" \
  -d '{"progress":10,"status":"processing"}')
[ "$HTTP" = "200" ] || { echo "❌ updateProgress expected 200, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "✅ updateProgress(processing) OK"

# 3. stale_minutes=0 — 任何 processing job 都应出现（刚刚设的）
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  "$BASE_URL/api/ai-video/jobs?status=processing&stale_minutes=0")
[ "$HTTP" = "200" ] || { echo "❌ listStale(0) expected 200, got $HTTP"; cat "$TMPFILE"; exit 1; }
STALE_DATA=$(cat "$TMPFILE")
echo "listStale(0) response: $STALE_DATA"
echo "$STALE_DATA" | grep -q '"data"' || { echo "❌ listStale: no data field"; exit 1; }
echo "✅ listStale(stale_minutes=0) OK"

# 4. status=processing 不带 stale_minutes → 返回空数组（向后兼容）
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  "$BASE_URL/api/ai-video/jobs?status=processing")
[ "$HTTP" = "200" ] || { echo "❌ listProcessing(no stale) expected 200, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "$(cat "$TMPFILE")" | grep -q '"data":\[\]' || { echo "❌ listProcessing without stale_minutes should return empty array"; cat "$TMPFILE"; exit 1; }
echo "✅ listProcessing(no stale_minutes) returns [] OK"

# 5. 清理：重置 job 为 failed（不影响其他 smoke）
curl -s -o /dev/null --max-time 15 \
  -X PUT "$BASE_URL/api/ai-video/jobs/$JOB_ID/complete" \
  -H "Content-Type: application/json" \
  -d '{"error_msg":"smoke cleanup"}' || true
echo "✅ cleanup OK"

echo ""
echo "✅ agent-v110-stale-recovery smoke 全部通过"
