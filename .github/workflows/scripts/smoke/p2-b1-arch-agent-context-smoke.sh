#!/usr/bin/env bash
# Path 2 Sprint B-1 architecture hotfix — agentContext middleware + mock-agent E2E Smoke
#
# 验证：
#   1. POST /api/_smoke/mock-agent 双门禁：缺 token → 403
#   2. POST /api/_smoke/mock-agent 正常 → 200 + 返 agent_uuid + agents 表新行 status='online'
#   3. POST /api/agent/burner/qr-bind 不带 session/header → 401 UNAUTHORIZED (tenantContext 拦)
#   4. POST /api/agent/burner/qr-bind 带 X-Feishu-User-Id 头但没绑 tenant → 403 NO_TENANT
#   5. POST /api/agent/burner/qr-bind 带 X-Feishu-User-Id 头 + tenant 但没 agent → 401 NO_AGENT_CONTEXT
#   6. POST /api/agent/burner/qr-bind 全链路 → 200 + 返 task_id（UUID 格式）
#   7. POST /api/agent/burner/qr-bind 显式 body { tenant_id, agent_id } 兼容路径 → 200
#
# 验证关键 architecture 行为：backend 自动 resolve agent_id (UUID)，frontend 仅传 account_label。
# 修复证据：postgres uuid.c:141 invalid input syntax for type uuid: "xian-rog-agent" 不再出现。

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

TENANT_AC_ID="dddddddd-1111-2222-3333-555555555555"
LICENSE_AC="ZJ-P2B1ARCH-VALID-001"
EMAIL_NO_AGENT="p2b1arch-noagent-$(date +%s)@example.com"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Cc3"
COOKIE_NA=$(mktemp)

trap 'rm -f "$COOKIE_NA"' EXIT

echo "==> [bootstrap] 建 tenant + license + tenant_members（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_AC_ID}', 'P2B1Arch-Smoke', '${LICENSE_AC}', 'matrix')
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES ('${LICENSE_AC}', 'matrix', 3, '', now() + interval '365 days', '${TENANT_AC_ID}', 'active')
ON CONFLICT (license_key) DO NOTHING;

-- 清理 agents 行（让 case 5 可走 NO_AGENT_CONTEXT 分支）
DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id IN
  (SELECT id FROM zenithjoy.agents WHERE tenant_id = '${TENANT_AC_ID}');
DELETE FROM zenithjoy.publish_tasks WHERE agent_id IN
  (SELECT id FROM zenithjoy.agents WHERE tenant_id = '${TENANT_AC_ID}');
DELETE FROM zenithjoy.agents WHERE tenant_id = '${TENANT_AC_ID}';
EOF
echo "  OK: bootstrap 完成"

echo "==> [1/7] mock-agent 缺 X-Smoke-Token → 403"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_AC_ID}\",\"agent_id_text\":\"smoke-agent-1\"}" \
  "${API_BASE}/api/_smoke/mock-agent")
[ "$HTTP_CODE" = "403" ] || { echo "  FAIL: 期望 403, got $HTTP_CODE"; exit 1; }
echo "  OK: 403 forbidden without token"

echo "==> [2/7] mock-agent 正常 → 200 + agents 行 status='online'"
RESP=$(curl -fsS -X POST -H "Content-Type: application/json" -H "X-Smoke-Token: ${SMOKE_TOKEN}" \
  -d "{\"tenant_id\":\"${TENANT_AC_ID}\",\"agent_id_text\":\"smoke-agent-1\",\"hostname\":\"smoke-host\"}" \
  "${API_BASE}/api/_smoke/mock-agent")
AGENT_UUID=$(echo "$RESP" | sed -E 's/.*"agent_uuid":"([^"]+)".*/\1/' | head -c 64)
[ -n "$AGENT_UUID" ] || { echo "  FAIL: 没拿到 agent_uuid  body=$RESP"; exit 1; }
echo "  OK: agent_uuid=$AGENT_UUID"

DB_STATUS=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c \
  "SELECT status FROM zenithjoy.agents WHERE id = '${AGENT_UUID}';")
[ "$DB_STATUS" = "online" ] || { echo "  FAIL: 期望 status=online, 实际=$DB_STATUS"; exit 1; }
echo "  OK: agents 行 status='online'"

echo "==> [3/7] qr-bind 没任何 auth → 401 UNAUTHORIZED (tenantContext 拦)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d '{"account_label":"smoke-label-1"}' \
  "${API_BASE}/api/agent/burner/qr-bind")
[ "$HTTP_CODE" = "401" ] || { echo "  FAIL: 期望 401 unauth, got $HTTP_CODE"; exit 1; }
echo "  OK: 401 unauthorized 无 session"

echo "==> [4/7] qr-bind 带 X-Feishu-User-Id 但没绑 tenant → 403 NO_TENANT"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ou_smoke_no_tenant_xyz" \
  -d '{"account_label":"smoke-label-2"}' \
  "${API_BASE}/api/agent/burner/qr-bind")
[ "$HTTP_CODE" = "403" ] || { echo "  FAIL: 期望 403 no-tenant, got $HTTP_CODE"; exit 1; }
echo "  OK: 403 NO_TENANT"

# 模拟一个 tenant_member 让 tenantContext 命中 + 但没 agent → NO_AGENT_CONTEXT
echo "==> [bootstrap-2] 插一条 tenant_member feishu_user_id='ou_smoke_p2b1arch'"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES ('${TENANT_AC_ID}', 'ou_smoke_p2b1arch', 'owner')
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;

DELETE FROM zenithjoy.agents WHERE tenant_id = '${TENANT_AC_ID}';
EOF

echo "==> [5/7] qr-bind tenant 已绑但没 agent → 401 NO_AGENT_CONTEXT"
RESP=$(curl -s -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ou_smoke_p2b1arch" \
  -d '{"account_label":"smoke-label-3"}' \
  "${API_BASE}/api/agent/burner/qr-bind")
ERR_CODE=$(echo "$RESP" | sed -E 's/.*"code":"([^"]+)".*/\1/' | head -c 64)
[ "$ERR_CODE" = "NO_AGENT_CONTEXT" ] || { echo "  FAIL: 期望 NO_AGENT_CONTEXT, got $ERR_CODE  body=$RESP"; exit 1; }
echo "  OK: NO_AGENT_CONTEXT"

# 现在 mock 一个 agent 让 case 6 走通
echo "==> [bootstrap-3] mock-agent 装一个 active agent"
RESP=$(curl -fsS -X POST -H "Content-Type: application/json" -H "X-Smoke-Token: ${SMOKE_TOKEN}" \
  -d "{\"tenant_id\":\"${TENANT_AC_ID}\",\"agent_id_text\":\"smoke-agent-real\",\"hostname\":\"smoke-host\"}" \
  "${API_BASE}/api/_smoke/mock-agent")
AGENT_UUID_REAL=$(echo "$RESP" | sed -E 's/.*"agent_uuid":"([^"]+)".*/\1/' | head -c 64)

echo "==> [6/7] qr-bind 全链路自动 resolve → 200 + task_id (UUID)"
RESP=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: ou_smoke_p2b1arch" \
  -d '{"account_label":"smoke-label-real"}' \
  "${API_BASE}/api/agent/burner/qr-bind")
TASK_ID=$(echo "$RESP" | sed -E 's/.*"task_id":"([^"]+)".*/\1/' | head -c 64)
echo "$TASK_ID" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
  || { echo "  FAIL: task_id 不是 UUID  body=$RESP"; exit 1; }
echo "  OK: task_id=$TASK_ID（backend agentContext 自 resolve UUID）"

echo "==> [7/7] qr-bind 显式 body 兼容 → 200"
RESP=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_AC_ID}\",\"agent_id\":\"${AGENT_UUID_REAL}\",\"account_label\":\"smoke-label-explicit\"}" \
  "${API_BASE}/api/agent/burner/qr-bind")
TASK_ID2=$(echo "$RESP" | sed -E 's/.*"task_id":"([^"]+)".*/\1/' | head -c 64)
echo "$TASK_ID2" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
  || { echo "  FAIL: 兼容路径 task_id 不是 UUID  body=$RESP"; exit 1; }
echo "  OK: 显式 body 兼容路径 task_id=$TASK_ID2"

echo ""
echo "Path 2 Sprint B-1 architecture hotfix smoke PASS:"
echo "  - mock-agent 双门禁 OK"
echo "  - agentContext 5 边界 OK"
echo "  - backend 自 resolve UUID（不再 invalid input syntax for type uuid 错误）"
