#!/usr/bin/env bash
# line02/keyword_acquisition#step7 — real API + PostgreSQL merged-bound regression.
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgres://cecelia:cecelia@localhost:5432/cecelia}}"
RUN_TOKEN="$(date +%s)-$$-${RANDOM}"
TMP_DIR=$(mktemp -d)
TENANT_ID=""

cleanup() {
  if [ -n "$TENANT_ID" ]; then
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c \
      "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

for bin in curl jq psql; do
  command -v "$bin" >/dev/null || { echo "FAIL: missing $bin"; exit 1; }
done
curl -fsS "$API_BASE/health" >/dev/null

TENANT_ID=$(psql "$DB_URL" -X -Atq -v ON_ERROR_STOP=1 -c \
  "INSERT INTO zenithjoy.tenants (name, license_key, plan)
   VALUES ('acq-config-eval-$RUN_TOKEN', 'ZJ-F-acq-config-$RUN_TOKEN', 'free')
   RETURNING id")
[ -n "$TENANT_ID" ] || { echo "FAIL: tenant setup returned no id"; exit 1; }

COMPLETE_BODY="$TMP_DIR/complete.json"
COMPLETE_HTTP=$(curl -sS -o "$COMPLETE_BODY" -w '%{http_code}' --max-time 15 \
  -X PUT "$API_BASE/api/acquisition/config" \
  -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"collect_rounds_per_day":2,"keywords_per_round_min":3,"keywords_per_round_max":5,"collect_active_start":"09:00","collect_active_end":"21:00","burner_count":3,"dm_per_hour":5,"dm_per_day":30,"dm_interval_min_sec":300,"dm_interval_max_sec":900,"dm_active_start":"09:00","dm_active_end":"22:00","nurture_per_day_min":1,"nurture_per_day_max":2,"cookie_check_interval_hours":6,"dm_message":"evaluator"}')
[ "$COMPLETE_HTTP" = "200" ] || { echo "FAIL: complete PUT HTTP=$COMPLETE_HTTP body=$(cat "$COMPLETE_BODY")"; exit 1; }
jq -e --arg tenant "$TENANT_ID" \
  '.success == true and .data.tenant_id == $tenant and .data.keywords_per_round_min == 3 and .data.keywords_per_round_max == 5' \
  "$COMPLETE_BODY" >/dev/null

BEFORE_ROW=$(psql "$DB_URL" -X -Atq -v ON_ERROR_STOP=1 -c \
  "SELECT keywords_per_round_min||'|'||keywords_per_round_max||'|'||updated_at::text
     FROM zenithjoy.acquisition_config
    WHERE tenant_id='$TENANT_ID'
      AND updated_at > NOW() - interval '2 minutes'")
[ -n "$BEFORE_ROW" ] || { echo "FAIL: complete update missing from current DB time window"; exit 1; }

INVALID_BODY="$TMP_DIR/invalid.json"
INVALID_HTTP=$(curl -sS -o "$INVALID_BODY" -w '%{http_code}' --max-time 15 \
  -X PUT "$API_BASE/api/acquisition/config" \
  -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords_per_round_min":10}')
[ "$INVALID_HTTP" = "400" ] || { echo "FAIL: invalid partial PUT HTTP=$INVALID_HTTP body=$(cat "$INVALID_BODY")"; exit 1; }
jq -e '.success == false and .error.code == "INVALID_CONFIG"' "$INVALID_BODY" >/dev/null

AFTER_ROW=$(psql "$DB_URL" -X -Atq -v ON_ERROR_STOP=1 -c \
  "SELECT keywords_per_round_min||'|'||keywords_per_round_max||'|'||updated_at::text
     FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID'")
[ "$AFTER_ROW" = "$BEFORE_ROW" ] || {
  echo "FAIL: invalid effective configuration changed persisted row"
  echo "before=$BEFORE_ROW"
  echo "after=$AFTER_ROW"
  exit 1
}

PARTIAL_BODY="$TMP_DIR/partial.json"
PARTIAL_HTTP=$(curl -sS -o "$PARTIAL_BODY" -w '%{http_code}' --max-time 15 \
  -X PUT "$API_BASE/api/acquisition/config" \
  -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords_per_round_max":6}')
[ "$PARTIAL_HTTP" = "200" ] || { echo "FAIL: legal partial PUT HTTP=$PARTIAL_HTTP body=$(cat "$PARTIAL_BODY")"; exit 1; }
jq -e '.success == true and .data.keywords_per_round_min == 3 and .data.keywords_per_round_max == 6' \
  "$PARTIAL_BODY" >/dev/null

FINAL_ROW=$(psql "$DB_URL" -X -Atq -v ON_ERROR_STOP=1 -c \
  "SELECT keywords_per_round_min||'|'||keywords_per_round_max
     FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID'")
[ "$FINAL_ROW" = "3|6" ] || { echo "FAIL: legal partial update not persisted, row=$FINAL_ROW"; exit 1; }

echo "PASS: complete=200 invalid_partial=400/INVALID_CONFIG unchanged=true legal_partial=200 db=3|6 tenant=$TENANT_ID"
