#!/usr/bin/env bash
# publish-logs-smoke.sh — 发布日志 smoke（media_platform_publish）
# Bootstrap：用 psql 复用 multi-tenant-smoke 的 Tenant A + Alice 夹具
# 验证：401 未认证 / 创建作品 / 列表 publish-logs / 创建 log / 更新 log
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

ALICE_FEISHU_ID="ou_alice_tu_001"
TENANT_A_ID="aaaaaaaa-1111-2222-3333-444444444444"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "==> [bootstrap] 确保 Tenant A + Alice 夹具存在（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 -q <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_A_ID}', 'TenantA-Smoke', 'ZJ-TUSMOKE-A0000001', 'matrix')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES ('ZJ-TUSMOKE-A0000001', 'matrix', 10, 'smoke-cust-a', NOW() + INTERVAL '1 year', '${TENANT_A_ID}', 'active')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES ('${TENANT_A_ID}', '${ALICE_FEISHU_ID}', 'owner')
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;
EOF

echo "── publish-logs-auth-guard ──"
http_no_auth=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/works/test-id/publish-logs")
[[ "$http_no_auth" == "401" ]] \
  && ok "GET /works/:id/publish-logs 缺 feishu header → 401" \
  || fail "GET /works/:id/publish-logs 缺 auth 未返回 401 (HTTP $http_no_auth)"

echo "── publish-logs-create-work ──"
r=$(curl -s -X POST "$API/api/works" \
    -H "X-Feishu-User-Id: $ALICE_FEISHU_ID" \
    -H "Content-Type: application/json" \
    -d '{"title":"smoke-publish-logs-work","content_type":"video","body":"smoke"}')
WORK_ID=$(echo "$r" | jq -r '.id // empty')
[[ -n "$WORK_ID" ]] \
  && ok "POST /works 创建作品成功 (id=$WORK_ID)" \
  || fail "POST /works 创建作品失败 ($r)"

if [[ -n "$WORK_ID" ]]; then
  echo "── publish-logs-list-empty ──"
  r2=$(curl -s "$API/api/works/$WORK_ID/publish-logs" -H "X-Feishu-User-Id: $ALICE_FEISHU_ID")
  echo "$r2" | jq -e 'type == "array"' >/dev/null 2>&1 \
    && ok "GET /works/:id/publish-logs 返回数组（初始为空）" \
    || fail "GET /works/:id/publish-logs 响应异常 ($r2)"

  echo "── publish-logs-create ──"
  r3=$(curl -s -X POST "$API/api/works/$WORK_ID/publish-logs" \
      -H "X-Feishu-User-Id: $ALICE_FEISHU_ID" \
      -H "Content-Type: application/json" \
      -d '{"platform":"douyin","status":"pending","content_snapshot":"smoke content"}')
  LOG_ID=$(echo "$r3" | jq -r '.id // empty')
  [[ -n "$LOG_ID" ]] \
    && ok "POST /works/:id/publish-logs 创建发布日志成功 (id=$LOG_ID)" \
    || fail "POST /works/:id/publish-logs 创建失败 ($r3)"

  if [[ -n "$LOG_ID" ]]; then
    echo "── publish-logs-update ──"
    r4=$(curl -s -X PUT "$API/api/publish-logs/$LOG_ID" \
        -H "X-Feishu-User-Id: $ALICE_FEISHU_ID" \
        -H "Content-Type: application/json" \
        -d '{"status":"published","platform_post_id":"douyin-smoke-post-001"}')
    echo "$r4" | jq -e '.id != null' >/dev/null 2>&1 \
      && ok "PUT /publish-logs/:id 更新状态为 published 成功" \
      || fail "PUT /publish-logs/:id 更新失败 ($r4)"
  fi
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ publish-logs smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
