#!/usr/bin/env bash
set -uo pipefail

# Always attempt the remaining cleanup, but never turn a failed cleanup into a
# successful receipt. This is an always-step helper, not an empty-env smoke.
FAILURES=0
SCOPES=0
failed() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }

AGENT_PACKAGE="${AGENT_PACKAGE:-com.zenithjoy.agent.e2e}"
if [[ "$AGENT_PACKAGE" != *.e2e ]]; then
  echo "FAIL: cleanup only accepts an .e2e candidate package" >&2
  exit 1
fi

if [ -n "${ADB:-}" ]; then
  SCOPES=$((SCOPES + 1))
  if [ -f "${RUNNER_TEMP:-}/r16-accessibility-services-before.txt" ]; then
    ACCESSIBILITY_UI="$(dirname "$0")/line02-android-accessibility-ui.sh"
    "$ACCESSIBILITY_UI" restore || failed "accessibility restore"
  fi
  "$ADB" shell am force-stop "$AGENT_PACKAGE" >/dev/null 2>&1 || failed "candidate force-stop"
  "$ADB" uninstall "$AGENT_PACKAGE" >/dev/null 2>&1 || failed "candidate uninstall"
fi

if [ -n "${E2E_DATABASE_URL:-}" ] && [ -n "${E2E_TENANT_ID:-}" ]; then
  SCOPES=$((SCOPES + 1))
  LICENSE_ID="${E2E_LICENSE_ID:-00000000-0000-0000-0000-000000000000}"
  psql "$E2E_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -v tenant_id="$E2E_TENANT_ID" \
    -v license_id="$LICENSE_ID" <<'SQL'
BEGIN;
DELETE FROM zenithjoy.publish_tasks WHERE tenant_id = :'tenant_id';
DELETE FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id = :'tenant_id';
DELETE FROM zenithjoy.agents WHERE tenant_id = :'tenant_id';
DELETE FROM zenithjoy.license_machines WHERE license_id = :'license_id';
DELETE FROM zenithjoy.licenses WHERE id = :'license_id';
DELETE FROM zenithjoy.tenant_members WHERE tenant_id = :'tenant_id';
DELETE FROM zenithjoy.tenants WHERE id = :'tenant_id';
COMMIT;
SQL
  [ "$?" -eq 0 ] || failed "candidate database deletion"
  RESIDUAL_COUNT=$(psql "$E2E_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 \
    -v tenant_id="$E2E_TENANT_ID" -v license_id="$LICENSE_ID" <<'SQL'
SELECT
  (SELECT count(*) FROM zenithjoy.tenants WHERE id = :'tenant_id')
  + (SELECT count(*) FROM zenithjoy.agents WHERE tenant_id = :'tenant_id')
  + (SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id = :'tenant_id')
  + (SELECT count(*) FROM zenithjoy.licenses WHERE id = :'license_id');
SQL
)
  if [ "$?" -ne 0 ]; then
    failed "candidate residual query"
  elif [[ ! "$RESIDUAL_COUNT" =~ ^[0-9]+$ ]] || [ "$RESIDUAL_COUNT" -ne 0 ]; then
    failed "candidate residual count is not zero"
  fi
elif [ -n "${E2E_DATABASE_URL:-}${E2E_TENANT_ID:-}" ]; then
  failed "both E2E_DATABASE_URL and E2E_TENANT_ID are required for database cleanup"
fi

if [ -n "${API_PID:-}" ]; then
  SCOPES=$((SCOPES + 1))
  if [[ ! "$API_PID" =~ ^[1-9][0-9]*$ ]]; then
    failed "invalid API_PID"
  elif kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" >/dev/null 2>&1 || failed "candidate API termination"
  fi
fi

[ "$SCOPES" -gt 0 ] || failed "no candidate cleanup scope supplied"
[ "$FAILURES" -eq 0 ] || exit 1
echo "PASS: candidate Android fixture cleaned up; production app untouched"
