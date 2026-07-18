# 设计：Path2 Seg1-4 服务端真实数据串联

## 背景

根因排查（2026-07-18）确认：Path2（客户智能获客）四段（采集/判定/抓评论/私信）从未在同一次
真实数据流里被串起来验证过。staging 库实测：私信段(Seg4)的"成功"记录全部是
`account_label="manual-test"/"manual-burner-test"`，同一个 `dm_assignment_id` 反复重发 7 次
打向一个人工登记的固定测试 lead（`douyin_id=133643315`，昵称直接叫"ZJ安全测试号-苏彦卿"），
跟 Seg1-3 产出完全脱节。

`golden-path-2-smoke.sh` 现有 Step 9/15 已经是"抓评论 → `/collect/report` → `rescoreLead()`
自动打分+置 `outreach_eligible` → lead 带真实 douyin_id 落库"这条真链路，但止步于此，注释里
明写"派单发号由 acquisition-dispatch-douyin-id.test.ts 的 dispatchDue payload 断言守"——也就是说
派单这一段是拿 mock capabilities 值单独单测的，从没接上 Step9/15 这条真实产出的 lead。

## 方案

在 Step 15 之后新增 **Step 22**（沿用脚本现有编号习惯，21 是当前最后一步），只用已存在的
真实端点组合，不改动任何生产代码逻辑：

1. `PATCH /api/acquisition/config`，把本次 `$TENANT_ID` 的 `dm_active_start`/`dm_active_end`
   改成 `00:00`/`23:59:59`——生产默认是 `09:00`-`22:00`，`dispatchDue()` 有硬时段闸
   （不在窗口内直接 `dispatched:0` 短路返回），CI 跑的时间点不可控，必须把窗口撑满一整天
   避免这条新断言随时段随机失败。
2. `POST /api/acquisition/dispatch/build`（`scoreLeads`+`buildAssignments`）——断言返回体
   `assigned >= 1`。
3. `POST /api/acquisition/dispatch/run`（`dispatchDue`）——断言返回体 `dispatched >= 1`。
4. 查 `zenithjoy.publish_tasks`（`task_type='dm_outreach'`，按 `$AGENT_PK` 过滤，
   `created_at > `本 Step 开始时间）：
   - 断言 `payload->>'douyin_id'` 等于 Step15 那条真实产出的 `$S15_DOUYIN_ID`
   - 断言 `payload->>'device_platform'` = `'android'`（复用 Step11 已经同步进
     `agents.capabilities` 的 `android` 能力）
   - 断言 `payload->>'dm_assignment_id'` 能在 `zenithjoy.dm_assignments` 表里查到对应真实行
     （即这个 ID 是 `buildAssignments` 刚生成的，不是任何硬编码值）

复用现有变量：`$TENANT_ID`、`$AGENT_PK`（Step2 起复用到底）、`$S15_DOUYIN_ID`（Step15 产出）。

## 为什么不需要改生产代码

`/dispatch/build`、`/dispatch/run`、`rescoreLead()` 自动打分、`resolveDevicePlatform()` 读
`capabilities` 全部已经是生产现役代码且各自有单测覆盖——本次缺的从来不是"功能不存在"，是
"没人把 Step9/15 产出的真实数据接进这几个已有端点走一遍"。这正是本次要补的验证缺口本身，
不是产品功能缺口。

## 测试策略

- **本次改动即测试**：新增内容就是 smoke 脚本本身（Step22），不需要额外的 vitest/pytest 单测——
  验证的对象是"多个已有真实端点组合起来数据对不对"，这只能用集成层面的真实调用链验证，
  跟 Step1-21 的既有断言风格完全一致（curl 真调 + psql 真查）。
- **不新增 E2E/Playwright**：纯后端服务链路，无 UI 变化。
- **回归防护**：Step22 断言 `dm_assignment_id` 回联到真实 `dm_assignments` 表行，这本身就是
  对"以后有人不小心又把这条链路测成两段独立 mock"的机制性防护——断言失败即证明链路断了。

## 影响范围

只新增 smoke 脚本内容，不修改任何 `apps/api/src` 生产代码。Step1-21 既有断言/变量不动。
