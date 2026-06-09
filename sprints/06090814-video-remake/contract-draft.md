# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面 + NEW_PATTERN — Brain registry 不可用，全新独立服务）

### Endpoint: GET /health
**Success (HTTP 200)**:
```json
{"status": "ok"}
```
- `status` (string, 必填): 固定值 `"ok"` — 来源：PRD E2E smoke 第7行 `assert d['status']=='ok'`

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
echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok', f'status={d[\"status\"]}'"  || { echo "FAIL: status != ok"; kill $SERVER_PID; exit 1; }
kill $SERVER_PID
```

**硬阈值**: HTTP 200 + `status == "ok"`，3 秒内响应

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

### Step 3: /api/nodes 返回恰好 9 个节点
**来源**: `[FROM_PRD]` — PRD E2E smoke 第8行 `assert len(d)==9`

**可观测行为**: `GET /api/nodes` 返回长度为 9 的 JSON 数组，每节点含 id/label/status/order

**验证命令**:
```bash
NODES=$(curl -sf http://localhost:8899/api/nodes) || { echo "FAIL: /api/nodes 无响应"; exit 1; }
COUNT=$(echo "$NODES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))")
[ "$COUNT" = "9" ] || { echo "FAIL: 节点数=$COUNT，期望 9"; exit 1; }

# 验证第一个节点包含必填字段
echo "$NODES" | python3 -c "
import sys,json
nodes = json.load(sys.stdin)
for n in nodes:
    for field in ['id','label','status','order']:
        assert field in n, f'节点 {n} 缺字段 {field}'
print('OK schema valid')
"
```

**硬阈值**: 数组长度 = 9，每节点含 id/label/status/order 字段

---

### Step 4: 节点确认操作（Node 01 输入素材）
**来源**: `[FROM_PRD]` — PRD Golden Path Step 2：点击节点→填写路径→确认→节点变绿

**可观测行为**: `POST /api/nodes/01/confirm` 携带素材路径 → 返回 `{"ok":true,"node_id":"01","status":"completed"}`

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:8899/api/nodes/01/confirm \
  -H "Content-Type: application/json" \
  -d '{"video_path":"/tmp/test.mp4","model_ref":"/tmp/model.jpg","product_ref":"/tmp/product.jpg","goal":"测试翻拍"}') \
  || { echo "FAIL: POST /api/nodes/01/confirm 无响应"; exit 1; }

echo "$RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('ok') == True, f'ok={d.get(\"ok\")}'
assert d.get('node_id') == '01', f'node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'status={d.get(\"status\")}'
print('OK node 01 confirm')
"
```

**硬阈值**: `ok==true`，`node_id=="01"`，`status=="completed"`

---

### Step 5: 不存在节点返回 404
**来源**: `[AI_ADDED]` — 防止 generator 用通用 catch-all 路由把未实现路由也返回 200，导致假绿

**可观测行为**: 访问不存在节点 id 的 confirm endpoint 返回 HTTP 404

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8899/api/nodes/99/confirm \
  -H "Content-Type: application/json" -d '{}')
[ "$CODE" = "404" ] || { echo "FAIL: 不存在节点返回 $CODE，期望 404"; exit 1; }
echo "OK node 99 -> 404"
```

**硬阈值**: HTTP 404

---

## E2E 验收（final-e2e）

**journey_type**: user_facing
**target_environment**: local_api

```bash
#!/usr/bin/env bash
# final-e2e — Line 07 video-remake thin 骨架 Golden Path 端到端验证
# 运行方式: bash sprints/06090814-video-remake/e2e-smoke.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_DIR="$REPO_ROOT/services/video-remake"
BASE_URL="http://localhost:8899"

cd "$SERVICE_DIR"

# 1. 启动服务（新鲜进程，防止利用历史状态）
python server.py &
SERVER_PID=$!
echo "▶ 服务 PID=$SERVER_PID 已启动"

# 等待服务就绪（最多 15 秒）
MAX_WAIT=15
for i in $(seq 1 $MAX_WAIT); do
  if curl -sf "$BASE_URL/health" > /dev/null 2>&1; then
    echo "✓ 服务就绪 (${i}s)"
    break
  fi
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: 服务 ${MAX_WAIT}s 内未就绪"; kill $SERVER_PID; exit 1; }
  sleep 1
done

# Step 1: 健康检查
HEALTH=$(curl -sf "$BASE_URL/health") || { echo "FAIL: /health 无响应"; kill $SERVER_PID; exit 1; }
echo "$HEALTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('status') == 'ok', f'FAIL: status={d.get(\"status\")}'
print('✓ Step 1 /health status=ok')
"

# Step 2: 前端可访问
CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/")
[ "$CODE" = "200" ] || { echo "FAIL: / 返回 $CODE"; kill $SERVER_PID; exit 1; }
echo "✓ Step 2 / -> 200"

# Step 3: 9 节点列表
NODES=$(curl -sf "$BASE_URL/api/nodes") || { echo "FAIL: /api/nodes 无响应"; kill $SERVER_PID; exit 1; }
python3 - <<'PYEOF'
import sys,json,os

nodes_str = os.environ.get('NODES_JSON', '')
PYEOF
NODES_JSON="$NODES" python3 -c "
import sys,json,os
nodes = json.loads(os.environ['NODES_JSON'])
assert len(nodes) == 9, f'FAIL: 节点数={len(nodes)}，期望 9'
for n in nodes:
    for field in ['id','label','status','order']:
        assert field in n, f'FAIL: 节点缺字段 {field}'
print(f'✓ Step 3 /api/nodes 返回 {len(nodes)} 个节点，schema 合法')
"

# Step 4: Node 01 确认操作
CONFIRM=$(curl -sf -X POST "$BASE_URL/api/nodes/01/confirm" \
  -H "Content-Type: application/json" \
  -d '{"video_path":"/tmp/test-video.mp4","model_ref":"/tmp/model.jpg","product_ref":"/tmp/product.jpg","goal":"e2e 测试翻拍目标"}') \
  || { echo "FAIL: POST /api/nodes/01/confirm 无响应"; kill $SERVER_PID; exit 1; }
echo "$CONFIRM" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('ok') == True, f'FAIL: ok={d.get(\"ok\")}'
assert d.get('node_id') == '01', f'FAIL: node_id={d.get(\"node_id\")}'
assert d.get('status') == 'completed', f'FAIL: status={d.get(\"status\")}'
print('✓ Step 4 node 01 confirm ok')
"

# Step 5: 不存在节点 404
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/nodes/99/confirm" \
  -H "Content-Type: application/json" -d '{}')
[ "$CODE" = "404" ] || { echo "FAIL: node 99 返回 $CODE，期望 404"; kill $SERVER_PID; exit 1; }
echo "✓ Step 5 node 99 -> 404"

kill $SERVER_PID 2>/dev/null || true
echo ""
echo "✅ Line 07 video-remake thin 骨架 Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0，每步 ✓ 输出
**失败标准**: 任一 `FAIL:` 或 exit 1

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| API 骨架 | `tests/test_api.py` | /health + /api/nodes + node confirm + 404 | → 4 failures（service 未实现） |
