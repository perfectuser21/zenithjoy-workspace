#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-scan-scroll-detail-fields-smoke.sh — A1/A2 端到端 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明本 smoke 可在 clean CI（标准 postgres + API:5200）跑。
#
# 背景（CRM 第一步地基 Track A）：
#   A1 滚动扫全活跃会话：scan_recent_contacts 改成滚完整个 Qt 虚拟列表（一屏只渲染 ~6 条 → 漏）。
#   A2 补字段：每个联系人补 wechat_id（对方微信号）+ add_friend_time（≈加微信时间），上报中台。
# 本 smoke 验「上报 payload 带这两字段时，后端 /friend-scan/ingest 真接受并落库」——
# 即 A2 的 payload schema 端到端 wire-compatible（agent 多带字段不会被后端拒）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-${PGHOST:-localhost}}"
PSQL_USER="${PSQL_USER:-${PGUSER:-cecelia}}"
PSQL_DB="${PSQL_DB:-${PGDATABASE:-cecelia}}"
PSQL_PASS="${PSQL_PASS:-${PGPASSWORD:-cecelia}}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"

CS="${CS_WECHAT_ID:-wx_cs_scan_$$}"
CONTACT_A="滚动客户A_$$"
CONTACT_B="滚动客户B_$$"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }
ci()  { curl -s  -H "X-Internal-Token: $INTERNAL_TOKEN" "$@"; }

bootstrap() {
  echo "[bootstrap] 建 schema + 迁移（幂等）"
  psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
  for f in \
    "$ROOT/apps/api/db/migrations/20260622_210000_create_wechat_cs_account_config.sql" \
    "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" \
    "$ROOT/apps/api/db/migrations/20260625_100000_add_blacklist_and_takeover_mode.sql" \
    "$ROOT/apps/api/db/migrations/20260625_101000_crm_customers_add_scan_source.sql" \
    "$ROOT/apps/api/db/migrations/20260625_102000_create_crm_onboarding_state.sql" \
    "$ROOT/apps/api/db/migrations/20260625_150000_crm_onboarding_add_force_scan.sql"; do
    PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
  done

  echo "[bootstrap] 幂等清场 + 造租户/客服机"
  psql_q "DELETE FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.crm_onboarding_state WHERE cs_wechat_id='$CS';" >/dev/null || true
  psql_q "DELETE FROM zenithjoy.service_agents WHERE wechat_id='$CS';" >/dev/null || true
  TENANT=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('scan-scroll-smoke','lk_scan_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  [ -n "$TENANT" ] || { echo "FAIL: 造租户失败"; exit 1; }
  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT','mc_scan_$$','$CS') ON CONFLICT DO NOTHING;" >/dev/null
}

main() {
  bootstrap

  echo "[A2] ingest：上报 contacts 带 wechat_id + add_friend_time → 后端接受（200）+ 落库 source=scan"
  R1=$(ci -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' \
    -d "{\"cs_wechat_id\":\"$CS\",\"contacts\":[{\"name\":\"$CONTACT_A\",\"last_message\":\"在吗\",\"wechat_id\":\"wxid_aaa_$$\",\"add_friend_time\":\"2026-03-12\"},{\"name\":\"$CONTACT_B\",\"last_message\":\"你好\",\"wechat_id\":\"wxid_bbb_$$\"}]}") \
    || { echo "FAIL: ingest 非 200"; exit 1; }
  echo "    resp=$R1"
  echo "$R1" | jq -e '.success==true and .ingested==2 and .scanned_count==2' >/dev/null \
    || { echo "FAIL: 带新字段的 ingest 响应不符（payload schema 不兼容）$R1"; exit 1; }

  echo "[A2] 落库校验：两个联系人都进 crm_customers，source=scan"
  CNT=$(psql_q "SELECT count(*) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS' AND source='scan'")
  [ "$CNT" = "2" ] || { echo "FAIL: 应落 2 行 scan 客户，实际 $CNT"; exit 1; }

  echo "[A1] 滚动累计语义：上报 >6 个 distinct 联系人后名册可读出全部（不被一屏 6 条上限截断）"
  BIG_CONTACTS=$(python3 - "$$" <<'PY'
import json, sys
suf = sys.argv[1]
arr = [{"name": f"批量客户{i}_{suf}", "last_message": f"m{i}", "wechat_id": f"wxid_{i}_{suf}"} for i in range(12)]
print(json.dumps(arr, ensure_ascii=False))
PY
)
  R2=$(ci -X POST "${API_BASE}/api/crm/friend-scan/ingest" -H 'Content-Type: application/json' \
    -d "{\"cs_wechat_id\":\"$CS\",\"contacts\":$BIG_CONTACTS}") || { echo "FAIL: 批量 ingest 非 200"; exit 1; }
  echo "$R2" | jq -e '.scanned_count==12' >/dev/null || { echo "FAIL: 批量 12 人未全收 $R2"; exit 1; }

  echo "PASS line04-scan-scroll-detail-fields-smoke"
}

main "$@"
