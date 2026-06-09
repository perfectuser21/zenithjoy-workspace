# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面 + NEW_PATTERN — Brain registry 不可用，全新独立服务）

### Endpoint: GET /health
**Success (HTTP 200)**:
```json
{"status": "ok"}
```
- `status` (string, 必填): 固定值 `"ok"` — 来源：PRD E2E smoke 第7行 `assert d['status']=='ok'`

**禁用字段名**: `state`、`healthy`

**Error (HTTP 5xx)**:
```json
{"status": "error", "detail": "<string>"}
```

---

### Endpoint: GET /api/nodes
**Success (HTTP 200)**:
```json
[
  {"id": "01", "label": "输入素材", "status": "pending", "order": 1},
  ...（共 9 个）
]
```
- `id` (string, 必填): 节点编号，"01"–"09" — 来源：[NEW_PATTERN] Golden Path 9 节点
- `label` (string, 必填): 节点中文名称 — 来源：[NEW_PATTERN] 画布显示用
- `status` (string, 必填): `"pending"` | `"in_progress"` | `"completed"` | `"error"` — 来源：[NEW_PATTERN]
- `order` (integer, 必填): 1–9，与 `id` 对应 — 来源：[NEW_PATTERN]

**数组长度**: 必须恰好 = 9（PRD smoke 第8行 `assert len(d)==9`）
**禁用字段名**: `node_id`（改用 `id`）、`state`（改用 `status`）、`name`（改用 `label`）

---

### Endpoint: POST /api/nodes/{node_id}/confirm
**Success (HTTP 200)**:
```json
{"ok": true, "node_id": "01", "status": "completed"}
```
- `ok` (boolean, 必填): `true` — 来源：[NEW_PATTERN] 统一操作成功响应
- `node_id` (string, 必填): 与路径参数一致 — 来源：[NEW_PATTERN]
- `status` (string, 必填): 操作完成后节点状态 — 来源：[NEW_PATTERN]

**禁用字段名**: `success`（改用 `ok`）、`state`（改用 `status`）

**Error (HTTP 404)**:
```json
{"detail": "node 99 not found"}
```

---

## Golden Path

[用户运行 python server.py] → [浏览器打开 localhost:8899 看到 9 节点画布] → [依次点击 9 个节点填写输入/触发处理/审核] → [下载合成视频]

---

### Step 1: 服务启动 + 健康检查
**来源**: `[FROM_PRD]` — PRD E2E smoke 第3–7行，`python server.py & sleep 3; curl /health`

**可观测行为**: `python server.py` 启动后，`GET /health` 返回 HTTP 200 + `{"status":"ok"}`

**验证命令**:
```bash
cd /workspace/services/video-remake
python server.py &
SERVER_PID=$!
sleep 3

HEALTH=$(curl -sf http://localhost:8899/health) || { echo "FAIL: /health 无响应"; kill $SERVER_PID; exit 1; }
echo "$HEALTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['status']=='ok', f'status={d[\"status\"]}'
assert 'state' not in d, 'FAIL: 含禁用字段 state'
assert 'healthy' not in d, 'FAIL: 含禁用字段 healthy'
print('OK')
" || { kill $SERVER_PID; exit 1; }
kill $SERVER_PID
```

**硬阈值**: HTTP 200 + `status == "ok"` + 禁用字段不存在，3 秒内响应

---

### Step 2: 9 节点画布前端可访问
**来源**: `[FROM_PRD]` — PRD E2E smoke 第9行 `curl -f http://localhost:8899/ ... | grep -q "200"`

**可观测行为**: `GET /` 返回 HTTP 200（React Flow 画布 HTML），浏览器可打开

**验证命令**:
```bash
CODE=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8899/) || { echo "FAIL: / 无响应"; exit 1; }
[ "$CODE" = "200" ] || { echo "FAIL: / 返回 $CODE，期望 200"; exit 1; }
echo "OK / -> 200"
```

**硬阈值**: HTTP 200

---

### Step 3: /api/nodes 返回恰好 9 个节点（含 schema 完整性 + 禁用字段检查）
**来源**: `[FROM_PRD]` — PRD E2E smoke 第8行 `assert len(d)==9`；schema 字段来自 PRD Golden Path 9 节点定义

**可观测行为**: `GET /api/nodes` 返回长度为 9 的 JSON 数组，每节点含 id/label/status/order，禁用字段 node_id/state/name 不存在

**验证命令**:
```bash
NODES=$(curl -sf http://localhost:8899/api/nodes) || { echo "FAIL: /api/nodes 无响应"; exit 1; }
NODES_JSON="$NODES" python3 -c "
import sys,json,os
nodes = json.loads(os.environ['NODES_JSON'])
# 数量
assert len(nodes) == 9, f'FAIL: 节点数={len(nodes)}，期望 9'
for n in nodes:
    # 必填字段完整性
    for field in ['id','label','status','order']:
        assert field in n, f'FAIL: 节点 {n.get(\"id\")} 缺字段 {field}'
    # 禁用字段反向检查
    for banned in ['node_id','state','name']:
        assert banned not in n, f'FAIL: 节点含禁用字段 {banned}'
print(f'OK nodes={len(nodes)}, schema valid, forbidden fields absent')
"
```

**硬阈值**: 数组长度 = 9，每节点含 id/label/status/order，无 node_id/state/name

---

### Step 4: 节点 01 确认操作 + 项目目录创建
**来源**: `[FROM_PRD]` — PRD Golden Path Step 2：「点击节点→填写路径→确认→节点变绿 + 生成项目目录 `~/video-remake-projects/<任务名>/`」

**可观测行为**: `POST /api/nodes/01/confirm` 携带素材路径 → 返回 `{"ok":true,"node_id":"01","status":"completed"}` + 项目目录已创建，响应不含禁用字段 success/state

**验证命令**:
```bash
TASK_NAME="e2e-test-$(date +%s)"
CONFIRM=$(curl -sf -X POST http://localhost:8899/api/nodes/01/confirm \
  -H "Content-Type: application/json" \
  -d "{\"video_path\":\"/tmp/test-video.mp4\",\"model_ref\":\"/tmp/model.jpg\",\"product_ref\":\"/tmp/product.jpg\",\"goal\":\"$TASK_NAME\"}") \
  || { echo "FAIL: POST /api/nodes/01/confirm 无响应"; exit 1; }

echo "$CONFIRM" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('ok') == True, f'FAIL: ok={d.get(\"ok\")}'
assert d.get('node_id') == '01', f'FAIL: node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'FAIL: status={d.get(\"status\")}'
# 禁用字段反向检查
assert 'success' not in d, 'FAIL: 含禁用字段 success'
assert 'state' not in d, 'FAIL: 含禁用字段 state'
# keys 完整性
allowed = {'ok','node_id','status'}
extra = set(d.keys()) - allowed
assert not extra, f'FAIL: 多余字段 {extra}'
print('OK node 01 confirm, schema valid')
"

# PRD Step 2: 项目目录已生成 ~/video-remake-projects/<任务名>/
PROJECT_DIR="$HOME/video-remake-projects/$TASK_NAME"
[ -d "$PROJECT_DIR" ] || { echo "FAIL: 项目目录未创建 $PROJECT_DIR"; exit 1; }
echo "OK 项目目录已创建 $PROJECT_DIR"
```

**硬阈值**: `ok==true`，`node_id=="01"`，`status=="completed"`，禁用字段不存在，`~/video-remake-projects/<任务名>/` 已创建

---

### Step 5: 节点 02–09 全流程可点通
**来源**: `[FROM_PRD]` — PRD 背景段「全流程可点通」+ PRD Golden Path Step 3–10 逐节点描述（thin：每节点 confirm 返回 ok:true 即为通过）

**可观测行为**: 节点 02–09 各自的 `POST /api/nodes/{id}/confirm` 均返回 HTTP 200 + `{"ok":true,"node_id":"<id>","status":"completed"}`

**验证命令**:
```bash
for NODE_ID in 02 03 04 05 06 07 08 09; do
  RESP=$(curl -sf -X POST "http://localhost:8899/api/nodes/$NODE_ID/confirm" \
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
print(f'OK node {nid} confirm')
"
done
```

**硬阈值**: 全部 8 个节点返回 HTTP 200 + ok==true + status==completed

---

## Risks

| # | 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | 端口 8899 被其他进程占用 | 中 | E2E 启动失败 | smoke 脚本启动前检测端口：`lsof -i:8899 && { echo "端口被占，请释放后重试"; exit 1; }` |
| R2 | ffmpeg 未安装或版本过旧 | 低 | 节点 02 拆视频功能不可用 | thin 骨架 node 02 stub 实现（不调 ffmpeg），requirements.txt 注明 ffmpeg 系统依赖，README 补安装说明 |
| R3 | 前端 React 依赖安装或 build 失败 | 低 | `GET /` 返回 404 | server.py 本地伺服预构建静态文件（`dist/`），CI 在 smoke 前先跑 `npm ci && npm run build`；前端 build 失败 → smoke 脚本 Step 2 FAIL 立即暴露 |

---

## E2E 验收（final-e2e）

**journey_type**: user_facing
**target_environment**: local_api

```bash
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
python server.py &
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
```

**通过标准**: 脚本 exit 0，每步 ✓ 输出
**失败标准**: 任一 `FAIL:` 或 exit 1

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| API 骨架全量 | `tests/test_api.py` | /health + /api/nodes + node confirm + dir 创建 + 节点 02-09 | → 14+ failures（service 未实现） |
