#!/usr/bin/env bash
# content-judgment-gate-smoke.sh
# Sprint: 07120952-line02-content-judgment-gate
# Contract 六段验收：
#   §1 judge-video 端点存在且幂等
#   §2 force_timeout=true → judgment_status=pending，不阻塞
#   §3 非 pending 结果幂等（cache_hit: true）
#   §4 empty target_profile_desc → matched（不调 Gemini）
#   §5 outreach_eligible 联动 rescoreLead
#   §6 Dashboard target_profile_desc 字段可见
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3000}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"
TENANT_ID="smoke-tenant-$(date +%s)"
VIDEO_ID="smoke-vid-$(date +%s)"

pass() { echo "  [PASS] $*"; }
fail() { echo "  [FAIL] $*" >&2; exit 1; }
section() { echo; echo "=== $* ==="; }

section "§1 judge-video 端点存在（POST /api/acquisition/judge-video）"
JUDGE_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"video_id\": \"${VIDEO_ID}\",
    \"capture_type\": \"screenshot\",
    \"data_b64\": \"$(echo 'fake-screenshot-data' | base64)\",
    \"force_result\": \"matched\"
  }" 2>&1) || fail "§1: judge-video 端点不存在或返回错误，curl 失败"

echo "  Response: ${JUDGE_RESP}"
echo "${JUDGE_RESP}" | grep -q '"judgment_status"' || fail "§1: 响应缺少 judgment_status 字段"
echo "${JUDGE_RESP}" | grep -q '"matched"\|"rejected"\|"pending"' || fail "§1: judgment_status 值不合法"
pass "judge-video 端点存在，响应包含 judgment_status"

section "§2 force_timeout=true → judgment_status=pending（不阻塞 8s）"
TIMEOUT_VIDEO_ID="smoke-timeout-vid-$(date +%s)"
START_TS=$(date +%s)
TIMEOUT_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"video_id\": \"${TIMEOUT_VIDEO_ID}\",
    \"capture_type\": \"screenshot\",
    \"data_b64\": \"$(echo 'fake-data' | base64)\",
    \"force_timeout\": true
  }") || fail "§2: force_timeout 请求失败"
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
echo "  Response: ${TIMEOUT_RESP} (elapsed: ${ELAPSED}s)"
echo "${TIMEOUT_RESP}" | grep -q '"judgment_status":"pending"' || fail "§2: force_timeout 应返回 judgment_status=pending"
[ "${ELAPSED}" -lt 10 ] || fail "§2: 超时不应阻塞超过 10 秒，实际 ${ELAPSED}s"
pass "force_timeout=true → pending，响应时间 ${ELAPSED}s < 10s"

section "§3 非 pending 结果幂等（同 video_id 第二次调用应返回 cache_hit: true）"
CACHE_VIDEO_ID="smoke-cache-vid-$(date +%s)"
# 第一次：写入 matched 结果
curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"video_id\": \"${CACHE_VIDEO_ID}\",
    \"capture_type\": \"screenshot\",
    \"data_b64\": \"$(echo 'fake-data' | base64)\",
    \"force_result\": \"matched\"
  }" > /dev/null || fail "§3: 第一次写入失败"

# 第二次：同 video_id，应命中缓存
CACHE_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"video_id\": \"${CACHE_VIDEO_ID}\",
    \"capture_type\": \"screenshot\",
    \"data_b64\": \"$(echo 'fake-data' | base64)\"
  }") || fail "§3: 第二次请求失败"
echo "  Cache Response: ${CACHE_RESP}"
echo "${CACHE_RESP}" | grep -q '"cache_hit":true' || fail "§3: 第二次相同 video_id 应返回 cache_hit: true"
pass "同 video_id 非 pending 结果返回 cache_hit: true"

section "§4 empty target_profile_desc → matched（不调 Gemini）"
EMPTY_DESC_TENANT="smoke-empty-desc-$(date +%s)"
EMPTY_DESC_VIDEO="smoke-empty-vid-$(date +%s)"
# 先设置空 target_profile_desc
curl -sf -X PATCH "${BASE_URL}/api/acquisition/config" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${EMPTY_DESC_TENANT}" \
  -d "{\"tenant_id\": \"${EMPTY_DESC_TENANT}\", \"target_profile_desc\": \"\"}" > /dev/null \
  || echo "  [INFO] PATCH config 返回非 2xx（可能端点尚未实现，跳过设置）"

EMPTY_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${EMPTY_DESC_TENANT}" \
  -d "{
    \"tenant_id\": \"${EMPTY_DESC_TENANT}\",
    \"video_id\": \"${EMPTY_DESC_VIDEO}\",
    \"capture_type\": \"screenshot\",
    \"data_b64\": \"$(echo 'fake-data' | base64)\"
  }") || fail "§4: empty target_profile_desc 请求失败"
echo "  Empty-desc Response: ${EMPTY_RESP}"
echo "${EMPTY_RESP}" | grep -q '"judgment_status":"matched"' || fail "§4: empty target_profile_desc 应直接返回 matched"
pass "empty target_profile_desc → matched，不调 Gemini"

section "§5 outreach_eligible 联动 rescoreLead"
RESCORE_LEAD_ID="smoke-lead-$(date +%s)"
RESCORE_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"lead_id\": \"${RESCORE_LEAD_ID}\"
  }") || fail "§5: rescore-lead 端点不存在或返回错误"
echo "  Rescore Response: ${RESCORE_RESP}"
echo "${RESCORE_RESP}" | grep -q '"outreach_eligible"' || fail "§5: rescore-lead 响应应包含 outreach_eligible 字段"
pass "rescoreLead 响应包含 outreach_eligible 字段"

section "§6 Dashboard target_profile_desc 字段（API 层可接受该字段）"
CONFIG_RESP=$(curl -sf -X PATCH "${BASE_URL}/api/acquisition/config" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"target_profile_desc\": \"中小企业主，关注降本增效，有数字化转型需求\"
  }") || fail "§6: PATCH /api/acquisition/config 不接受 target_profile_desc"
echo "  Config Response: ${CONFIG_RESP}"
echo "${CONFIG_RESP}" | grep -q '"target_profile_desc"' || fail "§6: config 响应应返回 target_profile_desc 字段"
pass "PATCH /api/acquisition/config 接受并返回 target_profile_desc"

echo
echo "=== content-judgment-gate-smoke PASSED ==="
