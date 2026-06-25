#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-crm-blacklist-ingest-onboarding-smoke.sh — Line04 CRM 重做 纯 DB/API smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明本 smoke 可在 clean CI（标准 postgres + API:5200）跑，
# 供线 A glob-runner 自动发现，不再逐个点名（memory issue a4699d21 根治）。纯 DB/API，无真机/RPA。
#
# 覆盖 Line04 CRM 重做 backend 五件事：
#   [1] 名册聚合：blacklist 主模型 managed = contact∉blacklist + scan 源并进名册（last_message）
#   [2] blacklist 写：PUT /manage managed=false→加黑名单 / true→移除（黑名单主模型）
#   [3] ingest：POST /friend-scan/ingest upsert 幂等落 source='scan' + 更新 onboarding O2 scanned_count
#   [4] 403 修法：super-admin 经 internal token 多通道读名册（裸 tenantContext 会 403，多通道放行）
#   [5] onboarding：GET/PUT /onboarding/:csWechatId 状态机读写
#
# 鉴权用 internal token（super-admin/service 通道）跑读写 + ingest（service-only）；
# 租户隔离的 CROSS_TENANT 已由 line04-crm-customer-list-smoke.sh 覆盖，本 smoke 专攻重做新增面。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-${PGHOST:-localhost}}"
PSQL_USER="${PSQL_USER:-${PGUSER:-cecelia}}"
PSQL_DB="${PSQL_DB:-${PGDATABASE:-cecelia}}"
PSQL_PASS="${PSQL_PASS:-${PGPASSWORD:-cecelia}}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"

CS="${CS_WECHAT_ID:-wx_cs_crm2_$$}"
CONTACT_KEEP="客户接管_$$"
CONTACT_EXCL="客户排除_$$"
CONTACT_SCAN="扫到好友_$$"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
# service/super-admin 通道 curl（internal token）
ci()  { curl -s  -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }
cif() { curl -sf -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }

bootstrap() {
  echo "[bootstrap] 建 schema + 三迁移（A blacklist / B scan / C onboarding，幂等）"
  psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
  for f in \
    "$ROOT/apps/api/db/migrations/20260622_210000_create_wechat_cs_account_config.sql" \
    "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
    "$ROOT/apps/api/db/migrations/20260625_100000_add_blacklist_and_takeover_mode.sql" \
    "$ROOT/apps/api/db/migrations/20260625_101000_crm_customers_add_scan_source.sql" \
    "$ROOT/apps/api/db/migrations/20260625_102000_create_crm_onboarding_state.sql"; do
    PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
  done

  echo "[bootstrap] 幂等清场 + 造租户/客服机"
  psql_q "DELETE FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.crm_onboarding_state WHERE cs_wechat_id='$CS';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.service_agents WHERE wechat_id='$CS';" >/dev/null || true

  TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('crm2-smoke','lk_crm2_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  [ -n "$TENANT" ] || { echo "FAIL: 造租户失败"; exit 1; }
  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT','mc_crm2_$$','$CS') ON CONFLICT DO NOTHING;" >/dev/null
  # 该客服机配置：blacklist 主模型（新接入默认），把 CONTACT_EXCL 预置进黑名单
  psql_q "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id, persona, takeover_mode, blacklist) VALUES ('$CS','{}'::jsonb,'blacklist', to_jsonb(ARRAY['$CONTACT_EXCL']::text[])) ON CONFLICT (wechat_id) DO UPDATE SET takeover_mode='blacklist', blacklist=EXCLUDED.blacklist;" >/dev/null
  # 一条已聊消息（让名册 distinct 出 CONTACT_KEEP）
  psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT','$CONTACT_KEEP','in','你好');" >/dev/null
  psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT','$CONTACT_EXCL','in','你好');" >/dev/null
  export TENANT
}

main() {
  bootstrap

  echo "[4] 403 修法：super-admin 经 internal token 多通道读名册 → 非 401/403（带显式 cs_wechat_id scope）"
  CODE=$(ci -o /tmp/crm2_get.json -w "%{http_code}" "${API_BASE}/api/crm/customers?cs_wechat_id=$CS")
  [ "$CODE" = "200" ] || { echo "FAIL: super-admin 读名册未 200 实际 $CODE"; cat /tmp/crm2_get.json; exit 1; }

  echo "[1a] 名册：blacklist 主模型 managed = contact∉blacklist（KEEP=true / EXCL=false）"
  jq -e --arg c "$CONTACT_KEEP" 'any(.customers[]; .contact==$c and .managed==true)'  /tmp/crm2_get.json >/dev/null || { echo "FAIL: KEEP 应 managed=true（不在黑名单=接管中）"; cat /tmp/crm2_get.json; exit 1; }
  jq -e --arg c "$CONTACT_EXCL" 'any(.customers[]; .contact==$c and .managed==false)' /tmp/crm2_get.json >/dev/null || { echo "FAIL: EXCL 应 managed=false（在黑名单=排除）"; cat /tmp/crm2_get.json; exit 1; }
  jq -e '.customers[0] | has("source") and has("last_message")' /tmp/crm2_get.json >/dev/null || { echo "FAIL: 名册行缺 source/last_message"; exit 1; }

  echo "[3] ingest：POST /friend-scan/ingest 落 source='scan' + 幂等"
  R1=$(cif -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' \
    -d "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CONTACT_SCAN\",\"last_message\":\"在吗\"},{\"name\":\"$CONTACT_KEEP\",\"last_message\":\"二次\"}]}") || { echo "FAIL: ingest 非 200"; exit 1; }
  echo "$R1" | jq -e '.success==true and .ingested==2 and .new>=1 and .scanned_count==2' >/dev/null || { echo "FAIL: ingest 响应不符 $R1"; exit 1; }
  SRC=$(psql_q "SELECT source FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$CONTACT_SCAN'")
  [ "$SRC" = "scan" ] || { echo "FAIL: 扫描客户 source=$SRC 非 scan"; exit 1; }

  echo "[3b] ingest 幂等：重复上报同名不新增行（new=0）"
  R2=$(cif -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' \
    -d "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CONTACT_SCAN\",\"last_message\":\"再扫\"}]}") || { echo "FAIL: ingest 二次非 200"; exit 1; }
  echo "$R2" | jq -e '.new==0 and .ingested==1' >/dev/null || { echo "FAIL: ingest 二次非幂等 $R2"; exit 1; }
  CNT=$(psql_q "SELECT count(*) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$CONTACT_SCAN'")
  [ "$CNT" = "1" ] || { echo "FAIL: 扫描客户重复成 $CNT 行（非幂等）"; exit 1; }

  echo "[3c] ingest 后 onboarding O2 step=ok + scanned_count 已写入（最后一轮扫描结果）"
  O2STEP=$(psql_q "SELECT step_o2_scanned FROM zenithjoy.crm_onboarding_state WHERE cs_wechat_id='$CS'")
  O2CNT=$(psql_q "SELECT scanned_count FROM zenithjoy.crm_onboarding_state WHERE cs_wechat_id='$CS'")
  [ "$O2STEP" = "ok" ] || { echo "FAIL: onboarding O2 step 非 ok（实际 '$O2STEP'）"; exit 1; }
  [ -n "$O2CNT" ] || { echo "FAIL: onboarding O2 scanned_count 未写入"; exit 1; }
  echo "    O2 step=$O2STEP scanned_count=$O2CNT"

  echo "[2] blacklist 写：PUT /manage managed=false → 加黑名单 + managed=true → 移除"
  ci -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' \
    -d "{\"wechat_id\":\"$CS\",\"contact\":\"$CONTACT_SCAN\",\"managed\":false}" \
    | jq -e '.success==true and .managed==false' >/dev/null || { echo "FAIL: manage 排除未 200/managed=false"; exit 1; }
  IN=$(psql_q "SELECT (blacklist @> to_jsonb('$CONTACT_SCAN'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS'")
  [ "$IN" = "t" ] || { echo "FAIL: blacklist 未含被排除的 $CONTACT_SCAN"; exit 1; }
  ci -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' \
    -d "{\"wechat_id\":\"$CS\",\"contact\":\"$CONTACT_SCAN\",\"managed\":true}" \
    | jq -e '.success==true and .managed==true' >/dev/null || { echo "FAIL: manage 接管未 200/managed=true"; exit 1; }
  OUT=$(psql_q "SELECT (blacklist @> to_jsonb('$CONTACT_SCAN'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS'")
  [ "$OUT" = "f" ] || { echo "FAIL: 接管后 $CONTACT_SCAN 仍在 blacklist"; exit 1; }

  echo "[5] onboarding：PUT 回写 O1/O4 → GET 读回一致"
  cif -X PUT "${API_BASE}/api/crm/onboarding/$CS" -H 'Content-Type: application/json' \
    -d '{"step_o1_online":"ok","step_o4_realpublish":"fail","blacklist_count":3}' \
    | jq -e '.success==true and (.updated | index("step_o1_online"))' >/dev/null || { echo "FAIL: onboarding PUT 未 200"; exit 1; }
  GETO=$(cif "${API_BASE}/api/crm/onboarding/$CS") || { echo "FAIL: onboarding GET 非 200"; exit 1; }
  echo "$GETO" | jq -e '.onboarding.step_o1_online=="ok" and .onboarding.step_o4_realpublish=="fail" and .onboarding.blacklist_count==3' >/dev/null || { echo "FAIL: onboarding 读回不一致 $GETO"; exit 1; }
  echo "[5b] onboarding 非法步态 → 400"
  CODE=$(cif -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/crm/onboarding/$CS" -H 'Content-Type: application/json' -d '{"step_o1_online":"bogus"}' || true)
  [ "$CODE" = "400" ] || { echo "FAIL: 非法步态未 400 实际 $CODE"; exit 1; }

  # [6] ingest service-only（env 已设 token 的生产闸）：无凭证 → 401。
  # 仅当后端 ZENITHJOY_INTERNAL_TOKEN 已设时该闸成立；未设（dev/CI 不设）则后端 dev 放行（与 agent「未设不带头」对齐），此时跳过本断言。
  if [ -n "${ZENITHJOY_INTERNAL_TOKEN:-}" ]; then
    echo "[6] ingest service-only：env 已设 token → 无凭证 ingest 应 401"
    CODE=$(curl -s -o /tmp/crm2_noauth.json -w "%{http_code}" -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' -d "{\"cs_wechat_id\":\"$CS\",\"contacts\":[]}")
    [ "$CODE" = "401" ] || { echo "FAIL: 无凭证 ingest 未 401 实际 $CODE"; cat /tmp/crm2_noauth.json; exit 1; }
  else
    echo "[6] 跳过（后端 ZENITHJOY_INTERNAL_TOKEN 未设=dev 放行模式，与 agent「未设不带头」对齐）"
  fi

  echo "✅ Line04 CRM 重做 blacklist/ingest/onboarding smoke 全过"
}

main "$@"
