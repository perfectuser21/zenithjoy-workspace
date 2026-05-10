# Path 2 Sprint B-1 Architecture Hotfix — agentContext middleware

**日期**: 2026-05-10
**分支**: `cp-05101835-p2-b1-arch-agent-context`
**类型**: Architecture hotfix（同 Sprint A architecture hotfix 套路）
**触发**: lead 自验真证据

---

## 1. 现状（错在哪 — 2 层 bug）

### Bug 1: backend `agent_id` 没自动 resolve（architecture 漏洞）

PR #281 (Sprint B-1) 把 `agent_id` 设成 POST `/api/agent/burner/qr-bind` 的 **body 必填字段**：

```ts
// apps/api/src/routes/agent-burner.ts L48-61
router.post('/qr-bind', async (req, res) => {
  const { tenant_id, agent_id, account_label } = req.body || {};
  if (!tenant_id || !agent_id) {
    return res.status(400).json(ERR('MISSING_ACCOUNT_LABEL', 'tenant_id + agent_id 必填'));
  }
  ...
  await pool.query(
    `INSERT INTO zenithjoy.publish_tasks (agent_id, ...) VALUES ($1, ...)`,
    [agent_id, ...]   // ← agent_id 期望 UUID（agents.id），但 caller 传 text agent_id 字符串
  );
});
```

但：
- `publish_tasks.agent_id` schema 是 **`UUID NOT NULL REFERENCES agents(id)`**（migration `20260507_115000_walking_skeleton_1.sql`）
- frontend / lead 自验都不知道当前 user 的 agent UUID（agents.id）
- frontend dashboard 实际只传 `{ account_label }`（`DouyinBurnerBindPage.tsx:97`），根本没 `agent_id`
- lead 自验脚本传 `agent_id="xian-rog-agent"`（文字 agent_id），不是 UUID

**真证据**:
```
postgres error: invalid input syntax for type uuid: "xian-rog-agent"
                at uuid.c:141
```

完全类比 Sprint A 的 `tenantContext` middleware 故事 — generator 设计成 frontend 必须传 `X-Tenant-Id` header，user 指出后改成 backend 用 session → user → tenant 自动 resolve。

### Bug 2: lead 自验 self-test script Step 1-3 是 stub（ws7 subagent 偷懒）

`scripts/lead-acceptance/path2-sprint-b1-self-test.cjs`：
- Step 1（注册 user + tenant + 飞书 binding）：log 一行 + `status: 'assumed_done'`，**没有 fetch**
- 直接跳 Step 4 用 hardcoded `agent_id="xian-rog-agent"` + `tenant_id=TENANT_KEY` 撞 backend UUID 校验
- 即使 backend 修好 agentContext，self-test 仍然没有真 user/tenant/agent 上下文 → 上线 0-touch lead 验收依然挂

---

## 2. 修法

### 2.1 Backend — 新增 `agentContext` middleware

新建 `apps/api/src/middleware/agent-context.ts`：

```ts
// 复用 tenantContext middleware 同样的 better-auth session resolve 逻辑：
// 1. tenantContext middleware 先 run → req.tenantId
// 2. agentContext middleware 接力 → 用 req.tenantId 查 agents 表
//    SELECT id FROM zenithjoy.agents
//     WHERE tenant_id = $1 AND status = 'active'
//     ORDER BY created_at DESC LIMIT 1
// 3. 命中 → req.agentId = UUID; 未命中 → 401 NO_AGENT_CONTEXT
```

边界处理：
- user 未绑过 agent → `401 NO_AGENT_CONTEXT`，提示先装 agent
- 多 agent → 取最新一个（lead 自验 only test 1 agent 场景；future 可加 `account_label → agent` 解析）
- DB error → `500 AGENT_LOOKUP_FAILED`

### 2.2 Backend — `routes/agent-burner.ts` 4 个端点改

| 端点 | 改法 |
|---|---|
| `POST /qr-bind` | mount `tenantContext` + `agentContext`；优先用 `req.agentId`/`req.tenantId`；body 仍可传 `agent_id`/`tenant_id` (向后兼容 supertest integration test 直接 POST，但 explicit body 优先) |
| `POST /crawl-comments` | 同上 |
| `POST /qr-bind-result` | **不加** middleware（Agent 回调，无 session）— 仅看 X-Smoke-Token 或现有逻辑 |
| `POST /crawl-comments-result` | 同上 |

### 2.3 self-test 脚本重写 Step 1-3

`scripts/lead-acceptance/path2-sprint-b1-self-test.cjs`：

| Step | 改前 | 改后 |
|---|---|---|
| 1 注册 | log 'assumed_done' | 真 fetch `POST /api/auth/sign-up/email` (better-auth) → 拿 `user.id` + session cookie |
| 2 飞书绑 | 无 | 真 fetch `POST /api/feishu/oauth/bind` 用 `app_id`/`app_secret`（命令行参或环境变量传入）→ 拿 `tenant_id` + `app_token` + 3 `table_id` |
| 3 写视频 URL | 无 | 真飞书 Bitable POST `/open-apis/bitable/v1/apps/<app_token>/tables/<table_id_target_videos>/records`（用 step 2 拿的 `tenant_access_token`）|
| 3.5 mock agent | 无 | 调 dev-only `POST /api/_smoke/mock-agent`（NODE_ENV gate）→ 创 `agents` 行 (status='active')，方便 step 4 agentContext 命中 |
| 4 qr-bind | hardcoded `agent_id="xian-rog-agent"` body | 去掉 `agent_id` body，仅传 `{ account_label }`；带 session cookie |

`/api/_smoke/mock-agent` 设计（dev-only）：
- 双门禁：`NODE_ENV !== 'production'` + `X-Smoke-Token`
- body: `{ tenant_id, agent_id_text }`（agent_id_text 是 hostname-friendly 文字串，例 'xian-rog-agent'，非 UUID）
- 行为：UPSERT `INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES (..., 'online')`
- 返：`{ success: true, agent_uuid }`

---

## 3. 测试策略

### 3.1 Unit / integration test (新)

`apps/api/src/middleware/agent-context.test.ts`:
- 测 happy path: `req.tenantId` 已 set → query agents → `req.agentId` set → next()
- 测 NO_AGENT_CONTEXT: tenant 没 agent → 401
- 测 多 agent → 取最新 (created_at DESC)
- 测 DB 错 → 500 AGENT_LOOKUP_FAILED

`apps/api/tests/integration/p2-b1-arch/agent-context-route.test.ts`:
- supertest POST `/api/agent/burner/qr-bind` 仅传 `{ account_label }` + 设置 X-Feishu-User-Id 头（旧路径）+ 已有 agent → 200
- 仅传 `{ account_label }` + 已有 tenant 但没 agent → 401 NO_AGENT_CONTEXT
- 完全不带 session → 401 UNAUTHORIZED
- 显式传 body `agent_id` + `tenant_id` (向后兼容路径) → 200（不走 middleware resolve）

### 3.2 self-test 脚本结构 test

`apps/api/tests/p2-b1-arch/self-test-step123-real.test.ts`:
- 读 self-test 文件，正则断言 Step 1 含 `auth/sign-up/email` 真 fetch
- 断言 Step 2 含 `/api/feishu/oauth/bind` 真 fetch
- 断言 Step 3 含 `bitable/v1/apps/` POST records 真 fetch
- 断言 Step 4 不含 `agent_id: 'xian-rog-agent'` 字面量

---

## 4. DoD

- [x] `apps/api/src/middleware/agent-context.ts` 新增，含 happy + 4 边界
- [x] `routes/agent-burner.ts` POST `/qr-bind` + `/crawl-comments` mount middleware
- [x] `routes/_smoke-mock-agent.ts` 新增，双门禁
- [x] `scripts/lead-acceptance/path2-sprint-b1-self-test.cjs` Step 1-3 全真 fetch
- [x] unit test + integration test 全通过
- [x] CI 35/35 PASS
- [x] backend redeploy 后 curl `qr-bind` 不再 UUID syntax 错误
