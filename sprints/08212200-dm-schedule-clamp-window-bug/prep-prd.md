# Bug PrepPRD：dm_assignments 排期游标越过 dm_active_end 后滚雪球甩到未来一周

## 症状
0821 line02 获客交付冲刺中，#1693 上线后重投候选池从 8 涨到 35，其中 33 条当场变
`limited`（可解释：per-hour 闸），但另外 2 条被排到了 **8-28 / 8-29**（7-8 天后）——
候选池明明日配额远没用满（9/30、7/30），排一周后等于没派，是白丢的送达机会。

## 根因假设（已用 staging 真实数据验证，非假设）
`apps/api/src/services/acquisition-dispatch.ts` 的 `clampToWindowStart(now, start)`：

```js
export function clampToWindowStart(now: Date, start: string): Date {
  const s = parseHHMM(start);
  if (s < 0) return new Date(now);
  const d = new Date(now);
  const startToday = new Date(now);
  startToday.setHours(Math.floor(s / 60), s % 60, 0, 0);
  if (d < startToday) return startToday;
  return d;   // ← 只有 d < startToday 才钳制，d 已过 startToday 时原样返回
}
```

`buildAssignments` 的 Step D / Step E 排期游标越过 `dm_active_end`（当天窗口关闭）时：
```js
if (!withinActiveWindow(when, cfg.dm_active_start, cfg.dm_active_end)) {
  const nextDay = new Date(when);
  nextDay.setDate(nextDay.getDate() + 1);
  when = clampToWindowStart(nextDay, cfg.dm_active_start);  // 期望拉回次日 09:00
}
```

`when` 越过窗口（例如原卡在 22:05，超过 `dm_active_end=22:00`）时，`nextDay` 只是把日期
+1、钟点原样保留（还是 22:05），而 `clampToWindowStart` 只在"还没到窗口开始"时才钳制——
22:05 已经过了 09:00（`startToday`），于是函数把这个**依然超窗**的时间原样吐回去。
下一条线索排期时，游标还停在 22:xx 附近，`withinActiveWindow` 继续判定超窗，于是**再滚一天，
还是卡在同一个超窗时刻**——同一个号连续几条候选被处理时，日期逐条前移约 1 天，滚雪球式
越滚越远。

**实锤（staging `zenithjoy_staging`，租户 `realmachine-smoke`/455a8ca9）**：
```
b1f66d65 | 秦军餐饮         | queued | 2026-08-28 15:21:07.794+00（中国时间 23:21，超窗）
820f6c96 | 大湖成长之路（Ai+）| queued | 2026-08-29 15:14:56.794+00（中国时间 23:14，超窗）
```
两条 `scheduled_for` 的钟点都精确落在"超过 22:00 窗口"上，与 bug 特征完全吻合。

## 关联上下文
- 相关 Journey：Line02 智能获客（`line02/keyword_acquisition`）
- 相关 handoff：`docs/handoffs/202608212130-line02-acquisition-delivery-push.md`
  「⚠️ 下一个赛程第一件事」段
- 相关历史决策：`93ed0761`（RPA 失败必须自带现场，同源方法论——本次也是先查真实 DB 数据
  再定根因，不是拿单条现场外推）
- `decisions/match` 未查到直接相关的既有决策，本 bug 是新发现

## 修法
`clampToWindowStart` 语义上只承诺"钳到当天窗口开始"，不负责判断"是否已过窗口结束"——
它的签名压根没有 `end` 参数，结构性做不到。调用方在 Step D / Step E 两处滚入次日前，
把 `nextDay` 显式重置到当天零点再传进去，确保 `d < startToday` 恒成立，钳制生效：

```js
const nextDay = new Date(when);
nextDay.setDate(nextDay.getDate() + 1);
nextDay.setHours(0, 0, 0, 0);   // 重置到当天零点，确保 clampToWindowStart 的 d < startToday 恒成立
when = clampToWindowStart(nextDay, cfg.dm_active_start);
```

两处调用点：
- Step D（pending_dispatch 补派重试）：`acquisition-dispatch.ts` ~495 行附近
- Step E（新 outreach_eligible leads 主派发）：`acquisition-dispatch.ts` ~640 行附近

## Regression Test 计划
在 `apps/api/src/services/acquisition-dispatch.test.ts`（或紧邻的 buildAssignments 测试文件）
新增：构造一个已经过 `dm_active_end` 的 `now`（如 21:58，interval 强制命中越窗），验证
`buildAssignments` 产出的 `scheduled_for` 落在**次日窗口内**（`dm_active_start` 到
`dm_active_end` 之间），而不是任意越窗时刻。再构造"同一个 label 连续多条候选、每条都会
触发越窗"的场景，验证连续多次滚动后 `scheduled_for` 仍然逐日 +1（次日/次次日窗口内），
不会一次性跳跃到一周后。

> 该 bug 命中的是纯函数排期逻辑（无真机/生产 env 接缝），按「哨兵死规矩」表格属于
> **逻辑接缝**——CI regression test 即为完整守卫，不需要额外运行时自检。

## 验收标准
- [ ] failing test 先 commit（commit-1）：证明越窗后 `scheduled_for` 落在错误的超窗时刻
- [ ] 修复代码让 test 变绿（commit-2）：`clampToWindowStart` 调用前重置到当天零点
- [ ] 已为本 bug 配 proven-to-fire 守卫（regression test 本身即守卫，已亲眼看它先红后绿）
- [ ] CI 全绿
