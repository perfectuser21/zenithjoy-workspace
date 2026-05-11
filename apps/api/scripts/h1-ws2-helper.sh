#!/usr/bin/env bash
# apps/api/scripts/h1-ws2-helper.sh — H-1 ws2 BEHAVIOR helper
set -euo pipefail
PSQL="psql -h ${DATABASE_HOST:-127.0.0.1} -U ${DATABASE_USER:-zenithjoy} -d ${DATABASE_NAME:-zenithjoy} -tA"
export PGPASSWORD="${DATABASE_PASSWORD:-}"

case "${1:-}" in
  apply_migration)
    F=$(ls "$(dirname "$0")/.."/db/migrations/*publish_tasks_status_enum*.sql 2>/dev/null | head -1)
    [ -n "$F" ] || { echo "no migration found"; exit 1; }
    $PSQL -f "$F"
    ;;
  test_new_statuses)
    "$0" apply_migration >/dev/null 2>&1 || true
    TS=$(date +%s)
    AID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES ('h1ws2-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
    for st in queued dispatched in_progress completed; do
      R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${AID}', 'douyin', '${st}') RETURNING id" 2>&1)
      echo "$R" | grep -qE '^[0-9a-f-]{36}$' || { echo "FAIL $st: $R"; exit 1; }
    done
    echo OK
    ;;
  test_invalid_status)
    TS=$(date +%s)
    AID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES ('h1ws2bad-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
    R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${AID}', 'douyin', 'banana') RETURNING id" 2>&1 || true)
    echo "$R" | grep -qiE 'violates check constraint|chk_publish_tasks_status'
    ;;
  verify_constraint_def)
    CDEF=$($PSQL -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_publish_tasks_status'")
    for s in pending running success failed done queued dispatched in_progress completed; do
      echo "$CDEF" | grep -q "'${s}'" || { echo "missing $s in: $CDEF"; exit 1; }
    done
    echo OK
    ;;
  test_legacy_statuses)
    TS=$(date +%s)
    AID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES ('h1ws2bc-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
    for st in pending running success failed done; do
      R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${AID}', 'douyin', '${st}') RETURNING id" 2>&1)
      echo "$R" | grep -qE '^[0-9a-f-]{36}$' || { echo "FAIL $st: $R"; exit 1; }
    done
    echo OK
    ;;
  *)
    echo "Usage: $0 {apply_migration|test_new_statuses|test_invalid_status|verify_constraint_def|test_legacy_statuses}" >&2
    exit 2
    ;;
esac
