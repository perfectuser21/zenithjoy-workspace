#!/usr/bin/env bash
# final-e2e — Line 07 video-remake thin 骨架 Golden Path 端到端验证（Round 2）
# 运行方式: bash sprints/06090814-video-remake/e2e-smoke.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_DIR="$REPO_ROOT/services/video-remake"
BASE_URL="http://localhost:8899"

# R1 风险缓解: 检测端口
if lsof -i:8899 2>/dev/null | grep -q LISTEN; then
  echo "FAIL: 端口 8899 已被占用，请释放后重试"
  exit 1
fi

cd "$SERVICE_DIR"

# 1. 启动服务（新鲜进程，防止利用历史状态）
python3 server.py &
SERVER_PID=$!
echo "▶ 服务 PID=$SERVER_PID 已启动"
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# 等待服务就绪（最多 15 秒）
for i in $(seq 1 15); do
  curl -sf "$BASE_URL/health" > /dev/null 2>&1 && break
  [ "$i" = "15" ] && { echo "FAIL: 服务 15s 内未就绪"; exit 1; }
  sleep 1
done
echo "✓ 服务就绪"

# Step 1: 健康检查
HEALTH=$(curl -sf "$BASE_URL/health") || { echo "FAIL: /health 无响应"; exit 1; }
echo "$HEALTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('status') == 'ok', f'FAIL: status={d.get(\"status\")}'
assert 'state' not in d, 'FAIL: 含禁用字段 state'
assert 'healthy' not in d, 'FAIL: 含禁用字段 healthy'
print('✓ Step 1 /health status=ok，禁用字段已排除')
"

# Step 2: 前端可访问
CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/")
[ "$CODE" = "200" ] || { echo "FAIL: / 返回 $CODE"; exit 1; }
echo "✓ Step 2 / -> 200"

# Step 3: 9 节点列表 + schema 完整性 + 禁用字段反向检查
NODES=$(curl -sf "$BASE_URL/api/nodes") || { echo "FAIL: /api/nodes 无响应"; exit 1; }
NODES_JSON="$NODES" python3 -c "
import sys,json,os
nodes = json.loads(os.environ['NODES_JSON'])
assert len(nodes) == 9, f'FAIL: 节点数={len(nodes)}，期望 9'
for n in nodes:
    for field in ['id','label','status','order']:
        assert field in n, f'FAIL: 节点 {n.get(\"id\")} 缺字段 {field}'
    for banned in ['node_id','state','name']:
        assert banned not in n, f'FAIL: 节点含禁用字段 {banned}'
print(f'✓ Step 3 /api/nodes={len(nodes)} 个节点，schema 合法，禁用字段已排除')
"

# Step 4: Node 01 确认操作 + 项目目录创建
TASK_NAME="e2e-test-$(date +%s)"
CONFIRM=$(curl -sf -X POST "$BASE_URL/api/nodes/01/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"video_path\":\"/tmp/test-video.mp4\",\"model_ref\":\"/tmp/model.jpg\",\"product_ref\":\"/tmp/product.jpg\",\"goal\":\"$TASK_NAME\"}") \
  || { echo "FAIL: POST /api/nodes/01/confirm 无响应"; exit 1; }

echo "$CONFIRM" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('ok') == True, f'FAIL: ok={d.get(\"ok\")}'
assert d.get('node_id') == '01', f'FAIL: node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'FAIL: status={d.get(\"status\")}'
assert 'success' not in d, 'FAIL: 含禁用字段 success'
assert 'state' not in d, 'FAIL: 含禁用字段 state'
extra = set(d.keys()) - {'ok','node_id','status'}
assert not extra, f'FAIL: 多余字段 {extra}'
print('✓ Step 4 node 01 confirm ok，schema 正确')
"

# PRD Step 2: 项目目录已生成 ~/video-remake-projects/<任务名>/
PROJECT_DIR="$HOME/video-remake-projects/$TASK_NAME"
[ -d "$PROJECT_DIR" ] || { echo "FAIL: 项目目录未创建 $PROJECT_DIR"; exit 1; }
echo "✓ Step 4 项目目录已创建 $PROJECT_DIR"

# Step 5: 节点 02-09 全流程可点通
for NODE_ID in 02 03 04 05 06 07 08 09; do
  RESP=$(curl -sf -X POST "$BASE_URL/api/nodes/$NODE_ID/confirm" \
    -H "Content-Type: application/json" \
    -d '{"goal":"click-through"}') \
    || { echo "FAIL: POST /api/nodes/$NODE_ID/confirm 无响应"; exit 1; }

  NODE_ID="$NODE_ID" RESP_JSON="$RESP" python3 -c "
import json,os
d=json.loads(os.environ['RESP_JSON'])
nid=os.environ['NODE_ID']
assert d.get('ok') == True, f'FAIL: node {nid} ok={d.get(\"ok\")}'
assert d.get('node_id') == nid, f'FAIL: node {nid} node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'FAIL: node {nid} status={d.get(\"status\")}'
print(f'✓ Step 5 node {nid} confirm ok')
"
done

echo ""
echo "✅ Line 07 video-remake thin 骨架 Golden Path 验证通过"
