# Sprint Contract Draft (Round 1)

sprint: 07282119-agent-panel-knife2-android
task_id: dc438e65-da7e-44c6-88df-26d305cfcac5
journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f（Path2 客户智能获客）
step_id: Path2-Step8

## 技术上下文（读现有代码得出，registry 侧 panel_events/panel-事 无命中，标 [NEW_PATTERN]）

Brain registry（api/db_schema/test 三源）对 `panel_events`/`panel-event` 关键词均无命中——刀1（PR #1488系列）刚落地，registry 尚未来得及沉淀。本节技术上下文改为**直接读现有已合并代码**（origin/main 分支，rebase 后本 worktree 已含）得出，比 registry 更权威：

1. **`zenithjoy.panel_events` 表已存在**（`apps/api/db/migrations/20260728_112227_panel_events.sql`）：`tenant_id, task_id, event(6种枚举), line, device, title, detail, progress(jsonb), severity(info/warn/error), created_at`。**本 sprint 不新增字段**（PRD 假设已确认，字段够用）。
2. **`POST /api/panel/events`（`apps/api/src/routes/panel-events.ts`）已存在**：鉴权走 `internalAuth`（Bearer/X-Internal-Token）+ 直接信任的 `X-Tenant-Id` header。这是刀1 line04（Windows 本机 RPA，desktop Agent 与写入者同源，可信内部 token）专用鉴权模型。
3. **安卓侧真实网络层鉴权模型与上面完全不同**（现场读代码实证，非猜测）：
   - `CollectReporter.kt` / `AcquisitionCollectPollLoop.kt`：header `x-agent-id`，服务端反查 `zenithjoy.agents` 得真 tenant_id（**不信任设备自报 tenant**，`acquisition.ts:1476` 原话："安卓 agent 按设计发 X-Tenant-Id = agentId（设备不持有真 tenant），不能信 header"）。
   - `agent-burner.ts` 的 `account-scan-result`（**DeviceAccountScanService 现有写回路径，Line02 Step7 原生端点**）：body 字段 `agent_id`（同为 `zenithjoy.agents.id`），同样不做 tenant 反查（该端点本身不需要 tenant_id，直接用 agent_id 做 FK）。
   - 安卓侧**从未发送** `X-Internal-Token` 或可信 `X-Tenant-Id`。
4. **`DeviceAccountScanService.kt` 本身零 HTTP 调用**（现场读代码实证）：状态机 `IDLE → OPENING_SWITCH_ACCOUNT_PANEL → READING_ACCOUNT_LIST → CLOSING_SWITCH_ACCOUNT_PANEL → IDLE`，切换时只 `sendBroadcast(ACTION_ACCOUNT_SCAN_RESULT)`；真正的中台 HTTP 上报由 `AgentService.kt` 收到广播后代发（第200行注释原话）。**本 sprint 状态机上报点应插在 `AgentService.kt` 的广播消费处**，PRD"预期受影响文件"括号里"（或安卓侧对应上报调用点）"已为此预留弹性，不字面锁死 `DeviceAccountScanService.kt`。
5. **`apps/agent-panel` 前端渲染层已高度通用**（现场读代码实证——这点非常关键，直接决定本合同范围）：
   - `ExpandedPanel.tsx` / `CollapsedStrip.tsx` 按 `LineState[]` 数组渲染，逐 `line.line` 生成独立 `data-testid="lane-${line}"` / `data-testid="lamp-${line}"`，**结构上天然物理隔离**（非本次新增）。
   - `line-labels.ts` 已含 `line02: '智能获客'` 映射（刀1已铺垫）。
   - `ExpandedPanel.test.tsx` 现有测试**已经在用 mock line02 数据**（`connected:true`）验证渲染——真正缺的不是"渲染逻辑"，是"真实数据能不能流到这里"。
6. **真正的缺口在两处**（现场读代码定位，非猜测）：
   - `services/agent/src/handlers/panel-events-route.ts` 的 `CONNECTED_LINES = new Set(['line04'])` 硬编码，且**没有任何机制把中台 `panel_events` 表里的 line02 行喂给本地 `PanelEventBus`**——line04 靠本机文件 tail（`PanelEventsTail`），line02（安卓，跨设备）目前完全没有桥接通道。
   - 没有"中台看门狗"计算端点（本机 `PanelEventBus` 的看门狗是**本地进程内存定时器**，只对本机文件 tail 来源有效，对中台 DB 里的跨设备事件无效——PRD 说的"中台看门狗"是要新建的服务端能力，不是复用本机 bus 的 90s 定时器）。

## 已知约束（来自回归测试 + 累积 FR）

- `apps/api/src/routes/__tests__/panel-events.test.ts` → POST /api/panel/events 缺 X-Tenant-Id 400 MISSING_TENANT / 缺必填字段 400 MISSING_FIELDS / event 非法 400 INVALID_EVENT / 正常 200 + 透传 tenant_id / service 抛异常 500 INTERNAL（**本 sprint 新增的 line02 端点需保持同款错误码风格，不得另起炉灶**）
- `services/agent/src/handlers/__tests__/panel-events-route.test.ts:59-74` → 现有断言 `{line02:false, line04:true, publish:false}`，**本 sprint 必须把它改为 `{line02:true, line04:true, publish:false}`**（真实、非 mock 的代码级验证——line02 桥接生效后此断言天然反转，不是手工改测试凑数）
- `services/agent/src/__tests__/panel-event-bus.test.ts` → `PanelEventBus` 看门狗默认 90s、多 task 灯态 max() 聚合、stuck 是过渡态非终态——**本地 bus 逻辑本身不改**，line02 走中台看门狗（独立 3 分钟阈值），不复用本地 90s
- `context-manifest` 端点（`GET /api/brain/journeys/{id}/golden-paths`）累积 FR：Path2 视频判定→评论抓取→Lead 落库全链已跑通（本 sprint 不触碰该链路，纯新增 line02 打点可观测性，[FROM_PRD] 累积 FR 段已声明）

## 禁 mock 边清单

- **中台 API ↔ `zenithjoy.panel_events` 表**（新增写入端点，真 Postgres 验证行落库，不 mock DB 层）
- **`services/agent` 桥接模块 ↔ `PanelEventBus`**（桥接代码调 `bus.ingest()` 必须是真实 `PanelEventBus` 实例，只允许 mock 桥接模块对外发起的 HTTP fetch 这一层"更外层的无关依赖"——桥接逻辑本身、`bus.ingest()`、灯态聚合全部真跑）
- **`apps/agent-panel` React 组件 ↔ `LineState[]` 渲染**（真 render 真 DOM 断言，不 mock React Testing Library）

## Golden Path

[Android 设备触发扫描] → [state machine 切换上报] → [3分钟无新事件中台判 stuck] → [完成/失败终态] → [本地 Agent 桥接central数据] → [作战窗渲染 line02 泳道] → [多设备物理隔离]

### Step 1: Android 触发账号扫描 → task_started 上报到中台
**来源**: `[FROM_PRD]` — Golden Path 第1条"测试/客户在设备上触发一次账号扫描任务→Agent状态机进入『打开面板中』→上报task_started"

**可观测行为**: 一次账号扫描任务开始后，`zenithjoy.panel_events` 表出现一条 `line='line02'`、`event='task_started'` 的新行，`tenant_id` 是服务端反查真值（不是客户端自报值），`device` 字段带设备型号+agent_id后4位格式。

**新增端点**: `POST /api/agent/burner/panel-event`（沿用 account-scan-result 同款 body `agent_id` 鉴权模型，不用 internalAuth，不信任客户端 tenant_id）

Request body:
```json
{"agent_id":"<uuid>","event":"task_started","task_id":"scan-<ts>","line":"line02","device":"RMX3478-b6ee","title":"📱 RMX3478-b6ee 第1/3步","detail":null,"progress":[1,3],"severity":"info"}
```

Success (200): `{"ok":true,"id":"<uuid>"}`

**验证命令**:
```bash
AGENT_ROW=$(psql "$DB" -At -c "SELECT id, tenant_id FROM zenithjoy.agents WHERE tenant_id='$TENANT_ID' LIMIT 1")
AGENT_ID=$(echo "$AGENT_ROW" | cut -d'|' -f1)
TID="scan-$(date +%s)"
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"📱 RMX3478-b6ee 第1/3步\",\"progress\":[1,3]}")
echo "$RESP" | jq -e '.ok == true' || exit 1
ROW=$(psql "$DB" -At -c "SELECT tenant_id, event, line, device FROM zenithjoy.panel_events WHERE task_id='$TID' AND created_at > NOW() - interval '5 minutes'")
echo "$ROW" | grep -q "$TENANT_ID|task_started|line02|RMX3478-b6ee" || exit 1
```

**硬阈值**: 200 + `ok:true` + panel_events 行存在，`tenant_id` 等于服务端反查值（非客户端可控）

---

### Step 2: 状态机切换 → step 事件带 progress
**来源**: `[FROM_PRD]` — Golden Path 第2条"状态机每次切换→上报step事件（progress=[n,total]）→作战窗line02泳道实时刷新当前步骤"

**可观测行为**: 同一 `task_id` 上追加 `event='step'` 行，`progress` jsonb 字段为 `[n,total]`。

**验证命令**:
```bash
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"step\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"📱 RMX3478-b6ee 第2/3步\",\"progress\":[2,3]}" \
  | jq -e '.ok == true' || exit 1
PROG=$(psql "$DB" -At -c "SELECT progress FROM zenithjoy.panel_events WHERE task_id='$TID' AND event='step' AND created_at > NOW() - interval '5 minutes'")
[ "$PROG" = "[2, 3]" ] || [ "$PROG" = "[2,3]" ] || exit 1
```

**硬阈值**: 新行 `event=step`，`progress` 等于 `[2,3]`

---

### Step 3: 3分钟无新事件 → 中台看门狗自动标 stuck（不依赖设备自报）
**来源**: `[AI_ADDED]` — PRD Golden Path 第3条描述行为但未指定接口；`panel_events` 表本身无"当前状态"列，本地 `PanelEventBus` 的看门狗是进程内存定时器（只对本机文件 tail 来源有效），中台侧需要一个新的计算入口才能让 line02（跨设备、无本机常驻进程）的 stuck 判定可查。这是把"中台看门狗3分钟无新事件自动标stuck"这条 PRD 明确要求的能力翻译成可验证接口，非范围蔓延。

**新增端点**: `GET /api/agent/burner/panel-active-tasks?line=line02`（鉴权：`X-Tenant-Id` header，与 `GET /sessions` 同款 `tenantContextOptional` 模式）

Success (200):
```json
{"line":"line02","activeTasks":[{"task_id":"...","device":"...","title":"...","detail":null,"progress":[2,3],"state":"work"}],"recentCompleted":[{"task_id":"...","device":"...","title":"...","state":"done"}]}
```

state 计算规则（服务端行为契约，非实现细节）：取每个 `task_id` 最新一条 panel_events 行；若最新事件是 `done`/`failed` → 归入 `recentCompleted`，`state`=该事件值；否则若 `NOW() - 最新行created_at > 3分钟`（常量命名，如 `PANEL_LINE02_STUCK_THRESHOLD_MS=180000`，禁止裸写魔法数）→ `state='stuck'`；否则按最新事件映射（`task_started`/`step`→`work`，`waiting`→`waiting`，`stuck`→`stuck`）。

**验证命令（用时间窗口回填技巧模拟3分钟流逝，不真等待）**:
```bash
STUCK_TID="scan-stuck-$(date +%s)"
psql "$DB" -c "INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at) VALUES ('$TENANT_ID', '$STUCK_TID', 'task_started', 'line02', 'RMX3478-c3d4', '📱 RMX3478-c3d4 第1/3步', '[1,3]', NOW() - interval '4 minutes')"
RESP=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
echo "$RESP" | jq -e --arg tid "$STUCK_TID" '.activeTasks[] | select(.task_id==$tid) | .state == "stuck"' || exit 1

# 字段完整性（Reviewer round1 问题3）：title/progress 必须从写入端点原样透传到聚合端点，不能只算出 state 就丢字段
echo "$RESP" | jq -e --arg tid "$STUCK_TID" '.activeTasks[] | select(.task_id==$tid) | .title == "📱 RMX3478-c3d4 第1/3步"' || exit 1
echo "$RESP" | jq -e --arg tid "$STUCK_TID" '.activeTasks[] | select(.task_id==$tid) | .progress == [1,3]' || exit 1

# 边界情况（PRD"边界情况"段）：新事件到达后自动恢复，不需要人工干预
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"step\",\"task_id\":\"$STUCK_TID\",\"line\":\"line02\",\"device\":\"RMX3478-c3d4\",\"title\":\"📱 RMX3478-c3d4 第2/3步\",\"progress\":[2,3]}" > /dev/null
RESP2=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
echo "$RESP2" | jq -e --arg tid "$STUCK_TID" '.activeTasks[] | select(.task_id==$tid) | .state != "stuck"' || exit 1
```

**硬阈值**: 3分钟内无新事件的任务 `state=stuck`；新事件到达后同一 task_id 的 `state` 自动脱离 `stuck`（无需人工重置）；`title`/`progress` 必须原样透传（不得只算出 `state` 而丢失原始字段）

---

### Step 4: 任务完成 → done 事件 → 泳道显示"最近完成"
**来源**: `[FROM_PRD]` — Golden Path 第4条"任务完成→上报done→泳道显示『最近完成』，灯带回绿/蓝"

**验证命令**:
```bash
DONE_TID="scan-done-$(date +%s)"
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$DONE_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"done\",\"task_id\":\"$DONE_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"扫描完成\"}" | jq -e '.ok==true' || exit 1
RESP=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
echo "$RESP" | jq -e --arg tid "$DONE_TID" '[.activeTasks[] | select(.task_id==$tid)] | length == 0' || exit 1
echo "$RESP" | jq -e --arg tid "$DONE_TID" '.recentCompleted[] | select(.task_id==$tid) | .state == "done"' || exit 1
```

**硬阈值**: done 事件后该 task 不再出现在 `activeTasks`，出现在 `recentCompleted` 且 `state=done`

---

### Step 5: 任务失败 → failed 事件带 error_code → 泳道标红
**来源**: `[FROM_PRD]` — Golden Path 第5条 + NFR"失败事件必须带error_code，供泳道展示失败原因简述"

`panel_events` 表无独立 `error_code` 列（schema 已锁定，PRD 假设已声明不新增字段），`error_code` 承载于 `detail` 字段，`severity` 必须为 `error`。

**验证命令**:
```bash
FAIL_TID="scan-fail-$(date +%s)"
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"failed\",\"task_id\":\"$FAIL_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"扫描失败\",\"detail\":\"OPEN_PANEL_FAILED\",\"severity\":\"error\"}" \
  | jq -e '.ok==true' || exit 1
ROW=$(psql "$DB" -At -c "SELECT detail, severity FROM zenithjoy.panel_events WHERE task_id='$FAIL_TID' AND event='failed' AND created_at > NOW() - interval '5 minutes'")
[ "$ROW" = "OPEN_PANEL_FAILED|error" ] || exit 1
RESP=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
echo "$RESP" | jq -e --arg tid "$FAIL_TID" '.recentCompleted[] | select(.task_id==$tid) | .state == "failed" and .detail == "OPEN_PANEL_FAILED"' || exit 1
```

**硬阈值**: `detail='OPEN_PANEL_FAILED'`，`severity='error'`，聚合端点返回 `state=failed` 且 `detail` 透传

---

### Step 6: 本地 Agent 桥接中台数据进本地 PanelEventBus
**来源**: `[AI_ADDED]` — 理由：`CONNECTED_LINES` 若只改常量为 `true` 而没有真实数据桥接，属"有灯没线"假绿（改一行 boolean 就能让测试转绿，但真实数据从未流动）。PRD"预期受影响文件"括号"中台agent-burner.ts/acquisition.ts或panel events写入端点"给了弹性空间，此桥接正是把中台数据接进本机常驻进程供 apps/agent-panel 现有 SSE 消费的必要粘合层，属于本 sprint 范围内"新增/复用line02事件转写路径"的落地。

**新增模块**：`services/agent/src/shared/panel-line02-bridge.ts`（仿 `panel-events-tail.ts` 同款"轮询→bus.ingest()"模式，只是数据源从本机文件换成 `fetch(${apiBase}/api/agent/burner/panel-active-tasks?line=line02)`）。启动后按轮询周期（如10s）拉取，把 `activeTasks`/`recentCompleted` 转成 `PanelEvent` 并调用真实 `bus.ingest()`。

**services/agent/src/handlers/panel-events-route.ts** 的 `CONNECTED_LINES` 需把 `'line02'` 加入集合——但只有桥接模块真实调用过 `bus.ingest()` 且拿到过 line02 数据（哪怕一次）后，line02 才在快照里体现 `connected:true` 且有非空 activeTasks/recentCompleted；本合同不接受"无条件硬编码 true"这种与 line04 判定条件不对称的写法（line04 的 connected 状态含义是"确实存在数据通路"，line02 也应遵循同一判定语义，避免在无真实事件时误报"已接入"给客户造成错误安全感）。

**验证命令（单测级，真实 bus + mock fetch 边界）**:
```bash
cd services/agent && npx vitest run src/shared/__tests__/panel-line02-bridge.test.ts --reporter=verbose
```

**硬阈值**: 桥接模块用 mock fetch 返回一条 activeTasks 数据后，真实 `PanelEventBus.getActiveTasks('line02')` 返回非空且字段与 mock 一致；`panel-events-route.test.ts` 断言从 `{line02:false,...}` 改为动态断言（桥接后有真实数据时 `line02:true`）

---

### Step 7: apps/agent-panel 展开态/收起态渲染 line02（回归锁定 + 物理隔离）
**来源**: `[FROM_PRD]` — Golden Path 第1-5条整体落地到 UI 的部分 + Invariant"多设备类型UI区分"（decision 8dbe91ee 同源教训）

现有 `ExpandedPanel.tsx`/`CollapsedStrip.tsx` 已是通用渲染（按 `line.line` 生成独立 testid），本 sprint 的 UI 侧任务主要是**回归锁定**：给定桥接后真实产生的 line02 数据（非本次前才伪造的 mock），断言：
1. `data-testid="lane-line02"` 与 `data-testid="lane-line04"` 是两个独立 DOM 节点（不得合并渲染成一个通用列表）
2. 展开态任务卡片展示设备名格式 `<型号>-<agent_id后4位>`（如 `RMX3478-b6ee`）
3. 收起态灯带 `data-testid="lamp-line02"` 的 `data-state` 属性随 severity 变化（stuck→红态，`lightStateColor('stuck')`）

**验证命令**:
```bash
cd apps/agent-panel && npx vitest run src/components/ExpandedPanel.test.tsx src/components/CollapsedStrip.test.tsx --reporter=verbose
```

**硬阈值**: 上述 vitest 套件全绿，且新增断言（lane-line02 与 lane-line04 分离、设备格式、灯态变红）真实存在于测试文件中（非仅有旧断言复用）

---

### Step 8: 多台同型号设备并发扫描 → 泳道按型号+agent_id后4位区分，不合并显示
**来源**: `[FROM_PRD]` — "边界情况"段"多台同型号设备并发扫描→泳道按型号+agent_id后4位区分，不得合并显示" + Invariant"多设备类型UI区分"

**验证命令**:
```bash
AGENT2_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('$TENANT_ID', 'p2-smoke-device2-${RND}', 'android-device-2', 'online') RETURNING id")
DEV1_TID="scan-multidev-a-$(date +%s)"; DEV2_TID="scan-multidev-b-$(date +%s)"
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$DEV1_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,2]}" > /dev/null
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT2_ID\",\"event\":\"task_started\",\"task_id\":\"$DEV2_TID\",\"line\":\"line02\",\"device\":\"RMX3478-a1f2\",\"title\":\"x\",\"progress\":[1,2]}" > /dev/null
RESP=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
D1=$(echo "$RESP" | jq -e --arg tid "$DEV1_TID" '.activeTasks[] | select(.task_id==$tid) | .device') || exit 1
D2=$(echo "$RESP" | jq -e --arg tid "$DEV2_TID" '.activeTasks[] | select(.task_id==$tid) | .device') || exit 1
[ "$D1" != "$D2" ] || { echo "FAIL: 同型号两台设备被合并显示"; exit 1; }
```

**硬阈值**: 同型号（`RMX3478`前缀）两台设备的两条活跃任务同时存在于 `activeTasks`，`device` 字段不同（`b6ee` vs `a1f2`），未被去重/合并

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | Android 状态机上报 line02 事件到中台，中台计算 stuck 判定，作战窗展示 line02 独立泳道 | Step 1-8 覆盖 |
| **NFR（做得多好）** | stuck 阈值3分钟；设备标识格式型号+agent_id后4位；心跳约30s | PRD NFR 段字面值 |
| **Invariant（永不违反）** | 租户隔离/端点鉴权/多租户测试/日志脱敏/凭据安全/禁写死假设值/真环境验证/多设备类型UI区分 | 见下方"Invariant 覆盖" |
| **判定点（怎么知道）** | 见判定点登记表 |
| **保质期（何时过期）** | panel_events 无 TTL/清理策略（刀1 schema 决定，本 sprint 不改）；stuck 是过渡态非终态，本轮不做过期清理，超期数据留在 recentCompleted 由后续 sprint 决定归档 |
| **死亡告警（停了谁知道）** | 桥接轮询器失败（fetch 报错）不得让本地 Agent 进程崩溃，需静默降级（line02 保持上一次已知态或 connected 状态不变），生产可观测性（告警）留待后续 sprint，本轮至少不能让故障传播到 line04（隔离原则） |
| **失败语义（挂了怎么办）** | 见"失败语义声明"表 |
| **效果确认（已发≠已生效）** | POST 端点响应 `{ok:true,id}` 视为已确认写入（同步写，非异步队列，无需额外轮询确认）；桥接轮询失败允许重试（幂等：panel_events 是纯 append-only 表，重复 POST 相同 task_id+event 只是多一行历史记录，不影响 state 计算取最新行的语义） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ line02 事件上报鉴权走哪套模型 | A. 复用 `/api/panel/events` 的 internalAuth+X-Tenant-Id；B. 新端点走 body `agent_id` 反查 tenant（同 account-scan-result 模型）；C. 新端点走 header `x-agent-id` 反查（同 acquisition.ts collect-tasks 模型） | B（body agent_id，同 account-scan-result 家族） | DeviceAccountScanService 现有写回路径（account-scan-result）已是 body agent_id 模型，AgentService.kt 转发广播时最自然复用同一套；且避免碰动 line04 现有 internalAuth 路径（隔离风险） | 若误选 A（改 internalAuth 端点信任模式），可能引入#1267同款"两条代码路径分叉"回归（真实设备发的是agent_id，测试却假设X-Tenant-Id可信） |
| 3分钟看门狗阈值计算基准 | A. 相对最新事件created_at；B. 相对task_started起始时间 | A（相对最新事件） | PRD Golden Path 边界情况"后续事件到达后自动恢复"要求活性判定，必须以"最近一次活动"为基准，否则长耗时任务一开始就会在阈值后被误判且无法恢复 | 若误选B，长任务一旦超过3分钟绝对时长即永久stuck，无法通过后续心跳自愈，直接违反PRD边界情况要求 |
| ⚠️ CONNECTED_LINES=line02:true 的触发条件 | A. 硬编码常量恒为true（只要代码部署即视为已接入）；B. 桥接模块真实拿到过数据才为true | B（真实数据驱动） | line04 现状语义是"确实有数据在流动"，line02 若硬编码true但桥接因故障从未拿到数据，会让客户/测试人员误以为系统在正常上报，掩盖真实故障（"有灯没线"） | 若误选A，桥接失败时客户端仍显示"已接入"，掩盖故障，延误排查 |

（本任务无输入对抗面判定点——Android agent 是我方受控客户端，非外部任意用户输入，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `POST /api/agent/burner/panel-event` 缺 agent_id | 400 MISSING_AGENT_ID，不写库 | 是（客户端补齐字段后重试，无副作用） | 无降级，直接拒绝 |
| agent_id 无法反查到 tenant | 404 AGENT_NOT_FOUND，不写库 | 否（agent 需先完成注册） | 无降级，Android 端应提示"设备未注册" |
| line !== 'line02' | 400 INVALID_LINE，不写库 | 是 | 无降级（本端点是 line02 专用通道，其余 line 走既有 `/api/panel/events`） |
| DB 写入异常 | 500 INTERNAL，不泄漏堆栈 | 是（幂等：append-only，重复写入只多一行历史） | 客户端本地缓存重试（判定点已登记，Android 侧队列策略留 Generator 实测决定） |
| 中台 3 分钟看门狗计算查询超时/DB 不可用 | `GET /panel-active-tasks` 500，不静默返回假数据 | — | 前端保留上一次已知快照，不清空为"idle"（避免误报任务已结束） |
| services/agent 桥接轮询 fetch 失败（网络/中台不可达） | 本地进程不崩溃，跳过本轮 ingest | 是（下一轮轮询自动重试） | line02 泳道保持上次已知状态，不因单次轮询失败就整体标 disconnected |

（本任务无外部暴露 agent 输入对抗面，N/A——Android App 是我方发布的受控客户端，不接受任意第三方指令注入）

## 真实调用方请求 shape

**生产 Android agent 现有真实调用方式**（实测代码，非猜测）：
- `CollectReporter.kt` / `AcquisitionCollectPollLoop.kt`：header `x-agent-id: <agents.id>`
- `AgentRegistrar.kt` / `account-scan-result`：body 字段 `agent_id: <agents.id>`（同一 UUID 值，不同传递方式）
- 安卓侧**从不**发送 `X-Internal-Token` 或可信 `X-Tenant-Id`；tenant 永远服务端反查

**本 sprint 新端点 `POST /api/agent/burner/panel-event` 选择 body `agent_id` 模型**（与 `account-scan-result` 同款——理由见判定点登记表），DoD 断言必须用 body `agent_id`，**不得**用 `X-Tenant-Id` header 走捷径（否则重演 #1267：测试假设与真实调用方 shape 分叉，测试永远绿、真实设备永远碰不到这条路径）。

## 未覆盖真实链路清单（规则 C）

- **Android 真机状态机→HTTP 上报全链路未覆盖**：`DeviceAccountScanService.kt`/`AgentService.kt` 真实运行在 Android 真机上、状态切换时是否真的触发 HTTP 调用到 `/api/agent/burner/panel-event`，本 sprint 的 `target_environment=local_api`（ubuntu-latest CI，Node+Postgres）**无法验证**（无真实 Android 设备/无法编译运行 Kotlin/Android 代码）。本清单登记为 **logic-done-pending**：服务端接口契约、看门狗计算、桥接、前端渲染均可真实验证；唯独"安卓真机确实按状态机节奏调用该接口"这一段留待 Android 真机通道（xian-rog nightly，参照 golden-path-2-smoke.sh 现有 TODO(android-evaluator-channel) 惯例）接管复跑。补位计划：待 Android 真机 TARGET_ENV 通道落地后，在 `AgentService.kt` 消费广播处插入真实 HTTP 调用，并新增 xian-rog workflow 复跑本合同 Step 1/2/4/5 的真机等价段。
- **`services/agent` 桥接轮询器的真实生产环境端到端行为未覆盖**：桥接模块的单测（Step 6）只验证"给定 mock fetch 响应，真实 bus.ingest() 后状态正确"，不验证桥接模块部署到真实 xian-rog/客户机上、真的按轮询周期打到生产中台 API、拿到真实数据这一整条链路——CI 沙箱无法起两个跨主机进程模拟"中台+本机Agent"的真实网络拓扑。补位计划：随刀1 已有的 `e2e-wechat-rpa.yml`/后续 line02 专属 workflow 补充桥接真实运行的验证。
- **WebView2 壳真实视觉渲染未覆盖**：沿用刀1 `agent-panel-host-build.yml` 已声明的范围限定（"只做编译检查+纯逻辑单测，不做真实窗口创建/热键注册/WebView2渲染的运行时验证"），本 sprint 不新增运行时 UI 验证，只新增 React 组件层单测。

## 铁律清单 → DoD Invariant 覆盖

- [x] [BEHAVIOR] INV-1（租户隔离）：新端点写入的 `tenant_id` 必须是服务端反查值，跨 tenant 的 `panel-active-tasks` 查询互不可见（见 contract-dod.md INV-1）
- [x] [BEHAVIOR] INV-2（端点鉴权）：`POST /api/agent/burner/panel-event` 缺 agent_id 拒绝写入；`GET /api/agent/burner/panel-active-tasks` 缺 X-Tenant-Id 拒绝读取（见 contract-dod.md INV-2）
- [x] [BEHAVIOR] INV-3（测试默认多租户）：contract-dod.md INV-3 断言两个不同 tenant 各自建 agent，写入 panel_events 后互不可见
- N/A [日志脱敏]：本 sprint 无客户聊天内容/PII 落日志（panel_events 只存任务标题/设备型号/进度，非隐私内容）
- N/A [凭据安全]：本 sprint 无新增 secrets
- [x] [BEHAVIOR] INV-6（禁止写死环境假设值）：3分钟阈值必须是命名常量（如 `PANEL_LINE02_STUCK_THRESHOLD_MS`），contract-dod.md INV-6 grep 断言禁止裸魔法数
- [x] [BEHAVIOR] INV-7（真环境验证才算done）：见"未覆盖真实链路清单"，Android 真机段标 logic-done-pending
- [x] [BEHAVIOR] INV-8（多设备类型UI区分）：见 Step 7/8，line02 与 line04 泳道物理隔离 + 同型号设备不合并

## E2E 验收

**journey_type**: user_facing
**target_environment**: local_api

> **Round 2 修订说明**（Reviewer round1 阻塞问题2）：round1 误套全局"UI→windows_cloud"规则；本 sprint 只碰 apps/agent-panel(React/jsdom)、services/agent(Node)、apps/api(Node+Postgres)，不涉及 apps/agent-panel-host 的 WebView2/WPF 原生渲染层（那才是 windows_cloud 的适用对象）。golden-path-2-smoke.sh 实际由 `ci-l4-e2e-smoke.yml` 的 `smoke-api-contract` job（`runs-on: ubuntu-latest`，起 postgres service）与 `ci-smoke-glob-runner.yml`（同为 `ubuntu-latest`）调用。下方脚本按 `target_environment=local_api` 的 curl+psql 全程链路模板编写，真实执行环境是 Linux CI 容器内的 Node+Postgres，不是 Windows。

```bash
#!/bin/bash
# final-e2e 验证脚本 — local_api（ubuntu-latest CI，Node+Postgres，golden-path-2-smoke.sh 实际运行环境）
# 本脚本验证 Step 1-5/8（后端 panel_events 写入+看门狗+多设备区分，curl+psql 全程真链路）
# 与 Step 6/7（services/agent 桥接 + apps/agent-panel 渲染，vitest(jsdom) 真跑，同一 ubuntu-latest job 内执行）
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
RND="$(date +%s)-$$"

psq() { psql "$DB_URL" -At -c "$1"; }

# 0. 建测试 tenant + agent（复用 golden-path-2-smoke.sh 惯用法）
TENANT_ID=$(psq "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('e2e-line02-${RND}', 'ZJ-F-e2e-${RND}', 'free') RETURNING id")
AGENT_ID=$(psq "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('${TENANT_ID}', 'e2e-android-${RND}', 'android-device', 'online') RETURNING id")

# 1. task_started
TID="e2e-scan-${RND}"
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"event\":\"task_started\",\"task_id\":\"${TID}\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"📱 RMX3478-b6ee 第1/3步\",\"progress\":[1,3]}")
echo "$RESP" | jq -e '.ok == true'
ROW=$(psq "SELECT tenant_id||'|'||event||'|'||line FROM zenithjoy.panel_events WHERE task_id='${TID}' AND created_at > NOW() - interval '5 minutes'")
[ "$ROW" = "${TENANT_ID}|task_started|line02" ]

# 2. step
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"event\":\"step\",\"task_id\":\"${TID}\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"📱 RMX3478-b6ee 第2/3步\",\"progress\":[2,3]}" \
  | jq -e '.ok == true'

# 3. 看门狗 stuck（时间窗口回填）
STUCK_TID="e2e-stuck-${RND}"
psq "INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at) VALUES ('${TENANT_ID}', '${STUCK_TID}', 'task_started', 'line02', 'RMX3478-c3d4', 'x', '[1,3]', NOW() - interval '4 minutes')" > /dev/null
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
echo "$RESP" | jq -e --arg tid "$STUCK_TID" '.activeTasks[] | select(.task_id==$tid) | .state == "stuck"'

# 4. done
DONE_TID="e2e-done-${RND}"
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"event\":\"task_started\",\"task_id\":\"${DONE_TID}\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"event\":\"done\",\"task_id\":\"${DONE_TID}\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"完成\"}" | jq -e '.ok==true'
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
echo "$RESP" | jq -e --arg tid "$DONE_TID" '.recentCompleted[] | select(.task_id==$tid) | .state == "done"'

# 5. failed 带 error_code
FAIL_TID="e2e-fail-${RND}"
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"event\":\"failed\",\"task_id\":\"${FAIL_TID}\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"失败\",\"detail\":\"OPEN_PANEL_FAILED\",\"severity\":\"error\"}" \
  | jq -e '.ok==true'
ROW=$(psq "SELECT detail||'|'||severity FROM zenithjoy.panel_events WHERE task_id='${FAIL_TID}' AND event='failed' AND created_at > NOW() - interval '5 minutes'")
[ "$ROW" = "OPEN_PANEL_FAILED|error" ]

# 8. 多设备物理隔离
DEV2_AGENT=$(psq "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('${TENANT_ID}', 'e2e-android2-${RND}', 'android-device-2', 'online') RETURNING id")
DEV2_TID="e2e-dev2-${RND}"
curl -sf -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${DEV2_AGENT}\",\"event\":\"task_started\",\"task_id\":\"${DEV2_TID}\",\"line\":\"line02\",\"device\":\"RMX3478-a1f2\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
D1=$(echo "$RESP" | jq -r --arg tid "$TID" '.activeTasks[] | select(.task_id==$tid) | .device')
D2=$(echo "$RESP" | jq -r --arg tid "$DEV2_TID" '.activeTasks[] | select(.task_id==$tid) | .device')
[ "$D1" != "$D2" ]

# 6+7：桥接 + 前端渲染 vitest 真跑
(cd services/agent && npx vitest run src/shared/__tests__/panel-line02-bridge.test.ts --reporter=verbose)
(cd apps/agent-panel && npx vitest run src/components/ExpandedPanel.test.tsx src/components/CollapsedStrip.test.tsx --reporter=verbose)

# 清理
psq "DELETE FROM zenithjoy.panel_events WHERE tenant_id='${TENANT_ID}'" > /dev/null
psq "DELETE FROM zenithjoy.agents WHERE tenant_id='${TENANT_ID}'" > /dev/null
psq "DELETE FROM zenithjoy.tenants WHERE id='${TENANT_ID}'" > /dev/null

echo "✅ Golden Path 验证通过（Android 真机段见未覆盖真实链路清单，logic-done-pending）"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| POST /api/agent/burner/panel-event + GET /panel-active-tasks | `tests/panel-event-line02.integration.test.ts` | 写入line02任务事件成功 / task_started写入panel_events / progress字段正确写入 / 3分钟无新事件state变stuck / 新事件到达后自动脱离stuck / done事件后从activeTasks消失 / failed事件detail携带error_code / 跨租户互不可见 / 同型号设备不合并 | → N failures（端点不存在，404） |
| services/agent 桥接 | `tests/panel-line02-bridge.test.ts` | 桥接模块真实调用bus.ingest / CONNECTED_LINES包含line02 | → 文件不存在，import error |
| apps/agent-panel 渲染回归 | `tests/agent-panel-line02-lane.test.tsx` | lane-line02与lane-line04物理隔离 / 设备名格式正确显示 | → 断言待新增测试点验证（现有渲染逻辑已支持，新增测试锁定回归） |

（本合同无 HTTP 响应缺失场景——新端点均已在上方"Response Schema"性质段落定义完整）
