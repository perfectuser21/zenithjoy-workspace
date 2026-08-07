#!/usr/bin/env bash
# staff-acceptance smoke —— Staff Hub 验收模块（Staff Hub 直连 Brain，决策 fc7b5dc0）
#
# 起真实 apps/api 进程，用真实 curl 打三个新端点，验证：
#   1. 三个端点无认证头 → 403（staffGuard 不遗漏）
#   2. GET /api/staff/acceptance/pending 带认证头 → 200，透传 availability 字段
#      （CI 沙盒够不着 Brain 内网地址，availability 必然是 degraded，属合法路径——
#      本脚本把 CECELIA_BRAIN_URL 显式指向一个必然拒连的本地端口，让 degraded 快速稳定复现，
#      不依赖 DNS 解析 host.docker.internal 的耗时/成败）
#   3. GET /api/staff/acceptance/history 缺 gp_id → 400；带 gp_id + 认证头 → 200
#   4. POST /api/staff/acceptance/results 空数组 → 400（校验先于反代，不触碰 Brain）
set -euo pipefail

echo "== staff-acceptance smoke =="

test -f apps/api/src/services/acceptance.ts
test -f apps/api/src/routes/staff.ts
test -f apps/staff-hub/src/pages/AcceptancePage.tsx
test -f apps/staff-hub/src/pages/AcceptanceDetailPage.tsx
test -f apps/staff-hub/src/pages/AcceptanceHistoryPage.tsx

cd apps/api
npm run build >/dev/null 2>&1
PORT="${STAFF_ACCEPTANCE_SMOKE_PORT:-52108}"
export PORT
export NODE_ENV=development
export STAFF_EMAILS="${STAFF_EMAILS:-smoke-staff@zenithjoy.local}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-smoke-dev-secret-not-for-prod}"
export TOAPI_API_KEY="${TOAPI_API_KEY:-smoke-unused}"
# 必然拒连的本地端口，让 fetchPendingRuns/fetchHistoryByGpId 快速稳定落到 degraded 分支，
# 不依赖 CI 沙盒里 host.docker.internal 默认地址的 DNS 解析耗时/结果不确定性。
export CECELIA_BRAIN_URL="http://127.0.0.1:39999"
AUTH_HEADER="X-User-Email: ${STAFF_EMAILS%%,*}"
API="http://localhost:${PORT}"

node -r dotenv/config dist/index.js > /tmp/staff-acceptance-smoke-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -s -o /dev/null "${API}/health"; then break; fi
  sleep 0.5
done

fail() { echo "FAIL: $1"; exit 1; }

echo "-- 1. 三个验收端点无认证头一律 403 --"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API}/api/staff/acceptance/pending")
[ "$CODE" = "403" ] || fail "pending 无认证头应 403，实得 $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API}/api/staff/acceptance/history?gp_id=gp1")
[ "$CODE" = "403" ] || fail "history 无认证头应 403，实得 $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/api/staff/acceptance/results" \
  -H "Content-Type: application/json" -d '{"results":[{"check_key":"r1:001","result":"通过"}]}')
[ "$CODE" = "403" ] || fail "results 无认证头应 403，实得 $CODE"
echo "   403: PASS"

echo "-- 2. GET pending 带认证头 → 200，透传 availability --"
PENDING=$(curl -sf "${API}/api/staff/acceptance/pending" -H "$AUTH_HEADER") || fail "pending 端点不可达"
echo "$PENDING" | jq -e '.success == true' >/dev/null || fail "pending success 应为 true"
echo "$PENDING" | jq -e '.availability == "degraded"' >/dev/null \
  || fail "CI 沙盒够不着 Brain，pending availability 应为 degraded"
echo "$PENDING" | jq -e '.runs | type == "array"' >/dev/null || fail "runs 必须恒为数组"
echo "   pending 200 + degraded 透传: PASS"

echo "-- 3. GET history 缺 gp_id → 400；带 gp_id + 认证 → 200 --"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API}/api/staff/acceptance/history" -H "$AUTH_HEADER")
[ "$CODE" = "400" ] || fail "history 缺 gp_id 应 400，实得 $CODE"
HISTORY=$(curl -sf "${API}/api/staff/acceptance/history?gp_id=gp1" -H "$AUTH_HEADER") || fail "history 端点不可达"
echo "$HISTORY" | jq -e '.success == true and .availability == "degraded"' >/dev/null \
  || fail "history 带 gp_id 应 200 且透传 degraded"
echo "   history 400/200: PASS"

echo "-- 4. POST results 空数组 → 400（校验先于反代）--"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/api/staff/acceptance/results" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"results":[]}')
[ "$CODE" = "400" ] || fail "results 空数组应 400，实得 $CODE"
echo "   results 空数组 400: PASS"

echo "-- 5. POST results 缺 run_key → 400（写入必须限定单个 run 作用域）--"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/api/staff/acceptance/results" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"results":[{"check_key":"S3-c1","result":"通过"}]}')
[ "$CODE" = "400" ] || fail "results 缺 run_key 应 400，实得 $CODE"
echo "   results 缺 run_key 400: PASS"

kill $API_PID 2>/dev/null || true
trap - EXIT
cd ../..

echo "staff-acceptance smoke: PASS"
