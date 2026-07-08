#!/usr/bin/env bash
# crm-status-history-smoke.sh
# Sprint: 07081012-crm-status-history
# 前置条件：API 已启动（localhost:3000），DATABASE_URL 已设置，DB migration 已跑
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
TS=$(date +%s)
WECHAT_ID="smoke_cs_${TS}"
CONTACT="smoke_customer_${TS}"

echo "=== [1/3] 新客户首次写 status → 历史表出现 old_status=NULL 记录 ==="
RESP1=$(curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A1\"}")
echo "API 响应: $RESP1"
echo "$RESP1" | grep -q '"success":true' || { echo "FAIL: API 响应非 success"; exit 1; }

COUNT=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT' AND old_status IS NULL AND new_status='A1'")
COUNT=$(echo "$COUNT" | tr -d '[:space:]')
[ "$COUNT" -eq 1 ] || { echo "FAIL: 新客户历史记录未写入 (count=$COUNT)"; exit 1; }
echo "PASS"

echo "=== [2/3] 状态变化（A1→A3）→ 历史表新增 old_status='A1' 记录 ==="
RESP2=$(curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}")
echo "API 响应: $RESP2"
echo "$RESP2" | grep -q '"success":true' || { echo "FAIL: API 响应非 success"; exit 1; }

COUNT2=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT' AND old_status='A1' AND new_status='A3'")
COUNT2=$(echo "$COUNT2" | tr -d '[:space:]')
[ "$COUNT2" -eq 1 ] || { echo "FAIL: 状态变化历史未写入 (count=$COUNT2)"; exit 1; }
echo "PASS"

echo "=== [3/3] 重复提交相同 status（A3）→ 历史表行数不增加 ==="
BEFORE=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")
BEFORE=$(echo "$BEFORE" | tr -d '[:space:]')

RESP3=$(curl -sf -X PUT "$BASE/api/crm/customers/status" \
  -H "Content-Type: application/json" \
  -d "{\"wechat_id\":\"$WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}")
echo "API 响应: $RESP3"
echo "$RESP3" | grep -q '"success":true' || { echo "FAIL: API 响应非 success"; exit 1; }

AFTER=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customer_status_history \
   WHERE cs_wechat_id='$WECHAT_ID' AND contact='$CONTACT'")
AFTER=$(echo "$AFTER" | tr -d '[:space:]')
[ "$BEFORE" -eq "$AFTER" ] || { echo "FAIL: 重复 status 不应新增历史记录 (before=$BEFORE, after=$AFTER)"; exit 1; }
echo "PASS"

echo ""
echo "crm-status-history smoke 全部通过 (3/3)"
