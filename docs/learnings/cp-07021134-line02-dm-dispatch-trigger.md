## Line02 评论写库后自动触发DM派发（2026-07-02）

### 根本原因

`/api/acquisition/comment-score-result` 只写入 `acquisition_leads` 表，
但从未调用 `buildAssignments` + `dispatchDue`，导致三步获客链路（抓→分析→发送）
的第 2→3 步断开：leads 堆在 DB 里，没有人触发 DM 派发。

### 下次预防

- [ ] 写 leads 的 handler 一定要问"写完了然后呢"，确认下游有无自动消费者
- [ ] fire-and-forget 触发必须配 VITEST 模式的可测路径（resolved_tenant_id 分支）
- [ ] `buildAssignments` + `dispatchDue` 自带去重和频控，可安全重入，不必担心并发调用
