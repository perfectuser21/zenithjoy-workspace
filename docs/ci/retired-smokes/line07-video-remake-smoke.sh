#!/usr/bin/env bash
# Line 07 video-remake smoke test — CI (local_api)
set -e

cd "$(dirname "$0")/../../../.." || exit 1
SERVICE_DIR="services/video-remake"
BASE_URL="http://localhost:8899"

python3 "$SERVICE_DIR/server.py" &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

for i in $(seq 1 15); do
  curl -sf "$BASE_URL/health" > /dev/null 2>&1 && break
  [ "$i" = "15" ] && { echo "FAIL: server 15s 内未就绪"; exit 1; }
  sleep 1
done

curl -sf "$BASE_URL/health" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('status') == 'ok', f'FAIL: status={d.get(\"status\")}'
assert 'state' not in d, 'FAIL: 含禁用字段 state'
assert 'healthy' not in d, 'FAIL: 含禁用字段 healthy'
print('OK /health')
"

curl -sf "$BASE_URL/api/nodes" | python3 -c "
import sys, json
nodes = json.load(sys.stdin)
assert len(nodes) == 9, f'FAIL: 节点数={len(nodes)},期望 9'
for n in nodes:
    for f in ['id','label','status','order']:
        assert f in n, f'FAIL: 节点缺字段 {f}'
    for banned in ['node_id','state','name']:
        assert banned not in n, f'FAIL: 含禁用字段 {banned}'
print(f'OK /api/nodes len={len(nodes)} schema 合法')
"

CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/")
[ "$CODE" = "200" ] || { echo "FAIL: / 返回 $CODE，期望 200"; exit 1; }
echo "OK / -> 200"

TASK="smoke-$(date +%s)"
CONFIRM=$(curl -sf -X POST "$BASE_URL/api/nodes/01/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"goal\":\"$TASK\",\"video_path\":\"/tmp/v.mp4\",\"model_ref\":\"/tmp/m.jpg\",\"product_ref\":\"/tmp/p.jpg\"}")
echo "$CONFIRM" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('ok') == True, f'FAIL: ok={d.get(\"ok\")}'
assert d.get('node_id') == '01', f'FAIL: node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'FAIL: status={d.get(\"status\")}'
assert 'success' not in d, 'FAIL: 含禁用字段 success'
assert 'state' not in d, 'FAIL: 含禁用字段 state'
extra = set(d.keys()) - {'ok', 'node_id', 'status'}
assert not extra, f'FAIL: 多余字段 {extra}'
print('OK node 01 confirm schema 合法')
"

PROJECT_DIR="$HOME/video-remake-projects/$TASK"
[ -d "$PROJECT_DIR" ] || { echo "FAIL: 项目目录未创建 $PROJECT_DIR"; exit 1; }
echo "OK 项目目录已创建 $PROJECT_DIR"

for NODE_ID in 02 03 04 05 06 07 08 09; do
  RESP=$(curl -sf -X POST "$BASE_URL/api/nodes/$NODE_ID/confirm" \
    -H "Content-Type: application/json" \
    -d '{"goal":"smoke-through"}')
  NODE_ID="$NODE_ID" RESP_JSON="$RESP" python3 -c "
import json, os
d = json.loads(os.environ['RESP_JSON'])
nid = os.environ['NODE_ID']
assert d.get('ok') == True, f'FAIL node {nid} ok={d.get(\"ok\")}'
assert d.get('node_id') == nid, f'FAIL node {nid} node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'FAIL node {nid} status={d.get(\"status\")}'
print(f'OK node {nid} confirm')
"
done

R=$(curl -o /dev/null -s -w "%{http_code}" -X POST "$BASE_URL/api/nodes/99/confirm" \
  -H "Content-Type: application/json" -d '{}')
[ "$R" = "404" ] || { echo "FAIL: node 99 返回 $R，期望 404"; exit 1; }
echo "OK node 99 -> 404"

echo ""
echo "✅ Line 07 smoke 通过"
