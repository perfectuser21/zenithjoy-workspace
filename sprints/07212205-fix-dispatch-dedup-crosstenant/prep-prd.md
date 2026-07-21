# Bug PrepPRD：Path2 触达链路串台/重复触达（P0，客户已被真实重复私信）

## 症状
员工今天测试反馈 + 真实数据坐实：staging 租户 `f94f40c1`（license `ZJ-F-4ZDNAAH8`）里 **7 条线索被 2-3 个不同小号各派单一次，部分状态是真实 `sent`**——同一个 Douyin 用户被咱们不同的小号各私信了一遍。同时反馈"指派小号与实际触达账号不一致，无法排查"。

## 根因假设

**主因（四.4 串台/重复触达）**：`buildAssignments`（`apps/api/src/services/acquisition-dispatch.ts:512-587`）Step E 的候选线索查询（`leadsRes`，512-519行）只按 `outreach_eligible=true` 过滤，**不排除已经有指派/已发送记录的线索**；循环内部的去重检查（465-478、547-560行）颗粒度是 `(tenant_id, lead_id, account_label)`——只防"同一条线索同一个小号被派两次"，防不住"同一条线索被派给不同小号各一次"。DB 唯一约束 `UNIQUE(tenant_id, lead_id, account_label)` 也是故意设计成允许这种情况。`buildAssignments` 触发很密集（采集任务完成、超时清扫、手动点"派单"都会重跑一遍），每次重跑，已经处理过的线索又会被重新纳入候选池，只要还没轮到的小号槽位空着，就会新插一行、真实二次派单。

**次因（四.1 之一，跨租户风险）**：`dispatchDue` 真正执行发送时查询 burner 账号会话的 SQL（`acquisition-dispatch.ts:686-694`）**没有 tenant_id 过滤**，且 `LIMIT 1` 没有 `ORDER BY`。如果两个不同租户的小号昵称字符串恰好相同，理论上会查到别的租户的 agent/session 去执行——目前数据里还没实锤，但代码结构上是漏洞，必须堵。

**四.1 里"指派小号与实际触达账号不一致"这条反馈**：追出代码发现，单条 `dm_assignments` 行内 assigned=executed 从来没有真正分裂过（`dispatchDue` 执行用的账号就是它刚查出来的那一行的 `account_label`，同一个值）。真实来源是 Step A（380-399行）——小号掉线时会把这条 `queued` 记录重标 `pending_dispatch` 并把 `account_label` 直接清空覆盖成空字符串，后续 Step D 重新指派到另一个小号，**旧的指派历史被覆盖抹掉**，员工事后看到的是"这条线索最终被 B 号发了"，但查不到"其实一开始是指派给 A 号的，A 掉线才改派 B"——不是数据错了，是审计轨迹丢了。

## 关联上下文
- Brain task 33ae43c8-a23d-4e26-995a-f7452e076b3e
- 相关历史 issue：dm_assignments 竞态相关注释见 acquisition-dispatch.ts 文件头

## 修法

1. **`buildAssignments` 加线索级去重**：Step E 的 `leadsRes` 查询加 `NOT EXISTS` 子句，排除掉已有非终态指派记录（`dm_assignments.status IN ('queued','dispatched','sent','pending_dispatch')`）或已有真实发送记录（`dm_outreach_log.status='sent'`）的线索——不管是哪个小号派的，只要这条线索已经在走流程或者已经发过，这一轮就不再把它当候选。

2. **`dispatchDue` 的账号会话查询补 tenant_id 过滤 + 显式排序**：`leadRes` 查询的 `agent_platform_sessions` JOIN 条件加 `a.tenant_id::text = $3`（联表到 agents 表按 tenant 过滤），`LIMIT 1` 前加 `ORDER BY s.bound_at DESC NULLS LAST`（或等价的确定性排序），杜绝重名小号跨租户串号的可能性。

3. **Step A 重标时保留指派历史，别再无痕清空**：`dispatch_reason` 字段改为在清空前记录 `'offline_reassign_from:' || account_label`，这样后续 Step D/E 重新指派后，这条记录的 `dispatch_reason` 能追溯出"曾经指派过谁、因为什么原因换人"，不需要新增表/新增列就能补上审计轨迹。

**不包含（本次范围外，跟用户已确认放到 Phase 2 产品排期）**：把"指派小号/实际触达账号/触达执行时间"三个字段完整地在前端"触达记录"页面展示出来——这次先把后端数据不再被覆盖抹掉，UI 怎么呈现留给 Phase 2。DB 唯一约束从 `(tenant,lead,account)` 收紧到 `(tenant,lead)` 这个更彻底的结构性方案本次不做（涉及生产数据清洗+schema migration，风险更高，本次先用应用层过滤堵住实际复现的路径）。

## Regression Test 计划
- `buildAssignments`：并发/连续两次调用同一 tenant，第二次调用不应再给已有非终态指派的线索产生新的 `INSERT`（mock pool 断言 `leadsRes` 查询结果不含已指派线索，或直接断言两轮 assigned 计数只在第一轮发生）
- `dispatchDue`：mock 两个不同 tenant 但账号昵称相同的场景，断言只会查到自己 tenant 的 session，不会拿到别的 tenant 的 agent_id
- Step A 重标：断言 `dispatch_reason` 携带了原账号信息，不是被清空成 NULL

## 数据remediation（代码修复之外的运维动作，不在本 PR 代码范围内）
staging 现存的 7 条重复指派线索，代码修复上线后需要手动跑一次清理：把已有 `sent` 记录的线索名下，剩余还处于 `queued`/`pending_dispatch`/`limited` 状态的重复行标记 `cancelled`，防止历史脏数据继续触发发送。

## 验收标准
- [ ] failing test 先 commit（现状：连续两轮 buildAssignments 会给同一线索派两次）
- [ ] 修复代码变绿
- [ ] CI 全绿
- [ ] staging 验证：对已有重复指派的线索重跑 buildAssignments，确认不再产生新指派
