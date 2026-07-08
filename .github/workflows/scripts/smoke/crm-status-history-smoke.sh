#!/bin/bash
set -e
# CRM Status History smoke — 验证 migration 文件存在且含幂等 DDL
echo "Checking CRM status history migration..."
[ -f "apps/api/db/migrations/20260708_120000_crm_status_history.sql" ] || { echo "FAIL: migration missing"; exit 1; }
grep -q "IF NOT EXISTS" "apps/api/db/migrations/20260708_120000_crm_status_history.sql" || { echo "FAIL: not idempotent"; exit 1; }
grep -q "crm_customer_status_history" "apps/api/db/migrations/20260708_120000_crm_status_history.sql" || { echo "FAIL: wrong table name"; exit 1; }
grep -q "old_status" "apps/api/db/migrations/20260708_120000_crm_status_history.sql" || { echo "FAIL: missing old_status"; exit 1; }
echo "PASS: CRM status history smoke"
