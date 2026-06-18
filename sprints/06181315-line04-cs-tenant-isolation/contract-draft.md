# Sprint Contract Draft (Round 1) — Line04 客服层多租户隔离（tenant scope）

## 已知约束（来自回归测试）

- [tests/integration/ws5/path1-isolation.test.ts] → 本类 sprint 不动 `agent_platform_sessions` schema（本 sprint 同样不动 schema 结构，只在查询上加 JOIN/WHERE）
- [tests/routes/wechat.test.ts] → 路由测试约定：supertest + `vi.mock('../../src/db/connection')` mock pg pool，不真连 DB
- [tests/works-multitenant.test.ts] → tenant 级隔离既有范式：`tenant_members.feishu_user_id` 反查 tenant，缺登录 401 / 无 tenant 关联 403 `NO_TENANT`

## 隔离链路（技术事实，决定 How）

```
agent_platform_sessions.agent_id ──FK──> zenithjoy.agents.id ──> agents.tenant_id
wechat_publish_task.agent_id      ───────────────────────────────> （写入归属同一租户的 agent）
```

- tenant scope = `JOIN zenithjoy.agents a ON a.id = aps.agent_id WHERE a.tenant_id = $当前租户`
- `agent_platform_sessions` 无 `tenant_id` 列、`wechat_publish_task` 无 `tenant_id` 列 → 一律经 `agents.tenant_id` 桥接，**不改 schema 结构**（符合 PRD 范围限定）
- 租户上下文来源：复用既有中间件语义。客服路径多为 cron / listen_chat 等非浏览器 caller（无 cookie）→ 采用 `agent-context.ts` 既定的「body 显式 id 向后兼容」范式：请求体显式 `tenant_id`（或可解析的租户上下文）= 当前租户；二者皆无 → 拒绝，**绝不回退全量**

## Response Schema（推导来源: api_registry 不可达 → 复用 wechat 路由现有 envelope + PRD 边界）

> Brain registry（localhost:5221）在本环境不可达；按 `apps/api/src/routes/wechat.ts` 现有响应风格推导（`{error, message}` 而非 middleware 的 `{success,...}` envelope，与同文件其它端点一致）。

### Endpoint: POST /api/wechat/scheduler-tick
**Success (HTTP 200)**（保持现状，不改）:
```json
{"generated": <number>, "skipped": <array>}
```
- `generated` (number, 必填): 本次生成的草稿数 — 来源 [现状保留]
- `skipped` (array, 必填): 跳过项 `[{customer, reason}]` — 来源 [现状保留]

**缺租户上下文 (HTTP 4xx)**:
```json
{"error": "<string>", "message": "<string>"}
```
- `error` (string, 必填): 错误码（如 `NO_TENANT_CONTEXT`）— 来源 [AI_ADDED，对齐 wechat 路由 `error` 风格]

### Endpoint: POST /api/wechat/draft-generate
**Success (HTTP 200)**（保持现状，新增内部 tenant scope 透传）:
```json
{"task_id": <string>, "draft_id": <string>, "status": <string>}
```
- 三字段来源 [现状保留]；新增要求：写入必须归属当前租户的 agent（经 `agents.tenant_id` 校验）

**缺租户上下文 (HTTP 4xx)**:
```json
{"error": "<string>", "message": "<string>"}
```

**禁用行为**（contract 反向断言）:
- ❌ 缺租户时执行**不带 `tenant_id` 过滤**的客户枚举查询（全量查）
- ❌ 缺租户时回退为「处理所有客户」/「写入任意 agent」
- ❌ 租户 B 的请求参数里出现租户 A 的 `tenant_id`

---

## Golden Path

[以某租户身份发起客服查询/写入] → [仅命中该租户数据] → [跨租户数据绝不出现] → [缺租户上下文则拒绝]

### Step 1: 以租户A 查"今日朋友圈客户列表" → 只返回 A 名下客户
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「范围限定·在范围内」客户列表查询（`apps/api/src/routes/wechat.ts:213` scheduler-tick 客户枚举）

**可观测行为**: 以租户 A 上下文触发客服客户枚举，DB 查询按 `agents.tenant_id = A` 过滤；返回的客户全部属于 A。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts \
  -t "租户A 客户枚举按 agents.tenant_id 过滤并绑定 A 参数"
# 期望: exit 0（SQL 含 agents JOIN + tenant_id 过滤 + 绑定参数 == 租户A id）
```

**硬阈值**: 客户枚举 SQL 匹配 `/agents/i` 且 `/tenant_id/i`，绑定参数包含租户 A 的 id；HTTP 200。
**对应可执行命令**: 上方 vitest（断言 `expect(sql).toMatch(/agents/i)`、`expect(sql).toMatch(/tenant_id/i)`、`expect(params).toContain(TENANT_A)`）

---

### Step 2: 以租户B 查同一接口 → 只返回 B 名下客户，绝无 A（物理隔离）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「边界情况」同 platform 不同租户互不污染

**可观测行为**: 切换到租户 B 上下文，枚举查询绑定 B 的 `tenant_id`，参数里**绝不出现** A 的 id。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts \
  -t "租户B 客户枚举绑定 B 参数，绝不串到租户A"
# 期望: exit 0（绑定参数含 B、不含 A）
```

**硬阈值**: 绑定参数包含租户 B 的 id 且 **不包含** 租户 A 的 id。
**对应可执行命令**: 上方 vitest（`expect(params).toContain(TENANT_B)` + `expect(params).not.toContain(TENANT_A)`）

---

### Step 3: draft-generate 写入 + scheduler-tick 客户遍历全部按当前租户 scope
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 +「范围限定」draft-generate 写入带 tenant / scheduler-tick 遍历带 tenant

**可观测行为**: draft-generate 在缺租户上下文时拒绝、绝不写入；带租户上下文时放行并把 `tenant_id` scope 透传到 `generateChatDraft` 写入（归属当前租户 agent）。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts \
  -t "draft-generate 带租户上下文时放行并按当前租户写入"
# 期望: exit 0（generateChatDraft 收到 {tenant_id: 当前租户}）
```

**硬阈值**: 带租户时 HTTP 200 且 `generateChatDraft` 入参含当前租户 `tenant_id`；写入归属该租户 agent。
**对应可执行命令**: 上方 vitest（`expect(arg).toMatchObject({ tenant_id: TENANT_A })`）

---

### Step 4: 缺租户上下文 → 拒绝请求，不回退全量查（不返回任何跨租户数据）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条 +「边界情况」租户上下文缺失→拒绝禁止 fallback

**可观测行为**: scheduler-tick / draft-generate 缺租户上下文 → 返回 4xx；**绝不执行**一条不带 `tenant_id` 过滤的全量客户枚举查询，也不处理任何客户。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts \
  -t "缺租户上下文时拒绝（4xx）且绝不执行无 tenant_id 过滤的全量客户查询"
cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts \
  -t "draft-generate 缺租户上下文时拒绝且绝不写入草稿"
# 期望: 两条均 exit 0（4xx + 无全量查 + 无写入/无客户处理）
```

**硬阈值**: HTTP ≥ 400；`mock.calls` 中不存在「命中 `agent_platform_sessions` 但不含 `tenant_id`」的查询；`generateMomentDraft`/`generateChatDraft` 零调用。
**对应可执行命令**: 上方 vitest（`expect(unscoped).toBeFalsy()` + `expect(generateMomentDraftMock).not.toHaveBeenCalled()` + `expect(generateChatDraftMock).not.toHaveBeenCalled()`）

---

### Step 5: 隔离断言反向兜底 —— 防应用层假隔离 / 全量查残留
**来源**: `[AI_ADDED]` — 理由：防 generator 用「先全量查再应用层 filter」假隔离（仍把 B 数据拉进进程内），或保留旧全量查路径只是不调用。断言对象是真实发给 `pool.query` 的 SQL 文本 + 绑定参数 → 隔离必须落在 SQL 层（`WHERE agents.tenant_id = $`），generator 不写真 scope SQL 无法转绿。

**可观测行为**: 任何命中 `agent_platform_sessions` 的客户枚举查询都必须带 `tenant_id` 过滤；不存在「无 tenant 过滤的枚举查询被执行」的路径。

**验证命令**: 同 Step 4 第一条（`unscoped` 断言）+ Step 1/2 的 `/tenant_id/i` SQL 文本断言共同覆盖。

**硬阈值**: 全测试套件中不出现未带 `tenant_id` 的 `agent_platform_sessions` 枚举查询。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 为纯后端 `apps/api` 客服读写隔离，无 HTTP 长驻服务/无 DB 实例于 evaluator 沙箱，且 `agent_platform_sessions` 无 `customer` 列（既有枚举查询出错即被 catch 吞掉）。因此 oracle 采用 repo 既定的 **supertest + mock pg pool** vitest（DB 为外部边界可 mock，被测真实逻辑 = tenant-scope SQL 构造 + 缺租户拒绝；断言对象是真实 SQL 文本与绑定参数，不可造假）。物理隔离由 SQL 层 `WHERE agents.tenant_id = $` 保证（postgres 强制）。

```bash
#!/bin/bash
set -e
# Golden Path 全程（local_api，evaluator 直接跑）：5 条 [BEHAVIOR] 一次性验收
cd apps/api
npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts --reporter=basic
# 期望：5 passed（实现前 5 failed = RED；实现后全绿 = GREEN）
echo "✅ Line04 客服层多租户隔离 Golden Path 验证通过"
```

**通过标准**: vitest exit 0，5 条 BEHAVIOR 全绿。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（客服层 tenant 隔离） | `apps/api/tests/regression/line04-cs-tenant-isolation.test.ts` | 租户A 枚举 scope / 租户B 枚举 scope 不串 A / 缺租户拒绝不回退全量 / draft-generate 缺租户拒绝 / draft-generate 带租户写入 scope | → 5 failed（已实测 RED）|

> 该测试位于 `apps/api/tests/regression/`：CLAUDE.md 规定修隔离类缺陷的 regression test 必须永久留 CI 跑。`regression/` 未被 vitest.config `exclude` → 默认 `vitest run` 即收。
