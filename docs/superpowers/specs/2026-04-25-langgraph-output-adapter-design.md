# LangGraph Output Adapter — pending 状态不 404

**日期**：2026-04-25
**分支**：cp-0423103152-langgraph-output-adapter
**范围**：zenithjoy `apps/api`

## 背景

Cecelia Brain 的 LangGraph Content Pipeline 用 `task.id`（UUID，同时作 `langgraph thread_id` 和 `cecelia_task_id`）为身份。zenithjoy api 已经做过一轮 adapter（PR #198/#199/#209）让 `/api/pipeline/:id/output` 和 `/api/pipeline/:id/stages` 能从 `cecelia_events` 表兜底读 LangGraph 任务事件，并在 `langgraph-adapter.ts` 里沉淀了工具函数（`fetchLangGraphEvents` / `buildOutputFromEvents` / `buildStagesFromEvents` / `listLangGraphOnlyRuns`）。

## 问题

`pipeline.controller.ts` 的 `getOutput` 和 `getStages` 在 `pipeline_runs` 无 row 时会走 404（`:254` / `:337`）。这对**纯 LangGraph 任务刚触发、事件尚未写入**的情形是误杀：

1. 前端 / 外部系统用 `cecelia_task_id` UUID 访问 `/api/pipeline/:id/output`。
2. `zenithjoy.pipeline_runs` 无对应 row。
3. `cecelia_events` 表里 events 数为 0（Brain 刚把 task 派发下去，第 1 个节点还没跑完）。
4. 当前代码返回 404 → 前端详情页显示错误，用户体感"任务失败了"，实际任务正在跑。

## 目标

纯 LangGraph 任务在**任意生命周期阶段**（pending / running / completed / failed）访问 `/output` 和 `/stages` 都能得到 200 + 正确结构；只有**任务真的不存在**时返 404。

## 非目标（YAGNI）

- 不改 `rerun` / `trigger` / `list` 其它 handler（已正确）。
- 不引入 HTTP fallback 到 cecelia Brain（`pipeline.test.ts:325` 注释明令禁止）。
- 不重构 controller 拆分。
- 不改 `listLangGraphOnlyRuns` 已有逻辑。

## 设计

### 1. 新增 `existsLangGraphTask(taskId)` 工具函数

文件：`apps/api/src/services/langgraph-adapter.ts`

```ts
export async function existsLangGraphTask(taskId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM tasks WHERE id = $1 AND task_type = 'content-pipeline' LIMIT 1`,
    [taskId]
  );
  return rows.length > 0;
}
```

**为什么**：已有 `listLangGraphOnlyRuns` 查同一个 `tasks` 表同一个 `task_type` 过滤。用主键命中，成本 ~1ms。

### 2. `getOutput` 404 分支改造

文件：`apps/api/src/controllers/pipeline.controller.ts:254`

**现状**：`row` 无 + `ceceliaTaskId` 有 + `events` 为空 → 掉到 `if (!row) 404`。

**改为**：`row` 无 + `ceceliaTaskId` 有 → 调 `existsLangGraphTask(ceceliaTaskId)`。

- 存在 → 返回 pending 结构（复用现有 `if (!manifest)` 分支 shape）：
  ```json
  {
    "output": {
      "pipeline_id": "<ceceliaTaskId>",
      "keyword": "",
      "status": "pending",
      "article_text": null,
      "cards_text": null,
      "image_urls": [],
      "export_path": null,
      "images": null
    }
  }
  ```
- 不存在 → 保留 404。

### 3. `getStages` 404 分支改造

文件：`apps/api/src/controllers/pipeline.controller.ts:337`

同样改造：`row` 无 + `ceceliaTaskId` 有 + `events` 为空 → 调 `existsLangGraphTask`。

- 存在 → 返回：
  ```json
  {
    "stages": {},
    "overall_status": "pending",
    "events": []
  }
  ```
- 不存在 → 404。

### 4. 决策：pending 返回的 `pipeline_id` 用 `ceceliaTaskId`

两者此场景等价（:id 本身就是 UUID=ceceliaTaskId），取 `ceceliaTaskId` 语义更准，与 `buildOutputFromEvents` 保持一致（第二参数 `routeId` 设计初衷）。

## 数据流

```
GET /api/pipeline/<uuid>/output
  │
  ├─ SELECT pipeline_runs WHERE id=<uuid>
  │    ├─ row 有 manifest → 读文件 → 返 output
  │    ├─ row 有 + manifest 无 + events 有 → buildOutputFromEvents
  │    ├─ row 有 + manifest 无 + events 无 → pending（走 :258）
  │    └─ row 无 → 下一步
  │
  ├─ ceceliaTaskId = isUuid(:id) ? :id : null
  │    └─ null → 404
  │
  ├─ fetchLangGraphEvents(ceceliaTaskId)
  │    └─ events 有 → buildOutputFromEvents → 200
  │
  └─ events 空 → existsLangGraphTask(ceceliaTaskId)
       ├─ true → 200 pending
       └─ false → 404
```

同构适用于 `/stages`。

## 错误处理

- `existsLangGraphTask` 查询失败 → 外层 try/catch 落 500（与现有一致）。
- 非 UUID + 无 row → `ceceliaTaskId === null` → 短路直接 404，不查 `tasks` 表。

## 测试

文件：`apps/api/tests/pipeline.test.ts`

**原有 2 个测试改造**：

`it('should return 404 when pipeline_run does not exist')`（`:301` / `:349`）拆为两个：

1. `should return pending when LangGraph task exists but no events yet`
   - mock：pipeline_runs 空 + cecelia_events 空 + tasks 有 1 row
   - 断言：200，`status: 'pending'`，`article_text: null`，`image_urls: []`

2. `should return 404 when LangGraph task does not exist`
   - mock：pipeline_runs 空 + cecelia_events 空 + tasks 空
   - 断言：404

`/stages` 同样两条。共 4 个测试（新增 2，改 2）。

`langgraph-adapter.test.ts` 加 1 个 `existsLangGraphTask` 单测（mock pool，返回/不返回 row）。

## 向后兼容

- `row` 有的所有路径不变，零影响。
- `ceceliaTaskId === null`（非 UUID）的 404 行为不变（对齐 `pipeline.test.ts:439`）。

## 变更清单

| 文件 | 改动类型 | 行数估 |
|------|---------|-------|
| `apps/api/src/services/langgraph-adapter.ts` | 新增 `existsLangGraphTask` | +10 |
| `apps/api/src/controllers/pipeline.controller.ts` | `getOutput` / `getStages` 各改 404 分支 | +20 |
| `apps/api/tests/pipeline.test.ts` | 改 2 个、加 2 个测试 | +40 |
| `apps/api/src/services/__tests__/langgraph-adapter.test.ts` | 加 `existsLangGraphTask` 单测 | +25 |

## 不做的事

- 不加 rate limit / auth（调用方是 zenithjoy 前端，已鉴权）。
- 不加 cache（主键查询足够快）。
- 不改 Brain 或 cecelia 代码。
