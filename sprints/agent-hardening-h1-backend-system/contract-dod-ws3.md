---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 3: WS routing UUID 化 + dispatcher 改读 agents.id (Round 2 修)

**范围**：agent-ws hello message 收 string agentId 自动转 UUID；agent-registry entry 加 displayName + agentId 改 UUID；dispatcher 发 WS message agent_id 字段填 UUID
**大小**: L
**依赖**: ws1 GREEN（要先有 register endpoint，但 mock client 测试可不依赖 — 实际并行）

> **Round 2 修订要点**：
> 1. PG quoting 改单引号 + helper script 抽离（同 ws2 模式）
> 2. server 启停模式从 chain `&` 改单独 build + 单独 background node + lsof 兜底清理 5200
> 3. 加 BEHAVIOR 5 — hello + heartbeat 时序 test（防 R5 — async hello handler 让早 heartbeat 丢）
> 4. helper script `apps/api/scripts/h1-ws3-helper.sh` 由 generator 在 commit-2 创建

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/api/src/services/agent-db.ts 含 findOrCreateAgentUuid 函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/agent-db.ts','utf8');if(!c.includes('findOrCreateAgentUuid'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/agent-registry.ts AgentEntry 接口含 displayName 字段
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/agent-registry.ts','utf8');if(!c.includes('displayName'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/agent-ws.ts hello message handler 调用 findOrCreateAgentUuid
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/agent-ws.ts','utf8');if(!c.includes('findOrCreateAgentUuid'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/task-dispatch.ts 发 WS message 时 payload 含 agent_id 字段
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/task-dispatch.ts','utf8');if(!c.includes('agent_id'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/schemas/agent-protocol.ts publish_request payload 含 agent_id 可选字段
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/schemas/agent-protocol.ts','utf8');if(!c.includes('agent_id'))process.exit(1)"

- [ ] [ARTIFACT] helper script apps/api/scripts/h1-ws3-helper.sh 存在且 chmod +x
  Test: bash -c 'test -x apps/api/scripts/h1-ws3-helper.sh'

## BEHAVIOR 条目（manual:bash 通过 helper script 真启 ws server 真 client 真 send 真 recv）

- [ ] [BEHAVIOR] mock WS client hello payload.agentId 为 string display name 时，server 自动转 UUID 注册到 registry，GET /api/agent/status 返该 agent 的 agentId 字段是 UUID
  Test: manual:bash -c 'apps/api/scripts/h1-ws3-helper.sh test_string_to_uuid_conversion'
  期望: jq -e displayName 命中且 agentId 是 UUID 格式，exit 0

- [ ] [BEHAVIOR] backend 派 douyin task 时 WS message 含 agent_id 字段是 UUID（不是 hostname / display name）
  Test: manual:bash -c 'apps/api/scripts/h1-ws3-helper.sh test_dispatch_message_agent_id_uuid'
  期望: mock client 收到 message + agent_id 是 UUID 格式，exit 0

- [ ] [BEHAVIOR] dispatch 后 publish_tasks.agent_id 字段填 UUID 等于 agents.id（JOIN 通过）
  Test: manual:bash -c 'apps/api/scripts/h1-ws3-helper.sh test_publish_tasks_uuid_join'
  期望: SQL JOIN 返 t (true)，exit 0

- [ ] [BEHAVIOR] 2 个 mock client 不同 capability（douyin / feishu）— backend 派 douyin task 时只 douyin client 收，feishu client 不收
  Test: manual:bash -c 'apps/api/scripts/h1-ws3-helper.sh test_capability_filter_two_clients'
  期望: douyin recv≥1 && feishu recv=0，exit 0

- [ ] [BEHAVIOR] hello + 立即 heartbeat 时序 — mock client 发 hello 后 200ms 内连发 heartbeat，server async findOrCreateAgentUuid 完成前 heartbeat 不丢（缓存或同步等）
  Test: manual:bash -c 'apps/api/scripts/h1-ws3-helper.sh test_hello_heartbeat_race'
  期望: agent 注册成功且 heartbeat 被处理（DB last_seen 在 5s 内更新），exit 0

---

## helper script 期望内容（generator commit-2 必创建）

```bash
#!/usr/bin/env bash
# apps/api/scripts/h1-ws3-helper.sh — H-1 ws3 BEHAVIOR helper
set -euo pipefail
PSQL="psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA"
export PGPASSWORD="$DATABASE_PASSWORD"
API="http://localhost:5200"
WS_URL="ws://localhost:5200/agent-ws"

start_server() {
  cd "$(dirname "$0")/.."
  if [ ! -f dist/index.js ] || [ src/index.ts -nt dist/index.js ]; then
    npm run build > /dev/null 2>&1
  fi
  node -r dotenv/config dist/index.js > /tmp/h1ws3-srv.log 2>&1 &
  echo $! > /tmp/h1ws3-srv.pid
  sleep 3
  for i in 1 2 3 4 5; do
    curl -fsS "$API/api/agent/status" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "server not ready" >&2; cat /tmp/h1ws3-srv.log; return 1
}

stop_server() {
  if [ -f /tmp/h1ws3-srv.pid ]; then
    kill -TERM "$(cat /tmp/h1ws3-srv.pid)" 2>/dev/null || true
    wait "$(cat /tmp/h1ws3-srv.pid)" 2>/dev/null || true
    rm -f /tmp/h1ws3-srv.pid
  fi
  lsof -ti:5200 2>/dev/null | xargs -r kill -9 2>/dev/null || true
}

signup_user() {
  local prefix="$1"
  local TS=$(date +%s%N | cut -c1-13)
  local EMAIL="${prefix}-${TS}@example.com"
  local SR=$(curl -fsS -X POST "$API/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"H1${prefix}!2026\",\"name\":\"H1${prefix}\"}")
  local UID=$(echo "$SR" | jq -r '.user.id')
  $PSQL -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%${UID}%' OR notes LIKE '%${UID}%' ORDER BY created_at DESC LIMIT 1"
}

trap stop_server EXIT

case "${1:-}" in
  test_string_to_uuid_conversion)
    start_server
    LK=$(signup_user "ws3a")
    TS=$(date +%s)
    DISPLAY="h1ws3a-display-${TS}"
    node -e "
const W=require('ws');
const w=new W('${WS_URL}?token=${LK}');
w.on('open',()=>{w.send(JSON.stringify({type:'hello',payload:{agentId:'${DISPLAY}',capabilities:['douyin'],version:'0.1.0'}}));setTimeout(()=>process.exit(0),3000)});" &
    WSPID=$!
    sleep 4
    STATUS=$(curl -fsS "$API/api/agent/status")
    kill $WSPID 2>/dev/null || true
    echo "$STATUS" | jq -e '.agents | map(select(.displayName=="'$DISPLAY'" or .agentId=="'$DISPLAY'")) | length >= 1' \
      && echo "$STATUS" | jq -e '.agents | map(.agentId | test("^[0-9a-f]{8}-[0-9a-f]{4}")) | all'
    ;;
  test_dispatch_message_agent_id_uuid)
    start_server
    LK=$(signup_user "ws3b")
    TS=$(date +%s)
    DISPLAY="h1ws3b-display-${TS}"
    mkdir -p /tmp/h1ws3b
    > /tmp/h1ws3b/recv.jsonl
    node -e "
const fs=require('fs'),W=require('ws');
const w=new W('${WS_URL}?token=${LK}');
w.on('open',()=>w.send(JSON.stringify({type:'hello',payload:{agentId:'${DISPLAY}',capabilities:['douyin'],version:'0.1.0'}})));
w.on('message',(r)=>fs.appendFileSync('/tmp/h1ws3b/recv.jsonl',r.toString()+'\n'));
setTimeout(()=>process.exit(0),8000);" &
    WSPID=$!
    sleep 3
    curl -fsS -X POST "$API/api/agent/test-publish-douyin" -H "Content-Type: application/json" -d '{}' > /dev/null
    sleep 4
    kill $WSPID 2>/dev/null || true
    MSG=$(grep -E "publish_request|\"task\"" /tmp/h1ws3b/recv.jsonl | head -1)
    [ -n "$MSG" ] || { echo "no msg"; cat /tmp/h1ws3b/recv.jsonl; exit 1; }
    echo "$MSG" | jq -e '.payload.agent_id // .agent_id | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")'
    ;;
  test_publish_tasks_uuid_join)
    R=$($PSQL -c "SELECT pt.agent_id::text=a.id::text FROM zenithjoy.publish_tasks pt JOIN zenithjoy.agents a ON a.id=pt.agent_id WHERE pt.created_at > NOW() - interval '5 minutes' AND a.agent_id LIKE 'h1ws3%' ORDER BY pt.created_at DESC LIMIT 1")
    echo "$R" | grep -q '^t$'
    ;;
  test_capability_filter_two_clients)
    start_server
    LK=$(signup_user "ws3d")
    TS=$(date +%s)
    mkdir -p /tmp/h1ws3d
    > /tmp/h1ws3d/dy.jsonl; > /tmp/h1ws3d/fs.jsonl
    node -e "
const fs=require('fs'),W=require('ws');
const w=new W('${WS_URL}?token=${LK}');
w.on('open',()=>w.send(JSON.stringify({type:'hello',payload:{agentId:'h1ws3d-dy-${TS}',capabilities:['douyin'],version:'0.1.0'}})));
w.on('message',(r)=>fs.appendFileSync('/tmp/h1ws3d/dy.jsonl',r.toString()+'\n'));
setTimeout(()=>process.exit(0),9000);" &
    PA=$!
    node -e "
const fs=require('fs'),W=require('ws');
const w=new W('${WS_URL}?token=${LK}');
w.on('open',()=>w.send(JSON.stringify({type:'hello',payload:{agentId:'h1ws3d-fs-${TS}',capabilities:['feishu'],version:'0.1.0'}})));
w.on('message',(r)=>fs.appendFileSync('/tmp/h1ws3d/fs.jsonl',r.toString()+'\n'));
setTimeout(()=>process.exit(0),9000);" &
    PB=$!
    sleep 3
    curl -fsS -X POST "$API/api/agent/test-publish-douyin" -H "Content-Type: application/json" -d '{}' > /dev/null
    sleep 4
    kill $PA $PB 2>/dev/null || true
    DR=$(grep -cE 'publish_request|"task"' /tmp/h1ws3d/dy.jsonl 2>/dev/null || echo 0)
    FR=$(grep -cE 'publish_request|"task"' /tmp/h1ws3d/fs.jsonl 2>/dev/null || echo 0)
    [ "$DR" -ge 1 ] && [ "$FR" = "0" ]
    ;;
  test_hello_heartbeat_race)
    start_server
    LK=$(signup_user "ws3e")
    TS=$(date +%s)
    DISPLAY="h1ws3e-display-${TS}"
    node -e "
const W=require('ws');
const w=new W('${WS_URL}?token=${LK}');
w.on('open',()=>{
  w.send(JSON.stringify({type:'hello',payload:{agentId:'${DISPLAY}',capabilities:['douyin'],version:'0.1.0'}}));
  setTimeout(()=>w.send(JSON.stringify({type:'heartbeat',payload:{uptime:1,busy:false}})),100);
  setTimeout(()=>process.exit(0),5000);
});" &
    WSPID=$!
    sleep 6
    kill $WSPID 2>/dev/null || true
    # 验 agent 已注册到 DB + last_seen 在 10s 内更新（hello+heartbeat 都被处理）
    R=$($PSQL -c "SELECT EXTRACT(EPOCH FROM (NOW() - last_seen)) FROM zenithjoy.agents WHERE agent_id='${DISPLAY}'")
    [ -n "$R" ] && awk "BEGIN{exit !($R < 10)}"
    ;;
  *)
    echo "Usage: $0 {test_string_to_uuid_conversion|test_dispatch_message_agent_id_uuid|test_publish_tasks_uuid_join|test_capability_filter_two_clients|test_hello_heartbeat_race}" >&2
    exit 2
    ;;
esac
```
