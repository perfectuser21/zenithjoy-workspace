#!/usr/bin/env bash
set -u

AGENT_PACKAGE="${AGENT_PACKAGE:-com.zenithjoy.agent.e2e}"

if [ -n "${ADB:-}" ]; then
  if [ -f "${RUNNER_TEMP:-}/r16-accessibility-services-before.txt" ]; then
    ACCESSIBILITY_UI="$(dirname "$0")/line02-android-accessibility-ui.sh"
    "$ACCESSIBILITY_UI" restore
  fi
  "$ADB" shell am force-stop "$AGENT_PACKAGE" >/dev/null 2>&1 || true
  "$ADB" uninstall "$AGENT_PACKAGE" >/dev/null 2>&1 || true
fi

if [ -n "${E2E_DATABASE_URL:-}" ] && [ -n "${E2E_TENANT_ID:-}" ]; then
  psql "$E2E_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -v tenant_id="$E2E_TENANT_ID" \
    -v license_id="${E2E_LICENSE_ID:-00000000-0000-0000-0000-000000000000}" <<'SQL'
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
  RESIDUAL_COUNT=$(psql "$E2E_DATABASE_URL" -X -Atq \
    -v tenant_id="$E2E_TENANT_ID" -v license_id="$E2E_LICENSE_ID" <<'SQL'
SELECT
  (SELECT count(*) FROM zenithjoy.tenants WHERE id = :'tenant_id')
  + (SELECT count(*) FROM zenithjoy.agents WHERE tenant_id = :'tenant_id')
  + (SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id = :'tenant_id')
  + (SELECT count(*) FROM zenithjoy.licenses WHERE id = :'license_id');
SQL
)
  test "$RESIDUAL_COUNT" -eq 0
fi

if [ -n "${API_PID:-}" ]; then
  kill "$API_PID" >/dev/null 2>&1 || true
fi

echo "PASS: candidate Android fixture cleaned up; production app untouched"
