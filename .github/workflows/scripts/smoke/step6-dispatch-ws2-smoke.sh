#!/usr/bin/env bash
# step6-dispatch-ws2-smoke.sh
# Step 6 dispatch chain WS2 smoke — dispatchPublishTask + ackPublishTask
# 依赖：API 在 localhost:5200 运行，psql 可访问
set -euo pipefail

API="${ZENITHJOY_API_BASE:-http://localhost:5200}"
DB="${DB:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
HELPER="${HELPER:-apps/api/scripts/step6-dispatch-helper.sh}"

echo "[ws2-smoke] 检查 API 健康状态"
curl -fsS "$API/health" > /dev/null || { echo "FAIL: API not up at $API"; exit 1; }

echo "[ws2-smoke] test_dispatch_inserts_task"
bash "$HELPER" test_dispatch_inserts_task

echo "[ws2-smoke] test_dispatch_inserts_task_with_work_id"
bash "$HELPER" test_dispatch_inserts_task_with_work_id

echo "[ws2-smoke] test_dispatch_sets_queued — psql verify works.publish_status"
bash "$HELPER" test_dispatch_sets_queued

echo "[ws2-smoke] test_ack_sets_success — psql verify publish_tasks.status=done + works.publish_status=success"
bash "$HELPER" test_ack_sets_success

echo "[ws2-smoke] test_no_agent_422"
bash "$HELPER" test_no_agent_422

echo "[ws2-smoke] test_ack_not_found — 404 via curl"
bash "$HELPER" test_ack_not_found

echo "[ws2-smoke] test_ack_cross_tenant_forbidden — 403 via curl"
bash "$HELPER" test_ack_cross_tenant_forbidden

echo "[ws2-smoke] ALL PASS"
