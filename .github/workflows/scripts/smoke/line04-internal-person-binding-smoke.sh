#!/usr/bin/env bash
# line04-internal-person-binding-smoke.sh — Line04 账号身份层真后端 smoke
#   （真 :5200 API + 真 zenithjoy postgres）
#
# 钉死用户拍板（Line04 第二刀地基）:
#  1. 内部人员字段:setup 写 internal_operator → DB 落库 + /cs/machines 真回显（可在中台编辑、可查）。
#  2. 1 email↔1 微信 1:1 绑定（防串台）:同一租户（= 同 license/同 email 账号）已绑一台机器后,
#     给「另一台」机器 setup 必须被拒（TENANT_ALREADY_BOUND，HTTP 400 / success!=true）,绝不静默
#     建第二行；同一台机器 re-setup 必须放行（幂等改配置）。
#
# 鉴权走 dashboard 租户管理员通道（X-Feishu-User-Id 头映射 tenant_members owner），与 per-operator smoke 同闸链。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_USER="${PSQL_USER:-cecelia}"
PSQL_DB="${PSQL_DB:-cecelia}"
PSQL_PASS="${PSQL_PASS:-cecelia}"

OWNER="ou_intperson_owner_$$"
MACHINE1="mc_intperson_1_$$"
MACHINE2="mc_intperson_2_$$"   # 同租户第二台机器（= 第二个微信，要被 1:1 拦截）
CS_WX1="wx_cs_intperson_1_$$"
OPERATOR="内部人员_苏彦卿_$$"     # 这个号背后真正的人

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
co()  { curl -s -H "X-Feishu-User-Id: $OWNER" "$@"; }
cof() { curl -sf -H "X-Feishu-User-Id: $OWNER" "$@"; }

echo "[bootstrap] schema + migrations（幂等）"
psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
for f in \
  "$ROOT/apps/api/db/migrations/20260622_210000_create_wechat_cs_account_config.sql" \
  "$ROOT/apps/api/db/migrations/20260625_175503_add_service_agent_real_wechat_id.sql" \
  "$ROOT/apps/api/db/migrations/20260630_120000_add_service_agent_internal_operator_and_tenant_1to1.sql"; do
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
done

echo "[bootstrap] internal_operator 列必须存在（migration 真应用）"
HAS_COL=$(psql_q "SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='service_agents' AND column_name='internal_operator' LIMIT 1")
[ "$HAS_COL" = "1" ] || { echo "FAIL: service_agents.internal_operator 列不存在（migration 未应用）"; exit 1; }

echo "[bootstrap] 造 1 租户 + owner + 1 license + 两台机器（同租户）"
TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('intperson-smoke','lk_intperson_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
[ -n "$TENANT" ] || { echo "FAIL: 造租户失败"; exit 1; }
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT','$OWNER','owner') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='owner';" >/dev/null
LIC=$(psql_q "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, tenant_id, expires_at) VALUES ('lk_intperson_lic_$$','free',5,'active','$TENANT', now()+interval '3650 days') ON CONFLICT (license_key) DO UPDATE SET tenant_id=EXCLUDED.tenant_id RETURNING id;")
[ -n "$LIC" ] || { echo "FAIL: 造 license 失败"; exit 1; }
# 两台机器都挂到同一个 license（→ 同租户 / 同 email 账号），制造串台条件。
psql_q "INSERT INTO zenithjoy.license_machines (license_id, machine_id) VALUES ('$LIC','$MACHINE1') ON CONFLICT DO NOTHING;" >/dev/null
psql_q "INSERT INTO zenithjoy.license_machines (license_id, machine_id) VALUES ('$LIC','$MACHINE2') ON CONFLICT DO NOTHING;" >/dev/null

echo "[1] 内部人员字段 — setup 第一台机器，填 internal_operator → 200"
co -X PUT "${API_BASE}/api/wechat/cs/setup/$MACHINE1" -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WX1\",\"persona\":{\"self_name\":\"小苏\",\"address_style\":\"\",\"tone\":\"\",\"sentence_style\":\"\",\"use_emoji\":\"\",\"banned_phrases\":[],\"few_shot\":[]},\"internal_operator\":\"$OPERATOR\"}" \
  | jq -e '.success==true' >/dev/null || { echo "FAIL: setup 第一台未 200"; exit 1; }

echo "[2] 内部人员真落库 — psql 读回 internal_operator"
GOT=$(psql_q "SELECT internal_operator FROM zenithjoy.service_agents WHERE machine_id='$MACHINE1' AND deleted_at IS NULL")
[ "$GOT" = "$OPERATOR" ] || { echo "FAIL: internal_operator 未落库 实际=$GOT 期望=$OPERATOR"; exit 1; }

echo "[3] /cs/machines 真回显 internal_operator（中台可查）"
cof "${API_BASE}/api/wechat/cs/machines" \
  | jq -e --arg op "$OPERATOR" 'any(.machines[]; .internal_operator==$op)' >/dev/null \
  || { echo "FAIL: /cs/machines 未回显 internal_operator"; exit 1; }

echo "[4] 1:1 防串台 — 同租户给第二台机器 setup → 必须被拒（绝不静默建第二行）"
RESP2=$(co -X PUT "${API_BASE}/api/wechat/cs/setup/$MACHINE2" -H 'Content-Type: application/json' \
  -d "{\"persona\":{\"self_name\":\"另一个号\",\"address_style\":\"\",\"tone\":\"\",\"sentence_style\":\"\",\"use_emoji\":\"\",\"banned_phrases\":[],\"few_shot\":[]},\"internal_operator\":\"张三\"}")
echo "$RESP2" | jq -e '(.success // false) != true' >/dev/null || { echo "FAIL: 第二台机器 setup 未被拒（串台风险！）实际=$RESP2"; exit 1; }
echo "$RESP2" | jq -e '((.message // (.error|tostring)) | test("TENANT_ALREADY_BOUND|已绑定|串台"))' >/dev/null \
  || { echo "FAIL: 拒绝未给明确告警（缺 TENANT_ALREADY_BOUND/已绑定/串台）实际=$RESP2"; exit 1; }

echo "[5] 第二台机器没有静默建第二行（同租户 active service_agents 仍只 1 行）"
N=$(psql_q "SELECT count(*) FROM zenithjoy.service_agents WHERE tenant_id='$TENANT' AND deleted_at IS NULL")
[ "$N" = "1" ] || { echo "FAIL: 同租户 active 绑定数=$N（应为 1，第二台被静默建了行 = 串台）"; exit 1; }

echo "[6] 同一台机器 re-setup（幂等改配置）→ 放行，更新 internal_operator"
co -X PUT "${API_BASE}/api/wechat/cs/setup/$MACHINE1" -H 'Content-Type: application/json' \
  -d "{\"internal_operator\":\"内部人员_改名_$$\"}" \
  | jq -e '.success==true' >/dev/null || { echo "FAIL: 同机器 re-setup 未 200（被 1:1 误拦）"; exit 1; }
GOT2=$(psql_q "SELECT internal_operator FROM zenithjoy.service_agents WHERE machine_id='$MACHINE1' AND deleted_at IS NULL")
[ "$GOT2" = "内部人员_改名_$$" ] || { echo "FAIL: re-setup 未更新 internal_operator 实际=$GOT2"; exit 1; }

echo "✅ Line04 内部人员字段 + 1 email↔1 微信 1:1 绑定 smoke 全过"
