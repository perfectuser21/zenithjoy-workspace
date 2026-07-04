# Sprint PRD — buildAssignments 真调度（在线+当天任务量最少优先派发 + 待派发重试）

## OKR 对齐

- **对应 KR**：Path 2 Step 6（评论区挖客闭环）
- **当前进度**：派发子能力 thin，字母序轮询无在线感知
- **本次推进预期**：buildAssignments 升级为在线感知调度 + 待派发重试机制

## 背景

buildAssignments 当前按 account_label 字母序轮询派发，不感知机器是否在线、各号当天负载如何。离线小号仍会被选中，超配额的 lead 直接丢弃。本次升级为真调度：优先"在线 + 当天任务量最少"，不可用时标记待派发等待重试。

## Golden Path（核心场景）

系统触发 buildAssignments → 按在线状态 + 当天任务量排序候选小号 → 派给最优小号并记录原因 → 无可用小号时标记待派发 → 下一个派发周期自动补派

具体：
1. 系统调用 buildAssignments，查询候选 burner 小号，附带各号 agent 的 last_heartbeat_at 和当天已派 dm_assignments 数量
2. 候选排序：心跳在 2 分钟内（在线）的小号优先，同层内按当天已派任务量升序；离线或超配额的小号跳过
3. 为每条符合条件的 lead 选出排序最优的可用小号，插入 dm_assignments，dispatch_reason 字段记录选择原因（"least_load" / "round_robin_fallback"）
4. 若本次循环中所有小号均离线或超配额：该批 lead 写入 dm_assignments，status 设 pending_dispatch，不丢弃、不报错
5. 下一个派发周期调用 buildAssignments 时，pending_dispatch 的 lead 被优先重试（排在未处理 lead 之前）；检测到有可用小号即补派，更新 status 为 queued

## 边界情况

- **全部小号持续离线**：pending_dispatch 队列持续累积；租户 A 的积压不阻塞租户 B 的正常派发（WHERE tenant_id = $1 隔离）
- **机器在待派发等待期间掉线**（心跳 > 2 分钟）：已插入 queued 但 scheduled_for 未到期的 dm_assignments 重新标 pending_dispatch，等下一周期重新派给其他在线小号
- **无 burner 账号**：保持现有行为（返回 assigned=0，不报错）
- **pending_dispatch 去重**：已存在 pending_dispatch 的 (tenant, lead, label) 不重复插入

## 范围限定

**在范围内**：
- buildAssignments 排序逻辑升级（在线感知 + 最少负载）
- dm_assignments 新增 pending_dispatch status + dispatch_reason 字段（migration）
- pending_dispatch lead 在下一个派发周期自动重试
- 已排队未到期 assignment 在小号掉线后自动重新派发

**不在范围内**：
- 号角色模型统一（依赖 Sprint 1）
- Lead 人工分配（Sprint 3）
- 多号矩阵批量爬取逻辑变更
- dm_active_start/end 时段逻辑改动

## 假设

- [ASSUMPTION: `agents.last_heartbeat_at` 已存在且由 agent heartbeat 端点持续更新，无需新字段]
- [ASSUMPTION: "在线"定义 = last_heartbeat_at > NOW() - INTERVAL '2 minutes'，超出即离线]
- [ASSUMPTION: "当天任务量" = dm_assignments WHERE status IN ('queued','dispatched','sent') AND date_trunc('day', scheduled_for) = date_trunc('day', now())]
- [ASSUMPTION: pending_dispatch 重试不改变 lead 的 relevance_score 排序，仍按原分降序]
- [ASSUMPTION: 派发周期 = 现有调度触发间隔，不引入新 cron 配置]

## 预期受影响文件

- `apps/api/src/services/acquisition-dispatch.ts`: buildAssignments 排序逻辑 + pending_dispatch 处理
- `apps/api/src/routes/acquisition-dispatch.ts`: 若有触发 buildAssignments 的路由，需 pass-through 变更
- `apps/api/tests/routes/acquisition-dispatch.test.ts`: 新增在线感知 + pending_dispatch 测试用例
- `db/migrations/YYYYMMDD_dm_assignments_dispatch.sql`: 新增 dispatch_reason 列 + pending_dispatch status

## NFR 约束

<!-- 来源: PrepPRD 显式值 + decisions 表（Brain API 本次不可用，优雅降级仅用 PrepPRD 值） -->
- 在线判定阈值: last_heartbeat_at > NOW() - INTERVAL '2 minutes'（PrepPRD 明确）
- 租户隔离: 所有查询按 tenant_id 过滤，pending_dispatch 积压不跨租户
- 频控: 保持现有 dm_per_day / dm_per_hour 配额机制不变
- 可观测: dispatch_reason 字段写入每条 dm_assignments，可查询原因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- Brain API 不可用，从 PrepPRD 和 Line02 已知规则提取 -->
- [租户隔离] buildAssignments 和待派发重试必须按 tenant_id 严格隔离，禁止跨租户读写（来源: area）
- [不丢数据] 全部小号不可用时 lead 必须标 pending_dispatch，禁止静默丢弃（来源: journey_feature）
- [心跳阈值] 在线判定唯一依据是 agents.last_heartbeat_at，2 分钟阈值不可配置（本 sprint）（来源: PrepPRD）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- Brain API 不可用，从代码现状和已知 sprint 历史提取 -->
- 评论区 lead 评分: scoreLeads 按启发式写 relevance_score，不触动（已验收）
- 频控预算: dm_per_day / dm_per_hour 闸已验收，本 sprint 不得移除（已验收）
- (tenant,lead,label) 去重: dm_assignments + dm_outreach_log 联合去重逻辑保留（已验收）
- 排期随机化: dm_interval_min/max_sec 随机排期逻辑保留（已验收）

## E2E 验收

<!-- proposer 将按 target_environment=local_api 填入完整 curl+psql 脚本 -->
```bash
# 占位：proposer 在 GAN 阶段填入真实脚本
# 期望验收点（自然语言）：
# 1. 在线小号存在时：buildAssignments 结果中 dm_assignments.dispatch_reason = 'least_load'，
#    且被选小号的当天任务量 ≤ 其他在线小号
# 2. 全部小号离线时：lead 出现在 dm_assignments WHERE status='pending_dispatch'，assigned=0，不报错
# 3. 心跳超过2分钟的小号不出现在本次 assignment 的 account_label 中
# 4. 租户 A 有积压 pending_dispatch 时，租户 B 的 buildAssignments 正常完成，不受阻
# 5. CI 全绿（existing tests 不回退）
```

## journey_type: autonomous
## journey_type_reason: 纯后端调度服务升级（apps/api/src/services/），无 UI 交互，由定时触发
## target_environment: local_api
## target_environment_reason: 验证 acquisition-dispatch 服务逻辑，curl 触发 + psql 查 dm_assignments 状态，在本地 API 环境执行
## journey_id: line02（客户智能获客路径）
## step_id: L02-S6（评论区挖客闭环 — 派发子能力）
