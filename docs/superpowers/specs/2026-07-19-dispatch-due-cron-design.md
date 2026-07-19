# 设计：补齐 dm_assignments dispatchDue 缺失的周期触发器

## 背景

真机验证 Path2 全链路（Seg1采集→Seg2音频判定→Seg3抓评论→评论意向分档→lead评分→dm_assignments建队列）2026-07-19全部自动跑通，但队列到期后不会自动真正发出私信——必须人工手动 `POST /dispatch/run`。

根因：`buildAssignments`/`dispatchDue` 只在 `/collect/report` 的 `afterCommit` 链（`apps/api/src/routes/acquisition.ts:1055-1057`、`:1121-1123`）里同步链式调用一次。调用那一刻 `scheduled_for`（故意随机分散到当天避免爆发式发送）通常还没到，`dispatchDue` 查询捞不到任何到期行。之后没有任何周期性任务会再回头检查——全局唯一定时器 `apps/api/src/services/scheduler.ts` 里没有给 DM 派单挂任何 tick。

## 方案

在 `scheduler.ts` 现有 `startScheduler()` 的 setInterval(60s) 循环里新增一个分支，每次 tick 无条件执行（不像日报/朋友圈/warmup 那样按整点门控——DM 派单本身就要随时检查是否有新到期的行）：

1. 新增 `triggerDmDispatchSweep()`：
   - 查询 `SELECT DISTINCT tenant_id FROM zenithjoy.dm_assignments WHERE status='queued' AND scheduled_for <= now()`
   - 对每个 tenant_id 调用现有 `dispatchDue(pool, tenantId)`（不改该函数任何逻辑，直接复用）
   - 全程容错：单个 tenant 失败只 warn，不影响其他 tenant / 不拖垮 scheduler 主循环（同其余三个 trigger 函数既有模式）
2. `startScheduler()` 的 setInterval 回调里追加一行调用 `triggerDmDispatchSweep()`
3. 需要一个数据库连接：`scheduler.ts` 当前不直接持有 `pool`，需要从调用方（`app.ts` 里 `startScheduler()` 的调用点）传入，或 `scheduler.ts` 内部 import 现有的共享 pool 单例（视代码库现状选一种，实现时以现有 `pool` 单例导入方式为准，不新建连接池）

## 数据流

```
每分钟 tick
  → triggerDmDispatchSweep()
    → 查 distinct tenant_id（有到期 queued 行的）
    → 逐个 dispatchDue(pool, tenantId)
      → （复用既有逻辑）查该租户到期 queued 行 → 建 publish_tasks → 更新 dm_assignments=dispatched
```

不改变 `dispatchDue`/`buildAssignments` 内部任何行为，是纯粹补一个"谁来定期调用"的缺口。

## 测试策略

- **单元测试**（`apps/api/src/services/scheduler.test.ts`，如无则新建）：
  - mock `dispatchDue`，构造场景验证 `triggerDmDispatchSweep()` 对有到期行的租户调用一次 `dispatchDue`
  - 边界：无到期租户 → 不调用；单租户多条到期行 → `dispatchDue` 只调一次（幂等由 SQL `DISTINCT` 保证，不依赖 `dispatchDue` 内部）
  - `startScheduler()` 的 setInterval 回调触发路径，追加断言"回调触发时 `triggerDmDispatchSweep` 被调用"
- **无需 integration/E2E**：`dispatchDue`/`buildAssignments` 本身逻辑已有测试覆盖（PR #1412 等），本次只是新增调用入口
- **Proven-to-fire**：实现后故意注释掉 `startScheduler()` 里新增的那一行调用，确认对应断言测试报红一次，再恢复

## 不包含

- 不改变发送频率/时段闸/频控逻辑（`dm_per_hour`/`dm_per_day`/`dm_active_start/end` 均沿用现状）
- 不做"精确到秒"的触发（60s 粒度对分钟级随机分散发送场景足够）
- 不改 `dispatchDue`/`buildAssignments` 函数签名或内部逻辑
