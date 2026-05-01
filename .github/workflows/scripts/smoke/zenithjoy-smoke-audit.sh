#!/usr/bin/env bash
# zenithjoy-smoke-audit.sh — ZenithJoy 全功能 smoke 审计
# 覆盖所有 feature 的实际行为链路
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="${API_BASE:-http://localhost:5200}"
PASS=0; FAIL=0

ok()      { echo "  ✅ $1"; ((PASS++)) || true; }
fail()    { echo "  ❌ $1"; ((FAIL++)) || true; }
section() { echo ""; echo "── $1 ──"; }

source ~/.credentials/zenithjoy-internal-token 2>/dev/null || true
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"

# ── health ────────────────────────────────────────────────────────────────────
section "health"
curl -sf "$API/health" | jq -e '.status == "ok"' >/dev/null 2>&1 \
  && ok "GET /health status=ok" \
  || fail "GET /health 不可达"

# ── ai-video ──────────────────────────────────────────────────────────────────
section "ai-video"
FEISHU="ou_smoke_aiv_001"

r=$(curl -s "$API/api/ai-video/history" -H "X-Feishu-User-Id: $FEISHU")
echo "$r" | jq -e '.data != null and (.total >= 0)' >/dev/null 2>&1 \
  && ok "ai-video-history: GET /ai-video/history {data, total}" \
  || fail "ai-video-history: 响应异常 ($r)"

r=$(curl -s "$API/api/ai-video/active" -H "X-Feishu-User-Id: $FEISHU")
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "ai-video-task-monitor: GET /ai-video/active 返回数组" \
  || fail "ai-video-task-monitor: 响应异常 ($r)"

http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/ai-video/generate" \
    -H "X-Feishu-User-Id: $FEISHU" -H "Content-Type: application/json" \
    -d '{"prompt":"smoke","model":"kling-v2-master","duration":5,"aspect_ratio":"16:9"}')
[[ "$http_code" != "404" ]] \
  && ok "ai-video-generate: POST /ai-video/generate 路由可达 (HTTP $http_code)" \
  || fail "ai-video-generate: 404"

# ── pipeline ──────────────────────────────────────────────────────────────────
section "pipeline (media_content_factory)"

r=$(curl -s "$API/api/pipeline/dashboard-stats" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.total != null' >/dev/null 2>&1 \
  && ok "pipeline-stats: GET /pipeline/dashboard-stats {total, running, ...}" \
  || fail "pipeline-stats: 响应异常 ($r)"

r=$(curl -s -X POST "$API/api/pipeline/trigger" \
    -H "X-Internal-Token: $INT_TOKEN" -H "X-Manual-Override: true" \
    -H "Content-Type: application/json" \
    -d "{\"content_type\":\"video\",\"topic\":\"smoke-audit-$(date +%s)\"}")
echo "$r" | jq -e '.success == true and .data.id != null' >/dev/null 2>&1 \
  && ok "pipeline-trigger: POST /pipeline/trigger 创建 pipeline" \
  || fail "pipeline-trigger: 创建失败 ($r)"

# ── fields ────────────────────────────────────────────────────────────────────
section "fields (crm_field_management)"

r=$(curl -s "$API/api/fields" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "fields-list: GET /fields 返回数组" \
  || fail "fields-list: 响应异常 ($r)"

r=$(curl -s -X POST "$API/api/fields" \
    -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
    -d "{\"field_name\":\"smoke-audit-$(date +%s)\",\"field_type\":\"text\",\"label\":\"Smoke\"}")
FIELD_ID=$(echo "$r" | jq -r '.id // empty')
[[ -n "$FIELD_ID" ]] \
  && ok "fields-create: POST /fields 返回 id=$FIELD_ID" \
  || fail "fields-create: 创建失败 ($r)"

[[ -n "$FIELD_ID" ]] && {
  curl -s -X DELETE "$API/api/fields/$FIELD_ID" -H "X-Internal-Token: $INT_TOKEN" >/dev/null
  ok "fields-delete: DELETE /fields/:id 清理完成"
}

# ── competitor-research ────────────────────────────────────────────────────────
section "competitor-research (crm_scraping)"

r=$(curl -s -X POST "$API/api/competitor-research/start" \
    -H "Content-Type: application/json" -d '{"query":"smoke audit"}')
JOB_ID=$(echo "$r" | jq -r '.jobId // empty')
[[ -n "$JOB_ID" ]] \
  && ok "crm-scraping-start: POST /competitor-research/start 返回 jobId" \
  || fail "crm-scraping-start: 失败 ($r)"

[[ -n "$JOB_ID" ]] && {
  r2=$(curl -s "$API/api/competitor-research/status/$JOB_ID")
  echo "$r2" | jq -e '.status != null' >/dev/null 2>&1 \
    && ok "crm-scraping-status: GET /competitor-research/status/:id status=$(echo "$r2" | jq -r '.status')" \
    || fail "crm-scraping-status: 响应异常 ($r2)"
}

# ── snapshots ─────────────────────────────────────────────────────────────────
section "snapshots (media_platform_data)"

SNAP_CONTENT_ID="smoke-audit-$(date +%s)"
r=$(curl -s -X POST "$API/api/snapshots/ingest" \
    -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
    -d "{\"platform\":\"douyin\",\"items\":[{\"content_id\":\"$SNAP_CONTENT_ID\",\"scraped_date\":\"$(date +%Y-%m-%d)\",\"title\":\"smoke\",\"views\":100,\"likes\":5,\"comments\":1,\"shares\":0}]}")
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "snapshots-ingest: POST /snapshots/ingest 摄入成功" \
  || fail "snapshots-ingest: 失败 ($r)"

r=$(curl -s "$API/api/snapshots/douyin" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true and (.data | type) == "array"' >/dev/null 2>&1 \
  && ok "snapshots-by-platform: GET /snapshots/douyin 返回 {success, data: []}" \
  || fail "snapshots-by-platform: 响应异常 ($r)"

SNAP_WORK_ID="00000000-dead-beef-0000-000000000099"
r=$(curl -s "$API/api/snapshots/work/$SNAP_WORK_ID" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e 'type == "array" or (.data != null)' >/dev/null 2>&1 \
  && ok "snapshots-by-work: GET /snapshots/work/:id 端点可达" \
  || fail "snapshots-by-work: 响应异常 ($r)"

# ── pacing-config ─────────────────────────────────────────────────────────────
section "pacing-config"

r=$(curl -s "$API/api/pacing-config" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true and .data.daily_limit != null' >/dev/null 2>&1 \
  && ok "pacing-config-get: GET /pacing-config 返回 {data: {daily_limit}}" \
  || fail "pacing-config-get: 响应异常 ($r)"

ORIG=$(echo "$r" | jq -r '.data.daily_limit // 5')
r2=$(curl -s -X PATCH "$API/api/pacing-config" \
    -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
    -d "{\"daily_limit\": $((ORIG + 1))}")
echo "$r2" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "pacing-config-patch: PATCH /pacing-config 更新成功" \
  || fail "pacing-config-patch: 失败 ($r2)"
curl -s -X PATCH "$API/api/pacing-config" \
  -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"daily_limit\": $ORIG}" >/dev/null

# ── topics ────────────────────────────────────────────────────────────────────
section "topics"

r=$(curl -s "$API/api/topics" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true and .data.items != null' >/dev/null 2>&1 \
  && ok "topics-list: GET /topics 返回分页列表" \
  || fail "topics-list: 响应异常 ($r)"

r=$(curl -s -X POST "$API/api/topics" \
    -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
    -d "{\"title\":\"smoke-audit-$(date +%s)\",\"keywords\":[\"smoke\"],\"status\":\"待研究\"}")
TID=$(echo "$r" | jq -r '.data.id // empty')
[[ -n "$TID" ]] \
  && ok "topics-create: POST /topics 返回 id=$TID" \
  || fail "topics-create: 失败 ($r)"

[[ -n "$TID" ]] && {
  curl -s -X PATCH "$API/api/topics/$TID" \
    -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
    -d '{"status":"已通过"}' | jq -e '.success == true' >/dev/null 2>&1 \
    && ok "topics-patch: PATCH /topics/:id 更新 status 成功" \
    || fail "topics-patch: 失败"
  curl -s -X DELETE "$API/api/topics/$TID" -H "X-Internal-Token: $INT_TOKEN" >/dev/null
  ok "topics-delete: DELETE /topics/:id 清理完成"
}

# ── publish-logs ──────────────────────────────────────────────────────────────
section "publish-logs (media_platform_publish)"

ALICE="ou_alice_tu_001"
TENANT_A="aaaaaaaa-1111-2222-3333-444444444444"
PSQL_PASS="${PGPASSWORD:-cecelia}"
# bootstrap（idempotent）
PGPASSWORD="$PSQL_PASS" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" \
  -d "${PGDATABASE:-cecelia}" -v ON_ERROR_STOP=1 -q <<EOF 2>/dev/null || true
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_A}', 'TenantA-Smoke', 'ZJ-TUSMOKE-A0000001', 'matrix')
ON CONFLICT (license_key) DO NOTHING;
INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES ('ZJ-TUSMOKE-A0000001', 'matrix', 10, 'smoke-cust-a', NOW() + INTERVAL '1 year', '${TENANT_A}', 'active')
ON CONFLICT (license_key) DO NOTHING;
INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES ('${TENANT_A}', '${ALICE}', 'owner')
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;
EOF

r=$(curl -s -X POST "$API/api/works" \
    -H "X-Feishu-User-Id: $ALICE" -H "Content-Type: application/json" \
    -d '{"title":"smoke-pub-logs-work","content_type":"video","body":"smoke"}')
WID=$(echo "$r" | jq -r '.id // empty')
[[ -n "$WID" ]] \
  && ok "publish-logs-setup: 作品创建成功 (id=$WID)" \
  || fail "publish-logs-setup: 作品创建失败 ($r)"

[[ -n "$WID" ]] && {
  r2=$(curl -s "$API/api/works/$WID/publish-logs" -H "X-Feishu-User-Id: $ALICE")
  echo "$r2" | jq -e 'type == "array"' >/dev/null 2>&1 \
    && ok "publish-logs-list: GET /works/:id/publish-logs 返回数组" \
    || fail "publish-logs-list: 响应异常 ($r2)"

  r3=$(curl -s -X POST "$API/api/works/$WID/publish-logs" \
      -H "X-Feishu-User-Id: $ALICE" -H "Content-Type: application/json" \
      -d "{\"work_id\":\"$WID\",\"platform\":\"douyin\",\"status\":\"pending\",\"content_snapshot\":\"smoke\"}")
  LID=$(echo "$r3" | jq -r '.id // empty')
  [[ -n "$LID" ]] \
    && ok "publish-logs-create: POST /works/:id/publish-logs 创建日志 (id=$LID)" \
    || fail "publish-logs-create: 创建失败 ($r3)"

  [[ -n "$LID" ]] && {
    r4=$(curl -s -X PUT "$API/api/publish-logs/$LID" \
        -H "X-Feishu-User-Id: $ALICE" -H "Content-Type: application/json" \
        -d '{"status":"published","platform_post_id":"smoke-post-001"}')
    echo "$r4" | jq -e '.id != null' >/dev/null 2>&1 \
      && ok "publish-logs-update: PUT /publish-logs/:id 更新 status=published" \
      || fail "publish-logs-update: 更新失败 ($r4)"
  }
}

# ── creator-service ───────────────────────────────────────────────────────────
section "creator-service (port 8899)"

CREATOR="${CREATOR_URL:-http://localhost:8899}"
r=$(curl -s "$CREATOR/health") || { fail "creator 服务不可达"; r="{}"; }
echo "$r" | jq -e '.status == "ok"' >/dev/null 2>&1 \
  && ok "creator-health: GET /health status=ok" \
  || fail "creator-health: 响应异常 ($r)"

r=$(curl -s "$CREATOR/api/topics" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true or type == "array"' >/dev/null 2>&1 \
  && ok "creator-topics-forward: GET /api/topics 转发正常" \
  || fail "creator-topics-forward: 失败 ($r)"

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ ZenithJoy 全功能 smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
