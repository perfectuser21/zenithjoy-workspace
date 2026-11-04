#!/usr/bin/env bash
# Scratch API/DB integration: invalidate only this agent's active Douyin burners.
set -euo pipefail
API_BASE="${SMOKE_API_BASE:-${API_BASE:-http://localhost:5200}}"
[ "${SMOKE_SCRATCH_API:-}" = 1 ] || { echo 'FAIL: disposable CI fixture authorization required'; exit 1; }
node - "$API_BASE" <<'JS'
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(process.argv[2]).hostname))throw Error('loopback scratch API required');
JS
case "${PGHOST:-${DATABASE_HOST:-localhost}}" in localhost|127.0.0.1|::1) ;; *) echo 'FAIL: loopback scratch DB required'; exit 1;; esac
psql_q(){ PGPASSWORD="${PGPASSWORD:-${DATABASE_PASSWORD:-cecelia}}" psql -h "${PGHOST:-${DATABASE_HOST:-localhost}}" -p "${PGPORT:-${DATABASE_PORT:-5432}}" -U "${PGUSER:-${DATABASE_USER:-cecelia}}" -d "${PGDATABASE:-${DATABASE_NAME:-cecelia}}" -v ON_ERROR_STOP=1 -qtAc "$1"; }
TMP=$(mktemp -d); TENANT=''
cleanup(){ if [ -n "$TENANT" ]; then psql_q "DELETE FROM zenithjoy.tenants WHERE id='$TENANT'" >/dev/null; fi; rm -rf "$TMP"; }
trap cleanup EXIT
TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name,license_key) VALUES ('invalidate-smoke-$$','invalidate-smoke-$$') RETURNING id")
[[ "$TENANT" =~ ^[0-9a-f-]{36}$ ]] || { echo 'FAIL: no scratch tenant'; exit 1; }
AGENT=$(psql_q "INSERT INTO zenithjoy.agents (tenant_id,agent_id,hostname,status) VALUES ('$TENANT','invalidate-agent-$$','scratch-agent','online') RETURNING id")
CONTROL=$(psql_q "INSERT INTO zenithjoy.agents (tenant_id,agent_id,hostname,status) VALUES ('$TENANT','invalidate-control-$$','scratch-control','online') RETURNING id")
psql_q "INSERT INTO zenithjoy.agent_platform_sessions (agent_id,platform,account_label,role,status) VALUES ('$AGENT','douyin','burner','burner','active'),('$AGENT','douyin','primary','main','active'),('$CONTROL','douyin','control','burner','active')" >/dev/null
CODE=$(curl -sS --max-time 20 -o "$TMP/unauth" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"reason":"DOUYIN_SESSION_EXPIRED"}' "$API_BASE/api/agent/burner/sessions/invalidate")
[ "$CODE" = 401 ] || { echo "FAIL: missing context HTTP $CODE"; exit 1; }
jq -e '.error.code == "NO_TENANT_FOR_AGENT_CONTEXT"' "$TMP/unauth" >/dev/null
CODE=$(curl -sS --max-time 20 -o "$TMP/invalidate" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"agent_id\":\"$AGENT\",\"reason\":\"DOUYIN_SESSION_EXPIRED\"}" "$API_BASE/api/agent/burner/sessions/invalidate")
[ "$CODE" = 200 ] || { echo "FAIL: invalidation HTTP $CODE"; exit 1; }
jq -e '.success == true and .data.invalidated == 1 and .data.reason == "DOUYIN_SESSION_EXPIRED"' "$TMP/invalidate" >/dev/null
ACTUAL=$(psql_q "SELECT string_agg(account_label || ':' || status, ',' ORDER BY account_label) FROM zenithjoy.agent_platform_sessions WHERE agent_id IN ('$AGENT','$CONTROL')")
[ "$ACTUAL" = 'burner:needs_rebind,control:active,primary:active' ] || { echo "FAIL: invalidation scope/readback $ACTUAL"; exit 1; }
echo 'PASS: expired burner persisted; primary and other agent unchanged'
