# Sprint PRD：安卓端补全"采集"两阶段协议 v2

sprint_id: 07091806-android-collect-protocol-v2
task_id: 12cf47d4-5ef8-4d91-aff2-fb72fd25f4cf
journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
feature_id: 6a2c546f-b0d0-4535-9f54-e8d5deeeaa61
journey_type: user_facing
target_environment: local_api

---

## 问题陈述

Dashboard「智能获客 → 采集」页面提交后，安卓手机零响应。

根因：服务端两条管线并存——

- 旧协议 `acquisition_keyword_tasks` + `/pending-keyword-tasks`：`AcquisitionKeywordPollLoop.kt` 已实现并跑通（PR #1202）
- 新协议 `acquisition_collect_tasks` + `/pending-collect-tasks` + `/collect/report` + `/collect/cancel`：API 端三个端点均已实现，但安卓 Agent 代码库对这三个端点**零引用**

本 sprint 只新增安卓客户端实现，不改服务端，不改 Dashboard，旧协议双跑保留。

---

## 涉及 Journey & Feature

- Journey：Path 2 客户智能获客（afa6abca）
- Feature：客户智能获客采集闭环（6a2c546f），thickness: thin → medium

---

## Invariant 约束

Brain API 端点 `/api/brain/journey/.../invariants` 返回 404（端点未实现）。

N/A — 无外部注册的 invariant，以下为从代码库提取的硬约束：

1. **跨租户隔离**：`/pending-collect-tasks` 按 `x-agent-id` 反查 `agents.tenant_id`，只返本租户任务；Agent 必须携带 `x-agent-id: config.agentId`（非 licenseKey）
2. **采集互斥锁**：`ScanMutex.busy` 在采集任务运行期置 `true`，结束后复位；账号扫描循环据此跳过，不得绕过
3. **一次性上报闩**：`DouyinCollectService.resultReported` 保证同一任务只上报一次，新循环不得重置此标记
4. **广播不可靠**：真机（MagicOS/荣耀）系统广播不可靠；必须沿用 `DouyinCollectService.onCollectResult` 同进程回调路径

---

## 累积 FR

Brain API 端点 `/api/brain/features/.../fr` 返回 404（端点未实现）。

从 PrepPRD 和代码库整理，共 6 条：

1. **FR-1 轮询**：`AcquisitionCollectPollLoop` 每 30s 轮询 `GET /api/acquisition/pending-collect-tasks`，头携 `x-agent-id`，返回 `{tasks, total}`
2. **FR-2 Stage1**：收到 `stage: "stage_1"` 任务 → 对 `keywords` 里每个词调 `DouyinCollectService.dispatchTask`（逐词搜索、记录视频卡片的 videoId/title）→ 调 `POST /api/acquisition/collect/report`（含 `video_id`、`commenters:[]`、`checkpoint`，`terminal=false`）→ 服务端写入 `acquisition_collect_videos` 后将任务状态推进为 `stage_1_done`
3. **FR-3 Stage2**：收到 `stage: "stage_2"` 任务 + `video_urls` → 依次打开每个 URL，抓评论者 → 每抓完一个视频调 `POST /api/acquisition/collect/report`（含 `commenters`、`checkpoint`），最后一个视频带 `terminal=true`
4. **FR-4 Checkpoint**：每次 `collect/report` 携带 `checkpoint: {last_video_id, processed_video_ids:[...]}` 以支持断点续传；重启后跳过 `checkpoint.processed_video_ids` 中已处理的视频
5. **FR-5 取消**：轮询时若 `status=cancelling`（服务端已存在 `/collect/cancel` 端点），Agent 停止当前采集，调 `POST /collect/report`（`terminal=true, partial_reason:"user_cancelled"`）
6. **FR-6 AgentService 集成**：`AgentService.initAgent()` 新增 `collectPollLoop = AcquisitionCollectPollLoop(...)` 并在 `onDestroy` 中 `stop()`，与现有 `keywordPollLoop` 并行运行

---

## NFR

- **轮询间隔**：30s（与旧协议一致），随机抖动 ±2s 防雪崩
- **Stage1 每关键词视频数量上限 N = 3**：搜索结果页取前 3 张视频卡，避免单任务占用无障碍服务过久（平均每视频约 25s，3 个视频约 75s/关键词；单关键词超过 3 分钟触发超时兜底）
- **Stage2 超时兜底**：沿用 `DouyinCollectService.EXTRACTION_TIMEOUT_MS = 20_000L`；整个 Stage2 总超时 10 分钟（服务端 `collect/sweep-timeouts` 兜底转 `failed`）
- **节点遍历上限**：沿用 `MAX_FLATTEN_NODES = 3_000`，防止热门评论区卡死
- **报告失败重试**：HTTP 失败最多重试 1 次（退避 5s），之后跳过本视频继续；不因单视频网络失败中止整个任务
- **并发保护**：Stage1/Stage2 不得与 `AcquisitionKeywordPollLoop` 同时并行抓同一关键词；通过 `ScanMutex.busy` 保证同一时刻最多一个采集任务在运行

---

## 关键设计决策（解决 PrepPRD 已知缺口）

### 缺口 1：Stage1 回报端点

**推荐方案：扩展现有 `POST /collect/report`，不新增端点。**

理由：现有 `collect/report` 已有以下字段：
- `task_id`、`video_id`、`commenters`（可为空数组 `[]`）、`checkpoint`、`terminal`、`video_title`、`thumbnail_url`、`publish_date`

Stage1 只需传 `commenters:[]`（0 条评论者）+ `terminal:false`，服务端已有逻辑：
- `video_count + 1`（视频维度记录）
- `INSERT INTO acquisition_collect_videos`（video_id、title 等字段落库）
- 状态不变为 `running`（非终态不跳到 `stage_1_done`）

**`stage_1_done` 状态推进方式**：Agent 在 Stage1 所有关键词的视频全部上报完毕后，发最后一次 `collect/report`（含 `checkpoint`、`terminal:false`）并等待下一轮轮询返回 `stage:"stage_2"`。服务端需在 `collect/report` 中增加一条：当 `terminal=false` 且视频数量已达 `keywords.length × N`（即全部关键词 Stage1 完成）时将状态更新为 `stage_1_done`。

> **注意**：此逻辑需要服务端 `collect/report` 做一行新判断（对比 `video_count >= keywords.length × N`）。这是本 sprint 唯一需要服务端配合的改动，范围极小，不破坏现有接口。

若不改服务端，备选方案是新增 `POST /collect/stage1-done`，但会引入新端点，优先排除。

### 缺口 2：候选视频数量 N

**N = 3**（每关键词取前 3 个视频卡）。

理由：
- 现有 `findFirstVideoCard()` 只点第 1 个，新逻辑复用其尺寸阈值匹配逻辑，按顺序取前 3 个
- 3 个视频 × 25s/视频 = 75s/关键词，在旧协议 `EXTRACTION_TIMEOUT_MS=20s` + 容忍范围内
- `MAX_FLATTEN_NODES=3_000` 对 3 个视频的评论采集已足够

### 缺口 3：AcquisitionCollectPollLoop 集成点

| 集成点 | 操作 |
|---|---|
| `AgentService.kt` 第 57 行（`keywordPollLoop` 字段旁） | 新增 `private var collectPollLoop: AcquisitionCollectPollLoop? = null` |
| `AgentService.initAgent()` 第 263 行 `keywordPollLoop?.start()` 之后 | 实例化并 `collectPollLoop?.start()` |
| `AgentService.onDestroy()` 第 175 行 `keywordPollLoop?.stop()` 旁 | 补 `collectPollLoop?.stop()` |
| `DouyinCollectService.onCollectResult` 回调（`AgentService` onCreate 第 153 行） | 回调内区分 keyword_task_id（旧协议）和 collect_task_id（新协议）：若 taskId 来自新协议，路由到 `reportCollectTaskResult()`（调 `/collect/report`）而非现有 `reportCollectResult()`（调 `/comment-score-result`） |

**任务 ID 区分策略**：`AcquisitionCollectPollLoop` 下发任务时在内存 Set 中记录 `collectTaskIds`；`onCollectResult` 回调收到 taskId 时先查该 Set，命中则走新协议上报路径，否则走旧协议。

---

## 新增文件

| 文件 | 说明 |
|---|---|
| `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoop.kt` | 两阶段采集主循环（参照 `AcquisitionKeywordPollLoop.kt` 结构） |
| `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoopTest.kt` | 单元测试（MockWebServer，覆盖 `pollOnce()` 的 stage_1/stage_2/empty/cancel 场景） |

---

## 修改文件

| 文件 | 改动 |
|---|---|
| `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt` | 集成 `AcquisitionCollectPollLoop`（3 处，见上方集成点说明） |
| `apps/api/src/routes/acquisition.ts` | `collect/report` 增加 `stage_1_done` 推进判断（1 处，约 5 行） |

---

## 验收标准（E2E）

| # | 验收条件 | 验证方式 |
|---|---|---|
| E1 | 提交后 ≤30s 手机自动打开抖音搜索关键词 | 真机观察 + `adb logcat` 看 `AcquisitionCollectPollLoop` 日志 |
| E2 | 一次任务抓到 ≥2 个不同视频来源的评论者 | Dashboard「名单」页出现 ≥2 条 `collect_task_id` 匹配的新 lead |
| E3 | 断点续传：强杀重启后不重复抓已处理视频 | `psql` 核查 `acquisition_leads.source_video_ids` 无重复 video_id |
| E4 | 取消：30s 内 Agent 停止，`acquisition_collect_tasks.status = 'cancelled'` | `psql SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='<task_id>'` |
| E5 | `AcquisitionCollectPollLoopTest` 全通 | `./gradlew :app:testDebugUnitTest` CI 绿 |

---

## 开发顺序（E2E-First）

```
commit-1：AcquisitionCollectPollLoopTest.kt（失败，定义完成条件）
commit-2：AcquisitionCollectPollLoop.kt + AgentService.kt 集成 + acquisition.ts stage_1_done 判断
```

---

## Path 推进声明

本 PR 把 **Path 2 Step 5**（系统自动建本地表 + Agent 端采集闭环）从 ❌ 推进到 🔴（安卓端两阶段协议接通，待真机验收）
