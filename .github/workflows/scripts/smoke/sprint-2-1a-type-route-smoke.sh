#!/usr/bin/env bash
# sprint-2-1a-type-route-smoke.sh
# Sprint 2.1a P0 验收：type=video 路由全链路 — DB 写入 + agent 路由到 video.cjs
# 使用：CI 跑要 mac mini API + 测试 license + agent 在线
set -euo pipefail

API_BASE="${ZENITHJOY_API_BASE:-http://localhost:5200}"
LICENSE_KEY="${SMOKE_LICENSE_KEY:-ZJ-F-SMOKE0001}"
AGENT_ID="${SMOKE_AGENT_ID:-}"

echo "[smoke] step 1: API 活着"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "${API_BASE}/api/account/me" | grep -q "401" || { echo "FAIL api"; exit 1; }

echo "[smoke] step 2: POST type=video task"
RESP=$(curl -sS -X POST "${API_BASE}/api/publish/task" \
  -H "Authorization: Bearer ${LICENSE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"platform\":\"douyin\",\"type\":\"video\",\"folder_path\":\"/tmp/smoke\",\"payload\":{}}")
echo "[smoke] response: $RESP"
TASK_ID=$(echo "$RESP" | grep -oE '"task_id":"[^"]+"' | cut -d'"' -f4 || true)

echo "[smoke] step 3: psql 验 DB type=video"
[ -n "$TASK_ID" ] && psql -At -d "${POSTGRES_DB:-cecelia}" \
  -c "SELECT type FROM zenithjoy.publish_tasks WHERE id='${TASK_ID}';" \
  | grep -q "^video$" || { echo "FAIL DB type"; exit 1; }

echo "[smoke] step 4: 跑 type-route 单测确保 transport 不丢 type"
npx vitest run apps/api/src/services/walking-skeleton.service.test.ts -t 'WS2 Sprint 2.1a transport patch' || exit 1

echo "[smoke] OK"
