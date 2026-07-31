#!/usr/bin/env bash
set -euo pipefail

: "${ADB:?}"
: "${E2E_DATABASE_URL:?}"
: "${API_BASE:?}"
: "${E2E_TENANT_ID:?}"
: "${E2E_USER_ID:?}"
: "${E2E_AGENT_UUID:?}"
: "${E2E_MACHINE_ID:?}"
: "${AGENT_PACKAGE:?}"
: "${AGENT_ACTIVITY:?}"
: "${GITHUB_RUN_ID:?}"
: "${HEAD_SHA:?}"
: "${ATTEMPT_MARKER:?}"
: "${REPEAT_INDEX:?}"

ADB_SERIAL=$("$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
test -n "$ADB_SERIAL"
TASK_ID=$(psql "$E2E_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 \
  -v tenant_id="$E2E_TENANT_ID" -v agent_id="$E2E_AGENT_UUID" <<'SQL'
INSERT INTO zenithjoy.acquisition_collect_tasks
  (tenant_id, keywords, source, status, agent_id, started_at)
VALUES
  (:'tenant_id', '["装修"]'::jsonb, 'manual', 'pending', :'agent_id', NULL)
RETURNING id;
SQL
)
TASK_ID=$(printf '%s' "$TASK_ID" | tail -1 | tr -d '[:space:]')
test -n "$TASK_ID"

# The E2E app was registered by candidate-setup. Starting the exported Activity
# is safe on Android 14 and keeps the production package/config untouched.
"$ADB" logcat -c
"$ADB" shell am start -W -n "$AGENT_PACKAGE/$AGENT_ACTIVITY" >/dev/null
APP_PID=$("$ADB" shell pidof -s "$AGENT_PACKAGE" | tr -d '\r')
test -n "$APP_PID"

for poll in $(seq 1 50); do
  TASK_ROW=$(psql "$E2E_DATABASE_URL" -X -Atq -F $'\t' \
    -v task_id="$TASK_ID" <<'SQL'
SELECT status, agent_id, started_at
  FROM zenithjoy.acquisition_collect_tasks
 WHERE id = :'task_id';
SQL
)
  IFS=$'\t' read -r TASK_STATUS TASK_AGENT_ID _TASK_STARTED_AT <<<"$TASK_ROW"
  if [ "$TASK_STATUS" = "running" ] \
    && [ "$TASK_AGENT_ID" = "$E2E_AGENT_UUID" ]; then
    break
  fi
  test "$poll" -lt 50
  sleep 1
done
test "$TASK_STATUS" = "running"
test "$TASK_AGENT_ID" = "$E2E_AGENT_UUID"
echo "task status before cancel=$TASK_STATUS agent_id=$TASK_AGENT_ID"

CANCEL_RESPONSE_FILE="${RUNNER_TEMP:-/tmp}/cancel-response-$REPEAT_INDEX.json"
set +e
CANCEL_HTTP_STATUS=$(curl --silent --show-error \
  --output "$CANCEL_RESPONSE_FILE" --write-out '%{http_code}' \
  -X POST "$API_BASE/api/acquisition/collect/cancel" \
  -H "Content-Type: application/json" \
  -H "X-Feishu-User-Id: $E2E_USER_ID" \
  --data "{\"task_id\":\"$TASK_ID\"}")
CANCEL_CURL_EXIT=$?
set -e
CANCEL_RESPONSE=$(cat "$CANCEL_RESPONSE_FILE" 2>/dev/null || true)
if [ "$CANCEL_CURL_EXIT" -ne 0 ] || [ "$CANCEL_HTTP_STATUS" != "200" ]; then
  TASK_STATUS_AFTER_CANCEL=$(psql "$E2E_DATABASE_URL" -X -Atq \
    -v task_id="$TASK_ID" <<'SQL'
SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id = :'task_id';
SQL
)
  echo "cancel request failed: curl_exit=$CANCEL_CURL_EXIT http=$CANCEL_HTTP_STATUS task_status=$TASK_STATUS_AFTER_CANCEL body=$CANCEL_RESPONSE" >&2
  exit 1
fi
jq -e --arg task_id "$TASK_ID" \
  '.success == true and .data.task_id == $task_id and .data.status == "cancelling"' \
  <<<"$CANCEL_RESPONSE" >/dev/null

ACTIVE_LOG=""
for poll in $(seq 1 30); do
  ACTIVE_LOG=$("$ADB" logcat --pid="$APP_PID" -d -v brief 2>/dev/null || true)
  if grep -Fq "dispatchTask(stage1) keyword=装修 taskId=$TASK_ID" <<<"$ACTIVE_LOG" \
    && grep -Fq "stage1 task received: keyword=装修 id=$TASK_ID" <<<"$ACTIVE_LOG"; then
    break
  fi
  test "$poll" -lt 30
  sleep 1
done
grep -Fq "dispatchTask(stage1) keyword=装修 taskId=$TASK_ID" <<<"$ACTIVE_LOG"
grep -Fq "stage1 task received: keyword=装修 id=$TASK_ID" <<<"$ACTIVE_LOG"

CANCEL_LOG=""
for poll in $(seq 1 40); do
  CANCEL_LOG=$("$ADB" logcat --pid="$APP_PID" -d -v brief 2>/dev/null || true)
  FINAL_STATUS=$(psql "$E2E_DATABASE_URL" -X -Atq \
    -v task_id="$TASK_ID" <<'SQL'
SELECT status
  FROM zenithjoy.acquisition_collect_tasks
 WHERE id = :'task_id';
SQL
)
  if [ "$FINAL_STATUS" = "cancelled" ] \
    && grep -Fq "acquisition_cancel safe_exit=true report_status=cancelled taskId=$TASK_ID" <<<"$CANCEL_LOG"; then
    break
  fi
  test "$poll" -lt 40
  sleep 1
done

FINAL_ROW=$(psql "$E2E_DATABASE_URL" -X -Atq -F $'\t' \
  -v task_id="$TASK_ID" <<'SQL'
SELECT status,
       to_char(cancel_requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(cancel_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       ROUND(EXTRACT(EPOCH FROM (cancel_sent_at - cancel_requested_at)) * 1000)::bigint,
       device_machine_id,
       cancel_command_id::text,
       (cancel_requested_at <= cancel_sent_at AND cancel_sent_at <= cancelled_at)::text
  FROM zenithjoy.acquisition_collect_tasks
 WHERE id = :'task_id' AND status = 'cancelled';
SQL
)
IFS=$'\t' read -r FINAL_STATUS CANCEL_REQUESTED_AT COMMAND_RECEIVED_AT CANCELLED_AT ENDED_AT DELIVERY_MS DEVICE_MACHINE_ID COMMAND_ID LIFECYCLE_ORDER_OK <<<"$FINAL_ROW"
test "$FINAL_STATUS" = "cancelled"
test -n "$CANCEL_REQUESTED_AT"
test -n "$COMMAND_RECEIVED_AT"
test -n "$CANCELLED_AT"
test -n "$ENDED_AT"
test "$DELIVERY_MS" -ge 0
test "$DELIVERY_MS" -le 30000
test "$DEVICE_MACHINE_ID" = "$E2E_MACHINE_ID"
test "$LIFECYCLE_ORDER_OK" = "true"
grep -Fq "acquisition_cancel safe_exit=true report_status=cancelled taskId=$TASK_ID" <<<"$CANCEL_LOG"
grep -Fq "ws1 task: android id=$COMMAND_ID type=acquisition_cancel" <<<"$CANCEL_LOG"

COMMAND_ROW=$(psql "$E2E_DATABASE_URL" -X -Atq -F $'\t' \
  -v task_id="$TASK_ID" <<'SQL'
SELECT count(*) OVER (), id::text, agent_id::text, status,
       to_char(receipt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  FROM zenithjoy.publish_tasks
 WHERE task_type = 'acquisition_cancel'
   AND payload->>'collect_task_id' = :'task_id';
SQL
)
IFS=$'\t' read -r COMMAND_COUNT PERSISTED_COMMAND_ID COMMAND_AGENT_ID COMMAND_STATUS COMMAND_RECEIPT_AT <<<"$COMMAND_ROW"
test "$COMMAND_COUNT" -eq 1
test "$PERSISTED_COMMAND_ID" = "$COMMAND_ID"
test "$COMMAND_AGENT_ID" = "$E2E_AGENT_UUID"
test "$COMMAND_STATUS" = "completed"
test -n "$COMMAND_RECEIPT_AT"

# Observe the actual E2E process after its success log. A frozen immediate
# snapshot cannot prove collection stayed stopped.
sleep 5
CANCEL_LOG=$("$ADB" logcat --pid="$APP_PID" -d -v brief 2>/dev/null || true)
WINDOW_XML="${RUNNER_TEMP:-/tmp}/cancel-window-$REPEAT_INDEX.xml"
# ADB is an SSH-backed proxy: a local destination passed to `adb pull` would
# be interpreted on the Xian host, not on this US runner. Stream the UI dump
# over stdout so the evidence lands in the runner's own filesystem.
"$ADB" exec-out uiautomator dump /dev/tty > "$WINDOW_XML"
if grep -qE '切换账号|选择账号' "$WINDOW_XML"; then PANEL_OPEN=true; else PANEL_OPEN=false; fi
CONTINUED_LIST_READS=$(sed -n "/acquisition_cancel safe_exit=true report_status=cancelled taskId=$TASK_ID/,\$p" \
  <<<"$CANCEL_LOG" \
  | grep -cE 'handleSearchResults:|Stage1 card#|Stage1 collected|extracted [0-9]+ comments|openSearchBar:|triggerSearch:' \
  || true)
test "$PANEL_OPEN" = false
test "$CONTINUED_LIST_READS" -eq 0

mkdir -p sprints/07310943-kernel-0e82adad/evidence/android
jq -n \
  --argjson github_run_id "$GITHUB_RUN_ID" --arg head_sha "$HEAD_SHA" \
  --arg attempt_marker "$ATTEMPT_MARKER" --argjson repeat_index "$REPEAT_INDEX" \
  --arg machine_id "$DEVICE_MACHINE_ID" --arg adb_serial "$ADB_SERIAL" \
  --arg cancel_requested_at "$CANCEL_REQUESTED_AT" --arg command_received_at "$COMMAND_RECEIVED_AT" \
  --arg cancelled_at "$CANCELLED_AT" --arg task_id "$TASK_ID" \
  --arg ended_at "$ENDED_AT" --arg command_id "$COMMAND_ID" \
  --arg agent_package "$AGENT_PACKAGE" --arg database_status "$FINAL_STATUS" \
  --argjson delivery_ms "$DELIVERY_MS" \
  --argjson panel_open "$PANEL_OPEN" --argjson continued_list_reads "$CONTINUED_LIST_READS" \
  '{github_run_id:$github_run_id,head_sha:$head_sha,attempt_marker:$attempt_marker,repeat_index:$repeat_index,
    scenario:"cancel",safe_exit:true,switch_account_panel_open:$panel_open,continued_list_reads:$continued_list_reads,
    report_status:"cancelled",machine_id:$machine_id,adb_serial:$adb_serial,
    task_id:$task_id,agent_package:$agent_package,database_status:$database_status,
    cancel_requested_at:$cancel_requested_at,command_received_at:$command_received_at,
    cancelled_at:$cancelled_at,ended_at:$ended_at,command_id:$command_id,
    cancel_delivery_ms:$delivery_ms}' \
  > "sprints/07310943-kernel-0e82adad/evidence/android/result-$REPEAT_INDEX.json"

echo "PASS: physical Android cancellation completed for task $TASK_ID in ${DELIVERY_MS}ms"
