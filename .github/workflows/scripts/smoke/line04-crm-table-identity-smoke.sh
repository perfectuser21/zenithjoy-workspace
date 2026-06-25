#!/usr/bin/env bash
# line04-crm-table-identity-smoke.sh — Line04 CRM 外层表重做（6列 + 身份三态）真后端 smoke
#
# 真 API :5200 + 真 zenithjoy postgres，验：
#   1. ingest 向前兼容：contacts[].wechat_id + add_friend_time 写进 crm_customers（旧 agent 不传亦不报错）。
#   2. GET /api/crm/customers：返回行带 add_friend_time + identity 字段。
#   3. identity='internal' 的行从 /customers 列表**排除**（内部人员不当客户）。
#
# 鉴权：service 通道带 X-Internal-Token（ZENITHJOY_INTERNAL_TOKEN）做 ingest；
#       读名册用 super-admin 旁路（X-User-Email ∈ ADMIN_EMAILS + 显式 cs_wechat_id）。
# 幂等：迁移 IF NOT EXISTS + 清场。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_USER="${PSQL_USER:-cecelia}"
PSQL_DB="${PSQL_DB:-cecelia}"
PSQL_PASS="${PSQL_PASS:-cecelia}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-boss@zenjoymedia.media}"

CS_WECHAT_ID="${CS_WECHAT_ID:-wx_cs_identity_$$}"
CUST="客户甲_$$"
INTERNAL="内部丙_$$"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
# super-admin 旁路读名册
sa() { curl -s -H "X-User-Email: $ADMIN_EMAIL" "$@"; }
# service 通道（agent ingest）
svc() { curl -s -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }

echo "[bootstrap] schema + 迁移（幂等）"
psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
for f in \
  "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
  "$ROOT/apps/api/db/migrations/20260625_101000_crm_customers_add_scan_source.sql" \
  "$ROOT/apps/api/db/migrations/20260625_230000_crm_customers_add_friend_time_identity.sql"; do
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 \
    -f "$f" >/dev/null 2>&1 || true
done

# 迁移真落列断言（防 ADD COLUMN 没生效就空过）
HAS_AFT=$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='crm_customers' AND column_name='add_friend_time'")
HAS_IDENT=$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='crm_customers' AND column_name='identity'")
[ "$HAS_AFT" = "1" ] || { echo "FAIL: add_friend_time 列没建出来"; exit 1; }
[ "$HAS_IDENT" = "1" ] || { echo "FAIL: identity 列没建出来"; exit 1; }

echo "[bootstrap] 清场 + 造租户 + 客服机"
psql_q "DELETE FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID';" >/dev/null || true
psql_q "DELETE FROM zenithjoy.service_agents WHERE wechat_id='$CS_WECHAT_ID';" >/dev/null || true
TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('crm-ident-smoke','lk_ident_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
[ -n "$TENANT" ] || { echo "FAIL: 造租户失败"; exit 1; }
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT','mc_ident_$$','$CS_WECHAT_ID') ON CONFLICT DO NOTHING;" >/dev/null

echo "[1] ingest 带 wechat_id + add_friend_time → 写库（向前兼容）"
svc -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' \
  -d "{\"cs_wechat_id\":\"$CS_WECHAT_ID\",\"contacts\":[{\"name\":\"$CUST\",\"wechat_id\":\"wxid_cust_$$\",\"add_friend_time\":\"2026-06-01T03:00:00.000Z\",\"last_message\":\"在吗\"}]}" \
  | jq -e '.success==true and .ingested==1' >/dev/null || { echo "FAIL: ingest 未 200"; exit 1; }
WID=$(psql_q "SELECT wechat_id FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$CUST'")
AFT=$(psql_q "SELECT (add_friend_time IS NOT NULL) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$CUST'")
[ "$WID" = "wxid_cust_$$" ] || { echo "FAIL: wechat_id 没写进库（实际 $WID）"; exit 1; }
[ "$AFT" = "t" ] || { echo "FAIL: add_friend_time 没写进库"; exit 1; }

echo "[2] ingest 不传新字段 → 不报错（旧 agent 兼容）"
svc -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' \
  -d "{\"cs_wechat_id\":\"$CS_WECHAT_ID\",\"contacts\":[{\"name\":\"$INTERNAL\",\"last_message\":\"嗨\"}]}" \
  | jq -e '.success==true' >/dev/null || { echo "FAIL: 旧字段 ingest 报错了"; exit 1; }

echo "[3] PUT /api/crm/customers/identity — 把 $INTERNAL 标 internal（标身份入口，替代手动 seed）"
svc -X PUT "${API_BASE}/api/crm/customers/identity" -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$INTERNAL\",\"identity\":\"internal\"}" \
  | jq -e '.success==true and .identity=="internal"' >/dev/null || { echo "FAIL: PUT identity=internal 未 200/未回 identity"; exit 1; }
# 入口真落库断言（防端点空过）
DB_IDENT=$(psql_q "SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$INTERNAL'")
[ "$DB_IDENT" = "internal" ] || { echo "FAIL: identity 没写进库（实际 $DB_IDENT）"; exit 1; }

echo "[4] GET /api/crm/customers — 行带 identity + add_friend_time，且 internal 被排除"
RESP=$(sa "${API_BASE}/api/crm/customers?cs_wechat_id=$CS_WECHAT_ID") || { echo "FAIL: GET customers 非 200"; exit 1; }
echo "$RESP" | jq -e --arg c "$CUST" 'any(.customers[]; .contact==$c and has("identity") and has("add_friend_time"))' >/dev/null \
  || { echo "FAIL: 客户行缺 identity/add_friend_time 字段"; echo "$RESP" | head -c 800; exit 1; }
echo "$RESP" | jq -e --arg i "$INTERNAL" 'all(.customers[]; .contact != $i)' >/dev/null \
  || { echo "FAIL: internal 人员未从客户列表排除"; exit 1; }
echo "$RESP" | jq -e --arg c "$CUST" '.customers[] | select(.contact==$c) | .identity=="customer"' >/dev/null \
  || { echo "FAIL: 客户 identity 非 customer"; exit 1; }

echo "[5] PUT identity=blacklist — 把 $CUST 标黑名单（名册标记，GET 仍返回该行且 identity=blacklist）"
svc -X PUT "${API_BASE}/api/crm/customers/identity" -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CUST\",\"identity\":\"blacklist\"}" \
  | jq -e '.success==true and .identity=="blacklist"' >/dev/null || { echo "FAIL: PUT identity=blacklist 未 200"; exit 1; }
RESP2=$(sa "${API_BASE}/api/crm/customers?cs_wechat_id=$CS_WECHAT_ID") || { echo "FAIL: GET customers(2) 非 200"; exit 1; }
echo "$RESP2" | jq -e --arg c "$CUST" '.customers[] | select(.contact==$c) | .identity=="blacklist"' >/dev/null \
  || { echo "FAIL: blacklist 标记后 GET 未回 identity=blacklist（黑名单仍是客户行，不排除）"; exit 1; }

echo "[6] PUT identity 三态校验 — 非法值 → 400 INVALID_INPUT，不落库"
CODE=$(svc -o /dev/null -w '%{http_code}' -X PUT "${API_BASE}/api/crm/customers/identity" -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CUST\",\"identity\":\"vip\"}")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 identity 未 400（实际 $CODE）"; exit 1; }
STILL=$(psql_q "SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$CUST'")
[ "$STILL" = "blacklist" ] || { echo "FAIL: 非法 identity 竟改了库（实际 $STILL，应保持 blacklist）"; exit 1; }

echo "✅ Line04 CRM 外层表重做（identity + add_friend_time + 标身份入口 PUT）smoke 全过"
