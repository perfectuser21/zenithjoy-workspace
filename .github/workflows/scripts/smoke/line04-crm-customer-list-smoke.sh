#!/usr/bin/env bash
# line04-crm-customer-list-smoke.sh — Line04 中台 AI-native CRM·客户列表页 真后端 smoke（模式 A）
#
# 真 API :5200 + 真 zenithjoy postgres：造两租户验隔离 + 登录态 401/200 + 接管开关写 whitelist +
# 状态 A1-A5 持久化 + 加客户 source=manual + should_reply 白名单 gate + 跨租户 403 CROSS_TENANT。
#
# 鉴权：用 dashboard 租户管理员通道 —— X-Feishu-User-Id 头映射 tenant_members（owner/admin），
# 走 tenantContext→requireCsAdmin→requireSameTenant（与 better-auth cookie 同一条闸链，能验跨租户隔离）。
# 该头**不**放进 ADMIN_FEISHU_OPENIDS，否则会被当 legacy 超管跨租户放行，验不出 CROSS_TENANT。
#
# --leg=cookie-seam：cookie 接缝真目标 leg —— 起 dashboard preview（vite proxy /api→:5200）+
#   playwright install chromium + 真登录 bootstrap 导出 REAL_SESSION_COOKIE → 跑
#   apps/dashboard/e2e/crm-cookie-seam.spec.ts（无 page.route stub / 无 VITE_SKIP_AUTH）。
#   cookie 未 bootstrap 出来 → spec 内 test.skip 自动降级 logic-done-pending（禁 stub 绿冒充 done）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_USER="${PSQL_USER:-cecelia}"
PSQL_DB="${PSQL_DB:-cecelia}"
PSQL_PASS="${PSQL_PASS:-cecelia}"

CS_WECHAT_ID="${CS_WECHAT_ID:-wx_cs_smoke_A}"
CS_WECHAT_ID_B="${CS_WECHAT_ID_B:-wx_cs_smoke_B}"
CONTACT="${CONTACT:-客户甲_$$}"
ADMIN_A="${ADMIN_A:-ou_crm_smoke_admin_A_$$}"
ADMIN_B="${ADMIN_B:-ou_crm_smoke_admin_B_$$}"

psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "$1"; }

# A 租户管理员的 curl（X-Feishu-User-Id 头）
ca()  { curl -s -H "X-Feishu-User-Id: $ADMIN_A" "$@"; }
caf() { curl -sf -H "X-Feishu-User-Id: $ADMIN_A" "$@"; }
cb()  { curl -s -H "X-Feishu-User-Id: $ADMIN_B" "$@"; }

bootstrap() {
  echo "[bootstrap] 建 schema + crm_customers 迁移（幂等）"
  psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null || true
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 \
    -f "$ROOT/apps/api/db/migrations/20260624_210000_create_crm_customers.sql" >/dev/null 2>&1 || true

  echo "[bootstrap] 造两租户 + 管理员 + 客服机 + 一条已聊消息"
  TENANT_A=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('crm-smoke-A','lk_crm_smoke_A_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  TENANT_B=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('crm-smoke-B','lk_crm_smoke_B_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  [ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] || { echo "FAIL: 造租户失败"; exit 1; }

  psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_A','$ADMIN_A','admin') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='admin';" >/dev/null
  psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_B','$ADMIN_B','admin') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='admin';" >/dev/null

  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_A','mc_crm_A_$$','$CS_WECHAT_ID') ON CONFLICT DO NOTHING;" >/dev/null
  psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_B','mc_crm_B_$$','$CS_WECHAT_ID_B') ON CONFLICT DO NOTHING;" >/dev/null

  # A 租户一条已聊消息（让名册 distinct 出 $CONTACT），tenant_id 以 text 存
  psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT_A','$CONTACT','in','你好');" >/dev/null
  export TENANT_A TENANT_B
}

mode_a() {
  bootstrap

  echo "[1] 登录态：无头 → 401；有头 → 非 401"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/crm/customers")
  [ "$CODE" = "401" ] || { echo "FAIL: 无登录态未 401 实际 $CODE"; exit 1; }
  CODE2=$(ca -o /dev/null -w "%{http_code}" "${API_BASE}/api/crm/customers")
  [ "$CODE2" != "401" ] || { echo "FAIL: 登录管理员仍 401 = 登录态 bug"; exit 1; }

  echo "[2] GET /api/crm/customers — 数组 + PRD 字段 + 含已聊 $CONTACT"
  RESP=$(caf "${API_BASE}/api/crm/customers") || { echo "FAIL: GET customers 非 200"; exit 1; }
  echo "$RESP" | jq -e '.customers | type == "array"' >/dev/null || { echo "FAIL: customers 非数组"; exit 1; }
  echo "$RESP" | jq -e --arg c "$CONTACT" 'any(.customers[]; .contact==$c and has("name") and has("wechat_id") and has("status") and has("last_contact_at") and has("managed"))' >/dev/null || { echo "FAIL: 客户行缺字段/缺 $CONTACT"; exit 1; }
  echo "$RESP" | jq -e '.customers[0] | (has("rating") or has("is_managed") or has("enabled")) | not' >/dev/null || { echo "FAIL: 出现禁用字段"; exit 1; }

  echo "[3] 接管开关 PUT → 200 保存成功 + whitelist 真写入"
  ca -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' \
    -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}" \
    | jq -e '.success==true and .managed==true and .message=="保存成功"' >/dev/null || { echo "FAIL: manage 未 200/保存成功"; exit 1; }
  IN=$(psql_q "SELECT (whitelist @> to_jsonb('$CONTACT'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS_WECHAT_ID'")
  [ "$IN" = "t" ] || { echo "FAIL: whitelist 未含 $CONTACT"; exit 1; }

  echo "[4] 状态 A3 持久化 + 刷新仍 A3；非法 A9 → 400"
  ca -X PUT "${API_BASE}/api/crm/customers/status" -H 'Content-Type: application/json' \
    -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}" \
    | jq -e '.success==true and .status=="A3"' >/dev/null || { echo "FAIL: status PUT 未 200"; exit 1; }
  ST=$(psql_q "SELECT status FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$CONTACT'")
  [ "$ST" = "A3" ] || { echo "FAIL: DB status=$ST 非 A3"; exit 1; }
  caf "${API_BASE}/api/crm/customers" | jq -e --arg c "$CONTACT" '.customers[] | select(.contact==$c) | .status=="A3"' >/dev/null || { echo "FAIL: 刷新后非 A3"; exit 1; }
  CODE=$(ca -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/crm/customers/status" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A9\"}")
  [ "$CODE" = "400" ] || { echo "FAIL: 非法 status 未 400 实际 $CODE"; exit 1; }

  echo "[5] +加客户 POST → source=manual + 列表可见"
  NC="新客_$$"
  ca -X POST "${API_BASE}/api/crm/customers" -H 'Content-Type: application/json' \
    -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"name\":\"$NC\",\"contact\":\"$NC\"}" \
    | jq -e '.success==true and .customer.status=="A1" and .customer.managed==false' >/dev/null || { echo "FAIL: POST 未 200"; exit 1; }
  CNT=$(psql_q "SELECT count(*) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$NC' AND source='manual'")
  [ "$CNT" = "1" ] || { echo "FAIL: 手动客户未入册"; exit 1; }
  caf "${API_BASE}/api/crm/customers" | jq -e --arg c "$NC" 'any(.customers[]; .contact==$c)' >/dev/null || { echo "FAIL: 新客不在列表"; exit 1; }

  echo "[6] 白名单 gate should_reply 纯函数"
  python3 -c "import sys; sys.path.insert(0,'$ROOT/services/agent/wechat-rpa'); from cs_config_gate import should_reply; assert should_reply({'whitelist':['张三']},'张三') is True; assert should_reply({'whitelist':['张三']},'李四') is False; assert should_reply({'whitelist':[]},'张三') is False; print('gate OK')"

  echo "[7] 跨租户隔离 — B 读不到 A 的 $CONTACT + B 跨写 A 客服机 → 403 CROSS_TENANT"
  cb "${API_BASE}/api/crm/customers" | jq -e --arg a "$CONTACT" 'all(.customers[]; .contact != $a)' >/dev/null || { echo "FAIL: B 看到 A 的客户=串台"; exit 1; }
  CODE=$(cb -o /tmp/crm_xt.json -w "%{http_code}" -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}")
  [ "$CODE" = "403" ] || { echo "FAIL: 跨租户写未拦 实际 $CODE"; exit 1; }
  jq -e '.error.code=="CROSS_TENANT"' /tmp/crm_xt.json >/dev/null || { echo "FAIL: 非 CROSS_TENANT"; exit 1; }

  echo "✅ Line04 CRM 客户列表 模式 A smoke 全过"
}

# cookie 接缝真后端 leg：真登录拿 better-auth session cookie → 注入浏览器无 stub 点接管开关
leg_cookie_seam() {
  bootstrap
  echo "[cookie-seam] 真登录 bootstrap REAL_SESSION_COOKIE（best-effort，缺则 spec 内 test.skip 降级）"
  REAL_SESSION_COOKIE=""
  if [ -n "${E2E_SUPER_ADMIN_EMAIL:-}" ] && [ -n "${E2E_SUPER_ADMIN_PASSWORD:-}" ]; then
    LOGIN=$(curl -s -i -X POST "${API_BASE}/api/auth/sign-in/email" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$E2E_SUPER_ADMIN_EMAIL\",\"password\":\"$E2E_SUPER_ADMIN_PASSWORD\"}" 2>/dev/null || true)
    TOKEN=$(printf '%s' "$LOGIN" | grep -i '^set-cookie:' | grep -oE 'better-auth.session_token=[^;]+' | head -1 || true)
    [ -n "$TOKEN" ] && REAL_SESSION_COOKIE="$TOKEN"
  fi

  echo "[cookie-seam] build dashboard + vite preview:5174"
  ( cd "$ROOT/apps/dashboard" && npm run build >/tmp/crm_dash_build.log 2>&1 ) || { echo "FAIL: dashboard build"; exit 1; }
  ( cd "$ROOT/apps/dashboard" && npx vite preview --port 5174 --host >/tmp/crm_preview.log 2>&1 & echo $! >/tmp/crm_preview.pid )
  for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:5174/" && break; sleep 1; done

  echo "[cookie-seam] playwright install + 跑 crm-cookie-seam.spec.ts（真后端无 stub）"
  ( cd "$ROOT/apps/dashboard" && npx playwright install chromium >/tmp/crm_pw_install.log 2>&1 ) || true
  set +e
  ( cd "$ROOT/apps/dashboard" && E2E_REAL_SESSION_COOKIE="$REAL_SESSION_COOKIE" E2E_BASE_URL="http://localhost:5174" \
      npx playwright test e2e/crm-cookie-seam.spec.ts --reporter=list )
  RC=$?
  set -e
  [ -f /tmp/crm_preview.pid ] && kill "$(cat /tmp/crm_preview.pid)" 2>/dev/null || true
  [ "$RC" -eq 0 ] || { echo "FAIL: cookie 接缝真浏览器 leg 未过 (rc=$RC)"; exit 1; }
  echo "✅ cookie 接缝 leg 通过（或 REAL_SESSION_COOKIE 缺失时 spec 内 test.skip 降级 logic-done-pending）"
}

LEG="${1:-}"
case "$LEG" in
  --leg=cookie-seam) leg_cookie_seam ;;
  *) mode_a ;;
esac
