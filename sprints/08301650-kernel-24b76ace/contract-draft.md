# Sprint Contract Draft (Round 1) — 工作机控制塔可视化·第一刀

> 仓库为第三方 repo（无 `packages/brain/src/lib/contract-gate.js`）。
> contract-gate: skipped (file not found, third-party repo)

## 锚定父路声明

独立小路（无父路）。本 sprint 新增"工作机控制塔"可视链路，不推进 line01/customer_first_success 的既有步骤，保持其全绿（见 `## GP-Anchor`）。

## GP-Anchor

GP-Anchor: line01/customer_first_success keep-green

> 依据：PRD 末尾 `gp_anchor=line01/customer_first_success keep-green`；已用 jq 核实该组合存在（`select(.line_id=="line01" and .id=="customer_first_success") | length == 1`）。本刀不触碰该 GP 的 smoke_files（`golden-path-1-smoke.sh`），仅要求其保持全绿。

---

## target_environment 决策与偏离说明（judgment-pending-user）

- **PRD 声明**：`target_environment: windows_cloud`（GitHub Actions 干净 VM + `E2E_FAKE_EXECUTORS` 假执行器）。
- **本刀执行环境事实**：本 sprint 交付物是 `apps/api`（HTTP 协议 + 新 Postgres 表 `worker_tasks`/`worker_task_steps`）+ `apps/dashboard`（总览/详情页）。核心存储是 Postgres；假执行器 = smoke 脚本 curl 协议端点（非 Windows 原生程序）。
- **windows_cloud 的落地方式（沿用仓库既有两段式，见 `.github/workflows/e2e-line02-account-role-unify-windows.yml`）**：
  1. **PR 必跑闸（ubuntu-latest + `postgres:15` service）** — GitHub Actions 的 `services:` 只能在 Linux runner 起（Docker），故"起 Postgres + 迁移 + 起 api + 假执行器 curl 协议 + Playwright 打真实后端"这段在 ubuntu 干净 VM 跑（对齐 `ci-l4-e2e-smoke.yml` 的 fake-executor api smoke 全部在 ubuntu 的既有事实）。**这是 `smoke 脚本进 CI、CI 全绿` 的落点**，也是本合同 `## E2E 验收` 脚本运行处。
  2. **windows-latest 评估者对照 job（`workflow_dispatch`）** — 对照 `e2e-*-windows.yml` 惯例，windows-latest 连外部 `E2E_DATABASE_URL` secret、起 api、跑同一套 Playwright（`e2e-verify.ps1`），给 windows 平台一致性兜底。
- **真机（小龙虾）验收** 由 AI 执行器人工驱动，在 staging 环境完成（见 `## staging 预览闸`），不进 CI 自动化（PRD 假设 3）。
- **判断依据**：GHA windows runner 无法起 `postgres` service、默认无 `psql` 客户端；把 Postgres 依赖强塞进 windows-latest 会让 E2E 不可跑（= 假绿/无法验），违背"环境要匹配真实行为能被验证之处"。本合同因此把 CI 必跑闸落在 ubuntu，windows-latest 仅作对照。
- `judgment-pending-user: 是否接受 "windows_cloud 的 CI 必跑闸落在 ubuntu+postgres service、windows-latest 仅对照" 的落地方式`（PrepPRD/对齐会未拍板）。

---

## Response Schema（推导来源：PRD 字面 + api_registry 错误壳惯例）

> 协议成功响应字段名 **字面取自 PRD**（PRD 是法律）；错误壳沿用仓库惯例 `{success:false, error:{code,message}, timestamp}`（PRD 未定义错误壳）。

### Endpoint: POST /api/workers/:agentId/tasks（开始任务，执行器→服务端）
**Success (HTTP 200)**:
```json
{"task_id": "<uuid>", "lease_until": "<ISO8601>"}
```
- `task_id` (string uuid, 必填): 来源 PRD 明确（"→ `{task_id, lease_until}`"）
- `lease_until` (string ISO8601, 必填): 来源 PRD 明确（租约 10 分钟，DB 时钟 `now() + interval '10 minutes'`）
**禁用字段名**: `id`（顶层任务 id 必须叫 `task_id`）、`lease`、`leaseUntil`（驼峰）
**冲突 (HTTP 409)**: 同 agent 已有 running 任务 → `{success:false, error:{code:"WORKER_TASK_ALREADY_RUNNING"}}`
**Not Found (HTTP 404)**: agentId 不属于调用租户 → `{success:false, error:{code:"WORKER_NOT_FOUND"}}`

### Endpoint: POST /api/workers/tasks/:id/steps（上报步骤，执行器→服务端）
**Success (HTTP 200)**:
```json
{"step_index": 0, "lease_until": "<ISO8601>"}
```
- `status` 入参 ∈ `doing|done|failed`；`status=failed` 时 `foreground_pkg + diag_line + screenshot_jpeg_b64` 三者必填
- 续租：每次上报把 `lease_until` 顺延 10 分钟
**Error (HTTP 400)**: failed 缺三件套任一 → `{success:false, error:{code:"FAILURE_SCENE_INCOMPLETE"}}`
**Error (HTTP 409)**: `executor_id` 与租约持有者不符 / 任务已非 running → `{success:false, error:{code:"WORKER_TASK_NOT_RUNNING"}}`
**Error (HTTP 413)**: `screenshot_jpeg_b64` 解码 > 200KB → `{success:false, error:{code:"SCREENSHOT_TOO_LARGE"}}`

### Endpoint: POST /api/workers/tasks/:id/complete（终态，执行器→服务端）
**Success (HTTP 200)**: `{"status": "completed|failed|needs_review"}`
- `outcome=failed` 时 `failed_step + error_code` 必填，否则 400

### Endpoint: POST /api/workers/:agentId/frame（推帧，执行器→服务端）
**Success (HTTP 200)**: `{"ok": true}`；`frame_jpeg_b64` 解码 > 120KB → 413；环形缓存 ≤10 帧

### Endpoint: GET /api/workers/:agentId/live（MJPEG，主理人）
**Success (HTTP 200)**: `Content-Type: multipart/x-mixed-replace; boundary=...`（无新帧不重复发旧帧）
**Not Found (HTTP 404)**: 跨租户

### Endpoint: GET /api/workers（总览，主理人）
**Success (HTTP 200)**:
```json
{"workers": [{"agent_id":"stub-win32-1","kind":"win32","online":true,"current":{"title":"发布视频到抖音","current_step":3,"steps_total":5}|null,"today_completed":2}]}
```
- `kind` ∈ `win32|android`（PRD：🖥️ Windows / 📱 安卓）
- `online` = `agents.last_seen > now() - interval '3 minutes'`（PRD 复用 agents 表）
- `current` = 当前 running 任务摘要，空闲为 `null`

### Endpoint: GET /api/workers/:agentId/activity（详情，主理人）
**Success (HTTP 200)**:
```json
{"agent_id":"stub-win32-1","current":{"task_id":"<uuid>","title":"...","steps":[{"step_index":0,"status":"done","screenshot_ref":"<ref>|null","foreground_pkg":null,"diag_line":null,"note":null,"created_at":"<ISO>"}]}|null,"live":{"last_frame_at":"<ISO>|null","stale":false},"history":[{"task_id":"<uuid>","status":"completed","finished_at":"<ISO>","error_code":null,"failed_step":null}]}
```
- `history` 最近 20 条；`live.stale = (now - last_frame_at) > 15s`（PRD："最新帧超 15 秒显示画面不可用"）
**Not Found (HTTP 404)**: 跨租户

### Endpoint: GET /api/workers/steps/screenshots/:ref（截图取回，主理人）
**Success (HTTP 200)**: `Content-Type: image/jpeg`
**Not Found (HTTP 404)**: 跨租户 / ref 不属本租户

---

## Golden Path

[主理人登录 Dashboard] → [看总览 /dashboard/workers] → [进实时详情] → [执行器 tasks/steps/frame 上报] → [看执行中画面+打勾] → [complete/failed/失联 进历史] → [对全部 worker 活动一目了然]

### Step 1: 主理人登录后看总览 `/dashboard/workers`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（`/dashboard/workers` 卡片：类型/在线/当前状态/今日完成）
**可观测行为**: 侧栏"工作机"入口可见；页面列出本租户全部 worker 卡片，含 🖥️/📱 类型标识与在线状态。
**验证命令**:
```bash
curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq -e '[.workers[].kind] | (index("win32") and index("android"))'
```
**硬阈值**: 总览含 ≥1 win32 + ≥1 android 卡片（`E2E_FAKE_EXECUTORS=1` seed 的 stub agents）。

### Step 2: 执行器开始任务并逐条上报步骤
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（POST tasks + POST steps → 1 秒轮询内卡片"第 x/y 步"，详情逐条打勾）
**可观测行为**: `POST tasks` 得 `{task_id, lease_until}`；连发 3 条 `steps(done)` 后总览卡片显示"正在执行：<title> 第 3/5 步"，详情页 3 条 ✅ 且缩略截图 ref 可取回。
**验证命令**:
```bash
TID=$(curl -sf "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"title":"发布视频到抖音","steps":["a","b","c","d","e"],"executor_id":"e2e-fake-executor"}' | jq -er '.task_id')
for i in 0 1 2; do curl -sf "$BASE_URL/api/workers/tasks/$TID/steps" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d "{\"step_index\":$i,\"status\":\"done\",\"screenshot_jpeg_b64\":\"$(printf 's%s' $i | base64)\",\"executor_id\":\"e2e-fake-executor\"}" >/dev/null; done
curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq -e '.workers[] | select(.agent_id=="'"$AGENT_WIN"'") | .current.current_step==3 and .current.steps_total==5'
```
**硬阈值**: 3 条 done 后 `current_step==3`、`steps_total==5`；activity 三步 `status==done` 且 `screenshot_ref` 非空。

### Step 3: 推帧 → 实时画面可见，停推 15 秒 → 画面不可用
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2/3 条 + NFR（最新帧超 15 秒显示"画面不可用"）
**可观测行为**: `POST frame` ×5（不同内容）后 `GET live` 10 秒内输出 ≥2 帧且相邻帧 hash 不同；停推 15 秒后 activity `live.stale==true`。
**验证命令**:
```bash
for i in 1 2 3 4 5; do curl -sf "$BASE_URL/api/workers/$AGENT_WIN/frame" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d "{\"frame_jpeg_b64\":\"$(head -c 64 /dev/urandom | base64 | tr -d '\n')\"}" >/dev/null; sleep 0.2; done
timeout 10 curl -s "$BASE_URL/api/workers/$AGENT_WIN/live" -H "X-Tenant-Id: $TENANT_A" | head -c 4000 | grep -c -- '--frame' | awk '{ if ($1>=2) exit 0; else exit 1 }'
```
**硬阈值**: 10 秒内 MJPEG 输出 ≥2 帧边界；停推 15 秒后 `activity.live.stale==true`。

### Step 4: 上报失败必带现场三件套（缺一 400）
**来源**: `[FROM_PRD]` + Invariant `[失败现场三件套]`（PRD 第 5 条 / CLAUDE.md invariant `93ed0761`）
**可观测行为**: `steps status=failed` 缺 `foreground_pkg|diag_line|screenshot_jpeg_b64` 任一 → 400；三件套齐 → 历史条目显示失败步骤 + 前台包名 + 诊断行 + 截图 ref。
**验证命令**:
```bash
TID=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"title":"私信","steps":["x","y"],"executor_id":"e2e-fake-executor"}' | jq -er '.task_id')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/tasks/$TID/steps" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"step_index":0,"status":"failed","executor_id":"e2e-fake-executor"}')
[ "$CODE" = "400" ] || { echo "FAIL: 缺三件套未 400，实际 $CODE"; exit 1; }
```
**硬阈值**: 缺三件套 → HTTP 400；带三件套 → 200 且 activity 失败步骤含 `foreground_pkg/diag_line/screenshot_ref`。

### Step 5: 终态 / 失联 / 跨租户
**来源**: `[FROM_PRD]` + Invariant `[租户隔离]`（PRD 第 4/5 条 + 边界情况）
**可观测行为**:
- `complete(outcome=completed)` → 卡片回"空闲"（`current==null`）、`today_completed` +1、history +1
- 同 agent 二次 `POST tasks`（running 中）→ 409
- 短租约过期 → sweeper（60s）标 `outcome=failed, error_code=executor_lost`，不新增任务
- 另一租户会话访问该 worker 的 `activity`/`live`/`screenshots/:ref` → 404
**验证命令**:
```bash
DUP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"title":"重复","steps":["a"],"executor_id":"e2e-fake-executor"}')
X404=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/$AGENT_WIN/activity" -H "X-Tenant-Id: $TENANT_B")
[ "$X404" = "404" ] || { echo "FAIL: 跨租户未 404"; exit 1; }
```
**硬阈值**: running 中 dup=409；跨租户 activity/live/screenshot=404；sweeper 后该任务 `status=failed`、`error_code=executor_lost`。

---

## 真实调用方请求 shape（规则 A — 执行器→服务端写通道）

本刀执行器（现：AI + skill 驱动小龙虾；未来：Windows/Android Agent 代码）作为**可信内部调用方**上报 worker 活动，认证与关键字段如下（DoD/E2E 构造请求必须逐字段一致）：

| 维度 | 生产调用方约定 | 依据 |
|---|---|---|
| 认证/租户 | HTTP header `X-Tenant-Id: <uuid>`（沿用 `agent-machines.ts` 的 `tenantContextOptional`，可信内部通道），服务端再校验 `agents.tenant_id == X-Tenant-Id` 且 `agent_id` 存在，否则 404 | `apps/api/src/middleware/tenant-context.ts` `tenantContextOptional`；`agent-machines.ts:26` |
| Content-Type | `application/json` | 仓库惯例 |
| 幂等/持有者 | body `executor_id`（string）；steps/complete 校验 `executor_id == worker_tasks.executor_id`（租约持有者），不符 409 | PRD 协议 |
| 关键字段（steps） | `step_index`(int)、`status`(doing\|done\|failed)、`screenshot_jpeg_b64`(≤200KB)、`foreground_pkg`、`diag_line`、`note`、`executor_id` | PRD 协议（字段名字面） |

> 专用执行器 token（长期凭据）**不在本刀范围**（PRD 不包含），执行器认证先复用 `X-Tenant-Id` 内部通道 → 登记进 `## 未覆盖真实链路清单`。

## 未覆盖真实链路清单（规则 C）

| 被 mock/顶替的真实链路点 | 为什么 | 真验证补位计划（谁/何时/环境） |
|---|---|---|
| 执行器由 `E2E_FAKE_EXECUTORS` 假执行器（smoke 脚本 curl）扮演，非真小龙虾 RPA | 本刀只交付"活动协议 + 可视化"，不含真机推流/RPA 代码（PRD 范围外） | 主理人 staging 真机验收：AI 执行器人工驱动小龙虾发布一条抖音（私密），全程页面可见（`## staging 预览闸`） |
| 执行器认证用 `X-Tenant-Id` 内部通道，非专用 token | 专用执行器 token / 截图对象存储 PRD 明确不包含 | 后续刀补 token 鉴权与对象存储；本刀截图落服务器盘 `uploads/worker-shots/<tenant>/<task>/<step>.jpg` |
| 真机段（windows_wechat / android_realmachine）未在 CI 覆盖 | 无真机推流代码，Android/Windows Agent 通道本刀不落地（规则 D） | staging 手动（AI 执行器）；真机 Agent 推流是后续刀 |

> 规则 B（第三方真调）：本 sprint **无第三方 API 依赖**（无 LLM/支付/短信/平台 API 调用），N/A。

## 禁 mock 边清单（规则 v9.12）

本单改动涉及：**DB 写路径**（新表 `worker_tasks`/`worker_task_steps` 的 INSERT/UPDATE）、**状态机**（running→completed/failed/needs_review + `executor_lost` 终态判定）、**生命周期钩子**（租约 sweeper 定时扫描）、**跨模块数据传递**（执行器上报 → 服务端落库 → 总览/详情读出）。故冻结测试禁 mock 下列边：

- 代码 ↔ Postgres 表 `zenithjoy.worker_tasks`（本单新建写路径，测试必须真 Postgres 验行落库 + 时间窗）
- 代码 ↔ Postgres 表 `zenithjoy.worker_task_steps`（步骤 + 失败现场三件套必须真库读回）
- 路由 workers.ts ↔ 租约 sweeper 服务（状态机终态 `executor_lost` 必须真库真扫，不 stub 时钟外的邻居）
- 执行器写端点 ↔ 总览/详情读端点（同一真库跨请求验证，不 mock 中间存储）

> 允许 mock 的仅更外层无关依赖（无）。`tests/worker-activity.test.ts` 打真实 `$API_BASE` + 真 `$DATABASE_URL`，无 `vi.mock('pg')`/`vi.mock('.../db/connection')`；evaluator 机械 grep 核查命中即 CONTRACT-IS-LAW FAIL。真 PG 测试由 CI Sprint Tests job（root `vitest.config.cjs`，`fileParallelism:false`）起真 Postgres 跑。

---

## 已知约束

### 来自回归测试（Step 1.2）
- `apps/api/tests/tenants.test.ts` → 多租户隔离：跨租户资源访问返回 404 而非 403（本刀 worker activity/live/screenshot 跨租户必须 404，复用同款语义）
- `apps/api/src/routes/agent-machines.ts`（`tenantContextOptional`）→ 支持 session 与 `X-Tenant-Id` 双通道（本刀写端点复用）
- `sprints/07212317-android-signal-reporting/tests/*` → RPA 失败上报必带 error_code + 现场（对齐 invariant `93ed0761`）

### 累积 FR（Step 1.3，context-manifest）
- 本 line 暂无历史 FR（PRD 累积 FR 段：本 line 暂无历史）。context-manifest 端点：本 repo 无 Brain（第三方 repo），标 `context-manifest: unavailable`（不阻塞）。

### Unified Map 半径（Step 1.0）
- `[MAP_NOT_CONFIGURED]`：task.payload 无 `map_scope`/`map_repo`（本 repo 无 Brain map），`must_run_assertions=[]`。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | worker 活动协议 8 类端点（tasks/steps/complete/frame/live/总览/activity/截图取回）+ 总览页 + 实时详情页 |
| **NFR（做得多好）** | 性能/可靠性 | 租约 10min（DB 时钟）；sweeper 60s；帧新鲜度 15s；卡片轮询 1s 内反映；step 截图 ≤200KB、frame ≤120KB、环形 ≤10 帧；截图 30 天清理 |
| **Invariant（永不违反）** | 不变量 | ① failed 必带前台包名+诊断行+截图缺一 400（`93ed0761`）；② worker activity/live/截图跨租户 404，不泄露存在性 |
| **判定点（怎么知道）** | 见判定点登记表 | 见下表 |
| **保质期（何时过期）** | 失效与退役 | 任务租约 `lease_until` 到期即视为失联；帧环形缓存重启丢失可接受（PRD 假设 2）；截图 30 天清理 |
| **死亡告警（停了谁知道）** | 告警手段 | sweeper 停 → running 任务永不落终态：以 `GET /api/workers` 中"长时间无 current 更新且未回空闲"为可观测症状；本刀不新增外部告警通道（登记为 known-gap，后续刀接 Bark） |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 见失败语义声明表 |
| **效果确认（已发≠已生效）** | 回执确认 | 每个执行器写动作返回 200 + 服务端落库；`GET activity` 读回步骤/现场即回执；`complete` 后 `today_completed`+1 且 history+1 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| worker 在线/离线 | A. `agents.status` 字段; B. `agents.last_seen > now-3min` | B. last_seen > now-3min | PRD 明确复用 `agents.last_seen`；status 字段更新时机不一定实时 | 显示离线为在线，主理人误以为在跑 |
| ⚠️ 执行器失联（该判失败） | A. 无 steps 上报超时; B. `lease_until < now()`（DB 时钟）+ sweeper 60s 扫 | B. lease_until < now DB 时钟 | DB 时钟单一权威，避免执行器/服务器时钟漂移；PRD 明确 | 误判失联 → 把在跑任务标 failed（面客错误）；误判存活 → 卡死任务永不进历史 |
| ⚠️ 画面是否可用 | A. 有无帧曾到达; B. 最新帧 `last_frame_at` 距今 >15s 判 stale | B. last_frame_at age >15s | PRD 明确 15s 阈值 | 误判可用 → 主理人盯着定格旧画面以为在动 |
| 步骤成功/失败 | A. 执行器自报 status; B. 服务端再校验现场三件套齐全 | A+B（failed 必须齐三件套否则拒） | invariant `93ed0761`：失败必须带现场，否则不得判成功 | 静默判成功 → 失败原因不落人会看的地方，复发只能靠猜（0821 白猜三轮） |

> `⚠️` 判定点误判后果严重（面客/静默丢现场），属"升拍板点"级别；PrepPRD 已在协议里拍定阈值（10min/60s/15s），故不另加 `judgment-pending-user`；仅 target_environment 落地方式待确认（见上）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 执行器上报失败（status=failed 三件套齐） | 落 `worker_task_steps`（status=failed）+ 现场；任务可继续或 complete(failed) | 是（step_index 幂等键） | 现场入历史，主理人查看 |
| 执行器上报 failed 缺三件套 | 拒绝写入，返回 400 | N/A | 执行器必须补齐现场重报（不得判成功） |
| 执行器失联（租约过期） | sweeper 标 `outcome=failed, error_code=executor_lost` 进历史 | 幂等（仅 running 且 lease_until<now 才标） | **不自动重跑**（PRD）；主理人可后续重新触发（本刀不做触发入口） |
| 画面流断（无新帧） | 详情页 `live.stale=true`（"画面不可用"）；任务状态不受影响 | N/A | 步骤流照常，仅画面降级 |
| 截图/帧超限 | steps>200KB→413；frame>120KB→413，不写入 | 是 | 执行器压缩后重报 |
| 跨租户访问 | 404（不泄露存在性） | N/A | 拦截 |

### 输入对抗面

> 本刀 worker 写端点是**可信内部执行器**通道（非对外暴露给终端用户/爬虫），且不把上报内容喂给任何 LLM/pipeline。故 Prompt Injection 面 N/A；仅需常规输入校验（体积上限、枚举值、租户归属）。

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 执行器上报（tasks/steps/frame） | 可信内部（X-Tenant-Id 内部通道） | N/A（不入 LLM/pipeline） | 校验 agent 归属租户（404）、租约持有者（409）、体积上限（413）、枚举值（400） |
| 主理人读端点（总览/详情/live/截图） | 已登录用户 | N/A | 租户隔离，跨租户 404 |

---

## staging 预览闸（user_facing 专属；BASE_REPO=zenithjoy → 阻塞式）

> journey_type=user_facing，强制含本段。zenithjoy 仓取**阻塞式**：需主理人放行，未放行禁 promote 到 prod。

### 步骤 A：落 staging
- 引用现有 staging 部署：`.github/workflows/deploy-dashboard-staging.yml`（dashboard）与对应 api staging 部署，不重造部署脚本。ZJ staging 环境地址由该 workflow 提供。

### 步骤 B：Final-E2E 在 staging 跑 + 截图（AI 执行器驱动真机小龙虾）
- 主理人 staging 真机验收：AI 执行器人工驱动小龙虾发布一条抖音（**私密**），全程在 `/dashboard/workers` 详情页可见（画面动 + 步骤逐条打勾 + 完成入历史）。
- 截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`（总览、详情执行中、完成历史各一张）。

### 步骤 C：Bark 推主理人预览链接（阻塞式）
- 调用 `$BARK_URL` 通知主理人，附 staging `/dashboard/workers` 预览链接 + 截图 URL，注明**需主理人放行**。
- prod promote 前核查放行标记（主理人确认），未放行禁 promote。本刀无 Brain PATCH 端点（第三方 repo），放行以主理人在 staging 确认为准，记录进 sprint 交接单。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `POST /api/workers/:agentId/tasks` 传 `steps: "not-an-array"` / 空 `steps: []` / 超长 title；`POST steps` 传 `status:"bogus"`、`step_index:-1`、`screenshot_jpeg_b64` 非法 base64
- 重复提交: 连点两次开始任务（并发 `POST tasks` 同 agent → 只应 1 个 running，另一个 409，不得双 running）；同一 `step_index` 重复上报（幂等，不得重复计步）
- 中途中断: 任务 running 中执行器失联又恢复上报（租约已过期后再 `POST steps` → 应 409，执行器停手）；complete 后再 `POST steps` → 409
- 边界值: `screenshot_jpeg_b64` 恰好 200KB / 200KB+1；`frame` 恰好 120KB / +1；帧推第 11 帧（环形 ≤10）；`live` 无任何帧时的响应；history 恰好 20 条与第 21 条
发现分级: P0/P1（跨租户泄露 / 双 running / 失败判成功 / 丢现场）→ 阻塞 merge；P2/P3（文案/边界提示）→ 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| worker 活动协议 + 存储 | `sprints/08301650-kernel-24b76ace/tests/worker-activity.test.ts` | POST tasks 返回 task_id / steps failed 缺三件套返回 400 / steps failed 带三件套现场落库 / 同 agent 第二个 running 任务返回 409 / 跨租户 activity 返回 404 / 总览列出 win32 与 android 卡片 / worker_tasks 真库写入带时间窗 | 端点未实现 → supertest 收 404 / 无 api 时 ECONNREFUSED；真库断言无表 → 全部 fail（Red） |

> Test File 为完整真实路径（无省略号）；BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串。

---

## E2E 验收（final-e2e / CI 必跑闸 — target_environment=windows_cloud 的 GHA 落地：ubuntu-latest + postgres service）

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA 干净 VM；CI 必跑闸落 ubuntu-latest + `postgres:15` service，见上"决策与偏离说明"；windows-latest 为对照 job）

> 下脚本即 `.github/workflows/scripts/smoke/worker-activity-smoke.sh` 的协议层内容 + 编排，evaluator/CI 直接跑；DB 断言走 api 端点（curl+jq，跨平台，不依赖 psql 二进制），迁移用 `npm run migrate`（node pg）。Playwright UI 层打**真实后端**（禁 `page.route()` stub），验总览页与详情页。

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Fleet/CI must inject a postgres DATABASE_URL}"
BASE_URL="${BASE_URL:-http://localhost:5200}"
export PORT="${PORT:-5200}" NODE_ENV=test E2E_FAKE_EXECUTORS=1
export TENANT_A="${TENANT_A:-00000000-0000-0000-0000-00000000000a}"
export TENANT_B="${TENANT_B:-00000000-0000-0000-0000-00000000000b}"
export AGENT_WIN="${AGENT_WIN:-stub-win32-1}"
export AGENT_AND="${AGENT_AND:-stub-android-1}"
API_PID=""; VITE_PID=""
cleanup() { [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null || true; [ -z "$VITE_PID" ] || kill "$VITE_PID" 2>/dev/null || true; }
trap cleanup EXIT

# 1. 迁移空库 + 机检目标表存在（run-migration.ts 走 DATABASE_URL / node pg，无需 psql 二进制）
( cd apps/api && npm run migrate )
node -e 'const{Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query("select to_regclass('"'"'zenithjoy.worker_tasks'"'"') is not null as ok");if(!r.rows[0].ok){console.error("FAIL: worker_tasks 表缺失");process.exit(1)}await c.end()})().catch(e=>{console.error(e);process.exit(1)})'

# 2. 起真实 api（E2E_FAKE_EXECUTORS=1 → 启动 seed ≥1 win32 + ≥1 android stub agents 归属 TENANT_A）
( cd apps/api && npm run build && node dist/index.js ) >/tmp/worker-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -sf "$BASE_URL/health" >/dev/null 2>&1 && break; [ "$i" = 40 ] && { echo "FAIL: api 未就绪"; cat /tmp/worker-api.log; exit 1; }; sleep 1; done

# 3. 总览含 win32 + android（Step 1）
curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq -e '[.workers[].kind] | (index("win32") and index("android"))' >/dev/null || { echo "FAIL: 总览缺 win32/android"; exit 1; }

# 4. 开始任务 + 3 步 done → 卡片"第 3/5 步"（Step 2）
TID=$(curl -sf "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"title":"发布视频到抖音","steps":["a","b","c","d","e"],"executor_id":"e2e-fake-executor"}' | jq -er '.task_id')
for i in 0 1 2; do curl -sf "$BASE_URL/api/workers/tasks/$TID/steps" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d "{\"step_index\":$i,\"status\":\"done\",\"screenshot_jpeg_b64\":\"$(printf 'shot%s' $i | base64)\",\"executor_id\":\"e2e-fake-executor\"}" >/dev/null; done
curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq -e '.workers[]|select(.agent_id=="'"$AGENT_WIN"'")|.current.current_step==3 and .current.steps_total==5' >/dev/null || { echo "FAIL: 卡片非第3/5步"; exit 1; }
curl -sf "$BASE_URL/api/workers/$AGENT_WIN/activity" -H "X-Tenant-Id: $TENANT_A" | jq -e '[.current.steps[]|select(.status=="done")]|length>=3 and all(.[];.screenshot_ref!=null)' >/dev/null || { echo "FAIL: 详情三步/截图缺"; exit 1; }

# 5. 推帧 → live ≥2 帧（Step 3）
for i in 1 2 3 4 5; do curl -sf "$BASE_URL/api/workers/$AGENT_WIN/frame" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d "{\"frame_jpeg_b64\":\"$(head -c 96 /dev/urandom | base64 | tr -d '\n')\"}" >/dev/null; sleep 0.2; done
FRAMES=$(timeout 10 curl -s "$BASE_URL/api/workers/$AGENT_WIN/live" -H "X-Tenant-Id: $TENANT_A" | head -c 8000 | grep -c -- '--frame' || true)
[ "${FRAMES:-0}" -ge 2 ] || { echo "FAIL: live 帧数 $FRAMES <2"; exit 1; }

# 6. failed 缺三件套 400；带三件套现场落库（Step 4，invariant 93ed0761）
TID2=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"title":"私信","steps":["x","y"],"executor_id":"e2e-fake-executor"}' | jq -er '.task_id')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/tasks/$TID2/steps" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"step_index":0,"status":"failed","executor_id":"e2e-fake-executor"}')
[ "$CODE" = "400" ] || { echo "FAIL: 缺三件套未 400 ($CODE)"; exit 1; }
curl -sf "$BASE_URL/api/workers/tasks/$TID2/steps" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d "{\"step_index\":0,\"status\":\"failed\",\"foreground_pkg\":\"com.tencent.mm\",\"diag_line\":\"foreground stolen after tap\",\"screenshot_jpeg_b64\":\"$(printf failshot | base64)\",\"executor_id\":\"e2e-fake-executor\"}" >/dev/null
curl -sf "$BASE_URL/api/workers/$AGENT_AND/activity" -H "X-Tenant-Id: $TENANT_A" | jq -e '[.current.steps[],(.history[]?.steps//[])[]]|map(select(.status=="failed"))|any(.foreground_pkg=="com.tencent.mm" and (.diag_line|test("stolen")) and .screenshot_ref!=null)' >/dev/null || { echo "FAIL: 失败现场三件套未落库"; exit 1; }

# 7. 同 agent 二次 tasks 409；跨租户 activity 404（Step 5）
DUP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{"title":"重复","steps":["a"],"executor_id":"e2e-fake-executor"}')
[ "$DUP" = "409" ] || { echo "FAIL: 二次 tasks 未 409 ($DUP)"; exit 1; }
X404=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/$AGENT_WIN/activity" -H "X-Tenant-Id: $TENANT_B")
[ "$X404" = "404" ] || { echo "FAIL: 跨租户 activity 未 404 ($X404)"; exit 1; }
XL=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/workers/$AGENT_WIN/live" -H "X-Tenant-Id: $TENANT_B")
[ "$XL" = "404" ] || { echo "FAIL: 跨租户 live 未 404 ($XL)"; exit 1; }

# 8. Playwright UI（打真实后端，禁 page.route() stub；总览页 + 详情页）
( cd apps/dashboard && npx vite --port 5174 >/tmp/worker-vite.log 2>&1 ) &
VITE_PID=$!
for i in $(seq 1 30); do curl -sf http://localhost:5174 >/dev/null 2>&1 && break; [ "$i" = 30 ] && { echo "FAIL: vite 未就绪"; exit 1; }; sleep 1; done
( cd apps/dashboard && E2E_BASE_URL=http://localhost:5174 VITE_API_URL="$BASE_URL" npx playwright test e2e/workers.spec.ts --reporter=list )

echo "✅ worker 活动协议 Golden Path E2E 全过"
```
