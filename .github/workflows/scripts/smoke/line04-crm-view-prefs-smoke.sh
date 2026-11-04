#!/usr/bin/env bash
# Isolated real API/Postgres fixture: authenticated PUT followed by exact GET.
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5200}"
# This writes only disposable fixtures, never an inferred production identity.
[ "${SMOKE_SCRATCH_API:-}" = 1 ] || { echo 'FAIL: SMOKE_SCRATCH_API=1 required for isolated CI fixture writes'; exit 1; }
node - "$API_BASE" <<'JS'
const u=new URL(process.argv[2]);
if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('scratch smoke requires a loopback API');
JS

: "${ZENITHJOY_INTERNAL_TOKEN:?scratch API internal credential required}"
case "${PSQL_HOST:-${PGHOST:-localhost}}" in localhost|127.0.0.1|::1) ;; *) echo 'FAIL: scratch DB must be loopback'; exit 1;; esac
CS="view-prefs-smoke-$$"
TMP=$(mktemp -d)
TENANT=''
psql_q(){ PGPASSWORD="${PSQL_PASS:-${PGPASSWORD:-cecelia}}" psql -h "${PSQL_HOST:-localhost}" -U "${PSQL_USER:-cecelia}" -d "${PSQL_DB:-cecelia}" -v ON_ERROR_STOP=1 -qtAc "$1"; }
cleanup(){ if [ -n "$TENANT" ]; then psql_q "DELETE FROM zenithjoy.crm_view_prefs WHERE tenant_id='$TENANT'; DELETE FROM zenithjoy.service_agents WHERE tenant_id='$TENANT'; DELETE FROM zenithjoy.tenants WHERE id='$TENANT';" >/dev/null; fi; rm -rf "$TMP"; }
trap cleanup EXIT
TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name,license_key) VALUES ('$CS','$CS') RETURNING id")
[[ "$TENANT" =~ ^[0-9a-f-]{36}$ ]] || { echo 'FAIL: no fixture tenant'; exit 1; }
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id,machine_id,wechat_id) VALUES ('$TENANT','$CS','$CS');" >/dev/null
request(){ curl -sS --max-time 20 -H "X-Internal-Token: $ZENITHJOY_INTERNAL_TOKEN" -H "X-User-Email: ${SMOKE_ADMIN_EMAIL:-boss@zenjoymedia.media}" "$@"; }
CODE=$(request -o "$TMP/response" -w '%{http_code}' "$API_BASE/api/crm/view-prefs")
[ "$CODE" = 400 ] || { echo "FAIL: expected validation HTTP 400, got $CODE"; exit 1; }
jq -e '.error.code == "CS_WECHAT_ID_REQUIRED"' "$TMP/response" >/dev/null
CODE=$(request -o "$TMP/response" -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS\"}" "$API_BASE/api/crm/view-prefs")
[ "$CODE" = 400 ] || { echo "FAIL: expected validation HTTP 400, got $CODE"; exit 1; }
jq -e '.error.code == "PREFS_REQUIRED"' "$TMP/response" >/dev/null
PREFS='{"views":[{"id":"smoke","name":"CI persisted view","columnState":[],"sortModel":[],"filterModel":{},"quickFilter":"persisted-marker"}],"activeViewId":"smoke"}'
PAYLOAD=$(jq -n --arg cs "$CS" --argjson prefs "$PREFS" '{wechat_id:$cs,prefs:$prefs}')
CODE=$(request -o "$TMP/response" -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -d "$PAYLOAD" "$API_BASE/api/crm/view-prefs")
[ "$CODE" = 200 ] || { echo "FAIL: prefs write HTTP $CODE"; exit 1; }
jq -e '.success == true' "$TMP/response" >/dev/null
CODE=$(request -o "$TMP/response" -w '%{http_code}' "$API_BASE/api/crm/view-prefs?cs_wechat_id=$CS")
[ "$CODE" = 200 ] || { echo "FAIL: prefs read HTTP $CODE"; exit 1; }
jq -e --argjson expected "$PREFS" '.success == true and .data.prefs == $expected' "$TMP/response" >/dev/null
# Read the persisted value back through a second request; a fake successful PUT
# or a missing route/auth failure cannot satisfy the exact value comparison.
echo 'PASS: CRM view preferences persisted and read back exactly'
