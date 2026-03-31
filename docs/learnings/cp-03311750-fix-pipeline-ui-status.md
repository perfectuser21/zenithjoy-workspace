# Learning: 修复 ContentFactory + PipelineOutputPage UI 状态问题

**Branch**: cp-03311750-fix-pipeline-ui-status
**Date**: 2026-03-31

## 现象

- 新建 pipeline 失败时，ContentFactory 进度条总把"文案"阶段标红（不管实际上哪个阶段出错）
- PipelineOutputPage 打开后不实时更新，进行中的 pipeline 状态"卡住"
- PipelineOutputPage 顶部状态栏显示原始英文字符串（in_progress、queued）

### 根本原因

`getStageStatuses` 函数对 `failed` 状态硬编码了 `['done', 'failed', 'pending', 'pending']`（4个元素，6个阶段），
导致：
1. 无论哪个阶段真正失败，进度条都把第 2 个阶段（文案）标红——对用户产生严重误导
2. 数组长度（4）与 PIPELINE_STAGES 长度（6）不一致，后两个阶段因下标越界取到 `undefined`

`PipelineOutputPage` 的初始 `useEffect` 只 fetch 一次，不启动轮询。`startPolling` 仅在用户点击"重新生成"后才调用，导致：
- 用户打开进行中的 pipeline 详情页，看到的是初始快照
- 状态看起来一直是"排队中"而不实时更新

状态标签只对 `completed` 做了特判，其他状态直接透传原始字符串。

### 下次预防

- [ ] 凡是根据 pipeline 整体状态推断各阶段颜色的函数，数组长度必须等于 PIPELINE_STAGES.length
- [ ] 不要在没有实际阶段数据的情况下硬编码某个阶段为红色（失败）——只有当真正有子任务数据时才标红
- [ ] 详情页 useEffect 加载完成后，非终态（非 completed/failed）必须启动轮询
- [ ] 所有面向用户的状态字符串必须用中文 map 转换，不暴露原始字段值
