# Sprint PRD — CRM 客户状态历史追踪表（crm_customer_status_history）

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — "装真人"人格 A/B 测试基础设施
- **当前进度**：`crm_customers.status` 只有当前值，无历史流转记录，无法计算状态推进速度（A1→A2 等时间间隔）
- **本次推进预期**：新增 `crm_customer_status_history` 历史追踪表 + 改造唯一写入点，A/B 测试"推进速度"指标具备数据基础

## 背景

"装真人"人格项目需要对比不同 AI 风格的转化效能，核心指标之一是"客户状态推进速度"（例如 A1→A3 平均耗时）。目前 `crm_customers.status` 只记录当前状态，历史流转完全丢失。本 sprint 是该 A/B 测试项目的 5 块子项目中第一块（数据基础设施），后续 timeline 查询、A/B 报表等子项目依赖本表。

唯一写入点是 `apps/api/src/routes/crm.ts` 的 `PUT /api/crm/customers/status`，当前直接做 INSERT … ON CONFLICT DO UPDATE，本次用事务包裹：取旧 status → upsert → 按条件写历史记录。

## Golden Path（核心场景）

1. 客服在 Dashboard 把客户 Alice 从 A1 拖到 A3
2. 前端调 `PUT /api/crm/customers/status { wechat_id, contact, status: "A3" }`
3. 后端开事务：SELECT 旧 status（A1）→ upsert crm_customers status=A3 → 新客户或状态变化时写一行历史（old_status='A1', new_status='A3', changed_at=now()）→ COMMIT
4. `crm_customer_status_history` 出现一行：old_status='A1', new_status='A3'
5. 后续 A/B 测试查这张表计算 A1→A3 的时间间隔

## 边界情况

- 重复提交相同 status（A3→A3）：不写历史行，只刷新 updated_at
- 新客户首次 upsert（表中无旧记录）：写历史行，old_status=NULL，new_status=新值
- upsert 本身失败：事务回滚，历史表不残留任何记录
- migration 回填（已有 crm_customers 记录但无历史）：幂等 INSERT…ON CONFLICT DO NOTHING，重跑不重复插入

## 范围限定

**在范围内**：
- 新建 migration：`zenithjoy.crm_customer_status_history` 表 + 索引 + 回填 INSERT（幂等）
- 改造 `apps/api/src/routes/crm.ts` 的 `PUT /api/crm/customers/status`：事务包裹，写历史行
- 单元/集成测试覆盖：migration 幂等、新客户首次写、状态变化写、重复 status 不写、事务回滚不残留

**不在范围内**：
- 历史数据的读路径（timeline API、前端展示等后续子项目再接）
- 其他写入点的历史追踪（`POST /api/crm/customers` 新增客户首次写 A1 仍走原路径，不在本次范围）
- A/B 报表、分析查询

## 假设

- [ASSUMPTION: `PUT /api/crm/customers/status` 是 `crm_customers.status` 的唯一写入点，`POST /api/crm/customers`（新增客户）写的是 source='manual' + status='A1' 默认值，不计入本次历史追踪范围（PrepPRD 已明确）]
- [ASSUMPTION: 回填 INSERT 只取 `crm_customers` 已有行的 status 作为 new_status，old_status=NULL，changed_at=created_at；幂等靠 (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at) 唯一约束的 ON CONFLICT DO NOTHING]

## 预期受影响文件

- `apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql`：新建，含表定义 + 索引 + 回填
- `apps/api/src/routes/crm.ts`：改造 `PUT /api/crm/customers/status`（约 470-500 行），用事务包裹并写历史行
- `apps/api/tests/routes/crm.test.ts`（或新建 `crm-status-history.test.ts`）：新增测试覆盖历史追踪场景

## NFR 约束

- 历史写入必须在同一事务内完成（upsert + history INSERT 原子），不允许两步分开提交
- migration 回填必须幂等（ON CONFLICT DO NOTHING），E2E smoke 可重入多次不重复插入
- 历史表只追加不删不改（append-only），禁止 UPDATE/DELETE 历史行
- 查询历史表时必须带 `tenant_id` 过滤（租户隔离，准入 invariant）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 sprint 与 Line04 一致，Brain API 离线，引用同 area 级铁律）-->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串，让隔离漏洞当场暴露（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [真环境验证才算done] 依赖真机/生产 env/真实调用方的接缝断言必须在真目标上验证过才算 done；未真验的只能标 logic-done-pending（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: Line04 journey bfeed805-deed-46c3-8624-87f0028101d4 已验收能力（Brain API 离线，以下从已知 sprint 历史整理）-->
- crm_customers 表存在且唯一键 (tenant_id, cs_wechat_id, contact) 正常运作（已验收，20260624 migration）
- `PUT /api/crm/customers/status` 鉴权 requireCsWriteAccess 同租户隔离（已验收）
- status CHECK 约束 A1-A5（已验收）
- source CHECK 约束 message/manual（已验收）

## E2E 验收

```bash
# target_environment=local_api，验收方式：jest/vitest 集成测试 + psql schema 验证

# 1. migration 幂等验证（psql）
psql $DATABASE_URL -c "SELECT COUNT(*) FROM zenithjoy.crm_customer_status_history;" # 不报错即 schema 存在
# 重跑 migration 不报错，历史行数不增加

# 2. 新客户首次写 status → 历史表出现 old_status=NULL 记录（jest）
# PUT /api/crm/customers/status { wechat_id: "new_cs", contact: "NewUser", status: "A1" }
# psql: SELECT old_status, new_status FROM zenithjoy.crm_customer_status_history WHERE contact='NewUser';
# 期望: old_status IS NULL, new_status='A1'

# 3. 已有客户 status 变化 → 历史表新增记录（jest）
# PUT /api/crm/customers/status { ..., status: "A2" }  (旧值 A1)
# psql: SELECT old_status, new_status FROM ... WHERE contact='NewUser' ORDER BY changed_at DESC LIMIT 1;
# 期望: old_status='A1', new_status='A2'

# 4. 重复提交相同 status → 历史表不新增记录（jest）
# PUT ... { status: "A2" } 再次提交
# psql: COUNT(*) 不变

# 5. upsert 失败时历史表不残留（jest mock pg 事务回滚）
# 期望: history 表行数不变

# 6. 多租户隔离（jest）
# 租户 A 的历史记录不出现在租户 B 查询结果

# 7. CI 全绿
echo "✅ crm_customer_status_history 验收通过"
```

## journey_type: autonomous
## journey_type_reason: 纯后端改动（DB migration + API 路由事务改造），无前端 UI 交互，无远端 agent 协议，命中"纯后端"分支
## target_environment: local_api
## target_environment_reason: PrepPRD 已显式声明 target_environment=local_api；验收方式为 jest 集成测试 + psql schema 验证，不需要浏览器/Windows runner
## journey_id: bfeed805-deed-46c3-8624-87f0028101d4
