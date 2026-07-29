#!/usr/bin/env bash
# staff-line-health smoke —— Staff Hub 业务线健康看板（GP3 / line_health）
#
# 起真实 apps/api 进程，用真实 curl 打三个新端点，验证：
#   1. 总览返回 line01/line02/line04 三条，均已接入 Brain（2026-07-29：line01/02 原先误写死
#      journeyId:null 与已下线的 Path 健康重复建设，已修正为原 Path 健康的真实 journey 映射）
#   2. 总览卡片字段集合恒等于约定集合 + 不出现禁用字段（path_key/health/status/smoke/environments）；
#      总览顶层 deployment.staging/production 结构恒在（2026-07-29 二次修正：不再用 git 分支猜三环境，
#      改查 apps/api 自己的 /version 端点——本地 smoke 环境够不着 :5201/:5200，sha 为 null 属合法）
#   3. deployment 端点 staging/production 结构恒在 + related_prs 恒为数组
#   4. line01/line02 deployment/abilities 均 connected=true（不再落回未接入空态）
#   5. 未知 lineKey → 404；无认证头 → 403（三个端点都挂 staffGuard）
#
# GitHub 未认证 60 次/小时限额：脚本内 deployment 只打 2 次（第二次必然命中 5 分钟缓存）。
set -euo pipefail

echo "== staff-line-health smoke =="

test -f apps/api/src/services/line-health.ts
test -f apps/staff-hub/src/pages/LineHealthPage.tsx
test -f apps/staff-hub/src/pages/LineHealthDetailPage.tsx
test -f product-map/generated/product-map.json

cd apps/api
npm run build >/dev/null 2>&1
PORT="${STAFF_LINE_HEALTH_SMOKE_PORT:-52107}"
export PORT
export NODE_ENV=development
export STAFF_EMAILS="${STAFF_EMAILS:-smoke-staff@zenithjoy.local}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-smoke-dev-secret-not-for-prod}"
export TOAPI_API_KEY="${TOAPI_API_KEY:-smoke-unused}"
AUTH_HEADER="X-User-Email: ${STAFF_EMAILS%%,*}"
API="http://localhost:${PORT}"

node -r dotenv/config dist/index.js > /tmp/staff-line-health-smoke-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -s -o /dev/null "${API}/health"; then break; fi
  sleep 0.5
done

fail() { echo "FAIL: $1"; exit 1; }

echo "-- 1. 总览三条业务线均已接入 Brain --"
OVERVIEW=$(curl -sf "${API}/api/staff/line-health" -H "$AUTH_HEADER") || fail "总览端点不可达"
echo "$OVERVIEW" | jq -e '.data | length == 3' >/dev/null || fail "总览应返回 3 条业务线"
echo "$OVERVIEW" | jq -e '[.data[].line_key] | sort == ["line01","line02","line04"]' >/dev/null \
  || fail "line_key 集合不对"
echo "$OVERVIEW" | jq -e '.data[] | select(.line_key=="line01") | .journey_id == "c019cdeb-d90b-4f8b-a658-ae333663ac35"' >/dev/null \
  || fail "line01 journey_id 应为原 Path 健康 path1 映射（智能发布）"
echo "$OVERVIEW" | jq -e '.data[] | select(.line_key=="line02") | .journey_id == "afa6abca-53c0-4815-8594-b7fb81ca547f"' >/dev/null \
  || fail "line02 journey_id 应为原 Path 健康 path2 映射（客户智能获客路径）"
echo "$OVERVIEW" | jq -e '.source == "product_map" and .fallback_reason == null' >/dev/null \
  || fail "product-map.json 存在时 source 应为 product_map"
echo "   总览 3 条均已接入: PASS"

echo "-- 2. 总览 schema keys 完整性 + 禁用字段反查 + 顶层共享部署摘要结构 --"
echo "$OVERVIEW" | jq -e '(.data[0] | keys | sort) == (["availability","feature_counts","journey_id","journey_name","label","line_key","maturity","message","pending_changes"] | sort)' >/dev/null \
  || fail "总览卡片字段集合漂移"
echo "$OVERVIEW" | jq -e '(.data[0] | has("path_key") | not) and (.data[0] | has("health") | not) and (.data[0] | has("status") | not) and (.data[0] | has("smoke") | not) and (.data[0] | has("environments") | not)' >/dev/null \
  || fail "总览卡片出现禁用字段"
echo "$OVERVIEW" | jq -e '.data[] | (.pending_changes | type == "array")' >/dev/null \
  || fail "pending_changes 必须恒为数组"
# staging/production 是三条线共享的一份部署摘要，只在总览顶层出现一次；本地 smoke 环境够不着
# :5201/:5200 内网地址，sha 为 null 属合法（结构必须在，具体值不判断）
echo "$OVERVIEW" | jq -e '(.deployment | has("staging")) and (.deployment | has("production"))' >/dev/null \
  || fail "总览顶层缺 deployment.staging/production"
echo "$OVERVIEW" | jq -e '(.deployment.staging | keys | sort) == (["build_time","sha","version"] | sort) and (.deployment.production | keys | sort) == (["build_time","sha","version"] | sort)' >/dev/null \
  || fail "deployment.staging/production 字段集合不对"
echo "   schema keys + 禁用字段 + 部署摘要结构: PASS"

echo "-- 3. deployment 端点 staging/production 结构 + related_prs 数组 --"
DEPLOY=$(curl -sf "${API}/api/staff/line-health/line04/deployment" -H "$AUTH_HEADER") || fail "deployment 端点不可达"
echo "$DEPLOY" | jq -e '(.data | has("staging")) and (.data | has("production"))' >/dev/null \
  || fail "deployment 缺 staging/production"
echo "$DEPLOY" | jq -e '(.data | has("environments") | not)' >/dev/null \
  || fail "deployment 不应再出现已废弃的 environments 字段"
echo "$DEPLOY" | jq -e '.data.related_prs | type == "array"' >/dev/null || fail "related_prs 必须恒为数组"
echo "$DEPLOY" | jq -e '.data | has("recent_commit")' >/dev/null || fail "缺 recent_commit 字段"
echo "$DEPLOY" | jq -e '(.data.production.sha == null) or (.data.production.sha | test("^[0-9a-f]{40}$"))' >/dev/null \
  || fail "production.sha 不是合法 40 位 hex（疑似硬编码假值）"
echo "$DEPLOY" | jq -e '(.data | has("deploy_version") | not) and (.data | has("version") | not)' >/dev/null \
  || fail "deployment 出现禁用字段 deploy_version/version"
echo "   deployment 结构: PASS"

echo "-- 4. line01/line02 deployment/abilities 均已接入（不再是 not_connected 空态）--"
D1=$(curl -sf "${API}/api/staff/line-health/line01/deployment" -H "$AUTH_HEADER") || fail "line01 deployment 不可达"
echo "$D1" | jq -e '.data.connected == true and (.data | has("staging")) and (.data | has("production"))' >/dev/null \
  || fail "line01 deployment 应 connected=true 且有 staging/production"
A1=$(curl -sf "${API}/api/staff/line-health/line02/abilities" -H "$AUTH_HEADER") || fail "line02 abilities 不可达"
echo "$A1" | jq -e '.data.connected == true and (.data.abilities | type == "array") and (.data | has("features") | not)' >/dev/null \
  || fail "line02 abilities 应 connected=true 且无禁用字段"
echo "   line01/line02 已接入: PASS"

echo "-- 5. 未知 lineKey 404 + 无认证头 403 --"
for suffix in deployment abilities; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API}/api/staff/line-health/bogus-line/${suffix}" -H "$AUTH_HEADER")
  [ "$CODE" = "404" ] || fail "未知 lineKey /${suffix} 应 404，实得 $CODE"
done
for p in "/api/staff/line-health" "/api/staff/line-health/line04/deployment" "/api/staff/line-health/line04/abilities"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API}${p}")
  [ "$CODE" = "403" ] || fail "${p} 无认证头应 403，实得 $CODE"
done
echo "   404 + 403: PASS"

kill $API_PID 2>/dev/null || true
trap - EXIT
cd ../..

echo "staff-line-health smoke: PASS"
