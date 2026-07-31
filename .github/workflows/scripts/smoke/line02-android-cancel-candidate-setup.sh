#!/usr/bin/env bash
set -euo pipefail

: "${ADB:?}"
: "${E2E_DATABASE_URL:?}"
: "${API_BASE:?}"
: "${API_WS_URL:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"
: "${GITHUB_ENV:?}"
: "${RUNNER_TEMP:?}"

AGENT_PACKAGE="${AGENT_PACKAGE:-com.zenithjoy.agent.e2e}"
AGENT_ACTIVITY="${AGENT_ACTIVITY:-com.zenithjoy.agent.MainActivity}"
ACCESSIBILITY_SERVICE="$AGENT_PACKAGE/com.zenithjoy.agent.collect.DouyinCollectService"

TENANT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
LICENSE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
LICENSE_SUFFIX=$(printf '%s-%s' "$GITHUB_RUN_ID" "$(date +%s%N)" | shasum -a 256 | cut -c1-8 | tr '[:lower:]' '[:upper:]')
LICENSE_KEY="ZJ-B-$LICENSE_SUFFIX"
E2E_USER_ID="r16-android-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$LICENSE_SUFFIX"

echo "::add-mask::$LICENSE_KEY"
psql "$E2E_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v tenant_id="$TENANT_ID" \
  -v license_id="$LICENSE_ID" \
  -v license_key="$LICENSE_KEY" \
  -v user_id="$E2E_USER_ID" <<'SQL'
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES (:'tenant_id', 'R16 Android candidate', :'license_key', 'free');
INSERT INTO zenithjoy.licenses
  (id, license_key, tier, max_machines, customer_id, customer_name,
   status, expires_at, tenant_id, is_test)
VALUES
  (:'license_id', :'license_key', 'basic', 1, :'user_id',
   'R16 Android candidate', 'active', NOW() + interval '1 day', :'tenant_id', true);
INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES (:'tenant_id', :'user_id', 'owner');
SQL

"$ADB" shell settings get secure enabled_accessibility_services \
  | tr -d '\r' > "$RUNNER_TEMP/r16-accessibility-services-before.txt"
"$ADB" shell settings get secure accessibility_enabled \
  | tr -d '\r' > "$RUNNER_TEMP/r16-accessibility-enabled-before.txt"
BEFORE_SERVICES=$(cat "$RUNNER_TEMP/r16-accessibility-services-before.txt")
if [ "$BEFORE_SERVICES" = "null" ]; then BEFORE_SERVICES=""; fi
"$ADB" shell am force-stop "$AGENT_PACKAGE" || true
ACCESSIBILITY_UI="$(dirname "$0")/line02-android-accessibility-ui.sh"
"$ACCESSIBILITY_UI" enable

ENCODED_API=$(jq -rn --arg value "$API_WS_URL" '$value|@uri')
BIND_URI="zenithjoy://bind?license=$LICENSE_KEY&api=$ENCODED_API"
# `adb shell` reconstructs argv into an on-device shell command. Without
# literal quote characters around the URI, `&api=...` becomes a shell control
# operator and MainActivity receives only the license parameter.
ADB_BIND_URI="'$BIND_URI'"
"$ADB" shell am start -W -n "$AGENT_PACKAGE/$AGENT_ACTIVITY" \
  -a android.intent.action.VIEW -d "$ADB_BIND_URI" >/dev/null
# Fresh E2E install asks for MediaProjection. Denial is an allowed production
# path and starts AgentService without content judgment, which this cancel
# scenario does not need.
sleep 1
"$ADB" shell input keyevent 4 || true

AGENT_ROW=""
for _ in $(seq 1 40); do
  AGENT_ROW=$(psql "$E2E_DATABASE_URL" -X -Atq -F $'\t' \
    -v ON_ERROR_STOP=1 -v tenant_id="$TENANT_ID" -v license_id="$LICENSE_ID" <<'SQL'
SELECT a.id::text, a.agent_id, lm.machine_id
  FROM zenithjoy.agents a
  JOIN zenithjoy.license_machines lm
    ON lm.license_id = a.license_id
   AND lm.agent_id = a.agent_id
   AND lm.status = 'active'
 WHERE a.tenant_id = :'tenant_id'
   AND a.license_id = :'license_id'
   AND a.status = 'online'
   AND a.os_type = 'android'
   AND a.capabilities @> ARRAY['android']::text[]
   AND a.last_heartbeat_at > NOW() - interval '60 seconds'
 ORDER BY a.created_at DESC
 LIMIT 1;
SQL
)
  [ -n "$AGENT_ROW" ] && break
  sleep 1
done
[ -n "$AGENT_ROW" ]
IFS=$'\t' read -r AGENT_UUID AGENT_RUNTIME_ID E2E_MACHINE_ID <<<"$AGENT_ROW"
[ -n "$AGENT_UUID" ]
[ -n "$AGENT_RUNTIME_ID" ]
[ -n "$E2E_MACHINE_ID" ]

{
  echo "E2E_TENANT_ID=$TENANT_ID"
  echo "E2E_LICENSE_ID=$LICENSE_ID"
  echo "E2E_USER_ID=$E2E_USER_ID"
  echo "E2E_AGENT_UUID=$AGENT_UUID"
  echo "E2E_AGENT_RUNTIME_ID=$AGENT_RUNTIME_ID"
  echo "E2E_MACHINE_ID=$E2E_MACHINE_ID"
  echo "AGENT_PACKAGE=$AGENT_PACKAGE"
  echo "AGENT_ACTIVITY=$AGENT_ACTIVITY"
} >> "$GITHUB_ENV"

echo "PASS: candidate tenant/license/agent registered on physical Android device"
