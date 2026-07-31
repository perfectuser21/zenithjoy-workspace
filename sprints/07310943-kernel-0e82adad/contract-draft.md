# Sprint Contract Draft (Round 12)

sprint: `07310943-kernel-0e82adad`
task_id: `e76cb826-caaf-404b-b853-845e107408b5`
journey_id: `afa6abca-53c0-4815-8594-b7fb81ca547f`
step_id: `step6`

## 技术上下文与推导

- `api_registry` 未命中获客取消端点；沿用 `apps/api/src/routes/acquisition.ts` 的 `{success,data,timestamp}` / `{success,error,timestamp}` 信封。
- `db_schema` registry 未返回业务 schema；迁移与生产调用方确认稳定设备身份是 Android 注册/心跳的 `machine_id`，不是会重注册变化的 `agent_id/agent_uuid`。
- `test_registry` 与仓库测试约定为 Vitest + Supertest + 真 Postgres，Android 为 Kotlin/JUnit；本合同 failing test 不 mock 被改边。
- `context-manifest: unavailable`；冻结 PRD 已内嵌累积 FR。
- `contract-gate: skipped (file not found, third-party repo)`。
- `product-map/generated/product-map.md` digest `fbea3a9e...` 将本路锚定为 `customer_app / line02 / keyword_acquisition`；安装锁定依赖后 `npm run product-map:check` 通过，分类 SSOT 无漂移。

## 已知约束（来自回归测试与累积 FR）

- `[apps/api/src/services/acquisition-collect.test.ts]` → `cancelling → cancelled 落章`。
- `[apps/api/src/routes/acquisition.test.ts]` → 任务领取与回执必须同时限制租户和绑定设备。
- `[services/agent-android/.../AcquisitionCollectPollLoopTest.kt]` → `pollOnce_cancellingStatus_invokesOnCancelOnly` 只证明回调，不证明运行中状态机安全退出。
- `[apps/dashboard/e2e/acquisition-tasks-collect-start.spec.ts]` → 现有 spec 使用 `page.route()`，不能作为本 sprint 的真实链证据。
- `[累积FR]` 取消不得回滚已采数据，也不得继续触发新的采集或触达。
- `context-manifest: unavailable`。

## Response Schema（推导来源: PRD 字面 + 既有 API 信封 + [NEW_PATTERN]）

### POST `/api/acquisition/collect/cancel`

Dashboard 使用浏览器 session；body 字面为 `{"task_id":"<uuid>"}`，禁止 body 接受 `tenant_id`。

成功 HTTP 200：

```json
{"success":true,"data":{"task_id":"<uuid>","status":"cancelling","cancel_phase":"requested|sent"},"timestamp":"<ISO-8601>"}
```

- 首次请求为 `requested`；重复请求返回当前真实阶段且不改首次时间、不新增指令。
- 禁用字段：`tenant_id`、`device_machine_id`、`agent_id`、`paused`、`resumable`。

防枚举错误 HTTP 403：

```json
{"success":false,"error":{"code":"FORBIDDEN","message":"无权操作该采集任务"},"timestamp":"<ISO-8601>"}
```

- 跨租户真实 UUID 与随机不存在 UUID 必须返回完全相同的 HTTP 状态、error code、message 和顶层 keys；不得以 403/404 差异泄露任务存在性。
- 本租户已终态任务返回 HTTP 409 `TASK_NOT_CANCELLABLE`，不改变终态。

### GET `/api/acquisition/collect-tasks`

```json
{"id":"<uuid>","status":"cancelling|cancelled","cancel_phase":"requested|sent|confirmed|null","cooldown_remaining_seconds":0}
```

- `sent` 只在真实 heartbeat 取走指令并原子写 `cancel_sent_at` 后出现。
- `confirmed/cancelled` 只在绑定设备安全退出回执后出现。
- `cooldown_remaining_seconds` 是服务端时钟计算的整数 `0..300`。

### POST `/api/agent/heartbeat`

生产 Android 请求：

```json
{"license":"<license-key>","version":"<version>","hostname":"<hostname>","os_type":"android","agent_id":"<runtime-id>","agent_uuid":"<uuid>","machine_id":"<stable-device-id>"}
```

响应中的取消指令：

```json
{"task_id":"<command-uuid>","platform":"android","type":"acquisition_cancel","payload":{"collect_task_id":"<uuid>"}}
```

服务端必须把本次通过 license 校验的 `machine_id` 快照到任务 `device_machine_id`。同一 `collect_task_id` 最多一条活动取消指令。

### POST `/api/acquisition/collect/report`

生产 `CollectReporter` 继续使用 header `x-agent-id: <runtime agent slug>`，body：

```json
{"task_id":"<uuid>","video_id":"cancelled_<task-prefix>","commenters":[],"checkpoint":{"last_video_id":null,"processed_video_ids":[]},"terminal":true,"partial_reason":"user_cancelled"}
```

成功响应必须含 `data.status="cancelled"`；服务端同一事务写首次 `cancelled_at` 与 `ended_at`，重复回执不得改首次时间。

### POST `/api/acquisition/collect/start`

同租户选择的目标 Agent 必须先解析到其 `license_machines.machine_id`；冷却查询键固定为 `(tenant_id, device_machine_id)`，严禁按 `agent_id/agent_uuid` 判定。冷却期返回：

```json
{"success":false,"error":{"code":"DEVICE_CANCEL_COOLDOWN","message":"设备冷却中","remaining_seconds":287},"timestamp":"<ISO-8601>"}
```

`remaining_seconds` 为 `1..300`；同一物理设备重装后换 runtime agent id 仍被拒绝，另一物理设备不受影响，301 秒后允许创建 `pending` 任务。

## 真实调用方请求 shape

1. Dashboard `AcquisitionTasksPage.tsx`：浏览器 session cookie + `Content-Type: application/json`，body 仅 `task_id`。
2. Android `HttpHeartbeatLoop.kt`：body license 认证并逐字携带 `version/hostname/os_type/agent_id/agent_uuid/machine_id`；其中 `machine_id` 是本合同冷却设备键。
3. Android `CollectReporter.kt`：header `x-agent-id` 是 `AgentConfig.agentId` 文本 slug；body 使用 `task_id/video_id/commenters/checkpoint/terminal/partial_reason`。

## 禁 mock 边清单

- Dashboard 放弃动作 ↔ 真实取消 API（Playwright 禁止 `page.route()`）。
- cancel/start/heartbeat/report routes ↔ 真 Postgres 的 `acquisition_collect_tasks`、`publish_tasks`、`license_machines`。
- heartbeat `machine_id` ↔ 任务 `device_machine_id` ↔ 冷却查询键。
- Android 取消协调器 ↔ 正在运行的采集状态机 ↔ 安全关闭切换账号面板 ↔ 真回执。

## Golden Path

覆盖父路 `keyword_acquisition` 第 6-7 步的运行中采集善后路径。

[本人租户看到 running 任务] → [点击放弃进入 requested] → [heartbeat 下发 sent] → [Android 安全退出并回执] → [confirmed/cancelled] → [同物理设备冷却 5 分钟]

### Step 1: 本人租户看到运行中任务并点击放弃

**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1-2 与租户边界。

**GAN 补充来源**: `[AI_ADDED]` — Round 11 Reviewer 指出 403/404 会泄露任务存在性，因此把“不得泄露”落成跨租户与不存在 UUID 的不可区分响应 oracle；不新增产品行为。

**可观测行为**: 本人 running 任务显示“放弃”；点击后立即显示“取消中”并禁用重复操作。跨租户 UUID 与不存在 UUID 均只得到同一个 403 信封。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "本人租户取消|跨租户与不存在任务"`

**硬阈值**: 本人请求 HTTP 200 且 `status=cancelling/cancel_phase=requested`；两种防枚举响应深相等。命令非 0 即失败。

### Step 2: 不可逆取消意图幂等持久化

**来源**: `[FROM_PRD]` — 重复点击不得产生冲突指令。

**可观测行为**: 并发/重复取消只保留首次 `cancel_requested_at` 与一条活动命令。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "重复取消幂等"`

**硬阈值**: 命令数恒为 1；首次时间不变；已终态返回 409 且状态不变。

### Step 3: 下一次生产心跳在 30 秒内下发唯一取消指令

**来源**: `[FROM_PRD]` — Golden Path 步骤 3 与 NFR 最长 30 秒。

**可观测行为**: 真实 heartbeat shape 得到唯一 `acquisition_cancel`；取走时写 `cancel_sent_at` 和稳定 `device_machine_id`，前台显示等待设备响应。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "heartbeat 下发唯一取消指令并快照稳定设备|取消接受到真实 heartbeat 响应的实测时延不超过 30 秒"`

**硬阈值**: 从 cancel HTTP 接受时间到生产 shape heartbeat 响应携带指令的实测时差 `<= 30000ms` 且 exactly 1；heartbeat 前 `device_machine_id/cancel_sent_at` 必须为 null，heartbeat 后 `device_machine_id` 才字面等于已认证 `machine_id`。

### Step 4: Android 抢占当前采集并安全退出

**来源**: `[FROM_PRD]` — Golden Path 步骤 4。

**可观测行为**: 取消抢占正在执行的采集；停止后续列表读取，关闭半开切换账号面板，然后才调用 `reportCancel`。

**验证命令**: `gh workflow run e2e-line02-android-collect.yml --repo perfectuser21/zenithjoy-workspace --ref "$GITHUB_REF_NAME" -f scenario=cancel -f repeat=2`

**硬阈值**: 两轮 evidence 均为 `safe_exit=true`、`switch_account_panel_open=false`、`continued_list_reads=0`、`report_status=cancelled`；不一致即 FLAKY。

### Step 5: 只有真实回执才落 confirmed/cancelled

**来源**: `[FROM_PRD]` — Golden Path 步骤 5 与“2 分钟无回执不假成功”。

**可观测行为**: sent 超 120 秒仍为等待；即使绑定 Agent 也不能在 heartbeat 真取走指令前回执成功；绑定 Agent 经过 heartbeat/sent 后回执才原子落终态；重复回执不改变首次 `cancelled_at`。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "121 秒无回执|绑定 Android Agent 回执|重复 cancelled 回执"`

**硬阈值**: heartbeat 前回执 409 `CANCEL_NOT_SENT` 且 DB 仍 cancelling；无回执永不自动 cancelled；错误 Agent 403；成功响应 `data.status=cancelled`。

### Step 6: 同一物理设备冷却 5 分钟

**来源**: `[FROM_PRD]` — Golden Path 步骤 6 与“按同一设备判定”。

**可观测行为**: 冷却从首次 `cancelled_at` 起算；同 `machine_id` 即使换新 runtime `agent_id` 仍被拒绝，另一 `machine_id` 可发起，期满恢复。

**验证命令**: `DATABASE_URL="$DATABASE_URL" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "稳定 machine_id 冷却"`

**硬阈值**: `1 <= remaining_seconds <= 300`；同机换 agent 不绕过；异机不误伤；301 秒后 `pending`。

## 两层验证与接缝清单

- 逻辑层 L2：真 Postgres + 真 Express routes 验状态机、租户、防枚举、稳定设备冷却。
- 接缝 1 `[接缝×2]`：Windows Chrome → 真 Dashboard → 真 API → 真 DB；现有 orphan workflow 必须增加 cancel spec、API/Postgres 启动与两次执行。
- 接缝 2 `[接缝×2]`：真实 heartbeat → Android 真机抢占 → 安全退出 → report；现有 Android workflow 必须增加 `scenario=cancel`、`repeat` 与 evidence 上传。
- Android 两轮真机证据未通过前为 `logic-done-pending`，不得标 done。

## 未覆盖真实链路清单

- 当前 `.github/workflows/e2e-orphan-consolidation-windows.yml` 只启动 Vite，现有获客 spec 使用 `page.route()`；Generator 必须补真 Postgres/API 与 `acquisition-cancel.spec.ts`，否则 Windows UI 链未覆盖。
- 当前 `.github/workflows/e2e-line02-android-collect.yml` 只跑普通采集 smoke；Generator 必须补 `scenario=cancel`、两轮执行和 `android-cancel-evidence`，否则 Android 段为 `logic-done-pending`。
- 本合同无第三方 API、`force_*` 或最终 oracle mock 豁免。

## CI Workflow 用户路径 1:1 映射

已逐行读取两份实际 workflow：

1. `.github/workflows/e2e-orphan-consolidation-windows.yml`：已有 Windows Chromium/Vite；`[CI_GAP: 未启动 Postgres/API，未跑真实取消、三态与冷却]`。补齐后 workflow 必须实际运行 `apps/dashboard/e2e/acquisition-cancel.spec.ts` 两次且任一失败阻塞 gate。
2. `.github/workflows/e2e-line02-android-collect.yml`：已有 xian-rog + adb + 普通采集 smoke；`[CI_GAP: 无 cancel 输入、无抢占/关面板/回执 evidence，证据未绑定触发 run/SHA]`。补齐后 `scenario=cancel` 必须调用真实取消 smoke并上传含 `github_run_id/head_sha/attempt_marker/repeat_index/cancel_requested_at/command_received_at` 的证据。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: windows_cloud（Android 接缝另派 `android_realmachine`）

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${SPRINT_DIR:=sprints/07310943-kernel-0e82adad}"
: "${GITHUB_REF_NAME:?}"
: "${GH_REPO:=perfectuser21/zenithjoy-workspace}"
test "${RUNNER_OS:-}" = "Windows" || { echo "FAIL: windows_cloud runner required"; exit 1; }
pwsh -NoProfile -File "$SPRINT_DIR/e2e-verify.ps1" -BaseUrl http://localhost:5174 -ApiUrl http://localhost:3000 -Repeat 2 -ScreenshotDir "$SPRINT_DIR/screenshots"
EXPECTED_SHA=$(git rev-parse HEAD)
DISPATCHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ATTEMPT_MARKER="cancel-${EXPECTED_SHA:0:12}-$(date +%s)-$$"
gh workflow run e2e-line02-android-collect.yml --repo "$GH_REPO" --ref "$GITHUB_REF_NAME" -f scenario=cancel -f repeat=2 -f attempt_marker="$ATTEMPT_MARKER"
RUN_ID=""
for DISCOVERY_POLL in $(seq 1 30); do RUN_ID=$(gh run list --repo "$GH_REPO" --workflow e2e-line02-android-collect.yml --branch "$GITHUB_REF_NAME" --event workflow_dispatch --limit 20 --json databaseId,createdAt,headSha | jq -r --arg ts "$DISPATCHED_AT" --arg sha "$EXPECTED_SHA" '[.[] | select((.createdAt|fromdateiso8601) >= ($ts|fromdateiso8601) and .headSha == $sha)] | first | .databaseId // empty'); test -n "$RUN_ID" && break; sleep 2; done
test -n "$RUN_ID"
for POLL in $(seq 1 180); do STATUS=$(gh run view "$RUN_ID" --repo "$GH_REPO" --json status --jq '.status'); test "$STATUS" = completed && break; test "$POLL" -lt 180 || exit 1; sleep 5; done
RUN_META=$(gh run view "$RUN_ID" --repo "$GH_REPO" --json conclusion,headSha,url)
test "$(jq -r .conclusion <<<"$RUN_META")" = success
test "$(jq -r .headSha <<<"$RUN_META")" = "$EXPECTED_SHA"
mkdir -p "$SPRINT_DIR/evidence/android"
gh run download "$RUN_ID" --repo "$GH_REPO" --name android-cancel-evidence --dir "$SPRINT_DIR/evidence/android"
for N in 1 2; do jq -e --argjson run_id "$RUN_ID" --arg sha "$EXPECTED_SHA" --arg marker "$ATTEMPT_MARKER" --argjson repeat_index "$N" '.github_run_id==$run_id and .head_sha==$sha and .attempt_marker==$marker and .repeat_index==$repeat_index and .scenario=="cancel" and .safe_exit==true and .switch_account_panel_open==false and .continued_list_reads==0 and .report_status=="cancelled" and (.machine_id|type=="string" and length>0) and ((.cancel_requested_at|fromdateiso8601) <= (.command_received_at|fromdateiso8601)) and (((.command_received_at|fromdateiso8601)-(.cancel_requested_at|fromdateiso8601)) <= 30)' "$SPRINT_DIR/evidence/android/result-$N.json"; done
test -s "$SPRINT_DIR/screenshots/cancel-requested.png"
test -s "$SPRINT_DIR/screenshots/cancel-sent.png"
test -s "$SPRINT_DIR/screenshots/cancel-confirmed.png"
test -s "$SPRINT_DIR/screenshots/cancel-cooldown.png"
echo "OK: Windows 真后端 UI x2 + Android 真机取消 x2"
```

`e2e-verify.ps1` 必须用 `Start-Process` 启真 API 3000 与 Vite 5174、用 `Test-NetConnection` 等待、向 Vite 注入 `VITE_API_URL=http://localhost:3000`；Playwright 禁止 `page.route()`，用真 DB fixture，并验证 requested/sent/confirmed/cooldown 四个可见状态。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 缺 task_id、非 UUID、额外 tenant_id、伪造 machine_id。
- 重复提交: 双击与 10 路并发 cancel、重复 heartbeat、重复回执。
- 中途中断: requested 后 Agent 离线重连；安全退出中 Android 服务重启。
- 边界值: sent 恰好 120 秒、cooldown 恰好 300 秒、同机重新注册换 agent_id。
- 发现分级: P0/P1（跨租户、防枚举泄露、假 cancelled、同机绕冷却）阻塞 merge；P2/P3 记 findings。

## Risks / Mitigation

| 风险 | 失败后果 | Mitigation / oracle |
|---|---|---|
| 把可变 agent_id 当设备键 | 重装/重注册立即绕过冷却 | heartbeat 认证后快照 `machine_id`；真 PG 测同 machine_id 换 agent_id 仍 409 |
| 403/404 差异枚举 | 跨租户探测任务存在性 | 跨租户与随机不存在 UUID 的状态/信封深相等测试 |
| 取消排队而不抢占 | Agent 继续操作账号且前台假成功 | Android 真机双跑，先 safe_exit 后 report，验面板关闭与读取计数为 0 |
| workflow 只跑替身或下载到历史 artifact | CI 假绿 | Windows 启真 API/PG 且禁 page.route；Android evidence 绑定本次 run ID、HEAD SHA、唯一 marker，并校验真实 30 秒时延 |
| 重复请求/回执改时间 | 冷却被无限延长 | 唯一活动命令 + `COALESCE(cancelled_at,NOW())` 语义的真 PG 幂等测试 |

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| **FR（做什么）** | 前台不可逆放弃单设备运行中获客任务；真机退出回执后确认；同物理设备冷却 5 分钟 |
| **NFR（做得多好）** | heartbeat 最长 30 秒下发；2 分钟无回执不假成功；请求与回执幂等 |
| **Invariant（永不违反）** | 租户隔离、鉴权、防枚举；只有绑定设备真实回执落终态；不回滚已采数据 |
| **判定点（怎么知道）** | 见下表 |
| **保质期（何时过期）** | 取消命令在 confirmed 后失活；冷却 300 秒；旧 Agent 不识别时保持 sent |
| **死亡告警（停了谁知道）** | sent 超 2 分钟结构化告警；Windows/Android workflow 红通知维护者 |
| **失败语义（挂了怎么办）** | fail closed；任何接缝失败都不写 cancelled，保留等待态 |
| **效果确认（已发≠已生效）** | heartbeat 仅算 sent；安全退出后的 report + DB 落章才算 confirmed |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Android 是否安全退出 | 回调触发 / 队列空 / 服务停止+面板关闭+无后续读取 | 服务停止+面板关闭+无后续读取后 report | PRD 明确安全退出 | 直接面客错误、账号误操作 |
| 取消指令是否已发送 | 入库 / heartbeat 真取走 | heartbeat 真取走并原子写 sent | 排队不等于送达 | 前台误报 |
| 同一设备身份 | agent_id / agent_uuid / machine_id | 已认证 heartbeat/注册的 machine_id | 前两者会随运行期或重注册变化 | 冷却被绕过 |

notes: `judgment-pending-user: Android 是否安全退出`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 未登录 | 401，不写库 | 是 | 无 |
| 跨租户或不存在 | 同一 403 信封，不写库 | 是 | 无 |
| 已终态 | 409，不改状态 | 是 | UI 刷新 |
| Agent 离线/超时 | 保留 requested/sent，不落 cancelled | 是 | 告警、人工处理 |
| 安全退出失败 | 不 report cancelled | 可重试 | 不自动重派 |
| 冷却期重触发 | 409 + 剩余秒数 | 是 | 期满重试 |

### 输入对抗面

N/A：不接受外部自然语言或 prompt；HTTP/Android 输入按 schema、认证与绑定关系校验。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it 名子串） | 预期红证据 |
|---|---|---|---|
| 取消与 schema | `sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts` | `本人租户取消 running 任务返回 cancelling` | 现 route 仍要求 body tenant_id |
| 防枚举 | 同上 | `跨租户与不存在任务返回不可区分的 403` | 现 route 分 404/成功路径 |
| 心跳设备快照 | 同上 | `heartbeat 下发唯一取消指令并快照稳定设备` | 现任务无 device_machine_id |
| 心跳下发时延 | 同上 | `取消接受到真实 heartbeat 响应的实测时延不超过 30 秒` | 现链路无取消时延 oracle |
| 幂等 | 同上 | `重复取消幂等且不生成第二条指令` | 现无唯一命令与首次时间 |
| 回执终态 | 同上 | `只有绑定 Android Agent 回执后才落 cancelled` | 现无 cancelled_at |
| 稳定设备冷却 | 同上 | `稳定 machine_id 冷却不能被更换 agent_id 绕过` | 现 start 无 machine_id 冷却闸 |
| 真 workflow | `sprints/07310943-kernel-0e82adad/tests/workflow-cancel-contract.test.ts` | `Windows 与 Android workflow 执行真实取消链` | 两 workflow 均无 cancel 场景 |

## Notes

- PRD 指定主 target 为 `windows_cloud`；Android 真机段按 PRD 要求独立路由 `android_realmachine`。
- 本 sprint 不含暂停/恢复、批量取消、staging 发布、Bark 通知、prod promote 或已采数据回滚。
- Round 12 仅修 Reviewer 指出的五项阻塞：report 必须经过 heartbeat/sent、heartbeat 前设备快照为空、E2E 入口真实可执行、Android evidence 绑定本次 run/SHA 且实测 30 秒 NFR、补齐取消响应禁用字段；不扩 PRD 范围。
