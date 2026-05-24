#!/usr/bin/env bash
# golden-path-2-smoke.sh
# Path 2 Sprint A 全链 smoke（CI 模式 — 用 helper seed + fake-feishu-server stub）
#
# 通过标准（合同约束 A）：跑到 Step 4 PASS，exit 0。任一 step fail → 整 sprint FAIL。
# 后续 Step 5-8 由 Lead 客户机自验（.agent-knowledge/path-2/lead-acceptance-sprint-a.md）

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"

# CI 模式自检：必须指向 fake-feishu-server（CI workflow 负责拉起 localhost:3099）
if [ -z "${FEISHU_API_BASE:-}" ]; then
  echo "❌ 前置失败：未设置 FEISHU_API_BASE，CI 模式必须 export 指向 fake-feishu-server"
  exit 99
fi

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }

# ── 前置：建测试 tenant + 灌 app_id/app_secret ──
# license_key UNIQUE，加 RANDOM 防重
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan, feishu_app_id, feishu_app_secret) VALUES ('p2-smoke-${RANDOM}-$$', 'p2-key-${RANDOM}-$$', 'free', 'cli_smoke_app', 'smoke_secret_xxx') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
echo "    [TENANT_ID=$TENANT_ID]"

# ── Step 1: OAuth start ──
RESP=$(curl -fsS -X POST "$API_BASE/api/feishu/oauth/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"app_id":"cli_smoke_app","app_secret":"smoke_secret_xxx"}')
echo "$RESP" | jq -er '.data.authorize_url' | grep -qE 'feishu\.cn.*authorize' || fail "Step 1: authorize_url 错 — $RESP" 1

# 验证 tenants.feishu_app_id 已写入（time-windowed）
COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenants WHERE id='$TENANT_ID' AND feishu_app_id='cli_smoke_app' AND updated_at > NOW() - interval '60 seconds'")
[ "$COUNT" = "1" ] || fail "Step 1: tenants.feishu_app_id 未写入 (count=$COUNT)" 1

STATE_TOKEN=$(echo "$RESP" | jq -r '.data.state')
[ -n "$STATE_TOKEN" ] && [ "$STATE_TOKEN" != "null" ] || fail "Step 1: 缺 data.state" 1
ok "Step 1: OAuth start"

# ── Step 2: callback（CI 模式：fake-feishu-server 已被 stub 接管）──
# state 带 = 等特殊字符，URL-encode 一下
STATE_ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$STATE_TOKEN")
RESP_CODE=$(curl -s -o /tmp/cb.json -w '%{http_code}' \
  "$API_BASE/api/feishu/oauth/callback?code=fake_code_smoke&state=$STATE_ENC")
[[ "$RESP_CODE" =~ ^(200|302)$ ]] || fail "Step 2: callback HTTP $RESP_CODE — $(cat /tmp/cb.json)" 2

BIND_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND tenant_access_token IS NOT NULL AND bound_at > NOW() - interval '60 seconds'")
[ "$BIND_COUNT" = "1" ] || fail "Step 2: tenant_feishu_bindings 未落库 (count=$BIND_COUNT)" 2
ok "Step 2: OAuth callback + token 入库"

# ── Step 3: token 自动刷新（强制过期）──
psql "$DB" -c "UPDATE zenithjoy.tenant_feishu_bindings SET expires_at = NOW() - interval '1 hour' WHERE tenant_id='$TENANT_ID'" >/dev/null
# lead-config 走 getValidToken — 即使没数据也会触发刷新
curl -fsS "$API_BASE/api/lead-config/$TENANT_ID" -H "X-Tenant-Id: $TENANT_ID" >/dev/null 2>&1 || true
REFRESHED=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND last_refreshed_at > NOW() - interval '60 seconds' AND expires_at > NOW() + interval '30 minutes'")
[ "$REFRESHED" = "1" ] || fail "Step 3: token 未自动刷新 (count=$REFRESHED)" 3
ok "Step 3: tenant_access_token 自动刷新"

# ── Step 4: Bitable 3 张表 + ID 入库（正则验真 ID 格式）──
RES=$(psql "$DB" -t -A -F'|' -c "SELECT app_token, table_id_lead_profile, table_id_target_videos, table_id_leads FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND bound_at > NOW() - interval '5 minutes'")
APP_TOKEN=$(echo "$RES" | cut -d'|' -f1)
T1=$(echo "$RES" | cut -d'|' -f2); T2=$(echo "$RES" | cut -d'|' -f3); T3=$(echo "$RES" | cut -d'|' -f4)

# app_token 必须符合飞书真 ID 格式 bascn[A-Za-z0-9]{10,}
echo "$APP_TOKEN" | grep -qE '^bascn[A-Za-z0-9]{10,}$' || fail "Step 4: app_token 格式错 '$APP_TOKEN'" 4

# 3 个 table_id 必须符合 tbl[A-Za-z0-9]{10,}
for tbl in "$T1" "$T2" "$T3"; do
  echo "$tbl" | grep -qE '^tbl[A-Za-z0-9]{10,}$' || fail "Step 4: table_id 格式错 '$tbl'" 4
done

[ "$T1" != "$T2" ] && [ "$T2" != "$T3" ] && [ "$T1" != "$T3" ] || fail "Step 4: 3 个 table_id 重复" 4
ok "Step 4: Bitable 文档 + 3 表 ID 落库 ✓✓✓ Sprint A 关键阈值过线"

# ── R4 错误路径自验：已绑过的 tenant 再次调 oauth/start 必须 400 ALREADY_BOUND ──
DUP_CODE=$(curl -s -o /tmp/dup.json -w '%{http_code}' -X POST "$API_BASE/api/feishu/oauth/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"app_id":"cli_smoke_app","app_secret":"smoke_secret_xxx"}')
[ "$DUP_CODE" = "400" ] || fail "R4: 重复绑定应返 400，实际 $DUP_CODE — $(cat /tmp/dup.json)" 41
ALREADY_BOUND=$(jq -r '.error.code' /tmp/dup.json)
[ "$ALREADY_BOUND" = "ALREADY_BOUND" ] || fail "R4: error.code 应 ALREADY_BOUND，实际 $ALREADY_BOUND" 41
ok "R4: ALREADY_BOUND 错误路径"

# ── 关键阈值线（PRD 约束 1）：跑到 Step 4 PASS = sprint A 通过 ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Path 2 Sprint A smoke: Step 1-4 PASS"
echo "  后续 Step 5-8 由 Lead 客户机自验"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
