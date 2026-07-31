# Sprint Contract Draft (Round 3)

sprint: `07310943-kernel-0e82adad`
task_id: `e76cb826-7fbf-45bd-b94d-75793edc2f33`
journey_id: `afa6abca-53c0-4815-8594-b7fb81ca547f`
step_id: `step6`

## 技术上下文与推导

- `api_registry` 可用，但没有命中获客取消端点；现有代码 `apps/api/src/routes/acquisition.ts` 使用统一信封 `{success,data,timestamp}` / `{success,error:{code,message},timestamp}`，本合同沿用。
- `db_schema` registry 未返回 `zenithjoy.acquisition_collect_tasks`；直接读取迁移确认现有状态值含 `pending/running/cancelling/cancelled/done/stage_1_done/partial/failed`，不新增同义状态。
- `test_registry` 与仓库测试共同确认 integration 测试风格为 `vitest + supertest + 真 Postgres`，Android 为 JUnit/Kotlin。
- `context-manifest: unavailable`；PRD 已内嵌累积 FR，合同按 PRD 字面保留。
- `contract-gate: skipped (file not found, third-party repo)`。
- 产品分类锚点来自 `product-map/generated/product-map.md`：`customer_app / line02 / keyword_acquisition`。

## 已知约束（来自回归测试与累积 FR）

- `[apps/api/src/services/acquisition-collect.test.ts]` → `cancelling → cancelled 落章（修 cancelled 永不落章 bug）`。
- `[apps/api/src/routes/acquisition.test.ts]` → `查任务表时必须带自己的 tenant_id + agent_id 条件（防跨租户/跨机器抢占）`。
- `[apps/api/src/routes/acquisition.test.ts]` → `tenant-A 的 agent 轮询时，只能捞到 tenant-A 自己的任务（不是全平台任务）`。
- `[apps/api/src/routes/acquisition.test.ts]` → `cancelling 任务回报 → 落章 cancelled，不写 leads`。
- `[services/agent-android/.../AcquisitionCollectPollLoopTest.kt]` → `pollOnce_cancellingStatus_invokesOnCancelOnly`；该测试只验回调，尚未证明正在执行的状态机被安全终止。
- `[apps/dashboard/e2e/acquisition-tasks-collect-start.spec.ts]` → `填关键词点开始采集，真实调用collect/start且body.keywords正确`；该存量 spec 使用 `page.route()`，不能充当本 sprint 的真实后端验收。
- `[累积FR]` 视频/图文判定与留言触达链已验收；取消不得回滚已采集数据，也不得触发新的采集/触达。
- `context-manifest: unavailable`。

## Response Schema（推导来源: 既有 API 信封 + PRD 字面 + [NEW_PATTERN]）

### Endpoint: POST `/api/acquisition/collect/cancel`

生产 Dashboard 请求必须依赖 better-auth session；测试兼容通道使用 `X-Feishu-User-Id`。请求 body 只含：

```json
{"task_id":"<uuid>"}
```

禁止从 body 接受 `tenant_id`，租户只由认证上下文解析。

**Success (HTTP 200)**:

```json
{"success":true,"data":{"task_id":"<uuid>","status":"cancelling","cancel_phase":"requested"},"timestamp":"<ISO-8601>"}
```

- `task_id` (string, 必填)：沿用既有任务字段。
- `status` (string, 必填)：PRD 字面状态 `cancelling`。
- `cancel_phase` (`requested|sent|confirmed`, 必填)：`[NEW_PATTERN]`，用于区分“取消中 / 指令已发送 / 已取消”。
- 重复请求返回 200，`cancel_phase` 为当前真实阶段，不生成第二条命令、不修改原 `cancel_requested_at`。
- 禁用 response 字段：`tenant_id`、`device_id`、`paused`、`resumable`。

**Error**:

```json
{"success":false,"error":{"code":"FORBIDDEN|TASK_NOT_CANCELLABLE","message":"<string>"},"timestamp":"<ISO-8601>"}
```

- 跨租户严格按冻结 PRD Final E2E 返回 `403 FORBIDDEN`，响应不得携带任务、租户或设备字段；不存在任务仍沿用现有 404。
- 已结束或不支持放弃的状态返回 `409 TASK_NOT_CANCELLABLE`，不改变既有终态。

### Endpoint: GET `/api/acquisition/collect-tasks`

现有 task 条目增加：

```json
{"id":"<uuid>","status":"cancelling|cancelled","cancel_phase":"requested|sent|confirmed|null","cooldown_remaining_seconds":0}
```

- `cancel_phase=requested`：取消意图已持久化，尚未被 Agent 心跳取走。
- `cancel_phase=sent`：指令已由心跳下发，尚未收到 Agent 回执；超过 2 分钟仍保持该值。
- `cancel_phase=confirmed` 且 `status=cancelled`：只在 Agent 回执后出现。
- `cooldown_remaining_seconds` 为服务端时钟计算的 `0..300` 整数。

### Endpoint: POST `/api/agent/heartbeat`

请求与生产 `HttpHeartbeatLoop.kt` 一致：

```json
{"license":"<license-key>","version":"<version>","hostname":"<hostname>","os_type":"android","agent_id":"<runtime-id>","agent_uuid":"<uuid>","machine_id":"<stable-id>"}
```

取消指令沿用现有 `queued_tasks` 形状：

```json
{"task_id":"<command-uuid>","platform":"android","type":"acquisition_cancel","payload":{"collect_task_id":"<uuid>"}}
```

同一 `collect_task_id` 最多一条活动取消指令。指令被本次心跳返回时，服务端原子写 `cancel_sent_at`，前台才显示“取消指令已发送，等待设备响应”。

### Endpoint: POST `/api/acquisition/collect/report`

Android 生产调用方继续使用 `x-agent-id` header，body 沿用 `CollectReporter.reportCancel()`：

```json
{"task_id":"<uuid>","video_id":"cancelled_<task-prefix>","commenters":[],"checkpoint":{"last_video_id":null,"processed_video_ids":[]},"terminal":true,"partial_reason":"user_cancelled"}
```

成功必须返回 `data.status="cancelled"`；只有绑定到该任务的 Agent 可落章。服务端在同一事务写 `cancelled_at` 与 `ended_at`，冷却从 `cancelled_at` 开始。

### Endpoint: POST `/api/acquisition/collect/start`

同设备仍在冷却期时：

```json
{"success":false,"error":{"code":"DEVICE_CANCEL_COOLDOWN","message":"设备冷却中","remaining_seconds":287},"timestamp":"<ISO-8601>"}
```

`remaining_seconds` 必须为服务端时间计算的 `1..300`；期满后沿用既有成功 schema `{task_id,status:"pending"}`。

## 真实调用方请求 shape

1. Dashboard 生产调用方 `AcquisitionTasksPage.tsx` 使用相对 URL、浏览器 session cookie、`Content-Type: application/json`；取消 body 只传 `task_id`。合同禁止测试用 body `tenant_id` 走另一条路径。
2. Android `HttpHeartbeatLoop.kt` 真实调用 `POST /api/agent/heartbeat`，认证在 body `license`，并携带 `version/hostname/os_type/agent_id/agent_uuid/machine_id`；响应解析字段为 `task_id/platform/type/payload`。
3. Android `CollectReporter.kt` 真实回执调用 `POST /api/acquisition/collect/report`，认证为 header `x-agent-id`，其值是运行期 `AgentConfig.agentId`，对应 DB `agents.agent_id` 文本 slug；body 使用 `task_id/video_id/commenters/checkpoint/terminal/partial_reason`。DoD 的成功路径必须逐字段复用且发送文本 slug，禁止用 DB UUID 兼容旁路冒充生产调用方，也禁止改为 body `tenant_id`。

## 禁 mock 边清单

- Dashboard 放弃动作 ↔ `POST /api/acquisition/collect/cancel`（Playwright 必须打真实 API，禁止 `page.route()`）。
- cancel route ↔ `zenithjoy.acquisition_collect_tasks` 与 `zenithjoy.publish_tasks`（状态机、幂等与命令入队必须真 Postgres）。
- `POST /api/agent/heartbeat` ↔ `getQueuedTasks` ↔ Android `HttpHeartbeatLoop` 请求/响应 shape（真相邻模块，不 mock heartbeat service）。
- Android 取消协调器 ↔ 当前 `CollectTaskQueue` / 正在运行的 `DouyinCollectService` / 切换账号面板清理（不得只 mock 一个成功回调）。
- Android `CollectReporter` ↔ 服务端 `/collect/report` ↔ DB 终态与冷却时间（真 HTTP + 真 Postgres）。

## Golden Path

覆盖父路 `keyword_acquisition` 第 6-7 步的运行中采集善后路径。

[客户看到运行中任务] → [点击放弃并进入取消中] → [心跳下发取消指令] → [Android 安全退出并回执] → [服务端确认 cancelled] → [冷却 5 分钟后允许重启]

### Step 1: 只给本人租户的运行中单设备任务显示“放弃”

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1、租户边界条件。

**可观测行为**: Dashboard 任务行在 `running` 时显示“放弃”；其他租户不可见；已结束任务无可用按钮。

**验证命令**: `pwsh -NoProfile -File sprints/07310943-kernel-0e82adad/e2e-verify.ps1 -Scenario list`

**硬阈值**: 两租户真实种数；租户 A 只见 A 任务；放弃按钮可见且可用；租户 B 不见任务 ID。命令非 0 即失败。

### Step 2: 点击放弃，立即进入 requested 且重复点击幂等

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 2 与“重复点击不产生第二次取消”。

**可观测行为**: 点击后 UI 显示“取消中”，按钮置灰；API 只写一次取消意图和一条命令。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "本人租户取消|重复取消幂等"`

**硬阈值**: HTTP 200；`status=cancelling`；`cancel_phase=requested`；命令数恒为 1；`cancel_requested_at` 不变。

### Step 3: 下一次生产形状心跳在 30 秒内下发取消指令

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 3 与 NFR“最长 30 秒”。

**可观测行为**: Android 下一个 heartbeat 的 `queued_tasks` 出现唯一 `acquisition_cancel`；服务端记录 `cancel_sent_at`；前台显示“取消指令已发送，等待设备响应”。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "下一次生产形状 heartbeat|Agent 离线期间保留取消意图"`

**硬阈值**: 30 秒内出现 1 条且仅 1 条命令；shape 与“真实调用方请求 shape”逐字段一致；未出现或重复出现即失败。

### Step 4: Android 中断当前采集并安全退出后才回执

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 4。

**可观测行为**: 取消必须抢占当前 Stage1/Stage2 job，而不是排在当前 job 后面；停止继续读取列表，关闭半开的切换账号面板，清空/终止对应任务后调用 `reportCancel`。

**验证命令**: `cd services/agent-android && ./gradlew testDebugUnitTest --tests '*AcquisitionCancellationCoordinatorTest*'`

**硬阈值**: 当前 job 在回执前已停止；面板状态 closed；取消后没有新的采集 callback；同一取消重复两次均通过。只验证回调被调用不算通过。

### Step 5: 只有 Agent 回执才能落 cancelled

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 5、边界“2 分钟仍无回执不得显示已取消”。

**可观测行为**: `cancel_sent_at` 已超过 2 分钟但无回执时仍为 `cancelling/sent`；绑定 Agent 以真实 `x-agent-id` 回执后，原子落 `cancelled/confirmed`。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "取消指令发出 121 秒|只有绑定 Android Agent 回执|重复 cancelled 回执"`

**硬阈值**: 无回执永不自动转终态；错误 Agent 回执 403；生产文本 `x-agent-id` 回执后 `status=cancelled`，且 `cancelled_at/ended_at` 均不早于本次回执开始时刻。

### Step 6: 确认后进入同设备 5 分钟冷却，期满恢复

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 6。

**可观测行为**: 冷却从 `cancelled_at` 起算；同 `agent_id` 新任务在 300 秒内被 409 拒绝并显示剩余秒数；301 秒后成功。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "冷却期内同设备"`

**硬阈值**: `1 <= remaining_seconds <= 300`；重复 cancel 不延长；期满返回 `status=pending`。

## 两层验证与接缝清单

- 逻辑层（L2）：Windows CI 启真 Postgres、真 API、真 Dashboard，跑 integration + Playwright；不使用 `page.route()`。
- 接缝 1 `[接缝×2]`：Dashboard 浏览器 session → API → DB；在 windows_cloud 连跑两次，截图与 DB 行留证。
- 接缝 2 `[接缝×2]`：服务端心跳命令 → Android 真机抢占 → 安全退出 → 回执；由 xian-rog workflow 连跑两次，两次结论不一致即 FLAKY。
- 接缝 3：ZJ staging 真实部署与预览；未获主理人 approval 前不得 prod promote。
- Android 真机验收前状态为 `logic-done-pending`，不得标 done。

## 未覆盖真实链路清单

- Android 真机通道已存在 `.github/workflows/e2e-line02-android-collect.yml`，但当前 workflow 只有采集场景，没有 `scenario=cancel` 输入，也没有安全退出证据产物；在 Generator 补齐并由 xian-rog 连续执行两次前，该段为 `logic-done-pending`。
- 现有 Windows orphan workflow 的获客 spec 使用 `page.route()`，不能覆盖本合同；必须新增真实后端 cancel spec 与 workflow step。
- 本合同不使用 `force_*`、stub 或假第三方数据作为最终 oracle；单元测试允许隔离无关 UIA 系统服务，但不得 mock“取消协调器 ↔ 当前采集服务”的被改边。

## CI Workflow 用户路径 1:1 映射

已读取：

- `.github/workflows/e2e-orphan-consolidation-windows.yml`：启动 Vite，但不启动真实 API，现有获客 spec 使用 `page.route()`；`[CI_GAP: 放弃按钮→真实取消 API→DB 状态→冷却提示全链缺失]`。
- `.github/workflows/e2e-line02-android-collect.yml`：xian-rog 真机仅运行采集 smoke；`[CI_GAP: heartbeat 取消指令、抢占、安全关面板、cancelled 回执证据缺失]`。

Generator 必须补齐的用户路径：

1. Windows：启动 Postgres → migrate → 启 API 3000 → Vite 5174 指向真实 API → 两租户登录态 → 打开任务页 → 点击放弃 → 观察 requested/sent/confirmed → 验冷却提示与期满恢复。
2. Android：真 heartbeat 取 `acquisition_cancel` → 真正在跑的采集被抢占 → UIA 验切换账号面板关闭且列表不再读取 → 真 `/collect/report` 回执 → 输出 JSON 证据。
3. 任一步只查文件存在、版本号或 HTTP 200，不算业务行为验证。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing  
**target_environment**: windows_cloud

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${SPRINT_DIR:=sprints/07310943-kernel-0e82adad}"
: "${GITHUB_REF_NAME:?GITHUB_REF_NAME required}"
: "${GH_REPO:=perfectuser21/zenithjoy-workspace}"
test "${RUNNER_OS:-}" = "Windows" || { echo "FAIL: windows_cloud runner required"; exit 1; }
pwsh -NoProfile -File "$SPRINT_DIR/e2e-verify.ps1" -BaseUrl "http://localhost:5174" -ApiUrl "http://localhost:3000" -ScreenshotDir "$SPRINT_DIR/screenshots"
for ATTEMPT in 1 2; do
  gh workflow run e2e-line02-android-collect.yml --repo "$GH_REPO" --ref "$GITHUB_REF_NAME" -f scenario=cancel -f smoke_kw=装修
  sleep 5
  RUN_ID=$(gh run list --repo "$GH_REPO" --workflow e2e-line02-android-collect.yml --branch "$GITHUB_REF_NAME" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
  test -n "$RUN_ID" || { echo "FAIL: Android run id missing"; exit 1; }
  for POLL in $(seq 1 144); do
    STATUS=$(gh run view "$RUN_ID" --repo "$GH_REPO" --json status --jq '.status')
    test "$STATUS" = "completed" && break
    test "$POLL" -lt 144 || { echo "FAIL: Android run timeout"; exit 1; }
    sleep 5
  done
  CONCLUSION=$(gh run view "$RUN_ID" --repo "$GH_REPO" --json conclusion --jq '.conclusion')
  test "$CONCLUSION" = "success" || { echo "FAIL: Android cancel run=$RUN_ID conclusion=$CONCLUSION"; exit 1; }
  OUT="$SPRINT_DIR/evidence/android-$ATTEMPT"
  mkdir -p "$OUT"
  gh run download "$RUN_ID" --repo "$GH_REPO" --name android-cancel-evidence --dir "$OUT"
  jq -e '.command_type=="acquisition_cancel" and .safe_exit==true and .switch_account_panel_open==false and .continued_list_reads==0 and .report_status=="cancelled"' "$OUT/result.json"
done
test -s "$SPRINT_DIR/screenshots/staging-cancel-requested.png"
test -s "$SPRINT_DIR/screenshots/staging-cancel-confirmed.png"
echo "OK: windows_cloud UI/API + Android real-machine cancel x2"
```

`e2e-verify.ps1` 硬要求：

- `Start-Process` 启真实 `apps/api`，端口 3000；`Test-NetConnection` 等待就绪。
- Vite 固定 5174，`VITE_API_URL=http://localhost:3000`；不得设置除 `VITE_SKIP_AUTH=true` 外的 mock 变量。
- Playwright spec `apps/dashboard/e2e/acquisition-cancel.spec.ts` 禁止 `page.route()`，用两个真实租户、真实 DB fixture。
- 截图写 `${SPRINT_DIR}/screenshots/staging-cancel-requested.png`、`staging-cancel-sent.png`、`staging-cancel-confirmed.png`、`staging-cancel-cooldown.png`。
- 任何 API、DB、DOM 或真机证据缺失均 exit 非 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:

- 错输入: `POST /api/acquisition/collect/cancel` 传非 UUID、缺 task_id、额外 tenant_id。
- 重复提交: 双击“放弃”、并发发 10 个相同 cancel、Agent 重复 heartbeat/重复回执。
- 中途中断: cancel requested 后 Agent 离线再上线；Android 正在切换账号面板时杀进程/重启服务。
- 边界值: `cancel_sent_at` 恰好 120 秒、`cancelled_at` 恰好 300 秒、服务端时钟跨秒。
- 发现分级: P0/P1（跨租户、假 cancelled、面板残留继续操作、冷却绕过）阻塞 merge；P2/P3 记 findings。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能承诺 | 前台不可逆放弃单设备运行中获客任务，真机退出回执后确认，随后 5 分钟冷却 |
| **NFR（做得多好）** | 延迟/可靠性 | 取消指令最长 30 秒随 heartbeat 下发；2 分钟无回执不假成功；重复请求幂等 |
| **Invariant（永不违反）** | 安全/一致性 | 租户隔离；只有绑定 Agent 回执可落终态；不回滚已采数据；无暂停/恢复语义 |
| **判定点（怎么知道）** | 现实判断 | 见下表 |
| **保质期（何时过期）** | 数据/能力 | 取消命令到 `cancelled` 后失活；冷却精确 300 秒；旧 Agent 不识别指令时保持等待 |
| **死亡告警（停了谁知道）** | 告警 | 指令 sent 超 2 分钟未回执写结构化告警并在 UI 保持等待；值班从 CI/真机 workflow 与服务告警得知 |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义表；核心原则 fail closed，不把 sent 当 cancelled |
| **效果确认（已发≠已生效）** | 回执 | heartbeat 返回只算 sent；Android 安全退出后真实 `/collect/report` 回执并落 DB 才算 confirmed |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Android 是否已安全退出采集 | A. 收到 cancel callback；B. 队列无 current job；C. 取消协调器确认采集服务停止、切换面板关闭、无后续读取后再回执 | C | PRD 明确要求安全退出且不能留下半开面板/继续读取；A/B 都可能过早 | 直接面客错误、账号误操作、前台假显示已取消 |
| 取消指令是否已发送 | A. 入库即 sent；B. heartbeat 真正取出命令并原子写 cancel_sent_at | B | “指令已发送”必须对应真实调用方已取走，不是排队 | 前台误报设备已收到 |
| 冷却起点 | A. cancel requested；B. cancel sent；C. Agent confirmed cancelled | C | PRD 假设明确 | 冷却提前耗尽，设备未退出即重派 |

notes: `judgment-pending-user: Android 是否已安全退出采集`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 未登录/跨租户取消 | 未登录 401；跨租户按冻结 PRD 返回不泄露数据的 403，不写库 | 是 | 无 |
| 已终态任务取消 | 409，不改终态 | 是 | UI 显示明确提示并刷新 |
| Agent 离线 | 保留 requested；恢复 heartbeat 后下发 | 是，唯一命令键为 collect_task_id | 不自动 cancelled |
| sent 超 2 分钟无回执 | 维持 cancelling/sent 并告警 | 是 | 用户看到“等待设备响应” |
| Agent 安全退出失败 | 不回执 cancelled；保留 cancelling 并上报失败证据 | 可重试取消 | 人工处理设备，不自动重派 |
| 重复回执 | 第一次原子落章，后续返回当前终态且不延长冷却 | 是 | 无 |
| 冷却期新任务 | 409 + remaining_seconds | 是 | 客户端倒计时，期满重试 |

### 输入对抗面

N/A：本任务没有对外暴露可接受 prompt/自然语言任务的 agent；Dashboard 参数按 UUID/schema 校验，Android 是受控生产客户端。

## staging 预览闸

### 步骤 A：落 staging

使用现有 `.github/workflows/deploy-staging-hk.yml` 将合同实现部署到 `https://staging-autopilot.zenjoymedia.media`；禁止重造部署脚本。Dashboard staging URL 使用现有 ZJ staging 配置。

### 步骤 B：Final E2E 在 staging 跑并截图

在 staging 用两租户真实 fixture 跑 `apps/dashboard/e2e/acquisition-cancel.spec.ts`，截图保存到 `${SPRINT_DIR}/screenshots/staging-<step>.png`。Android xian-rog 对 staging API 连跑两次，证据归档到 `${SPRINT_DIR}/evidence/`。

### 步骤 C：Bark 推主理人预览链接（ZenithJoy 阻塞式）

向 `$BARK_URL` 发送 staging 链接、截图 URL、Android 两次 run URL，并注明“需主理人放行”。PATCH Brain task metadata：

```bash
: "${BARK_URL:?}" "${STAGING_DASHBOARD_URL:?}" "${TASK_ID:?}"
curl -sf -X POST "$BARK_URL" -H 'Content-Type: application/json' -d "{\"title\":\"ZenithJoy staging 待预览\",\"body\":\"需主理人放行：$STAGING_DASHBOARD_URL；截图与 Android x2 证据见 Sprint artifacts\"}" | jq -e .
curl -sf -X PATCH "http://localhost:5221/api/brain/tasks/$TASK_ID" -H 'Content-Type: application/json' -d "{\"metadata\":{\"staging_deployed\":true,\"approval_required\":true,\"staging_url\":\"$STAGING_DASHBOARD_URL\"}}" | jq -e .
curl -sf "http://localhost:5221/api/brain/tasks/$TASK_ID" | jq -e '.decisions.approval=="approved" or .metadata.approval_granted==true'
```

最后一条命令是 prod promote 的阻塞闸；未放行时 `jq -e` 必须非 0，禁止 promote。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（必须是 it() 名子串） | 预期红证据 |
|---|---|---|---|
| 认证取消与 schema | `tests/acquisition-cancel.integration.test.ts` | `本人租户取消 running 任务返回 cancelling` | 当前 route 读 body tenant_id，返回 400 |
| 租户隔离 | 同上 | `跨租户取消返回 403 FORBIDDEN` | 当前 route 接受 body tenant_id，尚未按认证租户给出 403 |
| 心跳下发 | 同上 | `下一次生产形状 heartbeat 只下发一条` | 当前未向 publish_tasks 入 cancel command |
| 幂等 | 同上 | `重复取消幂等且不生成第二条指令` | 当前无 cancel_requested_at/唯一命令 |
| 回执终态 | 同上 | `只有绑定 Android Agent 回执后才落 cancelled` | 当前无 cancelled_at |
| 冷却 | 同上 | `冷却期内同设备新任务返回 DEVICE_CANCEL_COOLDOWN` | 当前 start 无冷却闸 |
| 离线恢复 | 同上 | `Agent 离线期间保留取消意图` | 当前没有取消命令恢复下发合同 |
| 非法状态 | 同上 | `已结束任务返回 409 TASK_NOT_CANCELLABLE` | 当前 cancel route 未按认证租户和可取消状态收敛 |
| 超时不假成功 | 同上 | `取消指令发出 121 秒无回执仍保持 cancelling sent` | 当前详情 response 无 cancel_phase |
| 重复回执 | 同上 | `重复 cancelled 回执幂等且不延长五分钟冷却起点` | 当前回执可能重写冷却起点 |

## Notes

- PRD 指定 `target_environment=windows_cloud`，合同保持该路由；Android 真实接缝由独立 xian-rog workflow 补位，并在未跑前保持 `logic-done-pending`。
- 本 sprint 不引入暂停、恢复、批量取消或已采数据回滚。
- `contract-gate: skipped (file not found, third-party repo)`。
- Round 3 收敛：所有带 `-t` 的 integration oracle 改为可独立建任务并完成前置状态，不再依赖测试声明顺序；取消回执成功路径固定使用生产 `agents.agent_id` 文本 slug；超时查询复用 PRD 已定义的 `/collect-tasks`，不新增详情端点。
