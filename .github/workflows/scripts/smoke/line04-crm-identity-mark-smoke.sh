#!/usr/bin/env bash
# line04-crm-identity-mark-smoke.sh — Line04 CRM 身份标记端点 PUT /api/crm/customers/identity 真后端 smoke
#
# 真 API :5200 + 真 zenithjoy postgres，验运营在界面上「标身份」的后端动作：
#   1. 标 internal → crm_customers.identity='internal'；GET /customers 该人从列表消失；config.blacklist 不被碰。
#   2. 标 blacklist → identity='blacklist' + config.blacklist 含该人（should_reply 会停回他）。
#   3. 标 customer → identity='customer' + config.blacklist 移除该人（恢复接管）。
#   4. 非法 identity 值 → 400；跨租户写 → 403 CROSS_TENANT。
#
# 鉴权：dashboard 租户管理员通道（X-Feishu-User-Id 头映射 tenant_members admin），
# 与 line04-crm-customer-list-smoke 同套，能验跨租户隔离。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_USER="${PSQL_USER:-cecelia}"
PSQL_DB="${PSQL_DB:-cecelia}"
PSQL_PASS="${PSQL_PASS:-cecelia}"

CS="${CS:-wx_cs_idmark_$$}"
CS_B="${CS_B:-wx_cs_idmark_B_$$}"
CUST="客户甲_$$"
INTERN="内部丙_$$"
ADMIN_A="${ADMIN_A:-ou_idmark_A_$$}"
ADMIN_B="${ADMIN_B:-ou_idmark_B_$$}"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
ca()  { curl -s -H "X-Feishu-User-Id: $ADMIN_A" "$@"; }
caf() { curl -sf -H "X-Feishu-User-Id: $ADMIN_A" "$@"; }
cb()  { curl -s -H "X-Feishu-User-Id: $ADMIN_B" "$@"; }

echo "[bootstrap] schema + 迁移（幂等）"
psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
for f in \
  "$ROOT/apps/api/db/migrations/20260622_210000_create_wechat_cs_account_config.sql" \
  "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
  "$ROOT/apps/api/db/migrations/20260625_100000_add_blacklist_and_takeover_mode.sql" \
  "$ROOT/apps/api/db/migrations/20260625_101000_crm_customers_add_scan_source.sql" \
  "$ROOT/apps/api/db/migrations/20260625_230000_crm_customers_add_friend_time_identity.sql"; do
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
done

echo "[bootstrap] 清场 + 造两租户 + 客服机 + 两个客户行"
for w in "$CS" "$CS_B"; do
  psql_q "DELETE FROM zenithjoy.crm_customers WHERE cs_wechat_id='$w';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$w';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.service_agents WHERE wechat_id='$w';" >/dev/null || true
done
TENANT_A=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('idmark-A','lk_idmark_A_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
TENANT_B=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('idmark-B','lk_idmark_B_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] || { echo "FAIL: 造租户失败"; exit 1; }
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_A','$ADMIN_A','admin') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='admin';" >/dev/null
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_B','$ADMIN_B','admin') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='admin';" >/dev/null
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_A','mc_idmark_A_$$','$CS') ON CONFLICT DO NOTHING;" >/dev/null
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_B','mc_idmark_B_$$','$CS_B') ON CONFLICT DO NOTHING;" >/dev/null
# 两个客户行（source=scan）
psql_q "INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, source) VALUES ('$TENANT_A','$CS','$CUST','scan') ON CONFLICT DO NOTHING;" >/dev/null
psql_q "INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, source) VALUES ('$TENANT_A','$CS','$INTERN','scan') ON CONFLICT DO NOTHING;" >/dev/null

idput() { ca -X PUT "${API_BASE}/api/crm/customers/identity" -H 'Content-Type: application/json' -d "$1"; }

echo "[1] 标 internal → identity 落库 + GET 列表排除 + config.blacklist 不被碰"
idput "{\"wechat_id\":\"$CS\",\"contact\":\"$INTERN\",\"identity\":\"internal\"}" \
  | jq -e '.success==true and .identity=="internal"' >/dev/null || { echo "FAIL: 标 internal 未 200"; exit 1; }
ID=$(psql_q "SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$INTERN'")
[ "$ID" = "internal" ] || { echo "FAIL: identity 没落 internal（实际 $ID）"; exit 1; }
caf "${API_BASE}/api/crm/customers?cs_wechat_id=$CS" | jq -e --arg i "$INTERN" 'all(.customers[]; .contact != $i)' >/dev/null \
  || { echo "FAIL: internal 没从客户列表排除"; exit 1; }
CFG=$(psql_q "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS'")
[ "$CFG" = "0" ] || { echo "FAIL: 标 internal 不该写 config（实际 $CFG 行）"; exit 1; }

echo "[2] 标 blacklist → identity + config.blacklist 含该人"
idput "{\"wechat_id\":\"$CS\",\"contact\":\"$CUST\",\"identity\":\"blacklist\"}" \
  | jq -e '.success==true and .identity=="blacklist"' >/dev/null || { echo "FAIL: 标 blacklist 未 200"; exit 1; }
ID2=$(psql_q "SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$CUST'")
[ "$ID2" = "blacklist" ] || { echo "FAIL: identity 没落 blacklist"; exit 1; }
INBL=$(psql_q "SELECT (blacklist @> to_jsonb('$CUST'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS'")
[ "$INBL" = "t" ] || { echo "FAIL: config.blacklist 没含被拉黑的 $CUST"; exit 1; }

echo "[3] 标 customer → identity + config.blacklist 移除该人（恢复接管）"
idput "{\"wechat_id\":\"$CS\",\"contact\":\"$CUST\",\"identity\":\"customer\"}" \
  | jq -e '.success==true and .identity=="customer"' >/dev/null || { echo "FAIL: 标 customer 未 200"; exit 1; }
OUTBL=$(psql_q "SELECT (blacklist @> to_jsonb('$CUST'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS'")
[ "$OUTBL" = "f" ] || { echo "FAIL: 恢复 customer 后 $CUST 仍在 config.blacklist"; exit 1; }

echo "[4] 非法 identity → 400"
CODE=$(ca -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/crm/customers/identity" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS\",\"contact\":\"$CUST\",\"identity\":\"vip\"}")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 identity 未 400（实际 $CODE）"; exit 1; }

echo "[5] 跨租户写 → 403 CROSS_TENANT"
CODE=$(cb -o /tmp/idmark_xt.json -w "%{http_code}" -X PUT "${API_BASE}/api/crm/customers/identity" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS\",\"contact\":\"$CUST\",\"identity\":\"internal\"}")
[ "$CODE" = "403" ] || { echo "FAIL: 跨租户写未拦（实际 $CODE）"; exit 1; }
jq -e '.error.code=="CROSS_TENANT"' /tmp/idmark_xt.json >/dev/null || { echo "FAIL: 非 CROSS_TENANT"; exit 1; }

echo "✅ Line04 CRM 身份标记端点 smoke 全过"
