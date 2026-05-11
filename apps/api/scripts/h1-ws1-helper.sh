#!/usr/bin/env bash
# apps/api/scripts/h1-ws1-helper.sh — H-1 ws1 BEHAVIOR helper
# 单独 build + 单独 background node + trap stop_server 兜底
set -euo pipefail
PSQL="psql -h ${DATABASE_HOST:-127.0.0.1} -U ${DATABASE_USER:-zenithjoy} -d ${DATABASE_NAME:-zenithjoy} -tA"
export PGPASSWORD="${DATABASE_PASSWORD:-}"
API="http://localhost:5200"

build_if_needed() {
  cd "$(dirname "$0")/.." # apps/api
  if [ ! -f dist/index.js ] || [ src/index.ts -nt dist/index.js ]; then
    npm run build > /dev/null 2>&1
  fi
}

start_server() {
  build_if_needed
  cd "$(dirname "$0")/.."
  node -r dotenv/config dist/index.js > /tmp/h1ws1-srv.log 2>&1 &
  echo $! > /tmp/h1ws1-srv.pid
  sleep 3
  for i in 1 2 3 4 5; do
    if curl -fsS "$API/health" >/dev/null 2>&1 || curl -fsS "$API/api/agent/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "server not ready" >&2
  cat /tmp/h1ws1-srv.log >&2 || true
  return 1
}

stop_server() {
  if [ -f /tmp/h1ws1-srv.pid ]; then
    SPID=$(cat /tmp/h1ws1-srv.pid)
    kill -TERM "$SPID" 2>/dev/null || true
    wait "$SPID" 2>/dev/null || true
    rm -f /tmp/h1ws1-srv.pid
  fi
  lsof -ti:5200 2>/dev/null | xargs -r kill -9 2>/dev/null || true
}

signup_user() {
  local prefix="$1"
  local TS=$(date +%s%N | cut -c1-13)
  local EMAIL="${prefix}-${TS}@example.com"
  local SR=$(curl -fsS -X POST "$API/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"H1${prefix}!2026\",\"name\":\"H1${prefix}\"}")
  local UID=$(echo "$SR" | jq -r '.user.id // empty')
  if [ -z "$UID" ]; then
    echo "signup failed: $SR" >&2; return 1
  fi
  $PSQL -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%${UID}%' OR notes LIKE '%${UID}%' ORDER BY created_at DESC LIMIT 1"
}

trap stop_server EXIT

case "${1:-}" in
  test_first_agent_dual_schema)
    start_server
    LK=$(signup_user "ws1a")
    TS=$(date +%s)
    R=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1a-${TS}\",\"hostname\":\"ws1a\",\"version\":\"0.1.0\"}")
    echo "$R" | jq -e '.ok==true and .success==true and .device_count==1 and .device_limit==1 and (.agent_id|test("^[0-9a-f]{8}-")) and .license_tier=="free" and .tier=="free" and .max_machines==1 and (.ws_token|type=="string") and (.license_id|type=="string")'
    ;;
  test_second_agent_403)
    start_server
    LK=$(signup_user "ws1b")
    TS=$(date +%s)
    curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1b-${TS}-a\",\"hostname\":\"a\",\"version\":\"0.1.0\"}" > /dev/null
    HC=$(curl -s -o /tmp/h1ws1b-r2.json -w "%{http_code}" -X POST "$API/api/agent/register" \
      -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1b-${TS}-b\",\"hostname\":\"b\",\"version\":\"0.1.0\"}")
    [ "$HC" = "403" ] || { echo "HTTP $HC"; cat /tmp/h1ws1b-r2.json; exit 1; }
    jq -e '.error=="LICENSE_DEVICE_LIMIT_EXCEEDED" and .current_count==1 and .limit==1 and .code=="QUOTA_EXCEEDED" and .success==false and .ok==false' /tmp/h1ws1b-r2.json
    ;;
  test_reconnect_no_increment)
    start_server
    LK=$(signup_user "ws1c")
    TS=$(date +%s)
    MID="ws1c-${TS}-same"
    R1=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"$MID\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    R2=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"$MID\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    echo "$R1" | jq -e '.success==true and .device_count==1' && \
    echo "$R2" | jq -e '.success==true and .device_count==1'
    ;;
  test_no_forbidden_fields)
    start_server
    LK=$(signup_user "ws1d")
    TS=$(date +%s)
    R=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1d-${TS}\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    echo "$R" | jq -e '(has("device_quota")|not) and (has("installed_count")|not) and (has("max_devices")|not) and (has("data")|not) and (has("payload")|not)'
    ;;
  test_success_keys_superset)
    start_server
    LK=$(signup_user "ws1e")
    TS=$(date +%s)
    R=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1e-${TS}\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    echo "$R" | jq -e '(["success","agent_id","license_tier","device_count","device_limit"] - keys) == []'
    ;;
  test_error_keys_superset)
    start_server
    LK=$(signup_user "ws1f")
    TS=$(date +%s)
    curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1f-${TS}-a\",\"hostname\":\"a\",\"version\":\"0.1.0\"}" > /dev/null
    HC=$(curl -s -o /tmp/h1ws1f-r2.json -w "%{http_code}" -X POST "$API/api/agent/register" \
      -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1f-${TS}-b\",\"hostname\":\"b\",\"version\":\"0.1.0\"}")
    [ "$HC" = "403" ] || { echo "HTTP $HC"; cat /tmp/h1ws1f-r2.json; exit 1; }
    jq -e '(["success","error","current_count","limit"] - keys) == []' /tmp/h1ws1f-r2.json
    ;;
  *)
    echo "Usage: $0 {test_first_agent_dual_schema|test_second_agent_403|test_reconnect_no_increment|test_no_forbidden_fields|test_success_keys_superset|test_error_keys_superset}" >&2
    exit 2
    ;;
esac
