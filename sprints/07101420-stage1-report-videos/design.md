# 设计：Stage1 视频清单回报端点 + 服务端终态结算（多视频协议闭环 PR1-2）

任务：Brain dev task `4fad361c-5cf9-4ea6-90c3-0023059c04ff`
PrepPRD：`sprints/07101420-stage1-report-videos/prep-prd.md`
设计审查：Research Subagent APPROVE（2026-07-10，修正点已并入下文）

## 问题

两阶段采集协议断层：API 靠「评论回报次数 ≥ keywords×3」倒推 stage_1_done（acquisition.ts:1001-1019），但 Stage1 搜索清单回报端点从未定义，安卓端抓 1 个视频就停 → `acquisition_collect_tasks` 永远卡 running。另有现存 bug：全 repo 无任何路径写 `cancelled`，取消停在 `cancelling` 后被 `resolveTerminalStatus` 覆盖成 done。

## 方案（已选：单次可重入清单回报 + 纯函数结算）

备选过的方案：A. 按 keyword 多次回报 + 服务端聚合状态机（复杂度高、agent 端也要配合改，否决）；B. 沿用倒推逻辑只调阈值（治标，视频数不足 3 时依然卡死，否决）；**C（选定）**：agent 搜完一次性回报整张清单，端点幂等可重入，服务端终态由纯函数统一结算。

### 1. 新端点 `POST /api/acquisition/collect/report-videos`

- **鉴权**：`x-agent-id` 反查 `zenithjoy.agents.tenant_id`；任务按 `(id, tenant_id)` 查（404）；`task.agent_id` 非空且 ≠ x-agent-id → 403。
- **body**：`{task_id, videos: [{video_id, keyword?, title?, thumbnail_url?, publish_date?}], reason?: {search_result?: 'empty', error_code?: string}}`
- **videos 非空**：事务 + `SELECT ... FOR UPDATE` 锁任务行 → 批量 upsert `acquisition_collect_videos ON CONFLICT (task_id, video_id) DO UPDATE`（只更新元数据，不动 comment_count）→ `status='stage_1_done'`，`video_count` 按该任务 distinct 视频数**重算**（幂等：重复回报返回同结果、不重复计数）。
- **videos 空**：`reason.search_result='empty'` → partial 终态（error_code=`stage1_empty`）；`reason.error_code` → failed 终态（checkpoint 保留可重试）；无 reason → 400。
- **状态守卫**：任务已终态 → **409** 拒绝（新端点新 agent 代码，可处理非 200）；`cancelling` → 结算为 `cancelled`（落章，修现存 bug）。

### 2. `settleCollectTask()` 纯函数（acquisition-collect.ts，可单测）

```
入参 {currentStatus, agentTerminal?, videoTotal, videoDone, leadCount}
出参 {status, error_code, changed}
```
分支：已终态 → `changed=false`（守卫）；`cancelling` → `cancelled`；agent 报 failed → failed+error_code；`videoTotal>0 && videoDone>=videoTotal` → done；agent 报 done/partial 但 `videoDone<videoTotal` → partial（诚实结算）；否则不变。**report、report-videos、sweep-timeouts 三处共用**；dispatch 链只在 `changed && 新状态是终态` 那一次点火。

### 3. 联动改现有 `POST /collect/report`

- 删 :1001-1019 倒推逻辑（`MAX_VIDEOS_PER_KEYWORD` 阈值判定整段）。
- 终态守卫：终态任务回报 → **200 + `{ignored: true, status}`** 不写库（不用 409：在网老 agent 对非 200 可能死循环重试）。
- 任务读+写包事务 + FOR UPDATE；**事务内 `rescoreLead` 传事务 client**（`QueryablePool` 接口 PoolClient 天然满足，传 pool 会用另一连接读不到未提交数据）；**SSE emit/close 与 dispatch 链放 COMMIT 之后**。
- videos upsert 键改 `ON CONFLICT (task_id, video_id)`；`video_count` 与新端点统一按 distinct 重算（弃盲加，防 Stage2 重试虚高）。
- 每次视频评论回报给该 video 打 `comments_reported_at = NOW()`。
- 终态结算走 `settleCollectTask`（含 cancelling→cancelled 落章）。
- **不加鉴权**（在网 agent 会断；鉴权只在新端点）。

### 4. Migration（apps/api/db/migrations/ 新文件）

- `acquisition_collect_videos`：`DROP CONSTRAINT acquisition_collect_videos_pkey; ADD PRIMARY KEY (task_id, video_id)`（旧单列 PK 保证无跨 task 冲突数据，无清洗前置；全库无 FK 引用该表，:294 存在性检查不受影响）+ `ADD COLUMN IF NOT EXISTS comments_reported_at timestamptz`。
- 状态 CHECK 约束已含 8 态（20260628 migration），不动。
- 生产落地：hk-vps + mmv 两台独立 postgres 各跑一遍（死规则，merge 后 promote 时执行）。

### 5. `GET /pending-collect-tasks`

stage_1_done 分支只下发 `comments_reported_at IS NULL` 的视频（Stage2 只发未完成）。

### 6. `POST /collect/sweep-timeouts`

扩到 `status IN ('running','stage_1_done')`；**stage_1_done 用 `updated_at` 作超时基准**（started_at 在首报即定格，会误杀正在跑 Stage2 的任务；Stage2 每次 report 都 touch updated_at）；结算走 settleCollectTask 语义（有 lead → partial，无 → failed）。

### 7. 契约文档

端点 schema、幂等语义、状态机图落 `sprints/07091806-android-collect-protocol-v2/`（补 prep-prd 缺口#1）。

## 向后兼容

- 旧 agent 发 `terminal:'stage_1'` → `resolveTerminalStatus` 非标准值分支照旧落 stage_1_done，不受影响。
- 纯靠倒推进 stage_1_done 的旧 agent（不发 terminal）不再自动推进，由扩容后的 sweep 兜成 partial/failed——不卡死，可接受降级。
- 旧 report 对旧 payload 全兼容（新行为只有终态 ignored 与计数口径）。

## 测试策略

- **unit（vitest，主力）**：`settleCollectTask` 四终态分支 + 守卫 + cancelling 落章（纯函数直测）；新端点鉴权 403 / 无 reason 400 / 空清单 partial 与 failed / 幂等重报不重计数 / 终态 409；旧 report 终态 ignored 守卫、dispatch 只点一次火；sweep stage_1_done 基准。路由测试沿用 `vi.mock('../db/connection')` 模式，**mock 需补 `pool.connect` 返回 fake client**（照抄 walking-skeleton.service.test.ts:85-100 先例）。
- **integration**：不新增（DB 行为由 migration + mock SQL 断言覆盖）。
- **E2E**：不涉及 UI/真机，纯 API 侧；CI vitest + smoke 即可。
- **smoke（feat PR 强制）**：`.github/workflows/scripts/smoke/` 新增脚本打新端点走通一条幂等回报链，登记进 smoke baseline（新 smoke 必须登记，无 API 环境时诚实 SKIP + REQUIRE_API=1）。

## 范围外

- 安卓端多视频循环（下一个 PR）。
- 生产 dispatch 链逻辑不改，只改触发点归属。
