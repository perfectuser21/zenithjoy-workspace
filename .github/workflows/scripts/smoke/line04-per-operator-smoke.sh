#!/usr/bin/env bash
# line04-per-operator-smoke.sh — Line04 per-operator 真后端 smoke（真 :5200 API + 真 zenithjoy postgres）
#
# 钉死用户拍板模型:一个运营(tenant owner)登录→自动只看自己租户客户、/cs/machines 只列自己机器、
# 真实微信号(SSOT)落 service_agents.real_wechat_id。**不需超管、不强制 cs_wechat_id**(决策5 仅超管旁路)。
#
# 鉴权走 dashboard 租户管理员通道(X-Feishu-User-Id 头映射 tenant_members owner)——与 better-auth cookie 同闸链。
# 该头不放进 ADMIN_FEISHU_OPENIDS,否则被当 legacy 超管旁路,验不出 per-operator 自动 scope。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_USER="${PSQL_USER:-cecelia}"
PSQL_DB="${PSQL_DB:-cecelia}"
PSQL_PASS="${PSQL_PASS:-cecelia}"

OWNER="ou_perop_owner_$$"
CS_WX="wx_cs_perop_$$"
MACHINE="mc_perop_$$"
CONTACT="客户甲_$$"
REAL_WX="perfect-xx-$$"   # 真实微信号(SSOT)
DISPLAY="默忆-$$"          # 微信昵称(display)

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
co()  { curl -s -H "X-Feishu-User-Id: $OWNER" "$@"; }
cof() { curl -sf -H "X-Feishu-User-Id: $OWNER" "$@"; }

echo "[bootstrap] schema + migrations（幂等）"
psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
for f in \
  "$ROOT/apps/api/db/migrations/20260622_210000_create_wechat_cs_account_config.sql" \
  "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
  "$ROOT/apps/api/db/migrations/20260625_100000_add_blacklist_and_takeover_mode.sql" \
  "$ROOT/apps/api/db/migrations/20260625_175503_add_service_agent_real_wechat_id.sql"; do
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
done

echo "[bootstrap] 造 1 租户 + owner + 客服机 + 一条已聊消息"
TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('perop-smoke','lk_perop_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
[ -n "$TENANT" ] || { echo "FAIL: 造租户失败"; exit 1; }
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT','$OWNER','owner') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='owner';" >/dev/null
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT','$MACHINE','$CS_WX') ON CONFLICT DO NOTHING;" >/dev/null
psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT','$CONTACT','in','你好');" >/dev/null

echo "[1] 普通运营(owner,不带 cs_wechat_id)→ 200 自动按租户 scope 出名册,含 $CONTACT"
RESP=$(cof "${API_BASE}/api/crm/customers") || { echo "FAIL: GET customers 非 200(per-operator 该自动放行)"; exit 1; }
echo "$RESP" | jq -e '.customers | type=="array"' >/dev/null || { echo "FAIL: customers 非数组"; exit 1; }
echo "$RESP" | jq -e --arg c "$CONTACT" 'any(.customers[]; .contact==$c)' >/dev/null || { echo "FAIL: 名册缺自己租户客户 $CONTACT"; exit 1; }
echo "$RESP" | jq -e '(.error.code // "") != "CS_WECHAT_ID_REQUIRED"' >/dev/null || { echo "FAIL: 普通运营被错误强制 cs_wechat_id(决策5 误套)"; exit 1; }

echo "[2] 无登录态 → 401"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/crm/customers")
[ "$CODE" = "401" ] || { echo "FAIL: 无登录态未 401 实际 $CODE"; exit 1; }

echo "[3] friend-scan/trigger 普通运营带本租户客服机 → 200 ok(不需超管)"
co -X POST "${API_BASE}/api/crm/friend-scan/trigger" -H 'Content-Type: application/json' \
  -d "{\"cs_wechat_id\":\"$CS_WX\"}" | jq -e '.ok==true' >/dev/null || { echo "FAIL: trigger 未 200(普通运营该能点)"; exit 1; }

echo "[4] /api/wechat/cs/machines 按租户 scope — 普通运营只列自己那台 $CS_WX"
MRESP=$(cof "${API_BASE}/api/wechat/cs/machines") || { echo "FAIL: /cs/machines 非 200"; exit 1; }
echo "$MRESP" | jq -e --arg m "$MACHINE" 'any(.machines[]; .machine_id==$m)' >/dev/null || { echo "FAIL: 列表缺自己机器"; exit 1; }
echo "$MRESP" | jq -e '[.machines[].machine_id] | length >= 1' >/dev/null || { echo "FAIL: 机器列表空"; exit 1; }

echo "[5] 真实微信号(SSOT)落库 — setup 手填 real_wechat_id → DB 落 + /cs/machines 回显 display name"
co -X PUT "${API_BASE}/api/wechat/cs/setup/$MACHINE" -H 'Content-Type: application/json' \
  -d "{\"persona\":{\"self_name\":\"小苏\",\"address_style\":\"\",\"tone\":\"\",\"sentence_style\":\"\",\"use_emoji\":\"\",\"banned_phrases\":[],\"few_shot\":[]},\"real_wechat_id\":\"$REAL_WX\",\"wechat_display_name\":\"$DISPLAY\"}" \
  | jq -e '.success==true' >/dev/null || { echo "FAIL: setup 未 200"; exit 1; }
RW=$(psql_q "SELECT real_wechat_id FROM zenithjoy.service_agents WHERE machine_id='$MACHINE' AND deleted_at IS NULL")
[ "$RW" = "$REAL_WX" ] || { echo "FAIL: real_wechat_id 未落库 实际=$RW"; exit 1; }
cof "${API_BASE}/api/wechat/cs/machines" | jq -e --arg d "$DISPLAY" 'any(.machines[]; .wechat_display_name==$d)' >/dev/null || { echo "FAIL: /cs/machines 未回显微信昵称"; exit 1; }

echo "✅ Line04 per-operator smoke 全过(租户自动 scope + /cs/machines scope + 真实微信号落库)"
