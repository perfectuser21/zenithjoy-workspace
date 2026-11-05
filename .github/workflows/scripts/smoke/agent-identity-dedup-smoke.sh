#!/usr/bin/env bash
# Verify agent identity deduplication and tenant/host isolation using an isolated
# PostgreSQL/API fixture; old QR creation must now return 410 without new work.
# Real pinned-agent selection is exercised by the required real-PG suite.

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"

PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

psql_q() {
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -t -A -c "$1"
}

TENANT_A="dddddddd-1111-2222-3333-aaaaaaaaaaaa"
TENANT_B="dddddddd-1111-2222-3333-bbbbbbbbbbbb"
LICENSE_A="ZJ-IDENTITY-DEDUP-A01"
HOST_ROG="XX-ROG-SMOKE"
HOST_PC="XX-PC-SMOKE"
TS="$(date +%s)"

echo "==> [bootstrap] 建 tenant A/B + license + 清旧 agents（idempotent）"
PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 <<EOF
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_A}', 'IdentityDedup-A', '${LICENSE_A}', 'matrix')
ON CONFLICT (license_key) DO NOTHING;
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('${TENANT_B}', 'IdentityDedup-B', '${LICENSE_A}-B', 'matrix')
ON CONFLICT (license_key) DO NOTHING;
INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, expires_at, tenant_id, status)
VALUES ('${LICENSE_A}', 'matrix', 3, '', now() + interval '365 days', '${TENANT_A}', 'active')
ON CONFLICT (license_key) DO NOTHING;

DELETE FROM zenithjoy.publish_tasks WHERE agent_id IN
  (SELECT id FROM zenithjoy.agents WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}'));
DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id IN
  (SELECT id FROM zenithjoy.agents WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}'));
UPDATE zenithjoy.licenses SET pinned_agent_id = NULL WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}');
DELETE FROM zenithjoy.agents WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}');
EOF
echo "  OK: bootstrap 完成"

mock_agent() { # tenant agent_id_text hostname
  curl -fsS -X POST -H "Content-Type: application/json" -H "X-Smoke-Token: ${SMOKE_TOKEN}" \
    -d "{\"tenant_id\":\"$1\",\"agent_id_text\":\"$2\",\"hostname\":\"$3\"}" \
    "${API_BASE}/api/_smoke/mock-agent" | sed -E 's/.*"agent_uuid":"([^"]+)".*/\1/' | head -c 64
}

echo "==> [1/5] 同 hostname 两个不同 agent_id_text → agents 只剩 1 行"
UUID1=$(mock_agent "$TENANT_A" "ws1-${TS}-heartbeat" "$HOST_ROG")
UUID2=$(mock_agent "$TENANT_A" "agent-env-${TS}-ws" "$HOST_ROG")
ROW_CNT=$(psql_q "SELECT count(*) FROM zenithjoy.agents WHERE tenant_id='${TENANT_A}' AND hostname='${HOST_ROG}';")
[ "$ROW_CNT" = "1" ] || { echo "  FAIL: 期望 1 行, 实际 ${ROW_CNT}（裂行未修）"; exit 1; }
echo "  OK: 同 hostname 去重为 1 行"

echo "==> [2/5] 两次返回的 agent_uuid 收敛为同一行"
[ -n "$UUID1" ] && [ "$UUID1" = "$UUID2" ] \
  || { echo "  FAIL: uuid 不一致 u1=$UUID1 u2=$UUID2"; exit 1; }
echo "  OK: agent_uuid 一致 = $UUID1"

echo "==> [3/5] 同 tenant 不同 hostname → 各自一行（不误并）"
mock_agent "$TENANT_A" "agent-pc-${TS}" "$HOST_PC" >/dev/null
HOST_CNT=$(psql_q "SELECT count(DISTINCT hostname) FROM zenithjoy.agents WHERE tenant_id='${TENANT_A}';")
[ "$HOST_CNT" = "2" ] || { echo "  FAIL: 期望 2 台不同 hostname, 实际 $HOST_CNT"; exit 1; }
echo "  OK: 不同 hostname 各自一行"

echo "==> [4/5] 不同 tenant 同 hostname → tenant 隔离各自一行"
UUID_B=$(mock_agent "$TENANT_B" "agent-rog-${TS}" "$HOST_ROG")
[ -n "$UUID_B" ] && [ "$UUID_B" != "$UUID1" ] \
  || { echo "  FAIL: 跨 tenant 串行 ub=$UUID_B u1=$UUID1"; exit 1; }
TOTAL_ROG=$(psql_q "SELECT count(*) FROM zenithjoy.agents WHERE hostname='${HOST_ROG}' AND tenant_id IN ('${TENANT_A}','${TENANT_B}');")
[ "$TOTAL_ROG" = "2" ] || { echo "  FAIL: 同 hostname 跨2 tenant 期望 2 行, 实际 $TOTAL_ROG"; exit 1; }
echo "  OK: tenant 隔离成立"

echo "==> [5/5] 旧 qr-bind 创建必须拒绝，不新增任务"
BEFORE=$(psql_q "SELECT count(*) FROM zenithjoy.publish_tasks WHERE tenant_id='${TENANT_A}'")
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
CODE=$(curl -s -o "$TMP" -w '%{http_code}' -X POST -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_A}" -d "{\"agent_id\":\"${UUID1}\",\"account_label\":\"dedup-burner\"}" \
  "${API_BASE}/api/agent/burner/qr-bind")
[ "$CODE" = 410 ] || { echo "FAIL: retired qr-bind expected 410, got $CODE"; exit 1; }
node -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).error?.code!=="LEGACY_ACQUISITION_RETIRED")process.exit(1)' "$TMP"
AFTER=$(psql_q "SELECT count(*) FROM zenithjoy.publish_tasks WHERE tenant_id='${TENANT_A}'")
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: retired creation inserted task"; exit 1; }
echo "agent identity isolation and retired creation refusal PASS; Skill/device acceptance not verified"
