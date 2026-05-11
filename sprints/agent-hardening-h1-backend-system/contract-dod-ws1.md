---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: License register endpoint 双 schema + 新 error code (Round 2 修)

**范围**：register endpoint 改造 + license.service 增加新字段输出
**大小**: M
**依赖**: 无

> **Round 2 修订要点**：
> 1. server 启停模式从 chain `&` 改单独 build + 单独 background node + helper script 抽离
> 2. 加 BEHAVIOR 5/6 — success 与 error response keys subset check（PRD line 77 schema 完整性约束改写后的 codify）
> 3. helper script `apps/api/scripts/h1-ws1-helper.sh` 由 generator 在 commit-2 创建

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/api/src/routes/agent.ts register 处理函数含 LICENSE_DEVICE_LIMIT_EXCEEDED 字面量
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent.ts','utf8');if(!c.includes('LICENSE_DEVICE_LIMIT_EXCEEDED'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/license.service.ts RegisterSuccess interface 含 success/agent_id/license_tier/device_count/device_limit
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/license.service.ts','utf8');for(const k of ['success','agent_id','license_tier','device_count','device_limit']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] license.service.ts RegisterFailure interface 含 success/error/current_count/limit
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/license.service.ts','utf8');for(const k of ['LICENSE_DEVICE_LIMIT_EXCEEDED','current_count','limit:']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] helper script apps/api/scripts/h1-ws1-helper.sh 存在且 chmod +x
  Test: bash -c 'test -x apps/api/scripts/h1-ws1-helper.sh'

## BEHAVIOR 条目（manual:bash 通过 helper script 真启 server 真发 curl 真验 schema）

- [ ] [BEHAVIOR] register 第 1 个 agent 返 200，body 同时含老字段 (ok+license_id+tier+max_machines+ws_token) + 新字段 (success+agent_id(UUID)+license_tier+device_count=1+device_limit=1)
  Test: manual:bash -c 'apps/api/scripts/h1-ws1-helper.sh test_first_agent_dual_schema'
  期望: helper 内部 jq -e exit 0 双字段全过

- [ ] [BEHAVIOR] register 第 2 个 agent 同 license 不同 machine_id 返 HTTP 403，body 含 error=LICENSE_DEVICE_LIMIT_EXCEEDED + current_count=1 + limit=1 + 老 code=QUOTA_EXCEEDED
  Test: manual:bash -c 'apps/api/scripts/h1-ws1-helper.sh test_second_agent_403'
  期望: HTTP 403 + jq -e 双字段全过

- [ ] [BEHAVIOR] register 同 machine_id 第 2 次 (reconnect) 不增 device_count，仍返 200 + device_count=1
  Test: manual:bash -c 'apps/api/scripts/h1-ws1-helper.sh test_reconnect_no_increment'
  期望: 两次都返 device_count=1

- [ ] [BEHAVIOR] success response 不含禁用字段 device_quota / installed_count / max_devices / data / payload
  Test: manual:bash -c 'apps/api/scripts/h1-ws1-helper.sh test_no_forbidden_fields'
  期望: jq -e exit 0

- [ ] [BEHAVIOR] success response keys 包含新 5 字段（subset check — PRD line 77 改写约束 codify）
  Test: manual:bash -c 'apps/api/scripts/h1-ws1-helper.sh test_success_keys_superset'
  期望: jq -e (["success","agent_id","license_tier","device_count","device_limit"] - keys) == [] exit 0

- [ ] [BEHAVIOR] error response keys 包含新 4 字段（subset check）
  Test: manual:bash -c 'apps/api/scripts/h1-ws1-helper.sh test_error_keys_superset'
  期望: jq -e (["success","error","current_count","limit"] - keys) == [] exit 0

---

## helper script 期望内容（generator commit-2 必创建）

```bash
#!/usr/bin/env bash
# apps/api/scripts/h1-ws1-helper.sh — H-1 ws1 BEHAVIOR helper
# - 单独 build 不嵌后台
# - 单独后台启 node 拿真 pid
# - kill -TERM SPID + wait 清理
set -euo pipefail
PSQL="psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA"
export PGPASSWORD="$DATABASE_PASSWORD"
API="http://localhost:5200"

# build 一次（如 dist 已 fresh 跳过）
build_if_needed() {
  cd "$(dirname "$0")/.." # apps/api
  if [ ! -f dist/index.js ] || [ src/index.ts -nt dist/index.js ]; then
    npm run build > /dev/null 2>&1
  fi
}

# 启 server background — 单独命令拿真 pid
start_server() {
  build_if_needed
  cd "$(dirname "$0")/.."  # apps/api
  node -r dotenv/config dist/index.js > /tmp/h1ws1-srv.log 2>&1 &
  echo $! > /tmp/h1ws1-srv.pid
  sleep 3
  # readiness check
  for i in 1 2 3 4 5; do
    if curl -fsS "$API/health" >/dev/null 2>&1 || curl -fsS "$API/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "server not ready" >&2
  return 1
}

stop_server() {
  if [ -f /tmp/h1ws1-srv.pid ]; then
    SPID=$(cat /tmp/h1ws1-srv.pid)
    kill -TERM "$SPID" 2>/dev/null || true
    wait "$SPID" 2>/dev/null || true
    rm -f /tmp/h1ws1-srv.pid
  fi
  # 兜底：杀 5200 上挂的任何进程
  lsof -ti:5200 2>/dev/null | xargs -r kill -9 2>/dev/null || true
}

# 注册 user 拿 license_key
signup_user() {
  local prefix="$1"
  local TS=$(date +%s%N | cut -c1-13)
  local EMAIL="${prefix}-${TS}@example.com"
  local SR=$(curl -fsS -X POST "$API/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"H1${prefix}!2026\",\"name\":\"H1${prefix}\"}")
  local UID=$(echo "$SR" | jq -r '.user.id')
  if [ -z "$UID" ] || [ "$UID" = "null" ]; then
    echo "signup fail: $SR" >&2; return 1
  fi
  $PSQL -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%${UID}%' OR notes LIKE '%${UID}%' ORDER BY created_at DESC LIMIT 1"
}

trap stop_server EXIT

case "${1:-}" in
  test_first_agent_dual_schema)
    start_server
    LK=$(signup_user "ws1a")
    TS=$(date +%s)
    R=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1a-${TS}\",\"hostname\":\"ws1a\",\"version\":\"0.1.0\"}")
    echo "$R" | jq -e '.ok==true and .success==true and .device_count==1 and .device_limit==1 and (.agent_id|test("^[0-9a-f]{8}-")) and .license_tier=="free" and .tier=="free" and .max_machines==1 and (.ws_token|type=="string") and (.license_id|type=="string")'
    ;;
  test_second_agent_403)
    start_server
    LK=$(signup_user "ws1b")
    TS=$(date +%s)
    curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1b-${TS}-a\",\"hostname\":\"a\",\"version\":\"0.1.0\"}" > /dev/null
    HC=$(curl -s -o /tmp/h1ws1b-r2.json -w "%{http_code}" -X POST "$API/api/agent/register" \
      -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1b-${TS}-b\",\"hostname\":\"b\",\"version\":\"0.1.0\"}")
    [ "$HC" = "403" ] || { echo "HTTP $HC"; cat /tmp/h1ws1b-r2.json; exit 1; }
    jq -e '.error=="LICENSE_DEVICE_LIMIT_EXCEEDED" and .current_count==1 and .limit==1 and .code=="QUOTA_EXCEEDED" and .success==false and .ok==false' /tmp/h1ws1b-r2.json
    ;;
  test_reconnect_no_increment)
    start_server
    LK=$(signup_user "ws1c")
    TS=$(date +%s)
    MID="ws1c-${TS}-same"
    R1=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"$MID\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    R2=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"$MID\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    echo "$R1" | jq -e '.success==true and .device_count==1' && \
    echo "$R2" | jq -e '.success==true and .device_count==1'
    ;;
  test_no_forbidden_fields)
    start_server
    LK=$(signup_user "ws1d")
    TS=$(date +%s)
    R=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1d-${TS}\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    echo "$R" | jq -e '(has("device_quota")|not) and (has("installed_count")|not) and (has("max_devices")|not) and (has("data")|not) and (has("payload")|not)'
    ;;
  test_success_keys_superset)
    start_server
    LK=$(signup_user "ws1e")
    TS=$(date +%s)
    R=$(curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1e-${TS}\",\"hostname\":\"h\",\"version\":\"0.1.0\"}")
    echo "$R" | jq -e '(["success","agent_id","license_tier","device_count","device_limit"] - keys) == []'
    ;;
  test_error_keys_superset)
    start_server
    LK=$(signup_user "ws1f")
    TS=$(date +%s)
    curl -fsS -X POST "$API/api/agent/register" -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1f-${TS}-a\",\"hostname\":\"a\",\"version\":\"0.1.0\"}" > /dev/null
    HC=$(curl -s -o /tmp/h1ws1f-r2.json -w "%{http_code}" -X POST "$API/api/agent/register" \
      -H "Content-Type: application/json" \
      -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1f-${TS}-b\",\"hostname\":\"b\",\"version\":\"0.1.0\"}")
    [ "$HC" = "403" ] || { echo "HTTP $HC"; cat /tmp/h1ws1f-r2.json; exit 1; }
    jq -e '(["success","error","current_count","limit"] - keys) == []' /tmp/h1ws1f-r2.json
    ;;
  *)
    echo "Usage: $0 {test_first_agent_dual_schema|test_second_agent_403|test_reconnect_no_increment|test_no_forbidden_fields|test_success_keys_superset|test_error_keys_superset}" >&2
    exit 2
    ;;
esac
```
