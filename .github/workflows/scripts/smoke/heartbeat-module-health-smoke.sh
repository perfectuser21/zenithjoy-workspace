#!/usr/bin/env bash
# heartbeat-module-health-smoke.sh
# Sprint 06081603 — 心跳双向 modules 协议 + module-health 端点真链路 E2E smoke
#
# 验证链路：
#   1. POST /api/auth/sign-up/email             注册（auto 建 free license）
#   2. GET  /api/account/me                     拿 license_key（agent 鉴权用）
#   3. POST /api/agent/heartbeat                响应含 modules（4 Line × status+required_version）
#      同一请求 body 带 module_status            → 服务端持久化
#   4. GET  /api/agent/module-health            返回该机器 module_status 矩阵
#   5. SQL 反查 zenithjoy.agents.module_status   确认 jsonb 真落库（防 API 撒谎）
#
# 退出码：0 全过 / 1 注册 / 2 取 license / 3 heartbeat modules / 4 module-health / 5 DB 校验
#
# 依赖：API_BASE 默认 http://localhost:5200；PG* 凭据从环境变量读取（dev 默认 cecelia）。
#   生产跑此脚本必须 export 真 PG 凭据，defaults 不触达生产数据。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PSQL_USER="${PGUSER:-cecelia}"
PSQL_DB="${PGDATABASE:-cecelia}"
PSQL_HOST="${PGHOST:-localhost}"
PSQL_PASS="${PGPASSWORD:-cecelia}"

TS=$(date +%s)
EMAIL="hb-modhealth-${TS}@zenithjoy.test"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

run_psql() {
  PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -v ON_ERROR_STOP=1 -t -A "$@"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Sprint 06081603 — heartbeat 双向 modules + module-health smoke"
echo "  email=${EMAIL}  API_BASE=${API_BASE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Step 1：注册
echo "▶ [1/5] POST /api/auth/sign-up/email"
curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"HB ModHealth Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email" >/dev/null 2>/tmp/hb-mh-step1.err || {
  echo "  FAIL: sign-up HTTP failed"; cat /tmp/hb-mh-step1.err; exit 1; }
sleep 1
echo "  OK"

# ─── Step 2：取 license_key
echo "▶ [2/5] GET /api/account/me → license_key"
RESP_2=$(curl -fsS -b "$COOKIE_JAR" "${API_BASE}/api/account/me" 2>/tmp/hb-mh-step2.err) || {
  echo "  FAIL: /api/account/me HTTP failed"; cat /tmp/hb-mh-step2.err; exit 2; }
LICENSE_KEY=$(echo "$RESP_2" | python3 -c "import sys,json;l=json.load(sys.stdin).get('license') or {};print(l.get('license_key') or '')" 2>/dev/null || true)
[ -z "$LICENSE_KEY" ] && { echo "  FAIL: 无 license_key ($RESP_2)"; exit 2; }
echo "  OK: license_key=${LICENSE_KEY}"

# ─── Step 3：heartbeat 带 module_status，断言响应 modules
echo "▶ [3/5] POST /api/agent/heartbeat（上报 module_status，校验下发 modules）"
HB_BODY='{"hostname":"smoke-pc","version":"1.0.0","module_status":{"line04-wechat-cs":{"ok":false,"reason":"wechat_version_4.2.0_unsupported"},"line01-publish":{"ok":true}}}'
RESP_3=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${LICENSE_KEY}" \
  -d "$HB_BODY" "${API_BASE}/api/agent/heartbeat" 2>/tmp/hb-mh-step3.err) || {
  echo "  FAIL: heartbeat HTTP failed"; cat /tmp/hb-mh-step3.err; exit 3; }
AGENT_ID=$(echo "$RESP_3" | python3 -c "import sys,json;print(json.load(sys.stdin).get('agent_id') or '')" 2>/dev/null || true)
L04_STATUS=$(echo "$RESP_3" | python3 -c "import sys,json;m=json.load(sys.stdin).get('modules') or {};print((m.get('line04-wechat-cs') or {}).get('status') or '')" 2>/dev/null || true)
L04_VER=$(echo "$RESP_3" | python3 -c "import sys,json;m=json.load(sys.stdin).get('modules') or {};print((m.get('line04-wechat-cs') or {}).get('required_version') or '')" 2>/dev/null || true)
[ -z "$AGENT_ID" ] && { echo "  FAIL: 无 agent_id ($RESP_3)"; exit 3; }
[ "$L04_STATUS" = "active" ] || { echo "  FAIL: 期望 line04 status=active，实际 '${L04_STATUS}'"; exit 3; }
[ "$L04_VER" = "1.0.109" ] || { echo "  FAIL: 期望 line04 required_version=1.0.109，实际 '${L04_VER}'"; exit 3; }
echo "  OK: agent_id=${AGENT_ID:0:8}… modules.line04={status=${L04_STATUS},ver=${L04_VER}}"

# ─── Step 4：module-health 端点回读
echo "▶ [4/5] GET /api/agent/module-health"
RESP_4=$(curl -fsS -H "Authorization: Bearer ${LICENSE_KEY}" \
  "${API_BASE}/api/agent/module-health" 2>/tmp/hb-mh-step4.err) || {
  echo "  FAIL: module-health HTTP failed"; cat /tmp/hb-mh-step4.err; exit 4; }
FOUND=$(AID="$AGENT_ID" python3 -c "
import sys,json,os
d=json.load(sys.stdin); aid=os.environ['AID']
for r in (d.get('data') or []):
    if r.get('agent_id')==aid:
        ms=r.get('module_status') or {}
        print('1' if (ms.get('line04-wechat-cs') or {}).get('ok') is False else '0'); break
else:
    print('0')
" <<<"$RESP_4" 2>/dev/null || echo 0)
[ "$FOUND" = "1" ] || { echo "  FAIL: module-health 未含本机 line04 ok=false ($RESP_4)"; exit 4; }
echo "  OK: module-health 返回本机 line04 ok=false"

# ─── Step 5：DB 二次校验（防 API 撒谎）
echo "▶ [5/5] SQL 反查 zenithjoy.agents.module_status"
DB_OK=$(run_psql -c "SELECT module_status->'line04-wechat-cs'->>'ok' FROM zenithjoy.agents WHERE id='${AGENT_ID}';")
[ "$DB_OK" = "false" ] || { echo "  FAIL: DB module_status line04.ok='${DB_OK}'，期望 false"; exit 5; }
echo "  OK: DB module_status 已落库"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ heartbeat 双向 modules 协议 + module-health PASS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
