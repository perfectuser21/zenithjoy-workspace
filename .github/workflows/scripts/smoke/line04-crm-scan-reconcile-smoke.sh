#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-crm-scan-reconcile-smoke.sh — Line04 CRM 采集对账 纯 DB/API smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= clean CI（标准 postgres + API:5200）可跑，纯 DB/API 无真机。
#
# 覆盖采集对账 6 件事（真删路径由 vitest 真模式 + staging 手验覆盖，本 smoke 默认 dry-run 环境）：
#   [1] 干跑累计：没扫到的 source='scan' 行 scan_miss_count++，deleted_at 保持 NULL（不删）
#   [2] 干跑满 K 仍不删：连续 3 次没扫到 → count=3 但 deleted_at 仍 NULL（证默认干跑安全）
#   [3] 扫到复活归零：再次扫到 → scan_miss_count 回 0
#   [4] ClawBot 默认黑名单：ingest 微信ClawBot → identity='blacklist'
#   [5] self_name 跳过：ingest 带 self_name → 该 contact 不入册
#   [6] GET /customers 排除软删：deleted_at 非空行不出现在名册
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-${PGHOST:-localhost}}"
PSQL_USER="${PSQL_USER:-${PGUSER:-cecelia}}"
PSQL_DB="${PSQL_DB:-${PGDATABASE:-cecelia}}"
PSQL_PASS="${PSQL_PASS:-${PGPASSWORD:-cecelia}}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-boss@zenjoymedia.media}"

CS="${CS_WECHAT_ID:-wx_cs_recon_$$}"
CUST="真客户_$$"
GROUP="客户、徐先生企业自媒体-Ai助力_$$"
SELFNAME="运营本人会话_$$"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
cif() { curl -sf -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }
ce()  { curl -s  -H "X-User-Email: $ADMIN_EMAIL" "$@"; }
ingest() {
  cif -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' -d "$1"
}

bootstrap() {
  echo "[bootstrap] schema + 迁移（含对账新列，幂等）"
  psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
  for f in \
    "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
    "$ROOT/apps/api/db/migrations/20260625_101000_crm_customers_add_scan_source.sql" \
    "$ROOT/apps/api/db/migrations/20260625_102000_create_crm_onboarding_state.sql" \
    "$ROOT/apps/api/db/migrations/20260625_150000_crm_onboarding_add_force_scan.sql" \
    "$ROOT/apps/api/db/migrations/20260625_230000_crm_customers_add_friend_time_identity.sql" \
    "$ROOT/apps/api/db/migrations/20260626_150000_crm_customers_add_reconcile.sql"; do
    PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
  done

  echo "[bootstrap] 幂等清场 + 造租户/客服机"
  psql_q "DELETE FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.service_agents WHERE wechat_id='$CS';" >/dev/null || true
  TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('recon-smoke','lk_recon_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  [ -n "$TENANT" ] || { echo "FAIL: 造租户失败"; exit 1; }
  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT','mc_recon_$$','$CS') ON CONFLICT DO NOTHING;" >/dev/null
  export TENANT
}

# 取某 contact 的 scan_miss_count / deleted_at 状态
miss()    { psql_q "SELECT scan_miss_count FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$1'"; }
deleted() { psql_q "SELECT (deleted_at IS NOT NULL) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$1'"; }

main() {
  bootstrap

  echo "[seed] 首扫：真客户 + 旧群 都入册"
  ingest "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CUST\"},{\"name\":\"$GROUP\"}]}" \
    | jq -e '.success==true and .ingested==2' >/dev/null || { echo "FAIL: 首扫 ingest 不符"; exit 1; }

  echo "[1] 干跑累计：第 2 次只扫到真客户（旧群缺席）→ 旧群 miss=1，deleted_at 仍 NULL"
  ingest "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CUST\"}]}" >/dev/null
  [ "$(miss "$GROUP")" = "1" ] || { echo "FAIL: 旧群 miss 应=1 实际 $(miss "$GROUP")"; exit 1; }
  [ "$(deleted "$GROUP")" = "f" ] || { echo "FAIL: 干跑下旧群不应被软删"; exit 1; }

  echo "[2] 干跑满 K 仍不删：再缺席 2 次 → miss=3 但 deleted_at 仍 NULL（默认干跑安全）"
  ingest "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CUST\"}]}" >/dev/null
  ingest "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CUST\"}]}" >/dev/null
  [ "$(miss "$GROUP")" = "3" ] || { echo "FAIL: 旧群 miss 应=3 实际 $(miss "$GROUP")"; exit 1; }
  [ "$(deleted "$GROUP")" = "f" ] || { echo "FAIL: 干跑满 K 仍不应软删（证默认干跑安全）"; exit 1; }

  echo "[3] 扫到复活归零：旧群重新被扫到 → miss 回 0"
  ingest "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CUST\"},{\"name\":\"$GROUP\"}]}" >/dev/null
  [ "$(miss "$GROUP")" = "0" ] || { echo "FAIL: 旧群复活后 miss 应=0 实际 $(miss "$GROUP")"; exit 1; }

  echo "[4] ClawBot 默认黑名单：ingest 微信ClawBot → identity='blacklist'"
  ingest "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CUST\"},{\"name\":\"微信ClawBot\"}]}" >/dev/null
  IDB=$(psql_q "SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='微信ClawBot'")
  [ "$IDB" = "blacklist" ] || { echo "FAIL: ClawBot identity 应=blacklist 实际 '$IDB'"; exit 1; }

  echo "[5] self_name 跳过：ingest 带 self_name=本人 → 该 contact 不入册"
  ingest "{\"cs_wechat_id\":\"$CS\",\"self_name\":\"$SELFNAME\",\"contacts\":[{\"name\":\"$CUST\"},{\"name\":\"$SELFNAME\"}]}" >/dev/null
  SCNT=$(psql_q "SELECT count(*) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND contact='$SELFNAME'")
  [ "$SCNT" = "0" ] || { echo "FAIL: self_name 会话竟入册 $SCNT 行"; exit 1; }

  echo "[6] GET /customers 排除软删：手动软删真客户 → 名册不再出现"
  psql_q "UPDATE zenithjoy.crm_customers SET deleted_at=now() WHERE cs_wechat_id='$CS' AND contact='$CUST';" >/dev/null
  ce -o /tmp/recon_get.json -w "%{http_code}" "${API_BASE}/api/crm/customers?cs_wechat_id=$CS" >/dev/null
  jq -e --arg c "$CUST" 'all(.customers[]; .contact != $c)' /tmp/recon_get.json >/dev/null \
    || { echo "FAIL: 软删客户仍出现在名册"; cat /tmp/recon_get.json; exit 1; }

  echo "✅ Line04 CRM 采集对账 smoke 全过（干跑累计/满K不删/复活/ClawBot/self_name/GET排除软删）"
}

main "$@"
