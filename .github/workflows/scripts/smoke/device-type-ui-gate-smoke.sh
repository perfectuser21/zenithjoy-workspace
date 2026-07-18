#!/usr/bin/env bash
# device-type-ui-gate-smoke.sh (ZenithJoy / Path2 机器管理 + 账号管理 设备类型区分)
#
# 验证 decision 8dbe91ee 修复的展示层缺口：机器管理页(GET /machines, /machines/:id, PUT /machines/:id)
# 和账号管理页(GET /burner/sessions)都必须能拿到 os_type/device_type，用来区分安卓手机和Windows机器。
# 覆盖回归：GET /machines/:id 与 PUT /machines/:id 复用 normMachine() 但曾经各自漏选 os_type 列，
# 导致前端列表合并操作(重命名/设主副机)后把刚显示的设备类型徽标覆盖成 null（本 smoke 逐端点独立验证，
# 任一端点漏选都会在这里被抓到，不靠"列表端点验过了其他端点应该也对"的假设）。
#
# Usage:
#   API_PORT=5200 DB="$DATABASE_URL" bash device-type-ui-gate-smoke.sh

set -uo pipefail

API_PORT="${API_PORT:-5200}"
API_BASE="http://localhost:${API_PORT}"
DB="${DB:-${DATABASE_URL:-}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy device-type-ui-gate Smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ -n "$DB" ] || fail "未提供 DB/DATABASE_URL，本 smoke 必须真库校验，不做纯 mock 降级"

TENANT_ID=$(psql "$DB" -At -c \
  "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-device-type-tenant', 'smoke-device-type-key-$$', 'free') ON CONFLICT DO NOTHING RETURNING id" \
  2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")
[ -n "$TENANT_ID" ] || fail "seed tenant 失败"

AGENT_ID=$(psql "$DB" -At -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, os_type) VALUES ('$TENANT_ID', 'smoke-device-type-agent-$$', 'smoke-android-phone', 'online', 'android') ON CONFLICT DO NOTHING RETURNING id" \
  2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")
[ -n "$AGENT_ID" ] || fail "seed android agent 失败"

psql "$DB" -At -c \
  "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, device_type) VALUES ('$AGENT_ID', 'douyin', 'smoke-device-type-burner', 'burner', 'active', 'android') ON CONFLICT DO NOTHING" \
  2>/dev/null >/dev/null

# 1) GET /machines 列表端点：返回体含 os_type='android'
LIST=$(curl -fsS -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/machines")
LIST_OS=$(echo "$LIST" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const m=(d.data||[]).find(x=>x.agent_id==="smoke-device-type-agent-'"$$"'");
  console.log(m ? m.os_type : "NOT_FOUND");
')
[ "$LIST_OS" = "android" ] || fail "GET /machines 期望 os_type=android，得 $LIST_OS：$LIST"
ok "GET /machines 列表返回 os_type=android"

# 2) GET /machines/:id 详情端点：回归守卫——之前这里漏选 os_type 列，返回体里恒为 null
DETAIL=$(curl -fsS -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/machines/$AGENT_ID")
DETAIL_OS=$(echo "$DETAIL" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).data.machine.os_type)')
[ "$DETAIL_OS" = "android" ] || fail "GET /machines/:id 期望 os_type=android，得 $DETAIL_OS（回归：详情端点漏选 os_type 列）"
ok "GET /machines/:id 详情返回 os_type=android（回归守卫）"

# 3) PUT /machines/:id：回归守卫——之前 RETURNING 漏选 os_type 列，返回体里恒为 null，
#    会导致前端 applyUpdated() 用显式 null 覆盖列表行，把刚显示的徽标冲掉
PUT_RES=$(curl -fsS -X PUT -H "X-Tenant-Id: $TENANT_ID" -H 'Content-Type: application/json' \
  -d '{"nickname":"smoke设备类型验证机"}' "$API_BASE/api/agent/machines/$AGENT_ID")
PUT_OS=$(echo "$PUT_RES" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).data.os_type)')
[ "$PUT_OS" = "android" ] || fail "PUT /machines/:id 期望 os_type=android，得 $PUT_OS（回归：RETURNING 漏选 os_type 列）"
ok "PUT /machines/:id 返回 os_type=android（回归守卫，防止列表徽标被合并覆盖成 null）"

# 4) GET /burner/sessions：返回体含 device_type='android'（账号管理页绑定机器列区分用）
SESSIONS=$(curl -fsS -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/sessions")
SESS_DT=$(echo "$SESSIONS" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const s=(d.data.sessions||[]).find(x=>x.account_label==="smoke-device-type-burner");
  console.log(s ? s.device_type : "NOT_FOUND");
')
[ "$SESS_DT" = "android" ] || fail "GET /burner/sessions 期望 device_type=android，得 $SESS_DT：$SESSIONS"
ok "GET /burner/sessions 返回 device_type=android"

echo "✅ device-type-ui-gate smoke PASS — 机器管理3端点 + 账号管理端点均正确区分安卓设备"
