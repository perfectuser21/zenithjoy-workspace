# 设计：补齐 dm_assignments dispatchDue 缺失的周期触发器

## 背景

真机验证 Path2 全链路（Seg1采集→Seg2音频判定→Seg3抓评论→评论意向分档→lead评分→dm_assignments建队列）2026-07-19全部自动跑通，但队列到期后不会自动真正发出私信——必须人工手动 `POST /dispatch/run`。

根因：`buildAssignments`/`dispatchDue` 只在 `/collect/report` 的 `afterCommit` 链（`apps/api/src/routes/acquisition.ts:1055-1057`、`:1121-1123`）里同步链式调用一次。调用那一刻 `scheduled_for`（故意随机分散到当天避免爆发式发送）通常还没到，`dispatchDue` 查询捞不到任何到期行。之后没有任何周期性任务会再回头检查——全局唯一定时器 `apps/api/src/services/scheduler.ts` 里没有给 DM 派单挂任何 tick。

**追加发现（写计划前复核代码时发现，比原判断更严重）**：`scheduler.ts` 导出的 `startScheduler()` 函数**从建库以来就从未被 `apps/api/src/index.ts`（唯一的进程入口）调用过**——`git log -S"startScheduler" -- apps/api/src/index.ts` 零命中，`grep -rn "startScheduler(" --include="*.ts" .`（排除 node_modules）只在 `scheduler.ts` 自己的定义和它自己的单测 `apps/api/tests/services/scheduler.test.ts` 里出现。也就是说 `scheduler.ts` 里挂的日报结算（北京23:55）、朋友圈草稿生成（09:00）、warmup 养号（北京10:00）三个已实现的周期任务，在真实运行的服务器进程里也从来没有被自动触发过——只是恰好没人拿"这三个功能是不是真的按时触发了"来倒查过。本次修复必须先把 `startScheduler()` 真正接进 `index.ts` 启动流程，否则新加的 DM 派单 tick 挂在一个从未运行的循环上，等于什么都没修（重犯本 bug 同一类错误）。

## 方案

两部分，缺一不可：

**第一部分：真正启动 scheduler**
在 `apps/api/src/index.ts` 里，紧邻现有 `startStaleListenerMonitor()` 调用处，导入并调用 `startScheduler()`（进程级单次调用，不需要 stop handle——进程存活期间常驻）。

**第二部分：给 dispatchDue 挂 tick**
在 `scheduler.ts` 现有 `startScheduler()` 的 setInterval(60s) 循环里新增一个分支，每次 tick 无条件执行（不像日报/朋友圈/warmup 那样按整点门控——DM 派单本身就要随时检查是否有新到期的行）：

1. 新增 `triggerDmDispatchSweep()`：
   - 用 `import pool from '../db/connection'`（跟 `acquisition.ts`/`warmup-dispatch.ts` 同一个共享单例 pool，不新建连接池）
   - 查询 `SELECT DISTINCT tenant_id FROM zenithjoy.dm_assignments WHERE status='queued' AND scheduled_for <= now()`
   - 对每个 tenant_id 调用现有 `dispatchDue(pool, tenantId)`（从 `./acquisition-dispatch` import，不改该函数任何逻辑，直接复用）
   - 全程容错：单个 tenant 失败只 warn，不影响其他 tenant / 不拖垮 scheduler 主循环（同其余三个 trigger 函数既有模式）
2. `startScheduler()` 的 setInterval 回调里追加一行调用 `triggerDmDispatchSweep()`

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

- **单元测试**（`apps/api/tests/services/scheduler.test.ts`，已存在，追加用例）：
  - mock `dispatchDue`，构造场景验证 `triggerDmDispatchSweep()` 对有到期行的租户调用一次 `dispatchDue`
  - 边界：无到期租户 → 不调用；单租户多条到期行 → `dispatchDue` 只调一次（幂等由 SQL `DISTINCT` 保证，不依赖 `dispatchDue` 内部）
  - `startScheduler()` 的 setInterval 回调触发路径，追加断言"回调触发时 `triggerDmDispatchSweep` 被调用"
- **无需 integration/E2E**：`dispatchDue`/`buildAssignments` 本身逻辑已有测试覆盖（PR #1412 等），本次只是新增调用入口
- **环境接缝守卫（关键，对应"从未被调用"这个根因）**：`index.ts` 现在有调用 `startScheduler()` 这行代码是不够的——历史已经证明"代码写了但没人验证真的跑起来"这类 bug 会长期潜伏。追加一条 `apps/api/tests/index-scheduler-wiring.test.ts`（或等价断言）：静态检查 `index.ts` 源码文本包含 `startScheduler()` 调用（正则匹配，同 `scheduler.test.ts:38` 现有的"检查导出签名"手法），防止未来重构时又被悄悄移除且没有测试报警
- **Proven-to-fire**：实现后故意注释掉 `index.ts` 里新增的 `startScheduler()` 调用，确认新增的静态检查测试报红一次；再故意注释掉 `scheduler.ts` 里 `triggerDmDispatchSweep()` 那一行调用，确认对应断言测试报红一次；两处都验证过再恢复

## 不包含

- 不改变发送频率/时段闸/频控逻辑（`dm_per_hour`/`dm_per_day`/`dm_active_start/end` 均沿用现状）
- 不做"精确到秒"的触发（60s 粒度对分钟级随机分散发送场景足够）
- 不改 `dispatchDue`/`buildAssignments` 函数签名或内部逻辑
- 不深挖/修复日报结算·朋友圈草稿·warmup 养号这三个任务过去因 `startScheduler()` 未接线而导致的历史影响（如有历史应发未发的数据缺口）——本次只保证"从现在起，接入的这一刻起，四个任务（含新增的 DM 派单）都会按各自设计的周期真正触发"，历史回溯不在本 bug 修复范围内，需要的话另开 issue
