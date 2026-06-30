#!/usr/bin/env bash
# acq-sse-smoke.sh — 验证采集任务 SSE 推送端点就绪
# 测试：GET /api/acquisition/agent/task-stream 返回 SSE headers（无 license 时 401）
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
echo "=== acq-sse-smoke: $API_BASE ==="

# 1. 无 license → 应返回 401（端点存在且鉴权正常）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 \
  "$API_BASE/api/acquisition/agent/task-stream" || echo "000")
if [ "$STATUS" != "401" ]; then
  echo "❌ 期望 401（无 license 鉴权），得到 $STATUS"
  exit 1
fi
echo "✅ /agent/task-stream 无 license → 401 (鉴权正常)"

# 2. /collect-tasks 端点仍正常（回归：SSE 改动不影响原有轮询路径）
STATUS2=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 \
  "$API_BASE/api/acquisition/pending-collect-tasks" || echo "000")
if [ "$STATUS2" != "200" ]; then
  echo "❌ pending-collect-tasks 期望 200，得到 $STATUS2"
  exit 1
fi
echo "✅ /pending-collect-tasks → 200 (回归通过)"

echo "=== acq-sse-smoke PASSED ==="
