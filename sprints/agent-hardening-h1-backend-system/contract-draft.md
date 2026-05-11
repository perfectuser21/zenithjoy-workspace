# Sprint Contract Draft (Round 1) — Agent 系统 hardening · H-1

## journey_type
`dev_pipeline` — 修后端基建（license enforce response 形态化、publish_tasks status 完整 enum、WS UUID 化），让所有未来 Path 2/3 Agent 涉及 sprint 在干净的 backend 系统层上跑。不直接面终端客户，但客户视角的 Path 2 链路因此不再撞 system bug。

---

## Architecture 5 大确认（reviewer 必挑战）

> Sprint A/B-1 教训：reviewer 漏挑 architecture → Lead 自验暴 8 bug。本合同明列 5 个 architecture 决策，proposer 已逐条回答 + reviewer 必复审。

### A1. License enforce — 是否真没 enforce？

**Proposer 调研结果（已读源码）**：`apps/api/src/services/license.service.ts:361-367` **已经** enforce `currentCount >= license.max_machines → QUOTA_EXCEEDED`。**PRD Bug 6 描述不准确**。

**真实 Bug 6 形态**：
- 当前 success response 字段名 `{ok, license_id, tier, max_machines, registered_machine_id, ws_token}`，**没有** `device_count` 字段 — 客户端无法直观看"我现在用了几台、还能用几台"。
- 当前 error response code = `QUOTA_EXCEEDED`，PRD 要求改 `LICENSE_DEVICE_LIMIT_EXCEEDED` + 字段 `current_count` + `limit`。

**架构决策**：H-1 在 register endpoint 返回**双 schema** — 既保留老字段（`ok/license_id/tier/max_machines/registered_machine_id/ws_token`）让 rog 上 v1.0 Agent 不断，又增加新字段（`success/agent_id/license_tier/device_count/device_limit`）让自验脚本验。Error 同样双发 `code` + `error`。

### A2. publish_tasks status enum — 完整 set 是哪些？

**Proposer 决策**：完整 enum = `pending/running/success/failed/done/queued/dispatched/in_progress/completed`（旧 5 + 新 4）。

- `pending` 旧 — 任务刚 INSERT 还没派
- `queued` 新 — 任务进派发队列等待 agent
- `dispatched` 新 — 已发 WS 消息给 agent，等 agent ack
- `running` 旧 / `in_progress` 新 — agent 执行中（两个名都接受，未来 deprecate `running`）
- `success` 旧 / `completed` 新 / `done` 旧 — 三个都表示成功（兼容 Sprint A/B/Path 1 历史代码）
- `failed` 旧 — 失败

**migration 策略**：
1. 临 PSQL 先 `SELECT DISTINCT status FROM zenithjoy.publish_tasks` 探活，验证旧数据全在新 superset 内
2. `ALTER TABLE ... DROP CONSTRAINT chk_publish_tasks_status`
3. `ALTER TABLE ... ADD CONSTRAINT chk_publish_tasks_status CHECK (status IN (上面 9 个))`
4. 加 COMMENT 解释 deprecate 时间表

### A3. WS routing UUID 化 — 怎么 backwards compat？

**Proposer 决策**：
- `agents.id` (UUID) 是真 routing key
- `agents.agent_id` (TEXT, hostname-derived) 仅作 display name，**不再**用作 routing
- WS dispatcher 改读 `agents.id`，向 ws connection 发 message 时 `agent_id` 字段填 UUID
- backwards compat：`agentRegistry` 改 indexed by UUID（`agents.id`），但 `pickFor()` 返的 entry 同时带 `agentId`(UUID) 与 `displayName`(string)
- 旧 hello message `agentId` (string) 收到后必须**转换成 UUID** — 调 `agent-db.findAgentIdByDisplay()` 查表，找不到就 `upsertAgent` 后取 UUID

### A4. 双 register call 同 license 怎么算 device_count？

**决策**：
- `device_count` = `SELECT COUNT(*) FROM license_machines WHERE license_id=$1 AND status='active'`
- 同 machine_id reconnect 不增 count（UPDATE existing row last_seen，不 INSERT）
- 同 hostname 不同 machine_id → 视为新装机，`device_count` 加 1，撞 limit 时返 403
- license_machine.status 默认 `active`，离线 60s 不 set offline（grace period 留 H-2）

### A5. WS dispatcher policy — capability + heartbeat + status 三维度

**决策**：`agent-registry.pickFor(capability, tenantId?)` 已实现 capability + busy + tenant filter。本 sprint **不改** pickFor 接口，**只改** 返回的 `agentId` 从 string 变成 UUID（保留 displayName 字段）。

heartbeat 维度由 `lastHeartbeat < 30000ms` 表示 online (已存在 `/api/agent/status` 第 77 行)。本 sprint 把 30s timeout 提取常量 `AGENT_HEARTBEAT_TIMEOUT_MS = 30000` 在 dispatcher policy 用。

> Reviewer 必查：上述 5 个 architecture 决策是否合 PRD 意图？是否漏 bug 形态？是否给老 Agent 留兼容？

---

## Golden Path

[Sprint B-1 Lead 自验暴 3 个 backend system bug] → [register endpoint 加新字段并保留老字段 / status enum migration superset / WS routing UUID 化] → [3 bug 真在生产消除，全自动 0-touch lead 自验脚本验证]

### Step 1: mac controller 注册 test user 拿 license

**可观测行为**：mac 调 `POST /api/auth/sign-up/email`，better-auth 自动签发 free tier license 到新 user 的 customer_id。

**验证命令**：
```bash
TS=$(date +%s)
EMAIL="h1-self-test-${TS}@example.com"
SIGNUP_RESP=$(curl -fsS -X POST "http://localhost:5200/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -c /tmp/h1-cookie.txt \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"H1selftest!2026\",\"name\":\"H1 Self Test\"}")
echo "$SIGNUP_RESP" | jq -e '.user.id | type == "string"' || exit 1
USER_ID=$(echo "$SIGNUP_RESP" | jq -r '.user.id')

# 直查 DB 看 license auto-issued
LICENSE_KEY=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%${USER_ID}%' OR notes LIKE '%${USER_ID}%' ORDER BY created_at DESC LIMIT 1")
[ -n "$LICENSE_KEY" ] || { echo "no license auto-issued for user $USER_ID"; exit 1; }
[[ "$LICENSE_KEY" =~ ^ZJ-F-[A-Z0-9]{8}$ ]] || { echo "license_key format wrong: $LICENSE_KEY"; exit 1; }
echo "PASS Step 1: USER_ID=$USER_ID LICENSE_KEY=$LICENSE_KEY (free tier)"
```

**硬阈值**：返 user_id (string)，license_key 形如 `ZJ-F-XXXXXXXX`，free tier。

---

### Step 2: 第 1 个 Agent register — 返双 schema 含 `device_count=1`

**可观测行为**：`POST /api/agent/register` 返 200，body 同时含老字段（`ok=true, license_id, tier, max_machines`）+ 新字段（`success=true, agent_id (UUID), license_tier, device_count=1, device_limit=1`）。

**验证命令**：
```bash
MACHINE_ID_1="machine-h1-test-${TS}-a"
RESP1=$(curl -fsS -X POST "http://localhost:5200/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"${LICENSE_KEY}\",\"machine_id\":\"${MACHINE_ID_1}\",\"hostname\":\"rog-h1-1\",\"version\":\"0.1.0\"}")

# 老字段（backwards compat）
echo "$RESP1" | jq -e '.ok == true' || { echo "FAIL: 老字段 .ok != true"; exit 1; }
echo "$RESP1" | jq -e '.license_id | type == "string"' || { echo "FAIL: .license_id 缺"; exit 1; }
echo "$RESP1" | jq -e '.tier == "free"' || { echo "FAIL: .tier != free"; exit 1; }
echo "$RESP1" | jq -e '.max_machines == 1' || { echo "FAIL: .max_machines != 1"; exit 1; }

# 新字段（H-1 新增，对齐 PRD）
echo "$RESP1" | jq -e '.success == true' || { echo "FAIL: 新字段 .success != true"; exit 1; }
echo "$RESP1" | jq -e '.agent_id | type == "string"' || { echo "FAIL: .agent_id 缺"; exit 1; }
echo "$RESP1" | jq -e '.agent_id | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")' \
  || { echo "FAIL: .agent_id 不是 UUID 格式"; exit 1; }
echo "$RESP1" | jq -e '.license_tier == "free"' || { echo "FAIL: .license_tier != free"; exit 1; }
echo "$RESP1" | jq -e '.device_count == 1' || { echo "FAIL: .device_count != 1"; exit 1; }
echo "$RESP1" | jq -e '.device_limit == 1' || { echo "FAIL: .device_limit != 1"; exit 1; }

echo "PASS Step 2"
```

**硬阈值**：双 schema 全过；agent_id 是 UUID 格式；device_count=1，device_limit=1。

---

### Step 3: 第 2 个 Agent register 同 license 不同 machine_id → HTTP 403 LICENSE_DEVICE_LIMIT_EXCEEDED

**可观测行为**：`POST /api/agent/register` 返 403，body 同时含老字段 `code: "QUOTA_EXCEEDED"` + 新字段 `error: "LICENSE_DEVICE_LIMIT_EXCEEDED", current_count: 1, limit: 1`。

**验证命令**：
```bash
MACHINE_ID_2="machine-h1-test-${TS}-b"
HTTP_CODE=$(curl -s -o /tmp/h1-resp2.json -w "%{http_code}" -X POST "http://localhost:5200/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"${LICENSE_KEY}\",\"machine_id\":\"${MACHINE_ID_2}\",\"hostname\":\"rog-h1-2\",\"version\":\"0.1.0\"}")
[ "$HTTP_CODE" = "403" ] || { echo "FAIL: HTTP $HTTP_CODE != 403"; cat /tmp/h1-resp2.json; exit 1; }

RESP2=$(cat /tmp/h1-resp2.json)
# 老字段
echo "$RESP2" | jq -e '.ok == false' || { echo "FAIL: .ok != false"; exit 1; }
echo "$RESP2" | jq -e '.code == "QUOTA_EXCEEDED"' || { echo "FAIL: .code != QUOTA_EXCEEDED"; exit 1; }

# 新字段（H-1 PRD 要求）
echo "$RESP2" | jq -e '.success == false' || { echo "FAIL: .success != false"; exit 1; }
echo "$RESP2" | jq -e '.error == "LICENSE_DEVICE_LIMIT_EXCEEDED"' \
  || { echo "FAIL: .error != LICENSE_DEVICE_LIMIT_EXCEEDED"; exit 1; }
echo "$RESP2" | jq -e '.current_count == 1' || { echo "FAIL: .current_count != 1"; exit 1; }
echo "$RESP2" | jq -e '.limit == 1' || { echo "FAIL: .limit != 1"; exit 1; }
echo "$RESP2" | jq -e '.message | type == "string"' || { echo "FAIL: .message 缺"; exit 1; }

echo "PASS Step 3"
```

**硬阈值**：HTTP 403；老 + 新字段全过。

---

### Step 4: SQL 验 license_machines 只 1 行 active for this license

**可观测行为**：DB `license_machines` 表中 license_id 对应仅 1 行，status='active'。

**验证命令**：
```bash
COUNT=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "SELECT COUNT(*) FROM zenithjoy.license_machines lm
        JOIN zenithjoy.licenses l ON l.id = lm.license_id
       WHERE l.license_key='${LICENSE_KEY}' AND lm.status='active'
         AND lm.first_seen > NOW() - interval '5 minutes'")
[ "$COUNT" = "1" ] || { echo "FAIL: license_machines count=$COUNT (expect 1)"; exit 1; }
echo "PASS Step 4"
```

**硬阈值**：count = 1，5 分钟时间窗（防造假通过）。

---

### Step 5: 模拟 INSERT publish_tasks status='queued' → PASS new constraint

**可观测行为**：`INSERT INTO publish_tasks (..., status='queued', ...)` 不撞 chk_publish_tasks_status。

**验证命令**：
```bash
# 先确保有 agent 行（用 _smoke/mock-agent dev endpoint 或直 INSERT）
AGENT_UUID=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "SELECT id FROM zenithjoy.agents WHERE agent_id LIKE '%h1-test%' OR hostname='rog-h1-1' ORDER BY last_seen DESC LIMIT 1")

# 如没有，直 INSERT 一行 agent (test-only)
if [ -z "$AGENT_UUID" ]; then
  AGENT_UUID=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
    -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) 
        VALUES ('h1-test-agent-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
fi

# INSERT publish_tasks status='queued' — 应 PASS（这是 H-1 修的核心）
TASK_RESULT=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) 
      VALUES ('${AGENT_UUID}', 'douyin', 'queued') RETURNING id" 2>&1) 
echo "$TASK_RESULT" | grep -qE "^[0-9a-f-]{36}$" || { echo "FAIL: queued INSERT 撞 constraint: $TASK_RESULT"; exit 1; }
echo "PASS Step 5: TASK_ID=$TASK_RESULT (status=queued accepted)"

# 再验剩余 3 个新 status 也 PASS
for st in dispatched in_progress completed; do
  R=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
    -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) 
        VALUES ('${AGENT_UUID}', 'douyin', '${st}') RETURNING id" 2>&1)
  echo "$R" | grep -qE "^[0-9a-f-]{36}$" || { echo "FAIL status=$st: $R"; exit 1; }
done
echo "PASS Step 5b: dispatched/in_progress/completed 全过"

# 反向验：'banana' 应被拒
BAD=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) 
      VALUES ('${AGENT_UUID}', 'douyin', 'banana') RETURNING id" 2>&1 || true)
echo "$BAD" | grep -qiE "violates check constraint|chk_publish_tasks_status" \
  || { echo "FAIL: 'banana' 没被拒（constraint 形同虚设）: $BAD"; exit 1; }
echo "PASS Step 5c: 'banana' 反向被 constraint 拒"
```

**硬阈值**：4 个新 status 全过、'banana' 被拒、constraint 名 `chk_publish_tasks_status` 真生效。

---

### Step 6: SQL `\d publish_tasks` 验 chk_publish_tasks_status 含完整 enum

**可观测行为**：pg_constraint 元数据中 chk_publish_tasks_status 的 condef 同时含 9 个 status。

**验证命令**：
```bash
CONSTRAINT_DEF=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_publish_tasks_status'")
echo "constraint def: $CONSTRAINT_DEF"

for st in pending running success failed done queued dispatched in_progress completed; do
  echo "$CONSTRAINT_DEF" | grep -q "'${st}'" || { echo "FAIL: constraint 缺 status='${st}'"; exit 1; }
done
echo "PASS Step 6: chk_publish_tasks_status 含全 9 个 enum"
```

**硬阈值**：9 个 status 字面量全在 constraint def 中。

---

### Step 7: mac 启 mock WS client connect backend `/agent-ws`，identify 用 UUID → backend dispatcher 用 UUID 作 routing key

**可观测行为**：mock WS client 用 `LICENSE_KEY` 作 token 连 `/agent-ws?token=...`，发 hello message `agentId=<UUID>` → backend `agentRegistry.register(uuid, ...)` → `pickFor` 找回该 entry 时返 entry.agentId 是 UUID。

**验证命令**：
```bash
# 启 mock WS client (Node inline script)
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:5200/agent-ws?token=${LICENSE_KEY}');
const AGENT_UUID = '${AGENT_UUID}';
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'hello',
    payload: { agentId: AGENT_UUID, capabilities: ['douyin'], version: '0.1.0' }
  }));
});
ws.on('message', (raw) => {
  console.log('WS_RECV:', raw.toString());
});
setTimeout(() => process.exit(0), 5000);
" &
WS_PID=$!
sleep 2

# 调 GET /api/agent/status — 验 registry 含此 agent，agentId 字段是 UUID
STATUS=$(curl -fsS "http://localhost:5200/api/agent/status")
echo "$STATUS" | jq -e ".agents | map(select(.agentId == \"${AGENT_UUID}\")) | length >= 1" \
  || { echo "FAIL: agent registry 没找到 UUID=${AGENT_UUID}"; kill $WS_PID 2>/dev/null; exit 1; }

# 真挑战：所有 .agents[].agentId 必须是 UUID 格式（不是 string display name）
echo "$STATUS" | jq -e '.agents | map(.agentId | test("^[0-9a-f]{8}-[0-9a-f]{4}")) | all' \
  || { echo "FAIL: 有 agent .agentId 不是 UUID"; kill $WS_PID 2>/dev/null; exit 1; }

kill $WS_PID 2>/dev/null
echo "PASS Step 7"
```

**硬阈值**：registry 找到 entry，agentId 字段是 UUID 格式。

---

### Step 8: backend 派 task → mock WS client 收到 message agent_id 是 UUID

**可观测行为**：backend 调 `dispatchTask` 给 capability='douyin' agent → WS message JSON 含 `type: 'task' | 'publish_request', agent_id: <UUID>, task_id, payload`。

**验证命令**：
```bash
# 启 mock WS client，mark 收到的 message 写到文件
mkdir -p /tmp/h1-ws-receive
node -e "
const fs = require('fs');
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:5200/agent-ws?token=${LICENSE_KEY}');
const AGENT_UUID = '${AGENT_UUID}';
const RECEIVED_FILE = '/tmp/h1-ws-receive/messages.jsonl';
fs.writeFileSync(RECEIVED_FILE, '');
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'hello',
    payload: { agentId: AGENT_UUID, capabilities: ['douyin'], version: '0.1.0' }
  }));
});
ws.on('message', (raw) => {
  fs.appendFileSync(RECEIVED_FILE, raw.toString() + '\n');
});
setTimeout(() => process.exit(0), 8000);
" &
WS_PID=$!
sleep 2

# 用 dev endpoint 触发 dispatch（POST /api/agent/test-publish-douyin）
DISPATCH=$(curl -fsS -X POST "http://localhost:5200/api/agent/test-publish-douyin" \
  -H "Content-Type: application/json" -d '{}')
echo "$DISPATCH" | jq -e '.ok == true' \
  || { echo "FAIL: dispatch 失败 $DISPATCH"; kill $WS_PID 2>/dev/null; exit 1; }

sleep 4
kill $WS_PID 2>/dev/null

# 验 mock client 收到含 UUID 的 message
[ -s /tmp/h1-ws-receive/messages.jsonl ] || { echo "FAIL: mock client 没收到 message"; exit 1; }
TASK_MSG=$(grep '"publish_request"\|"task"' /tmp/h1-ws-receive/messages.jsonl | head -1)
[ -n "$TASK_MSG" ] || { echo "FAIL: 没收到 task/publish_request 消息"; cat /tmp/h1-ws-receive/messages.jsonl; exit 1; }

# message 必须含正确 agent UUID（不是 hostname / arbitrary string）
echo "$TASK_MSG" | jq -e ".agent_id == \"${AGENT_UUID}\"" \
  || { echo "FAIL: message agent_id 不是 UUID=${AGENT_UUID}: $TASK_MSG"; exit 1; }
echo "$TASK_MSG" | jq -e '.task_id | type == "string"' || { echo "FAIL: 缺 task_id"; exit 1; }
echo "$TASK_MSG" | jq -e '.payload | type == "object"' || { echo "FAIL: 缺 payload"; exit 1; }
echo "PASS Step 8"
```

**硬阈值**：mock client 收到 message，agent_id 字段 = AGENT_UUID（UUID 格式）。

---

### Step 9: SQL 验 publish_tasks.agent_id 字段填 UUID

**可观测行为**：dispatch 完成后，DB 中本次 dispatch 写的 publish_tasks.agent_id 列是 UUID（指向 agents.id）。

**验证命令**：
```bash
# 找最近 5 分钟内 INSERT 的 publish_tasks
RESULT=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "SELECT pt.agent_id::text, a.id::text, a.agent_id 
        FROM zenithjoy.publish_tasks pt
        JOIN zenithjoy.agents a ON a.id = pt.agent_id
       WHERE pt.created_at > NOW() - interval '5 minutes'
         AND a.agent_id LIKE '%h1-test%'
       ORDER BY pt.created_at DESC LIMIT 1")

echo "joined row: $RESULT"
[ -n "$RESULT" ] || { echo "FAIL: 没找到本次 dispatch 写的 publish_tasks"; exit 1; }
PT_AGENT_ID=$(echo "$RESULT" | cut -d'|' -f1)
A_UUID=$(echo "$RESULT" | cut -d'|' -f2)
[ "$PT_AGENT_ID" = "$A_UUID" ] || { echo "FAIL: pt.agent_id($PT_AGENT_ID) != a.id($A_UUID)"; exit 1; }
echo "$PT_AGENT_ID" | grep -qE "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" \
  || { echo "FAIL: pt.agent_id 不是 UUID 格式: $PT_AGENT_ID"; exit 1; }
echo "PASS Step 9"
```

**硬阈值**：publish_tasks.agent_id 是 UUID，等于 joined agents.id。

---

### Step 10: 启第 2 个 mock WS client 不同 capability → backend 按 capability filter 路由

**可观测行为**：启 2 个 ws client（一 douyin、一 feishu），backend 派 douyin task 时只路由到 douyin client，feishu client 不收。

**验证命令**：
```bash
# 启 2 个 client
mkdir -p /tmp/h1-ws-multi
AGENT_UUID_2=$(PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -tA \
  -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) 
      VALUES ('h1-test-feishu-${TS}', ARRAY['feishu'], '0.1.0', 'online') RETURNING id")

# Client A: douyin capability
node -e "
const fs = require('fs');
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:5200/agent-ws?token=${LICENSE_KEY}');
ws.on('open', () => {
  ws.send(JSON.stringify({type:'hello', payload:{agentId:'${AGENT_UUID}', capabilities:['douyin'], version:'0.1.0'}}));
});
ws.on('message', (raw) => fs.appendFileSync('/tmp/h1-ws-multi/douyin.jsonl', raw.toString()+'\n'));
setTimeout(() => process.exit(0), 8000);
" > /dev/null 2>&1 &
PID_A=$!

# Client B: feishu capability
node -e "
const fs = require('fs');
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:5200/agent-ws?token=${LICENSE_KEY}');
ws.on('open', () => {
  ws.send(JSON.stringify({type:'hello', payload:{agentId:'${AGENT_UUID_2}', capabilities:['feishu'], version:'0.1.0'}}));
});
ws.on('message', (raw) => fs.appendFileSync('/tmp/h1-ws-multi/feishu.jsonl', raw.toString()+'\n'));
setTimeout(() => process.exit(0), 8000);
" > /dev/null 2>&1 &
PID_B=$!

sleep 2
> /tmp/h1-ws-multi/douyin.jsonl 2>/dev/null
> /tmp/h1-ws-multi/feishu.jsonl 2>/dev/null

# 派 douyin task
curl -fsS -X POST "http://localhost:5200/api/agent/test-publish-douyin" -H "Content-Type: application/json" -d '{}' > /dev/null

sleep 4
kill $PID_A $PID_B 2>/dev/null

DOUYIN_RECV=$(grep -c '"publish_request"\|"task"' /tmp/h1-ws-multi/douyin.jsonl 2>/dev/null || echo 0)
FEISHU_RECV=$(grep -c '"publish_request"\|"task"' /tmp/h1-ws-multi/feishu.jsonl 2>/dev/null || echo 0)

[ "$DOUYIN_RECV" -ge 1 ] || { echo "FAIL: douyin client 没收到 task (dispatch 漏)"; exit 1; }
[ "$FEISHU_RECV" = "0" ] || { echo "FAIL: feishu client 不应收到 douyin task (capability filter 失效)"; cat /tmp/h1-ws-multi/feishu.jsonl; exit 1; }
echo "PASS Step 10: douyin recv=$DOUYIN_RECV, feishu recv=$FEISHU_RECV (capability filter 真生效)"
```

**硬阈值**：douyin client 收 ≥ 1 message，feishu client 收 = 0。

---

## E2E 验收（最终 Evaluator 跑 — 单一可执行脚本）

**journey_type**: `dev_pipeline`

**完整验证脚本**: `.github/workflows/scripts/smoke/agent-hardening-h1-smoke.sh`

```bash
#!/bin/bash
set -e

API="${API_BASE:-http://localhost:5200}"
DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-zenithjoy}"
DB_USER="${DATABASE_USER:-zenithjoy}"
export PGPASSWORD="${DATABASE_PASSWORD:?need DATABASE_PASSWORD}"

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tA"
TS=$(date +%s)

# Step 1: signup + license
EMAIL="h1-smoke-${TS}@example.com"
SIGNUP=$(curl -fsS -X POST "$API/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"H1smoke!2026\",\"name\":\"H1\"}")
USER_ID=$(echo "$SIGNUP" | jq -r '.user.id')
[ -n "$USER_ID" ] && [ "$USER_ID" != "null" ] || { echo "Step 1 FAIL: no user_id"; exit 1; }

LICENSE_KEY=$($PSQL -c "SELECT license_key FROM zenithjoy.licenses 
  WHERE customer_id LIKE '%${USER_ID}%' OR notes LIKE '%${USER_ID}%' 
  ORDER BY created_at DESC LIMIT 1")
[[ "$LICENSE_KEY" =~ ^ZJ-F-[A-Z0-9]{8}$ ]] || { echo "Step 1 FAIL: license $LICENSE_KEY"; exit 1; }

# Step 2: register agent #1
RESP1=$(curl -fsS -X POST "$API/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"smoke-h1-${TS}-a\",\"hostname\":\"smoke-host-a\",\"version\":\"0.1.0\"}")
echo "$RESP1" | jq -e '.success == true and .device_count == 1 and .device_limit == 1 and (.agent_id | test("^[0-9a-f]{8}-"))' \
  || { echo "Step 2 FAIL: $RESP1"; exit 1; }

# Step 3: register agent #2 → 403
HC=$(curl -s -o /tmp/h1-r2.json -w "%{http_code}" -X POST "$API/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"smoke-h1-${TS}-b\",\"hostname\":\"smoke-host-b\",\"version\":\"0.1.0\"}")
[ "$HC" = "403" ] || { echo "Step 3 FAIL: HTTP $HC"; cat /tmp/h1-r2.json; exit 1; }
jq -e '.error == "LICENSE_DEVICE_LIMIT_EXCEEDED" and .current_count == 1 and .limit == 1' /tmp/h1-r2.json \
  || { echo "Step 3 FAIL schema"; cat /tmp/h1-r2.json; exit 1; }

# Step 4: SQL count
LMC=$($PSQL -c "SELECT COUNT(*) FROM zenithjoy.license_machines lm 
  JOIN zenithjoy.licenses l ON l.id=lm.license_id 
  WHERE l.license_key='$LICENSE_KEY' AND lm.status='active' 
    AND lm.first_seen > NOW() - interval '5 minutes'")
[ "$LMC" = "1" ] || { echo "Step 4 FAIL: count=$LMC"; exit 1; }

# Step 5+6: status enum
AGENT_UUID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) 
  VALUES ('h1-smoke-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
for st in queued dispatched in_progress completed; do
  R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) 
    VALUES ('$AGENT_UUID', 'douyin', '$st') RETURNING id" 2>&1)
  echo "$R" | grep -qE "^[0-9a-f-]{36}$" || { echo "Step 5 FAIL status=$st: $R"; exit 1; }
done
CDEF=$($PSQL -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_publish_tasks_status'")
for st in pending running success failed done queued dispatched in_progress completed; do
  echo "$CDEF" | grep -q "'$st'" || { echo "Step 6 FAIL: enum 缺 $st"; exit 1; }
done

# Step 7+8+9: WS routing UUID
node -e "
const fs=require('fs'),WS=require('ws');
const ws=new WS('ws://localhost:5200/agent-ws?token=$LICENSE_KEY');
fs.writeFileSync('/tmp/h1-ws-msg.jsonl','');
ws.on('open',()=>ws.send(JSON.stringify({type:'hello',payload:{agentId:'$AGENT_UUID',capabilities:['douyin'],version:'0.1.0'}})));
ws.on('message',(r)=>fs.appendFileSync('/tmp/h1-ws-msg.jsonl',r.toString()+'\n'));
setTimeout(()=>process.exit(0),6000);
" &
WSPID=$!
sleep 2
curl -fsS -X POST "$API/api/agent/test-publish-douyin" -H "Content-Type: application/json" -d '{}' > /dev/null
sleep 3
kill $WSPID 2>/dev/null || true

TASK_MSG=$(grep -E '"publish_request"|"task"' /tmp/h1-ws-msg.jsonl | head -1)
[ -n "$TASK_MSG" ] || { echo "Step 7/8 FAIL: no message"; cat /tmp/h1-ws-msg.jsonl; exit 1; }
echo "$TASK_MSG" | jq -e ".agent_id == \"$AGENT_UUID\"" \
  || { echo "Step 8 FAIL: agent_id not UUID: $TASK_MSG"; exit 1; }

PT_RESULT=$($PSQL -c "SELECT pt.agent_id::text 
  FROM zenithjoy.publish_tasks pt 
  JOIN zenithjoy.agents a ON a.id=pt.agent_id 
  WHERE pt.created_at > NOW() - interval '5 minutes' 
    AND a.agent_id LIKE 'h1-smoke-%' 
  ORDER BY pt.created_at DESC LIMIT 1")
[ -n "$PT_RESULT" ] && echo "$PT_RESULT" | grep -qE "^[0-9a-f]{8}-" \
  || { echo "Step 9 FAIL: pt.agent_id not UUID: $PT_RESULT"; exit 1; }

echo "✅ H-1 smoke: 9 steps PASS (Step 10 capability filter 由 lead self-test 验)"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 3

### Workstream 1: License register endpoint 双 schema + 新 error code

**范围**：
- `apps/api/src/routes/agent.ts` register endpoint：改写返双 schema（老 + 新字段并存），error 同样
- `apps/api/src/services/license.service.ts` registerAgent 函数：返新增字段 `agent_id (UUID)/license_tier/device_count/device_limit`，error 加 `current_count/limit`
- 既有 license enforce 逻辑**保留不动**（已存在 line 361-367）
- `apps/api/src/routes/agent.test.ts` 扩展（既有有 mock-agent 类的 test）— 加 register endpoint 双 schema + 403 限额 test

**大小**：M（约 150-250 行新代码）
**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/license-register-dual-schema.test.ts`

---

### Workstream 2: publish_tasks status enum migration

**范围**：
- `apps/api/db/migrations/20260511_<HHMMSS>_publish_tasks_status_enum_full.sql` — DROP 老 constraint + ADD 新 constraint 含 9 个 status
- 不改 INSERT 处代码（既有 SQL 语句继续使用现有 status 值；H-2 之后 generator 才 emit 新 status）
- 复用 `db/migrations/run-migration.ts` 现有机制（filename 命名严格按 sprint convention）

**大小**：S（约 30-50 行 SQL + 注释）
**依赖**：无（与 ws1 并行）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/publish-tasks-status-enum.test.ts`

---

### Workstream 3: WS routing UUID 化 + dispatcher 改读 agents.id

**范围**：
- `apps/api/src/services/agent-ws.ts`：hello message 收到 string `agentId` 时，**调 agent-db 查 / upsert 拿 UUID**，registry register 用 UUID
- `apps/api/src/services/agent-registry.ts`：entry 加 `displayName` 字段保存原 string；`agentId` 从 string 改 UUID
- `apps/api/src/services/task-dispatch.ts`：发 WS message 时 `agent_id` 字段填 UUID
- `apps/api/src/schemas/agent-protocol.ts`：publish_request payload 加可选 `agent_id` (UUID) 字段
- `apps/api/src/services/agent-db.ts`：加 `findOrCreateAgentUuid(displayName, tenantId, capabilities, version)` helper
- `apps/api/src/routes/agent.ts` `/test-publish-douyin` 等 dev endpoint 改读 entry.agentId（已是 UUID）
- backwards compat：旧 v1.0 Agent 发 string agentId 仍能工作（自动转 UUID）

**大小**：L（约 200-400 行；多文件改动）
**依赖**：ws1（要先有 register endpoint 返 UUID 让 Agent 知道自己的 UUID — 但本 sprint mock client 也可不依赖，并行）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/ws-routing-uuid.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/license-register-dual-schema.test.ts` | 双 schema success / 403 LIMIT_EXCEEDED 双字段 / device_count 真 SQL count | 4 failures（success/limit/devicecount/error字段） |
| WS2 | `tests/ws2/publish-tasks-status-enum.test.ts` | 9 status 全 INSERT 过 / banana 反向被拒 / pg_constraint 含 9 字面量 | 3 failures |
| WS3 | `tests/ws3/ws-routing-uuid.test.ts` | hello string→UUID 转换 / dispatcher 发 UUID / publish_tasks.agent_id 是 UUID | 3 failures |

---

## 反作弊红线（Reviewer 必复审）

1. 验证命令含**时间窗口** `created_at > NOW() - interval '5 minutes'`（Step 4/9）— 防造假 row
2. JSON 响应**逐字段 jq -e** 检查 — 不允许 generator 偷漂移字段名
3. constraint def **逐字面量 grep** — 防 generator 只 add `queued` 漏其他 3 个
4. WS 真启 mock client 真 send 真 recv — 不允许 generator 用 unit test 替代 (E2E 必须 真 ws round-trip)
5. capability filter 用 2 client 验 — douyin recv ≥1 + feishu recv = 0 双约束（防只验单边）
