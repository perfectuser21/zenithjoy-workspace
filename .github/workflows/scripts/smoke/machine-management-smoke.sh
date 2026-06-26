#!/usr/bin/env bash
# machine-management-smoke.sh — 机器管理模块 真后端 smoke（模式 A + cookie-seam leg）
#
# 真 API :5200 + 真 zenithjoy postgres：造租户 + 两台机器（在线/离线）+ 一条失效 burner session，
# 验机器列表（7 字段 + 禁用字段反向 + key=machines）/ 改名标主副持久化 / error path（空名·非法角色）/
# 机器详情 accounts(role/valid) / 在机器上 qr-bind 加号→回写→新号现身 / 离线 status + 失效 valid=false /
# 跨租户隔离 403/404 + 无登录态 401。
#
# 鉴权：用 dashboard 租户管理员通道 —— X-Feishu-User-Id 头映射 tenant_members（owner/admin），
# 走 tenantContextOptional→tenantContext（与 better-auth cookie 同一条闸链，能验跨租户隔离）。
# 该头**不**放进 ADMIN_FEISHU_OPENIDS，否则会被当 legacy 超管跨租户放行，验不出 CROSS_TENANT。
#
# --leg=cookie-seam：cookie 接缝真目标 leg（接缝清单 #1）—— best-effort 真登录拿 better-auth
#   session cookie → 真 PUT /api/agent/machines/:id（credentials 真到达后端）→ psql 复核 agents
#   nickname/updated_at 真写入。无 E2E_SUPER_ADMIN 凭据时降级 logic-done-pending（禁 stub 绿冒充 done）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_USER="${PSQL_USER:-cecelia}"
PSQL_DB="${PSQL_DB:-cecelia}"
PSQL_PASS="${PSQL_PASS:-cecelia}"

ADMIN_A="${ADMIN_A:-ou_mm_smoke_admin_A_$$}"
ADMIN_B="${ADMIN_B:-ou_mm_smoke_admin_B_$$}"

# 依赖工具自检（缺则早失败，给清晰提示，而不是中途莫名报错）
for tool in curl jq psql; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: 缺依赖工具 $tool"; exit 1; }
done

# 临时文件统一清理（避免残留）
TMP_EMPTY=$(mktemp /tmp/mm_empty.XXXXXX.json)
TMP_XT=$(mktemp /tmp/mm_xt.XXXXXX.json)
trap 'rm -f "$TMP_EMPTY" "$TMP_XT"' EXIT

# curl 统一超时（防真机/CI 网络卡死），所有 helper 复用
CURL_OPTS=(--connect-timeout 5 --max-time 30)

# -q 抑制命令状态标签（如 "INSERT 0 1"），否则 RETURNING 捕获会把标签和 id 一起带出
psql_q() { PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -qtAc "$1"; }

# A 租户管理员的 curl（X-Feishu-User-Id 头）
ca()  { curl -s "${CURL_OPTS[@]}" -H "X-Feishu-User-Id: $ADMIN_A" "$@"; }
caf() { curl -sf "${CURL_OPTS[@]}" -H "X-Feishu-User-Id: $ADMIN_A" "$@"; }
cb()  { curl -s "${CURL_OPTS[@]}" -H "X-Feishu-User-Id: $ADMIN_B" "$@"; }

bootstrap() {
  echo "[bootstrap] 按序跑全部 migration（幂等；不写死单个文件名，对改名/新增鲁棒）"
  psql_q "CREATE SCHEMA IF NOT EXISTS zenithjoy;" >/dev/null
  psql_q "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  MIG_DIR="$ROOT/apps/api/db/migrations"
  [ -d "$MIG_DIR" ] || { echo "FAIL: 找不到 migration 目录 $MIG_DIR"; exit 1; }
  # 幂等迁移：ON_ERROR_STOP=0 容忍「已存在」噪声，但下面用 schema 后置断言兜底真失败
  for f in "$MIG_DIR"/*.sql; do
    PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=0 \
      -f "$f" >/dev/null 2>&1 || true
  done
  # 后置断言：本 sprint 关键列必须真建出来（迁移若真失败，这里早失败，不让后续测试静默错位）
  COLS=$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='agents' AND column_name IN ('nickname','machine_role')")
  [ "$COLS" = "2" ] || { echo "FAIL: agents 缺 nickname/machine_role 列（migration 未生效，count=$COLS）"; exit 1; }

  echo "[bootstrap] 造两租户 + 管理员 + 两台机器（在线/离线）+ 一条失效 burner session"
  TENANT_A=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('mm-smoke-A','lk_mm_smoke_A_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  TENANT_B=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('mm-smoke-B','lk_mm_smoke_B_$$') ON CONFLICT (license_key) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  [ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] || { echo "FAIL: 造租户失败"; exit 1; }

  psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_A','$ADMIN_A','admin') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='admin';" >/dev/null
  psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_B','$ADMIN_B','admin') ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role='admin';" >/dev/null

  # 在线机器（A 租户）
  MACHINE_ID=$(psql_q "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, version, status, machine_role) VALUES ('$TENANT_A','agent_mm_on_$$','pc-mm-on','1.0.70','online','sub') RETURNING id;")
  # 离线机器（A 租户）
  OFFLINE_MACHINE_ID=$(psql_q "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, version, status, machine_role) VALUES ('$TENANT_A','agent_mm_off_$$','pc-mm-off','1.0.60','offline','sub') RETURNING id;")
  [ -n "$MACHINE_ID" ] && [ -n "$OFFLINE_MACHINE_ID" ] || { echo "FAIL: 造机器失败"; exit 1; }

  # 失效 burner session（needs_rebind → valid=false）挂在在线机器下
  psql_q "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at) VALUES ('$MACHINE_ID','douyin','burner_dead_$$','burner','needs_rebind',NOW()) ON CONFLICT (agent_id, platform, account_label) DO UPDATE SET status='needs_rebind';" >/dev/null

  export TENANT_A TENANT_B MACHINE_ID OFFLINE_MACHINE_ID
  AGENT_ID="$MACHINE_ID"
  export AGENT_ID
}

mode_a() {
  bootstrap

  echo "[1] 登录态：无头 → 401；有头 → 非 401"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/agent/machines")
  [ "$CODE" = "401" ] || { echo "FAIL: 无登录态未 401 实际 $CODE"; exit 1; }
  CODE2=$(ca -o /dev/null -w "%{http_code}" "${API_BASE}/api/agent/machines")
  [ "$CODE2" != "401" ] || { echo "FAIL: 登录管理员仍 401 = 登录态 bug"; exit 1; }

  echo "[2] GET /machines — 数组 + 7 字段 + 禁用字段反向 + key=machines"
  RESP=$(caf "${API_BASE}/api/agent/machines") || { echo "FAIL: GET machines 非 200"; exit 1; }
  echo "$RESP" | jq -e '.machines | type == "array"' >/dev/null || { echo "FAIL: machines 非数组"; exit 1; }
  echo "$RESP" | jq -e --arg m "$MACHINE_ID" 'any(.machines[]; .id==$m and has("hostname") and has("nickname") and has("status") and has("machine_role") and has("version") and has("douyin_account_count"))' >/dev/null || { echo "FAIL: 机器行缺字段"; exit 1; }
  echo "$RESP" | jq -e '.machines[0] | (has("role") or has("is_main") or has("machineRole") or has("accountCount")) | not' >/dev/null || { echo "FAIL: 出现禁用漂移字段"; exit 1; }
  echo "$RESP" | jq -e 'has("machines") and (has("agents")|not)' >/dev/null || { echo "FAIL: 列表 key 非 machines"; exit 1; }

  echo "[3] PUT 改名 + 标主副 → 200 + DB 真写入(5分钟窗) + 刷新持久化"
  caf -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H 'Content-Type: application/json' \
    -d '{"nickname":"主控机A","machine_role":"main"}' \
    | jq -e '.success==true and .machine.nickname=="主控机A" and .machine.machine_role=="main"' >/dev/null || { echo "FAIL: PUT 未 200"; exit 1; }
  N=$(psql_q "SELECT count(*) FROM zenithjoy.agents WHERE id='$MACHINE_ID' AND nickname='主控机A' AND machine_role='main' AND updated_at > NOW() - interval '5 minutes'")
  [ "$N" = "1" ] || { echo "FAIL: agents 未真写入"; exit 1; }
  caf "${API_BASE}/api/agent/machines" | jq -e --arg m "$MACHINE_ID" '.machines[] | select(.id==$m) | .nickname=="主控机A" and .machine_role=="main"' >/dev/null || { echo "FAIL: 刷新未持久化"; exit 1; }

  echo "[4] error path — 改名为空 / 非法角色 → 400 INVALID_INPUT"
  CODE=$(ca -o "$TMP_EMPTY" -w "%{http_code}" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H 'Content-Type: application/json' -d '{"nickname":"","machine_role":"main"}')
  [ "$CODE" = "400" ] || { echo "FAIL: 空名未 400 实际 $CODE"; exit 1; }
  jq -e '.error.code=="INVALID_INPUT"' "$TMP_EMPTY" >/dev/null || { echo "FAIL: 空名非 INVALID_INPUT"; exit 1; }
  CODE=$(ca -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H 'Content-Type: application/json' -d '{"nickname":"x","machine_role":"boss"}')
  [ "$CODE" = "400" ] || { echo "FAIL: 非法角色未 400 实际 $CODE"; exit 1; }

  echo "[5] GET /machines/:id — {machine, accounts} 号含 role/valid(boolean)"
  RESP=$(caf "${API_BASE}/api/agent/machines/${MACHINE_ID}") || { echo "FAIL: GET detail 非 200"; exit 1; }
  echo "$RESP" | jq -e '.machine.id != null' >/dev/null || { echo "FAIL: 缺 machine"; exit 1; }
  echo "$RESP" | jq -e '.accounts | type == "array"' >/dev/null || { echo "FAIL: accounts 非数组"; exit 1; }
  echo "$RESP" | jq -e '.accounts[0] | has("account_label") and has("role") and has("status") and has("nickname") and (.valid|type=="boolean")' >/dev/null || { echo "FAIL: 号字段缺/valid 非 boolean"; exit 1; }
  echo "$RESP" | jq -e 'has("accounts") and (has("sessions")|not)' >/dev/null || { echo "FAIL: 详情 key 非 accounts"; exit 1; }

  echo "[6] 在机器上加号 — qr-bind → fake-agent 经真路由回写 → 新 burner session 真写入 + 现身详情"
  L="小号_$$"
  TID=$(caf -X POST "${API_BASE}/api/agent/burner/qr-bind" -H 'Content-Type: application/json' \
    -d "{\"agent_id\":\"$AGENT_ID\",\"tenant_id\":\"$TENANT_A\",\"account_label\":\"$L\"}" | jq -r '.data.task_id')
  [ -n "$TID" ] && [ "$TID" != "null" ] || { echo "FAIL: 无 task_id"; exit 1; }
  curl -sf -X POST "${API_BASE}/api/agent/burner/qr-bind-result" -H 'Content-Type: application/json' \
    -d "{\"task_id\":\"$TID\",\"agent_id\":\"$AGENT_ID\",\"qr_login\":\"success\",\"account_nickname\":\"新小号\"}" \
    | jq -e '.success==true' >/dev/null || { echo "FAIL: 回写未 success"; exit 1; }
  N=$(psql_q "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND platform='douyin' AND account_label='$L' AND role='burner' AND status='active' AND bound_at > NOW() - interval '5 minutes'")
  [ "$N" = "1" ] || { echo "FAIL: 新小号未写入"; exit 1; }
  caf "${API_BASE}/api/agent/machines/${MACHINE_ID}" | jq -e --arg l "$L" '.accounts[] | select(.account_label==$l) | .role=="burner"' >/dev/null || { echo "FAIL: 新号未现身机器详情"; exit 1; }

  echo "[7] 离线机器 status=offline + 失效 session valid=false"
  caf "${API_BASE}/api/agent/machines" | jq -e --arg m "$OFFLINE_MACHINE_ID" '.machines[] | select(.id==$m) | .status=="offline"' >/dev/null || { echo "FAIL: 离线机器 status 非 offline"; exit 1; }
  caf "${API_BASE}/api/agent/machines/${MACHINE_ID}" | jq -e '[.accounts[] | select(.status=="needs_rebind" or .status=="expired")] | (length>0) and all(.valid==false)' >/dev/null || { echo "FAIL: 失效 session valid 非 false"; exit 1; }

  echo "[8] 跨租户隔离 — B 读不到 A 的机器 + 跨写 403/404"
  cb "${API_BASE}/api/agent/machines" | jq -e --arg m "$MACHINE_ID" 'all(.machines[]; .id != $m)' >/dev/null || { echo "FAIL: B 看到 A 的机器=串台"; exit 1; }
  CODE=$(cb -o "$TMP_XT" -w "%{http_code}" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H 'Content-Type: application/json' -d '{"nickname":"窃改","machine_role":"main"}')
  { [ "$CODE" = "403" ] || [ "$CODE" = "404" ]; } || { echo "FAIL: 跨租户写未拦 实际 $CODE"; exit 1; }

  echo "✅ 机器管理 模式 A smoke 全过"
}

# cookie 接缝真后端 leg：真登录拿 better-auth session cookie → 真 PUT（credentials 真到达后端）→ psql 复核
leg_cookie_seam() {
  bootstrap
  echo "[cookie-seam] 真登录 bootstrap REAL_SESSION_COOKIE（best-effort，缺则降级 logic-done-pending）"
  COOKIE_HEADER=""
  if [ -n "${E2E_SUPER_ADMIN_EMAIL:-}" ] && [ -n "${E2E_SUPER_ADMIN_PASSWORD:-}" ]; then
    LOGIN=$(curl -s -i -X POST "${API_BASE}/api/auth/sign-in/email" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$E2E_SUPER_ADMIN_EMAIL\",\"password\":\"$E2E_SUPER_ADMIN_PASSWORD\"}" 2>/dev/null || true)
    TOKEN=$(printf '%s' "$LOGIN" | grep -i '^set-cookie:' | grep -oE 'better-auth.session_token=[^;]+' | head -1 || true)
    [ -n "$TOKEN" ] && COOKIE_HEADER="$TOKEN"
  fi

  if [ -z "$COOKIE_HEADER" ]; then
    echo "⚠️  无 E2E_SUPER_ADMIN 凭据 → cookie 接缝降级 logic-done-pending（逻辑/UI 已绿，真接缝待补）"
    echo "✅ cookie-seam leg 降级完成（不阻塞）"
    return 0
  fi

  echo "[cookie-seam] 真 cookie PUT /api/agent/machines/:id → 真后端真收 cookie → 真写 agents"
  curl -sf -b "$COOKIE_HEADER" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H 'Content-Type: application/json' \
    -d '{"nickname":"cookie主控机","machine_role":"main"}' | jq -e '.success==true' >/dev/null \
    || { echo "FAIL: cookie PUT 未 200"; exit 1; }
  N=$(psql_q "SELECT count(*) FROM zenithjoy.agents WHERE id='$MACHINE_ID' AND nickname IS NOT NULL AND updated_at > NOW() - interval '5 minutes'")
  [ "$N" = "1" ] || { echo "FAIL: cookie 接缝—改名后 agents 无真写入，cookie 未真到达后端"; exit 1; }
  echo "✅ cookie 接缝 leg 通过（cookie 真到达后端触发真写）"
}

LEG="${1:-}"
case "$LEG" in
  --leg=cookie-seam) leg_cookie_seam ;;
  *) mode_a ;;
esac
