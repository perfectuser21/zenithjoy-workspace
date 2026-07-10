# 契约：Stage1 视频清单回报端点 + 服务端终态结算

补 prep-prd 缺口#1。以下内容以代码实际行为为准（`apps/api/src/routes/acquisition.ts`、
`apps/api/src/services/acquisition-collect.ts`、`apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql`），
design.md 是设计意图，本文档是实现落地后的契约。

来源任务：Brain dev task `4fad361c-5cf9-4ea6-90c3-0023059c04ff`。
设计文档：`sprints/07101420-stage1-report-videos/design.md`。

---

## 1. 新端点 `POST /api/acquisition/collect/report-videos`

安卓 agent 一次性搜索完关键词、拿到整张视频清单后调用；幂等可重入（同一清单重复回报不重复计数）。

### 1.1 鉴权

- 请求头 `x-agent-id` 必填。
  - **缺失** → `401 MISSING_AGENT_ID`。
  - `x-agent-id` 反查 `zenithjoy.agents.agent_id` 取不到行（未注册 agent）→ **403 UNKNOWN_AGENT**。
- 任务按 `(id, tenant_id)` 查（`tenant_id` 取自反查到的 agent 归属租户，不信任 body）：
  - 查不到 → **404 NO_COLLECT_TASK**。
  - `task.agent_id` 非空且 ≠ `x-agent-id`（任务已绑定别的 agent）→ **403 AGENT_MISMATCH**。
  - 任务未绑定 agent（`agent_id IS NULL`）时首次回报会把任务绑定到当前 `x-agent-id`（`COALESCE(agent_id, $xAgentId)`）。

### 1.2 请求体

```json
{
  "task_id": "uuid",
  "videos": [
    {
      "video_id": "string（必填）",
      "keyword": "string（可选，当前实现未落库，仅占位）",
      "title": "string | null（可选）",
      "thumbnail_url": "string | null（可选）",
      "publish_date": "string | null（可选，ISO 日期）"
    }
  ],
  "reason": {
    "search_result": "'empty'（可选）",
    "error_code": "string（可选）"
  }
}
```

- `task_id` 缺失 → **400 MISSING_TASK_ID**。
- `videos` 数组里没有 `video_id` 的项会被过滤丢弃（`videos.filter(v => v && v.video_id)`），不报错。
- `videos` 有效项为空（即传空数组，或全被过滤掉）且 `reason.search_result !== 'empty'` 且 `reason.error_code` 未给 → **400 MISSING_REASON**（空清单必须带 reason）。

### 1.3 响应信封

统一走 `ok()` / `fail()`：

```json
// 成功
{ "success": true, "data": { ... }, "timestamp": "ISO8601" }
// 失败
{ "success": false, "error": { "code": "STRING", "message": "STRING" }, "timestamp": "ISO8601" }
```

### 1.4 响应码表

| 场景 | HTTP | code | data / 备注 |
|---|---|---|---|
| 缺 `x-agent-id` | 401 | `MISSING_AGENT_ID` | — |
| agent 未注册 | 403 | `UNKNOWN_AGENT` | — |
| 缺 `task_id` | 400 | `MISSING_TASK_ID` | — |
| 空清单无 reason | 400 | `MISSING_REASON` | — |
| 任务不存在（按 id+tenant） | 404 | `NO_COLLECT_TASK` | — |
| 任务已绑定其他 agent | 403 | `AGENT_MISMATCH` | — |
| 任务已终态（done/partial/failed/cancelled） | 409 | `TASK_TERMINAL` | message 含当前 status |
| 任务处于 `cancelling` | 200 | — | `{task_id, status:'cancelled', video_count:0, accepted:0}`（落章路径，见 §3） |
| 清单非空，正常回报 | 200 | — | `{task_id, status:'stage_1_done', video_count:<distinct总数>, accepted:<本次提交条数>}` |
| 清单为空 + `search_result='empty'` | 200 | — | `{task_id, status:'partial', video_count:0, accepted:0}`，`error_code='stage1_empty'` 落库（不出现在响应体） |
| 清单为空 + `reason.error_code` | 200 | — | `{task_id, status:'failed', video_count:0, accepted:0}`，`error_code=<reason.error_code>` 落库 |
| DB 异常 | 500 | `DB_ERROR` | message = 异常原文 |

注：终态判定用 **409**（新端点、新 agent 代码，可安全处理非 200），与旧 `/collect/report` 端点的「200+ignored」策略不同（旧 agent 在网，避免对非 200 死循环重试）。

### 1.5 幂等语义

- 视频落库走 `INSERT ... ON CONFLICT (task_id, video_id) DO UPDATE`，只更新 `title/thumbnail_url/publish_date`（用 `COALESCE(EXCLUDED.x, 旧值)`，不会用 `null` 覆盖已有值）+ `updated_at`，**不动 `comment_count`**。
- `acquisition_collect_tasks.video_count` 每次回报都用 `SELECT count(*) FROM acquisition_collect_videos WHERE task_id=$1` **按 distinct 视频数重算**，不是累加。
- 结论：同一清单（或有重叠的清单）重复回报 → `video_count` 不会虚高，`accepted` 只反映本次请求体条数（不是去重后条数）。

### 1.6 空清单三分支

| 输入 | 结算 | error_code |
|---|---|---|
| `videos:[]` 且无 `reason` | 400 拒绝，不落库 | — |
| `videos:[]` + `reason.search_result='empty'` | `partial` | `stage1_empty` |
| `videos:[]` + `reason.error_code=X`（X 优先于 search_result） | `failed` | `X` |

`video_count` 在这三种分支里都不变（空清单分支不写 `acquisition_collect_videos`）。

---

## 2. `settleCollectTask()` 纯函数

`apps/api/src/services/acquisition-collect.ts:212`，`report` / `report-videos` / `sweep-timeouts` 三处共用，单测覆盖全部分支（`acquisition-collect.test.ts`）。

```ts
settleCollectTask(input: {
  currentStatus: string;
  agentTerminal?: { terminal?: string; error_code?: string|null; partial_reason?: string|null } | null;
  videoTotal: number;
  videoDone: number;
  leadCount: number;
}): { status: CollectStatus; error_code: string|null; changed: boolean }
```

分支优先级（自上而下）：

1. `currentStatus` 已是终态（`done/partial/failed/cancelled`）→ `changed=false`，原样返回（守卫，防二次结算/二次点火）。
2. `currentStatus === 'cancelling'` → `{status:'cancelled', changed:true}`（唯一落章路径）。
3. `agentTerminal.terminal === 'failed'` → `{status:'failed', error_code:agentTerminal.error_code, changed:true}`。
4. `agentTerminal.terminal === 'done'`：`videoTotal>0 && videoDone>=videoTotal`（全完成）→ `done`；否则诚实降级 → `partial`（`error_code = partial_reason ?? 'videos_incomplete'`）。
5. `agentTerminal.terminal === 'partial'` → `{status:'partial', error_code: partial_reason ?? error_code ?? null, changed:true}`。
6. `agentTerminal.terminal` 存在但非标准值（如旧 agent 的 `'stage_1'`）→ `stage_1_done`（`changed = currentStatus !== 'stage_1_done'`）。
7. 无 `agentTerminal`：仅当 `currentStatus === 'stage_1_done' && videoTotal>0 && videoDone>=videoTotal` → 自动 `done`（服务端据视频清单自然推进，不需要 agent 显式发终态）。
8. 兜底：不变（`changed=false`）。

---

## 3. 状态机

8 态（CHECK 约束，`20260628` migration，未改）：`pending / running / cancelling / cancelled / done / stage_1_done / partial / failed`。

```
pending ──(agent 领取 GET /pending-collect-tasks)──▶ running
running ──(POST /collect/report-videos，清单非空)──▶ stage_1_done
running ──(POST /collect/report-videos，清单空+empty)──▶ partial(stage1_empty)
running ──(POST /collect/report-videos，清单空+error_code)──▶ failed(X)
running ──(POST /collect/report，视频全回完 或 agent terminal)──▶ done|partial|failed
stage_1_done ──(POST /collect/report，Stage2 视频逐个回完，全 done 无需 terminal)──▶ done
stage_1_done ──(POST /collect/report，agent terminal=partial/failed)──▶ partial|failed
pending|running|cancelling(经 POST /collect/cancel 触发) ──▶ cancelling
cancelling ──(下一次 report 或 report-videos 命中该任务)──▶ cancelled   ★ 修复：此前全 repo 无写 cancelled 路径，cancelling 会被 resolveTerminalStatus 覆盖为 done
done|partial|failed|cancelled（终态）──(任何回报)──▶ 不变（report-videos:409 TASK_TERMINAL；report:200+ignored）
```

`cancelling → cancelled` 落章不是靠专门的轮询/定时任务，而是「下一次任意回报打到该任务时顺手结算」——若任务已停机不再回报，会停在 `cancelling` 直到 sweep-timeouts 命中（sweep 目前只扫 `running`/`stage_1_done`，不扫 `cancelling`；`cancelling` 任务需等 agent 恢复回报或人工介入，属已知限制，范围外）。

---

## 4. 旧 `POST /collect/report` 行为变更

相对改动前（design.md 问题描述的倒推版本），以下是**行为变更点**：

1. **终态后回报被拒改为 ignored，不再倒推**：删除了 `acquisition.ts` 原 `:1001-1019` 的「评论回报次数 ≥ keywords×3 倒推 stage_1_done」整段逻辑。Stage1 推进现在**只**走新端点 `POST /collect/report-videos`；旧 `/collect/report` 不再能把任务从 `running` 推进到 `stage_1_done`。
2. **终态任务回报 → 200 + `{ignored:true, status}`，零写库**：不用 409（在网旧 agent 对非 200 可能死循环重试，风险高于对 200+ignored 无感知）。事务里查到终态立刻 `ROLLBACK`，不落任何数据。
3. **`video_count` 计数口径改为 distinct 重算**：不再对 `comment_count`/`video_count` 盲加，`report` 内部每次都 `SELECT count(*) AS total, count(comments_reported_at) AS done FROM acquisition_collect_videos WHERE task_id=$1` 重新算，防 Stage2 重试造成计数虚高。
4. **视频 upsert 键改为 `(task_id, video_id)`**：原单列 `video_id` 主键会让同一条抖音视频被两个不同 task 命中时互相覆盖；migration `20260710_150000_collect_videos_composite_pk.sql` 已把主键改为复合键 `(task_id, video_id)`。
5. **每次视频评论回报打 `comments_reported_at = NOW()`**：`ON CONFLICT (task_id, video_id) DO UPDATE` 分支里对该视频打时间戳，标记该视频 Stage2 已完成。
6. **`cancelling → cancelled` 落章路径新增**：修复此前「全 repo 无任何路径写 `cancelled`，取消永远停在 `cancelling`，被 `resolveTerminalStatus` 覆盖成 `done`」的 bug。`report` 和 `report-videos` 都能命中此分支。
7. **终态结算统一走 `settleCollectTask`**：不再是端点内联判断，行为在 §2 集中定义、纯函数可单测。
8. **`GET /pending-collect-tasks` — Stage2 只发未完成视频**：`stage_1_done` 分支下发视频清单时新增 `WHERE comments_reported_at IS NULL` 过滤，agent 断线重连不会重复拿到已回报完的视频。
9. **`POST /collect/sweep-timeouts` 扩容**：原来只扫 `status='running'`，现扩到 `status IN ('running','stage_1_done')`。`running` 用 `COALESCE(started_at, updated_at, created_at)` 做超时基准（不变）；**`stage_1_done` 用 `updated_at` 做超时基准**（`started_at` 在首次回报即定格不再更新，若用它算超时会误杀正在正常跑 Stage2 的任务；Stage2 每次 `report` 都会 touch `updated_at`）。sweep 命中后走 `settleCollectTask` 语义结算：有 `lead_count>0` → `partial(COLLECT_TIMEOUT)`，否则 → `failed(COLLECT_TIMEOUT)`。

### 未变的行为

- 不加鉴权（在网旧 agent 无 `x-agent-id`，加鉴权会直接断线，鉴权只在新端点 `/collect/report-videos`）。
- 事务模型不变：任务读+写包在同一事务、`FOR UPDATE` 锁行；`rescoreLead` 事务内传 `client`（不能传 `pool`，否则读不到未提交数据）；SSE `emit`/`close` 与 dispatch 链放在 `COMMIT` 之后执行。
- 对旧 payload（不带 `terminal`/`checkpoint` 等新字段）完全兼容；旧 agent 发 `terminal:'stage_1'` 时 `resolveTerminalStatus`/`settleCollectTask` 的非标准值分支照旧落 `stage_1_done`。
- 纯靠倒推进 `stage_1_done` 的旧 agent（不发 `terminal`、也不调新端点）不再能自动推进 Stage1，会被扩容后的 sweep 兜成 `partial`/`failed`——不再卡死，但会以失败收场（已知降级，design.md 判定可接受）。

---

## 5. 参考：数据库变更

`apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql`：

- `acquisition_collect_videos` 主键 `video_id` → `(task_id, video_id)`（全库无 FK 引用该表，无需数据清洗）。
- 新增 `comments_reported_at timestamptz`（NULL=Stage2 未完成）。
- 生产落地：hk-vps + mmv 两台独立 postgres 各跑一遍（merge 后 promote 时人工执行，死规则）。
