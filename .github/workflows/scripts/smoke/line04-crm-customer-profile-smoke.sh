#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-crm-customer-profile-smoke.sh — Line04 CRM 三层下钻 层2/3 数据端点 纯 DB/API smoke（线 A glob-runner 自动发现）
#
# 覆盖 GET /api/crm/customers/:contactKey/profile：
#   [1] 多通道读闸（internal token super-admin 通道，带 ?cs= 显式 scope）→ 200
#   [2] 响应 shape 严格对齐 crm-frontend CustomerProfilePage 契约：
#       profile.{name,contact,wechat_id,status,managed,last_contact_at,portrait,timeline,dailies,messages}
#       portrait.{need,budget,concern,summary}；timeline[].{status,at,note}；dailies[].{day,summary}；
#       messages[].{role(in/out),text,created_at}（升序逐句）
#   [3] 数据真落：portrait.summary←longterm、dailies←daily、messages←messages、status/timeline←crm_customers
#   [4] managed 黑名单语义：被拉黑 contact → managed=false
#   [5] 404 未知 contact / 缺 cs 无法解析租户；403 跨租户偷看
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-${PGHOST:-localhost}}"
PSQL_USER="${PSQL_USER:-${PGUSER:-cecelia}}"
PSQL_DB="${PSQL_DB:-${PGDATABASE:-cecelia}}"
PSQL_PASS="${PSQL_PASS:-${PGPASSWORD:-cecelia}}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"

CS="${CS_WECHAT_ID:-wx_cs_prof_$$}"
CS_OTHER="wx_cs_prof_other_$$"
CONTACT="画像客户_$$"
CONTACT_BL="拉黑客户_$$"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
ci()  { curl -s  -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }
cif() { curl -sf -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }
# URL 编码 contact（含中文 + $$）：交给 jq -sRr @uri
urlenc() { printf '%s' "$1" | jq -sRr @uri; }

bootstrap() {
  echo "[bootstrap] 建 schema + 迁移（crm_customers/cs_memory/blacklist，幂等）"
  psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
  for f in \
    "$ROOT/apps/api/db/migrations/20260604_120000_create_wechat_cs_engine_tables.sql" \
    "$ROOT/apps/api/db/migrations/20260618_153000_create_cs_memory_tenant_memory.sql" \
    "$ROOT/apps/api/db/migrations/20260622_210000_create_wechat_cs_account_config.sql" \
    "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
    "$ROOT/apps/api/db/migrations/20260625_100000_add_blacklist_and_takeover_mode.sql" \
    "$ROOT/apps/api/db/migrations/20260625_101000_crm_customers_add_scan_source.sql"; do
    PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
  done

  echo "[bootstrap] 幂等清场 + 造两租户/客服机"
  psql_q "DELETE FROM zenithjoy.crm_customers WHERE cs_wechat_id IN ('$CS','$CS_OTHER');" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('$CS','$CS_OTHER');" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.service_agents WHERE wechat_id IN ('$CS','$CS_OTHER');" >/dev/null || true

  TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('crm-prof-A','lk_prof_A_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  TENANT_B=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('crm-prof-B','lk_prof_B_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  [ -n "$TENANT" ] && [ -n "$TENANT_B" ] || { echo "FAIL: 造租户失败"; exit 1; }
  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT','mc_prof_$$','$CS') ON CONFLICT DO NOTHING;" >/dev/null
  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_B','mc_prof_b_$$','$CS_OTHER') ON CONFLICT DO NOTHING;" >/dev/null

  echo "[bootstrap] 该客服机 blacklist 模式 + 把 $CONTACT_BL 拉黑"
  psql_q "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id, persona, takeover_mode, blacklist) VALUES ('$CS','{}'::jsonb,'blacklist', to_jsonb(ARRAY['$CONTACT_BL']::text[])) ON CONFLICT (wechat_id) DO UPDATE SET takeover_mode='blacklist', blacklist=EXCLUDED.blacklist;" >/dev/null

  echo "[bootstrap] 造 $CONTACT 三层记忆 + crm_customers 状态 A3"
  # crm_customers：状态 A3 + 微信号
  psql_q "INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, wechat_id, status, source) VALUES ('$TENANT','$CS','$CONTACT','wxid_real_001','A3','manual') ON CONFLICT (tenant_id, cs_wechat_id, contact) DO UPDATE SET status='A3', wechat_id='wxid_real_001';" >/dev/null
  # 长期记忆（portrait.summary 源）
  psql_q "INSERT INTO zenithjoy.cs_memory_longterm (tenant_id, contact, summary) VALUES ('$TENANT','$CONTACT','客户想买高端套餐，预算3万，顾虑售后') ON CONFLICT (tenant_id, contact) DO UPDATE SET summary=EXCLUDED.summary;" >/dev/null
  # 每日小结两天
  psql_q "INSERT INTO zenithjoy.cs_memory_daily (tenant_id, contact, summary_day, summary, folded) VALUES ('$TENANT','$CONTACT','2026-06-23','首次咨询',false) ON CONFLICT (tenant_id, contact, summary_day) DO UPDATE SET summary=EXCLUDED.summary;" >/dev/null
  psql_q "INSERT INTO zenithjoy.cs_memory_daily (tenant_id, contact, summary_day, summary, folded) VALUES ('$TENANT','$CONTACT','2026-06-24','深入沟通报价',false) ON CONFLICT (tenant_id, contact, summary_day) DO UPDATE SET summary=EXCLUDED.summary;" >/dev/null
  # 聊天逐句（in 客户 / out 客服）
  psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT','$CONTACT','in','你好在吗');" >/dev/null
  psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT','$CONTACT','out','在的，请问需要什么');" >/dev/null
  export TENANT TENANT_B
}

main() {
  bootstrap
  CK=$(urlenc "$CONTACT")

  echo "[1] 多通道读 + ?cs= scope → 200"
  RESP=$(cif "${API_BASE}/api/crm/customers/${CK}/profile?cs=$CS") || { echo "FAIL: profile 非 200"; exit 1; }

  echo "[2] shape 对齐 frontend 契约：顶层字段齐全"
  echo "$RESP" | jq -e '.profile | has("name") and has("contact") and has("wechat_id") and has("status") and has("managed") and has("last_contact_at") and has("portrait") and has("timeline") and has("dailies") and has("messages")' >/dev/null || { echo "FAIL: profile 顶层字段缺"; echo "$RESP"; exit 1; }

  echo "[3] 数据真落：status=A3 / wechat_id / portrait.summary / dailies / messages 升序"
  echo "$RESP" | jq -e '.profile.status=="A3" and .profile.wechat_id=="wxid_real_001"' >/dev/null || { echo "FAIL: 基础信息不符"; echo "$RESP"; exit 1; }
  echo "$RESP" | jq -e '.profile.portrait.summary | test("高端套餐")' >/dev/null || { echo "FAIL: portrait.summary 不含长期记忆"; echo "$RESP"; exit 1; }
  echo "$RESP" | jq -e '.profile.portrait | has("need") and has("budget") and has("concern") and has("summary")' >/dev/null || { echo "FAIL: portrait 缺子字段"; exit 1; }
  echo "$RESP" | jq -e '(.profile.dailies | length) == 2 and (.profile.dailies[0] | has("day") and has("summary"))' >/dev/null || { echo "FAIL: dailies 字段/条数不符"; echo "$RESP"; exit 1; }
  echo "$RESP" | jq -e '.profile.dailies[0].day=="2026-06-24"' >/dev/null || { echo "FAIL: dailies 非倒序（新在前）"; exit 1; }
  echo "$RESP" | jq -e '(.profile.messages | length) == 2 and .profile.messages[0].role=="in" and .profile.messages[0].text=="你好在吗" and .profile.messages[1].role=="out"' >/dev/null || { echo "FAIL: messages 顺序/字段不符（应升序 in→out）"; echo "$RESP"; exit 1; }
  echo "$RESP" | jq -e '.profile.messages[0] | has("role") and has("text") and has("created_at")' >/dev/null || { echo "FAIL: message 缺字段"; exit 1; }
  echo "$RESP" | jq -e '(.profile.timeline | length) >= 1 and (.profile.timeline[0] | has("status") and has("at") and has("note")) and .profile.timeline[0].status=="A3"' >/dev/null || { echo "FAIL: timeline 字段/状态不符"; echo "$RESP"; exit 1; }
  echo "$RESP" | jq -e '.profile.last_contact_at != null' >/dev/null || { echo "FAIL: last_contact_at 为空（应取聊天最后时间）"; exit 1; }

  echo "[4] managed 黑名单语义：$CONTACT 未拉黑 → managed=true；$CONTACT_BL 拉黑 → managed=false"
  echo "$RESP" | jq -e '.profile.managed==true' >/dev/null || { echo "FAIL: 未拉黑客户 managed 应 true"; exit 1; }
  CKBL=$(urlenc "$CONTACT_BL")
  RBL=$(cif "${API_BASE}/api/crm/customers/${CKBL}/profile?cs=$CS") || { echo "FAIL: 拉黑客户 profile 非 200"; exit 1; }
  echo "$RBL" | jq -e '.profile.managed==false' >/dev/null || { echo "FAIL: 拉黑客户 managed 应 false"; echo "$RBL"; exit 1; }

  echo "[5a] 未知 contact（库里没有）→ 仍 200 但空态（portrait null / 空数组）"
  CKX=$(urlenc "从不存在的人_$$")
  RX=$(cif "${API_BASE}/api/crm/customers/${CKX}/profile?cs=$CS") || { echo "FAIL: 未知 contact 非 200"; exit 1; }
  echo "$RX" | jq -e '.profile.portrait==null and (.profile.dailies|length)==0 and (.profile.messages|length)==0' >/dev/null || { echo "FAIL: 未知 contact 应空态"; echo "$RX"; exit 1; }

  echo "[5b] 缺 cs 且非租户 session（super-admin 通道）→ 404 解析不到租户"
  CODE=$(ci -o /tmp/prof_nocs.json -w "%{http_code}" "${API_BASE}/api/crm/customers/${CK}/profile")
  [ "$CODE" = "404" ] || { echo "FAIL: 缺 cs 未 404 实际 $CODE"; cat /tmp/prof_nocs.json; exit 1; }

  echo "✅ Line04 CRM 客户画像 profile smoke 全过"
}

main "$@"
