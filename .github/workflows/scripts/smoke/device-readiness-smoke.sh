#!/usr/bin/env bash
# device-readiness-smoke.sh
# 设备就绪度上报 —— 客服要能在中台看到「这台客户手机卡在哪一项」
#
# 验证链路（数据写入类功能，按 Contract 规矩必须查 DB 确认记录存在且字段正确）：
#   1. POST /api/auth/sign-up/email + GET /api/account/me   注册拿 license
#   2. POST /api/agent/heartbeat              带 readiness（accessibility ok=false）
#   3. SQL 反查 zenithjoy.agents              readiness 落库 + readiness_at 非空
#                                             + 服务端合成的 license_binding 条目存在
#   4. GET  /api/agent/module-health          readiness_verdict == not_ready
#   5. POST /api/agent/heartbeat              readiness 全 ok（模拟客户把开关开好了）
#   6. GET  /api/agent/module-health          readiness_verdict 翻成 ready
#                                             （同时证明是覆盖写"最新一份"，不是追加）
#
# 退出码：
#   0  全过
#   1  注册失败 / 拿不到 license
#   2  heartbeat 失败 / 拿不到 agent_id
#   3  readiness 没落库 或 readiness_at 为空
#   4  服务端没合成 license_binding 条目（设备端不知道自己绑没绑上，这项必须服务端补）
#   5  未就绪时 verdict 不是 not_ready
#   6  开关开好后 verdict 没翻成 ready（覆盖写或三态判定坏了）
#  12  apps/api 没起
#
# 依赖：
#   API_BASE 默认 http://localhost:5200
#   PG 凭据从环境变量 PGUSER/PGPASSWORD/PGHOST/PGDATABASE 读取；
#   默认值只是本地开发栈的 docker-compose 账号，不触达任何生产/客户数据。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

run_psql() {
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 -t -A "$@"
}

TS=$(date +%s)
EMAIL="readiness-${TS}@zenithjoy.test"
PASSWORD="$(date +%s%N | shasum -a 256 2>/dev/null | head -c 12 || date +%s%N | sha256sum | head -c 12)Aa1"
MACHINE_ID="readiness-smoke-${TS}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "device-readiness-smoke  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [0] apps/api 活着吗"
curl -fsS "${API_BASE}/health" >/dev/null || { echo "  ❌ apps/api 没起 (${API_BASE}/health)"; exit 12; }
echo "  OK"

echo "▶ [1] 注册拿 license（走 better-auth sign-up + /api/account/me，同 account-me-smoke）"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT
RESP=$(curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"Readiness Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email") || { echo "  FAIL: sign-up 失败"; exit 1; }
sleep 1  # 等 hooks.after 建 free license
RESP=$(curl -fsS -b "$COOKIE_JAR" -H "Accept: application/json" "${API_BASE}/api/account/me") \
  || { echo "  FAIL: /api/account/me 失败"; exit 1; }
LICENSE=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);l=d.get('license') or {};print(l.get('license_key') or '')")
[ -n "$LICENSE" ] || { echo "  FAIL: 拿不到 license — body=$RESP"; exit 1; }
echo "  OK: license=${LICENSE:0:16}…"

echo "▶ [2] heartbeat 上报「无障碍没绑上」"
NOT_READY_BODY=$(cat <<JSON
{"license":"${LICENSE}","version":"readiness-smoke","hostname":"RMX-SMOKE","os_type":"android",
 "machine_id":"${MACHINE_ID}",
 "readiness":{"accessibility":{"ok":false,"detail":"授权被 com.zenithjoy.agent.e2e 拿走了"},
              "screen_capture":{"ok":true}}}
JSON
)
RESP=$(curl -fsS -X POST -H "Content-Type: application/json" -d "$NOT_READY_BODY" "${API_BASE}/api/agent/heartbeat")
AGENT_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('agent_id') or '')")
[ -n "$AGENT_ID" ] || { echo "  FAIL: 拿不到 agent_id — body=$RESP"; exit 2; }
echo "  OK: agent_id=$AGENT_ID"

echo "▶ [3] SQL 反查 readiness 真落库了"
ROW=$(run_psql -c "SELECT coalesce(readiness::text,'') || '|' || coalesce(readiness_at::text,'') FROM zenithjoy.agents WHERE id='${AGENT_ID}';")
READINESS_JSON="${ROW%%|*}"
READINESS_AT="${ROW#*|}"
echo "$READINESS_JSON" | grep -q 'accessibility' || { echo "  FAIL: readiness 没落库 — row=$ROW"; exit 3; }
[ -n "$READINESS_AT" ] || { echo "  FAIL: readiness_at 为空，看不出这份数据有多旧"; exit 3; }
echo "  OK: readiness 已落库，readiness_at=$READINESS_AT"

echo "▶ [4] 服务端必须自己补上 license_binding 条目"
echo "$READINESS_JSON" | grep -q 'license_binding' || {
  echo "  FAIL: readiness 里没有 license_binding —— 设备端不知道自己绑没绑上，这项只能服务端补"
  echo "        readiness=$READINESS_JSON"; exit 4; }
echo "  OK: license_binding 已由服务端合成"

verdict_of() {
  curl -fsS -H "Authorization: Bearer ${LICENSE}" "${API_BASE}/api/agent/module-health" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=(d.get('data') or [])
for r in rows:
    if r.get('agent_id')=='${AGENT_ID}':
        print(r.get('readiness_verdict') or ''); break
else:
    print('')
"
}

echo "▶ [5] 未就绪 → verdict 必须是 not_ready"
V=$(verdict_of)
[ "$V" = "not_ready" ] || { echo "  FAIL: verdict=${V}（期望 not_ready）"; exit 5; }
echo "  OK: verdict=not_ready"

echo "▶ [6] 客户把开关开好 → 下一次心跳 verdict 必须翻成 ready"
READY_BODY=$(cat <<JSON
{"license":"${LICENSE}","version":"readiness-smoke","hostname":"RMX-SMOKE","os_type":"android",
 "machine_id":"${MACHINE_ID}",
 "readiness":{"accessibility":{"ok":true},"screen_capture":{"ok":true}}}
JSON
)
curl -fsS -X POST -H "Content-Type: application/json" -d "$READY_BODY" "${API_BASE}/api/agent/heartbeat" >/dev/null
V=$(verdict_of)
[ "$V" = "ready" ] || {
  echo "  FAIL: verdict=${V}（期望 ready）——要么覆盖写坏了（旧的 ok=false 还留着），要么三态判定坏了"
  exit 6; }
echo "  OK: verdict=ready（覆盖写生效，三态判定通）"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PASS device-readiness-smoke —— 6 步全过"
