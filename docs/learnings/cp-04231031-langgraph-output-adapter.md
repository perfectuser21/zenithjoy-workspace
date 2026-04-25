## LangGraph 任务 pending 阶段 /output /stages 不再 404（2026-04-25）

**PR**：#214
**分支**：cp-04231031-langgraph-output-adapter

### 根本原因

zenithjoy api 的 `getOutput` / `getStages` 在 `zenithjoy.pipeline_runs` 无 row 时直接 404。这对**纯 LangGraph 任务**（task.id = cecelia_task_id，不走 zenithjoy pipeline_runs 回写路径）在两个时间窗内会误报：

1. Brain 刚派发 task，第 1 个节点还没跑完 → `cecelia_events` 表里 0 条事件
2. 前端用 `cecelia_task_id` UUID 拉 `/output`、`/stages`

当前实现只有 `fetchLangGraphEvents` 一步兜底，events 为空就落到 `if (!row) 404`，把"任务存在正在跑"误当成"任务不存在"。

根因是**单一存在性探针**——用"events 是否 >0"当"任务是否存在"的近似，但事件滞后于任务创建。正确做法是分层：`tasks` 表确认任务身份，`cecelia_events` 填充进度细节。

### 下次预防

- [ ] 新增返回 404 的 endpoint 前，列清楚"任务不存在 vs 任务存在数据未落盘"两态，避免合并判断
- [ ] 多数据源读路径（本地表 + 跨 schema 事件表）要有"存在性探针"与"可用性探针"分层，不用后者近似前者
- [ ] 改 404 分支时同步扫反向测试（原 test 固化的 404 行为要显式拆成"存在→pending / 不存在→404"两条），防止测试把 bug 固化为 contract
- [ ] LangGraph thread_id / task.id / pipeline_runs.id 三个 ID 的关系在 adapter 层用一个工具函数统一（`existsLangGraphTask` + 既有 `fetchLangGraphEvents` + `listLangGraphOnlyRuns` 构成 adapter 的完整探针集）
- [ ] zenithjoy api 与 cecelia 同 PG 实例直连（DATABASE_NAME=cecelia），避免 HTTP fallback；所有跨 schema 查询走 `pool.query`，由连接池共享（`pipeline.test.ts:325` 注释已明令禁止 HTTP fallback）
