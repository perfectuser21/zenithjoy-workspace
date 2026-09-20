# 小改动 PrepPRD：工作机排期从甘特图改成「一机一张任务表」

## 改什么

`apps/dashboard/src/pages/WorkersPage.tsx` 的排期区块：

- 删 `ScheduleGantt.tsx`（多台机挤在一张甘特图里、横向色块），连同 `ScheduleGantt.test.tsx`
- 新增 `DeviceTaskTable.tsx`：**一台设备一张表**，当天每件活一行，五列 = 时间 / 任务 / 部门 / 状态 / 说明
- 时间列写「起止 + 时长」（`08:00–22:00` + `14 小时`）
- 时间区间有重叠的活标 `并行 N` 角标，说明列写「同时在跑：<别的活>」
- 页面顶部只留一条日期条（前一天 / 今天 / 后一天）+ 部门筛选 + 全局汇总，去掉日/周切换

## 为什么改

主理人原话：「我可能不是要甘特图，我要的是 table 那种效果，而且应该是一个机子一个。你不应该把多少个机子放到一起，一个机子一个 table，这个 table 你就告诉我，我们今天每一天的工作是哪些。有的时候它可能是并行好几个工作，你应该这样排出来。」

甘特图把四台机压在一张图里，色块只能看出「有活」，看不出这件活叫什么、几点到几点、为什么没跑。表格能把这些直接写成字。并行是真实场景（触达跑一整天，中间插发布），必须一眼看出来哪些活在同一时段。

## 关联上下文

- 决策 e14297d4（工作机控制塔）：读面数据源 = `worker_tasks`
- 前端契约 `apps/dashboard/src/api/schedule.api.ts` 不变，仍是后端接入的唯一开关（`fetchSchedule()`）
- 失败码人话化走 `apps/dashboard/src/api/error-codes.ts` 的 `explainError()`
- 后端接入另有开工单：`docs/handoffs/202609201700-f9ab4ab5-backend.md`

## 影响范围

- 只动 dashboard 前端展示层，不动 API、不动数据库、不动执行器
- `dept-colors.ts` 继续复用（表格里部门标签用同一套配色）
- smoke `schedule-board-smoke.sh` 第 8b 层改为断言表格结构，并反向断言 `ScheduleGantt.tsx` 已删除

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 两件活算不算「并行」 | ①同一小时内即算 ②时间区间真重叠 ③同部门才算 | 区间真重叠（`a.start < b.end && b.start < a.end`），贴着结束不算 | 排期是连续区间，不是离散格子；22:00 接 22:00 是串行不是并行 | 误标并行会让主理人以为机子超载，误判额度 |

## 验收标准

- [ ] 每台在线设备渲染一张 `data-testid="device-task-table"`，多台机不再共用一张图
- [ ] 表头五列齐全，每件活一行 `data-testid="task-row"`，按开始时间升序
- [ ] 重叠的活带 `data-testid="parallel-badge"`，角标 title 与说明列都写出并行对象
- [ ] 不重叠的活不标并行
- [ ] 失败的活说人话（「机器失联」而不是 `executor_lost`）
- [ ] `ScheduleGantt.tsx` 已从仓库删除，smoke 反向断言生效
- [ ] 全量单测 + tsc + eslint + smoke 全绿，CI 全绿

GP-Anchor: line02/keyword_acquisition keep-green
