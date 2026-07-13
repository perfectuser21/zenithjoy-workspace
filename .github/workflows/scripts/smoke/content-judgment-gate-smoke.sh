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
DB="${DB:-}"

# acquisition_collect_videos.tenant_id 是 uuid 类型（FK → tenants.id），judge-video
# 内部 SELECT/UPDATE 都会做 uuid 类型转换——tenant_id 必须是合法 UUID 格式，
# 非 uuid 字符串会直接触发 500（invalid input syntax for type uuid）。
TENANT_ID=$(node -e "console.log(require('crypto').randomUUID())")
# judge-video 改为按 x-agent-id 反查真 tenant（设备不持有真 tenant），smoke 须建绑该 tenant 的 agent
AGENT_ID="smoke-agent-${TENANT_ID}"
VIDEO_ID="smoke-vid-$(date +%s)"

pass() { echo "  [PASS] $*"; }
fail() { echo "  [FAIL] $*" >&2; exit 1; }
section() { echo; echo "=== $* ==="; }

# §3 幂等缓存检查依赖 acquisition_collect_videos 已有该 video_id 行（judge-video
# 只 UPDATE 不 INSERT，行不存在时 UPDATE 影响 0 行，写不进判决结果，第二次调用
# 也查不到缓存）。有 DB 连接时按生产真实前置条件预先写入 tenants/collect_tasks/
# collect_videos 三张表；没有 DB 时跳过 §3 的强校验（只验证端点可达）。
COLLECT_TASK_ID=""
if [ -n "$DB" ]; then
  psql "$DB" -tA -c \
    "INSERT INTO zenithjoy.tenants (id, name, license_key) VALUES ('${TENANT_ID}', 'smoke-content-judgment', 'smoke-license-${TENANT_ID}')" \
    > /dev/null 2>&1 || echo "  [INFO] 插入 tenants 失败（可能已存在），继续"
  COLLECT_TASK_ID=$(psql "$DB" -tA -c \
    "INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status) VALUES ('${TENANT_ID}', '[]', 'running') RETURNING id" \
    2>/dev/null | head -1 | tr -d ' \n' || echo "")
  psql "$DB" -tA -c \
    "INSERT INTO zenithjoy.agents (tenant_id, agent_id, status) VALUES ('${TENANT_ID}', '${AGENT_ID}', 'online')" \
    > /dev/null 2>&1 || echo "  [INFO] 插入 agent 失败（可能已存在），继续"
fi

cleanup() {
  if [ -n "$DB" ] && [ -n "$COLLECT_TASK_ID" ]; then
    psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='${TENANT_ID}'" > /dev/null 2>&1 || true
    psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='${EMPTY_DESC_TENANT:-}'" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

seed_video() {
  local video_id="$1"
  if [ -n "$DB" ] && [ -n "$COLLECT_TASK_ID" ]; then
    psql "$DB" -c \
      "INSERT INTO zenithjoy.acquisition_collect_videos (video_id, task_id, tenant_id, judgment_status)
       VALUES ('${video_id}', '${COLLECT_TASK_ID}', '${TENANT_ID}', 'pending')
       ON CONFLICT (task_id, video_id) DO NOTHING" > /dev/null 2>&1 \
      || echo "  [INFO] 预置 collect_videos 行失败，${video_id} 相关校验可能不准确"
  fi
}

# §1-§3 用的 TENANT_ID 必须先有非空 target_profile_desc，否则 INV-6（空画像直接
# matched）会在 force_timeout/force_result 判断之前短路，掩盖 §2/§3 真正要测的逻辑。
curl -sf -X PATCH "${BASE_URL}/api/acquisition/config" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "x-agent-id: ${AGENT_ID}" \
  -d "{\"tenant_id\": \"${TENANT_ID}\", \"target_profile_desc\": \"中小企业主，关注降本增效\"}" > /dev/null \
  || fail "预置 target_profile_desc 失败（PATCH /api/acquisition/config）"

section "§1 judge-video 端点存在（POST /api/acquisition/judge-video）"
seed_video "${VIDEO_ID}"
JUDGE_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "x-agent-id: ${AGENT_ID}" \
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
seed_video "${TIMEOUT_VIDEO_ID}"
START_TS=$(date +%s)
TIMEOUT_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "x-agent-id: ${AGENT_ID}" \
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
seed_video "${CACHE_VIDEO_ID}"
if [ -z "$DB" ]; then
  echo "  [INFO] 无 DB 连接，跳过 §3 幂等强校验（judge-video 只 UPDATE 不 INSERT，无预置行时无法验证 cache_hit）"
fi
# 第一次：写入 matched 结果
curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "x-agent-id: ${AGENT_ID}" \
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
  -H "x-agent-id: ${AGENT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"video_id\": \"${CACHE_VIDEO_ID}\",
    \"capture_type\": \"screenshot\",
    \"data_b64\": \"$(echo 'fake-data' | base64)\"
  }") || fail "§3: 第二次请求失败"
echo "  Cache Response: ${CACHE_RESP}"
if [ -n "$DB" ]; then
  echo "${CACHE_RESP}" | grep -q '"cache_hit":true' || fail "§3: 第二次相同 video_id 应返回 cache_hit: true"
  pass "同 video_id 非 pending 结果返回 cache_hit: true"
else
  echo "${CACHE_RESP}" | grep -q '"judgment_status"' || fail "§3: 响应缺少 judgment_status 字段"
  pass "端点可达（无 DB，跳过 cache_hit 强校验）"
fi

section "§4 empty target_profile_desc → matched（不调 Gemini）"
EMPTY_DESC_TENANT=$(node -e "console.log(require('crypto').randomUUID())")
EMPTY_AGENT_ID="smoke-agent-${EMPTY_DESC_TENANT}"
if [ -n "$DB" ]; then
  psql "$DB" -tA -c "INSERT INTO zenithjoy.tenants (id, name, license_key) VALUES ('${EMPTY_DESC_TENANT}', 'smoke-empty-desc', 'smoke-lic-${EMPTY_DESC_TENANT}')" > /dev/null 2>&1 || true
  psql "$DB" -tA -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, status) VALUES ('${EMPTY_DESC_TENANT}', '${EMPTY_AGENT_ID}', 'online')" > /dev/null 2>&1 || true
fi
EMPTY_DESC_VIDEO="smoke-empty-vid-$(date +%s)"
# 先设置空 target_profile_desc
curl -sf -X PATCH "${BASE_URL}/api/acquisition/config" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${EMPTY_DESC_TENANT}" \
  -H "x-agent-id: ${EMPTY_AGENT_ID}" \
  -d "{\"tenant_id\": \"${EMPTY_DESC_TENANT}\", \"target_profile_desc\": \"\"}" > /dev/null \
  || echo "  [INFO] PATCH config 返回非 2xx（可能端点尚未实现，跳过设置）"

EMPTY_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${EMPTY_DESC_TENANT}" \
  -H "x-agent-id: ${EMPTY_AGENT_ID}" \
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
# acquisition_leads.tenant_id/id 均为 uuid 类型，须传合法 UUID 格式（同 §1 根因）
RESCORE_LEAD_ID=$(node -e "console.log(require('crypto').randomUUID())")
RESCORE_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "x-agent-id: ${AGENT_ID}" \
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
  -H "x-agent-id: ${AGENT_ID}" \
  -d "{
    \"tenant_id\": \"${TENANT_ID}\",
    \"target_profile_desc\": \"中小企业主，关注降本增效，有数字化转型需求\"
  }") || fail "§6: PATCH /api/acquisition/config 不接受 target_profile_desc"
echo "  Config Response: ${CONFIG_RESP}"
echo "${CONFIG_RESP}" | grep -q '"target_profile_desc"' || fail "§6: config 响应应返回 target_profile_desc 字段"
pass "PATCH /api/acquisition/config 接受并返回 target_profile_desc"

echo
echo "=== content-judgment-gate-smoke PASSED ==="
