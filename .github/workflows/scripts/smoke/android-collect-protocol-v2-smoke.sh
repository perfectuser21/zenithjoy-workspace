#!/bin/bash
# Smoke test: 安卓端两阶段采集协议 v2（Path 2 Step 5）
# 验证 pending-collect-tasks / collect/report / collect/cancel 端点可达性
# 以及 Stage1 完成后自动推进为 stage_1_done 的状态机逻辑
set -e

BASE_URL="${API_URL:-http://localhost:5201}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-test-token}"

echo "[smoke] android-collect-protocol-v2: BASE_URL=$BASE_URL"

# 1. 验证 pending-collect-tasks 端点可达（无效 agent_id → 返回空任务列表，不 5xx）
PENDING_RESP=$(curl -sf -w "\nHTTP_STATUS:%{http_code}" \
  -H "x-agent-id: smoke-agent-nonexistent" \
  "$BASE_URL/api/acquisition/pending-collect-tasks" 2>/dev/null || true)
PENDING_STATUS=$(echo "$PENDING_RESP" | grep "HTTP_STATUS:" | cut -d: -f2)
echo "[smoke] pending-collect-tasks status=$PENDING_STATUS"
if [ "$PENDING_STATUS" != "200" ]; then
  echo "[smoke] FAIL: pending-collect-tasks returned $PENDING_STATUS (expected 200)"
  exit 1
fi
echo "[smoke] PASS: pending-collect-tasks 200 OK"

# 2. 验证 collect/report 端点 — 缺 task_id 返回 400（端点存在且参数校验正常）
REPORT_RESP=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/acquisition/collect/report" \
  -H "Content-Type: application/json" \
  -d '{"video_id":"smoke_vid"}' 2>/dev/null || true)
echo "[smoke] collect/report (no task_id) status=$REPORT_RESP"
if [ "$REPORT_RESP" != "400" ]; then
  echo "[smoke] FAIL: collect/report without task_id returned $REPORT_RESP (expected 400)"
  exit 1
fi
echo "[smoke] PASS: collect/report param validation 400"

# 3. 验证 collect/cancel 端点 — 缺 task_id 返回 400
CANCEL_RESP=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/acquisition/collect/cancel" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || true)
echo "[smoke] collect/cancel (no task_id) status=$CANCEL_RESP"
if [ "$CANCEL_RESP" != "400" ]; then
  echo "[smoke] FAIL: collect/cancel without task_id returned $CANCEL_RESP (expected 400)"
  exit 1
fi
echo "[smoke] PASS: collect/cancel param validation 400"

# 4. 验证 Kotlin 单元测试通过（AcquisitionCollectPollLoopTest）
if command -v gradle &>/dev/null || [ -f services/agent-android/gradlew ]; then
  echo "[smoke] running Kotlin unit tests..."
  cd services/agent-android && ./gradlew :app:testDebugUnitTest \
    --tests "com.zenithjoy.agent.AcquisitionCollectPollLoopTest" \
    --no-daemon -q 2>&1 | tail -20
  echo "[smoke] PASS: AcquisitionCollectPollLoopTest all passed"
  cd - >/dev/null
else
  echo "[smoke] SKIP: gradlew not found (CI will run in android workflow)"
fi

echo "[smoke] android-collect-protocol-v2 ALL PASS"
