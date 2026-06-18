# Sprint PRD — Line04 对话记忆三层后端

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — 对话记忆能力基线
- **当前进度**：客服回复无跨轮/跨天记忆，每次回复只见当前消息
- **本次推进预期**：后端具备按租户×联系人隔离的三层记忆（短期原文 / 中期日 summary / 长期融合 summary）+ 取回复上下文 API

## 背景

Line04 客服 AI 接管个微对话，需要"记得"客户。租户隔离基线已就位（上一刀 tenant scope），但记忆本身还不存在。本刀只做**后端存储 + summarization + 取上下文 API**，不接 listen_chat 真机回复路径（那需真机，单独一刀）。

## Golden Path（核心场景，后端可观察）

系统以某租户身份写入消息 → 三层记忆按 (tenant_id × contact) 累积 → 查"回复上下文"返回 长期+中期+短期 拼接结果，且绝不串租户。

具体：
1. 写入一条消息（tenant_id + contact + role + text）→ 进**短期**（最近 N 条原文滑窗）
2. 触发当天收尾 → 把今天短期内容生成**中期**（今天的 summary）
3. 跨天再次收尾 → 把昨天的中期 summary 并入**长期**（融合压缩）
4. 查"回复上下文"（tenant_id + contact）→ 返回 长期 summary + 中期 summary + 短期原文 拼好的上下文
5.（隔离）以租户A 查只见 A 的记忆，绝无 B
6.（异常）写入/查询缺 tenant_id → 拒绝请求，不回退、不串租户

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 缺 tenant_id（写或查）→ 拒绝，禁止 fallback
- 同一 contact 名在不同租户下 → 各租户各自独立记忆，互不污染
- 某 (tenant×contact) 无任何记忆 → 返回空上下文，不报错、不串别人
- 当天无消息却触发收尾 → 不生成空中期，不污染长期
- summarization（DeepSeek/OpenRouter）调用失败 → 不破坏已有三层数据，写入/读取链路可降级（具体降级策略由 Proposer 倒推）

## 范围限定

**在范围内**：
- 新建三层记忆存储（per tenant_id × contact）：短期（原文滑窗）/ 中期（日 summary）/ 长期（融合 summary）
- summarization 服务接 DeepSeek（via OpenRouter，`~/.credentials/openrouter.env` 已就绪）
- 三个后端能力：写消息 / 取回复上下文 / 触发日收尾
- 2 租户隔离 failing 测试（先红后绿）+ 缺 tenant_id 拒绝测试

**不在范围内**：
- listen_chat 把记忆接进真实回复路径（需真机，单独一刀）
- 前端 / Dashboard 改动
- tenant 模型改造（tenants 表 / agents.tenant_id 已存在，不动结构）
- 自动定时调度（本刀"触发日收尾"是可被调用的能力，不含 cron 编排）

## 假设

- [ASSUMPTION: 租户上下文复用现有 `apps/api/src/middleware/tenant-context.ts` / `agent-context.ts`，不新建租户解析机制]
- [ASSUMPTION: 记忆表新增 migration（apps/api/src/db 或 packages/db），按 (tenant_id, contact) 联合索引；具体表结构由 Proposer 倒推]
- [ASSUMPTION: "短期最近 N 条" 的 N、summary 长度上限为实现细节，由 Proposer 定，PRD 不锁死数值]

## 预期受影响文件

- `apps/api/src/services/wechat/`：新增记忆存储 + summarization 服务（三层读写 + DeepSeek 调用）
- `apps/api/src/db`（或 `packages/db`）：新增三层记忆表 migration
- `apps/api/src/routes/`：暴露 写消息 / 取回复上下文 / 触发日收尾 后端能力（按现有 wechat 客服 route 风格）
- `apps/api/src/services/__tests__/`（vitest）：2 租户隔离 + 三层拼接 + 缺 tenant_id 拒绝测试

## E2E 验收

> Planner 初稿留占位，最终脚本由 proposer 在 GAN 阶段按 target_environment（local_api）填入 vitest + psql 真实链路。

```bash
# 占位：proposer 按 local_api 填入真实脚本（vitest + psql 验证）
# 期望验收点（自然语言）：
#  - 种 2 个租户 A/B，各对某 contact 写入多条消息
#  - 触发 A 的当天收尾 → 中期 summary 生成；模拟跨天再收尾 → 昨天 summary 并入长期
#  - 查 A 的 (tenant×contact) 回复上下文 → 断言【含长期+中期+短期三层拼接】
#  - 以租户B 查同 contact → 断言【只见 B 自己的记忆，绝无 A 的任何内容】
#  - 写入/查询缺 tenant_id → 断言被拒绝（非全量、非串租户）
#  - commit-1 上述测试 failing；commit-2 实现后转绿；CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 纯后端 apps/api 记忆存储 + summarization + API，无 UI / 无 agent 远端协议 / 无 engine。
## target_environment: local_api
## target_environment_reason: 后端记忆逻辑用 vitest + psql 在本地 evaluator 验证（apps/api 已有 vitest），summarization 经 OpenRouter，无需远端机器。
## journey_id: Line04（客户私域 AI 接管；UUID 来源 = task.payload.journey_id，本次 payload 未注入显式 UUID，按 PrepPRD 锚定 Line04）
## step_id: L04-CS-memory-backend（来源 = PrepPRD Golden Path 锚定结果：对话记忆三层后端）
