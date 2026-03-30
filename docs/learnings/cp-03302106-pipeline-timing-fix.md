# Learning: cp-03302106-pipeline-timing-fix

## 背景

PipelineOutputPage 显示 "< 1s" 时间，实际上调研等阶段根本不可能在 1 秒内完成。

## 根因

Pipeline 阶段时间戳由后端批量 INSERT 生成，所有 `started_at`/`completed_at` 在 10-20ms 内完成。这些是数据库操作时间，不是真实执行时间。

## 方案

前端增加可靠性检测：
- 收集所有阶段的 `started_at`/`completed_at` 时间戳
- 计算最大值与最小值之差
- 若跨度 < 5000ms，判定为批量插入的虚假数据，隐藏所有耗时（显示 "—"）
- 跨度 >= 5000ms，显示真实耗时

## 可复用模式

任何展示异步任务耗时的页面，若时间戳来自批量写入，都应加入类似的可靠性检测，而非直接展示原始数据。

## 变更文件

- `apps/dashboard/src/pages/PipelineOutputPage.tsx`
  - `StagesPanel` 新增 `isTimingReliable: boolean` prop
  - 主组件计算 `isTimingReliable`（5000ms 阈值）
