#!/bin/bash
# Smoke test: Stage1 视频清单回报端点（多视频协议闭环 PR1-2）
# 验证 POST /api/acquisition/collect/report-videos 的参数校验与鉴权链：
#   缺 task_id → 400；缺 x-agent-id → 401；agent 未注册 → 403
set -e

BASE_URL="${API_URL:-http://localhost:5200}"

echo "[smoke] stage1-report-videos: BASE_URL=$BASE_URL"

# 1. 缺 task_id → 400（参数校验先于鉴权）
S1=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -d '{"videos":[{"video_id":"smoke_vid"}]}' 2>/dev/null || true)
echo "[smoke] report-videos (no task_id) status=$S1"
if [ "$S1" != "400" ]; then
  echo "[smoke] FAIL: 缺 task_id 返回 $S1（期望 400）"
  exit 1
fi
echo "[smoke] PASS: 缺 task_id → 400"

# 2. 有 task_id 但缺 x-agent-id → 401
S2=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000000","videos":[{"video_id":"smoke_vid"}]}' 2>/dev/null || true)
echo "[smoke] report-videos (no x-agent-id) status=$S2"
if [ "$S2" != "401" ]; then
  echo "[smoke] FAIL: 缺 x-agent-id 返回 $S2（期望 401）"
  exit 1
fi
echo "[smoke] PASS: 缺 x-agent-id → 401"

# 3. x-agent-id 未注册 → 403
S3=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: smoke-agent-nonexistent" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000000","videos":[{"video_id":"smoke_vid"}]}' 2>/dev/null || true)
echo "[smoke] report-videos (unknown agent) status=$S3"
if [ "$S3" != "403" ]; then
  echo "[smoke] FAIL: 未注册 agent 返回 $S3（期望 403）"
  exit 1
fi
echo "[smoke] PASS: 未注册 agent → 403"

echo "[smoke] stage1-report-videos ALL PASS"
