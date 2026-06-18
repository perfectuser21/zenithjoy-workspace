# Sprint PRD — Line04 客服层多租户隔离（tenant scope）

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — 多租户安全基线
- **当前进度**：客服查询/写入未按租户隔离（数据越权风险）
- **本次推进预期**：客服读写路径全部按当前租户 scope，A/B 两租户数据物理隔离

## 背景

客服层（朋友圈客户列表、draft-generate 写入、scheduler-tick 客户遍历）当前用 `SELECT DISTINCT customer ... WHERE platform=$1` 这类**全量查**，不带租户过滤。tenant 模型已存在（tenants 表 + agents.tenant_id），但客服路径未消费 → 租户A 登录可能看到租户B 的客户数据，属越权。本 sprint 给客服层读写补 tenant scope。

## Golden Path（核心场景，后端可观察）

系统以某租户身份发起客服查询/写入 → 仅命中该租户数据 → 跨租户数据绝不出现。

具体：
1. 以【租户A】身份查"今日朋友圈客户列表" → 只返回 A 名下客户，**绝无** B 的客户
2. 以【租户B】身份查同一接口 → 只返回 B 名下客户，绝无 A 的客户
3. draft-generate 写入、scheduler-tick 客户遍历等客服路径，全部按当前租户 scope 过滤
4.（异常）缺租户上下文 → 拒绝请求，不回退为全量查（不返回任何跨租户数据）

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 租户上下文缺失（无 tenant_id）→ 拒绝，禁止 fallback 到全量
- 某租户名下 0 客户 → 返回空列表，不串到其它租户
- 同一 platform、不同租户的同名客户 → 各租户各自可见，互不污染

## 范围限定

**在范围内**：
- 客服查询路径补 tenant scope（朋友圈客户列表 `SELECT DISTINCT customer`，apps/api/src/routes/wechat.ts:213 一带）
- draft-generate 写入路径带 tenant
- scheduler-tick 客户遍历带 tenant（apps/api/src/services/scheduler.ts）
- 2 租户隔离 failing 测试（先红后绿）

**不在范围内**：
- 非客服层的其它越权点（本 sprint 只锚客服读写）
- tenant 模型本身改造（tenants 表 / agents.tenant_id 已存在，不动 schema 结构）
- 前端/Dashboard 改动

## 假设

- [ASSUMPTION: 租户上下文经现有 `apps/api/src/middleware/tenant-context.ts` / `agent-context.ts` 注入，本 sprint 复用而非新建租户解析机制]
- [ASSUMPTION: 客服查询按 `JOIN agents ON agents.tenant_id` 关联当前租户过滤；具体是 JOIN 还是加列由 Proposer 倒推]

## 预期受影响文件

- `apps/api/src/routes/wechat.ts`：客服客户列表全量查（:213 `SELECT DISTINCT customer`）补 tenant 过滤
- `apps/api/src/services/scheduler.ts`：scheduler-tick 客户遍历补 tenant scope
- draft-generate 写入路径（位于 wechat 客服相关 route/service）：写入带 tenant
- `apps/api/tests/`：新增 2 租户隔离 E2E 测试（vitest）

## E2E 验收

> Planner 初稿留占位，最终脚本由 proposer 在 GAN 阶段按 target_environment（local_api）填入 vitest + psql 真实链路。

```bash
# 占位：proposer 按 local_api 填入真实脚本（vitest + psql 验证）
# 期望验收点（自然语言）：
#  - 种 2 个租户 A/B，各挂 1 个 agent + 若干客户（platform 相同）
#  - 以租户A 上下文查客户列表 → 断言【只含 A 客户】且【不含任何 B 客户】
#  - 以租户B 上下文查 → 断言【只含 B 客户】
#  - 缺租户上下文查 → 断言被拒绝（非全量返回）
#  - commit-1 该测试 failing；commit-2 实现后转绿；CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 纯后端 apps/api 客服读写路径改造，无 UI / 无 agent 远端协议 / 无 engine。
## target_environment: local_api
## target_environment_reason: 后端隔离逻辑用 vitest + psql 在本地 evaluator 验证（apps/api/tests 已有 vitest），无需远端机器。
## journey_id: Line04（客户私域 AI 接管；UUID 来源 = task.payload.journey_id，本次 payload 未注入显式 UUID，按 PrepPRD 锚定 Line04）
## step_id: L04-CS-tenant-isolation（来源 = PrepPRD Golden Path 锚定结果：客服层多租户隔离）
