#!/usr/bin/env bash
# apps/api/scripts/h1-ws3-helper.sh — H-1 ws3 BEHAVIOR helper
set -euo pipefail
PSQL="psql -h ${DATABASE_HOST:-127.0.0.1} -U ${DATABASE_USER:-zenithjoy} -d ${DATABASE_NAME:-zenithjoy} -tA"
export PGPASSWORD="${DATABASE_PASSWORD:-}"
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
  echo "server not ready" >&2; cat /tmp/h1ws3-srv.log >&2; return 1
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
  local UID=$(echo "$SR" | jq -r '.user.id // empty')
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
w.on('open',()=>{w.send(JSON.stringify({type:'hello',v:1,msgId:'m-1',ts:Date.now(),payload:{agentId:'${DISPLAY}',capabilities:['douyin'],version:'0.1.0'}}));setTimeout(()=>process.exit(0),3000)});
w.on('error',(e)=>{console.error('ws err',e.message);process.exit(1)});" &
    WSPID=$!
    sleep 4
    STATUS=$(curl -fsS "$API/api/agent/status")
    kill $WSPID 2>/dev/null || true
    echo "$STATUS" | jq -e ".agents | map(select(.agentId | test(\"^[0-9a-f]{8}-[0-9a-f]{4}\"))) | length >= 1"
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
w.on('open',()=>w.send(JSON.stringify({type:'hello',v:1,msgId:'m-1',ts:Date.now(),payload:{agentId:'${DISPLAY}',capabilities:['douyin'],version:'0.1.0'}})));
w.on('message',(r)=>fs.appendFileSync('/tmp/h1ws3b/recv.jsonl',r.toString()+'\n'));
w.on('error',(e)=>process.exit(1));
setTimeout(()=>process.exit(0),8000);" &
    WSPID=$!
    sleep 3
    curl -fsS -X POST "$API/api/agent/test-publish-douyin" -H "Content-Type: application/json" -d '{}' > /dev/null
    sleep 4
    kill $WSPID 2>/dev/null || true
    MSG=$(grep -E "publish_request|\"task\"" /tmp/h1ws3b/recv.jsonl | head -1)
    [ -n "$MSG" ] || { echo "no msg"; cat /tmp/h1ws3b/recv.jsonl; exit 1; }
    echo "$MSG" | jq -e '(.payload.agent_id // .agent_id) | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")'
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
w.on('open',()=>w.send(JSON.stringify({type:'hello',v:1,msgId:'m-dy',ts:Date.now(),payload:{agentId:'h1ws3d-dy-${TS}',capabilities:['douyin'],version:'0.1.0'}})));
w.on('message',(r)=>fs.appendFileSync('/tmp/h1ws3d/dy.jsonl',r.toString()+'\n'));
setTimeout(()=>process.exit(0),9000);" &
    PA=$!
    node -e "
const fs=require('fs'),W=require('ws');
const w=new W('${WS_URL}?token=${LK}');
w.on('open',()=>w.send(JSON.stringify({type:'hello',v:1,msgId:'m-fs',ts:Date.now(),payload:{agentId:'h1ws3d-fs-${TS}',capabilities:['feishu'],version:'0.1.0'}})));
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
  w.send(JSON.stringify({type:'hello',v:1,msgId:'m-h',ts:Date.now(),payload:{agentId:'${DISPLAY}',capabilities:['douyin'],version:'0.1.0'}}));
  setTimeout(()=>w.send(JSON.stringify({type:'heartbeat',v:1,msgId:'m-hb',ts:Date.now(),payload:{uptime:1,busy:false}})),100);
  setTimeout(()=>process.exit(0),5000);
});" &
    WSPID=$!
    sleep 6
    kill $WSPID 2>/dev/null || true
    R=$($PSQL -c "SELECT EXTRACT(EPOCH FROM (NOW() - last_seen)) FROM zenithjoy.agents WHERE agent_id='${DISPLAY}'")
    [ -n "$R" ] && awk "BEGIN{exit !($R < 10)}"
    ;;
  *)
    echo "Usage: $0 {test_string_to_uuid_conversion|test_dispatch_message_agent_id_uuid|test_publish_tasks_uuid_join|test_capability_filter_two_clients|test_hello_heartbeat_race}" >&2
    exit 2
    ;;
esac
