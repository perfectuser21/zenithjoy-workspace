# Plan — Path 2 Sprint B-1 Architecture Hotfix: agentContext

**分支**: `cp-05101835-p2-b1-arch-agent-context`
**hotfix 性质** — 4 task 即可。

---

## Task 1 — agentContext middleware（TDD）

**RED commit**:
- 写 `apps/api/src/middleware/agent-context.test.ts` (vitest unit test)
  - 4 case：happy / NO_AGENT_CONTEXT / 多 agent 取最新 / DB 错 500
- 不写 impl，跑 `pnpm test agent-context.test` 必须 RED

**GREEN commit**:
- 写 `apps/api/src/middleware/agent-context.ts` 真 impl
- pool.query 用 `agents WHERE tenant_id=$1 AND status='online' ORDER BY created_at DESC LIMIT 1`
  - （schema check 是 'online'/'offline'，不是 'active'/'inactive' — 用真 schema 值）
- 跑 `pnpm test agent-context.test` 必须 GREEN

---

## Task 2 — agent-burner routes 接入 middleware（TDD）

**RED commit**:
- 写 `apps/api/tests/integration/p2-b1-arch/agent-context-route.test.ts`
  - case A: 不传 body agent_id，仅 `{ account_label }` + X-Feishu-User-Id 头 + 已有 agent → 200
  - case B: 同 A 但没 agent → 401 NO_AGENT_CONTEXT
  - case C: explicit body `{ tenant_id, agent_id, account_label }` 向后兼容 → 200（既有 supertest 测试也必须仍然通过）
- 跑 → RED（路由还没接 middleware）

**GREEN commit**:
- 改 `apps/api/src/routes/agent-burner.ts`：
  - import `tenantContext` + `agentContext`
  - `router.post('/qr-bind', tenantContext, agentContext, async (req, res) => { ... })`
  - 内部：`const tenantId = req.body?.tenant_id || req.tenantId; const agentId = req.body?.agent_id || req.agentId;`
  - 同改 `/crawl-comments`
  - 不改 `/qr-bind-result` / `/crawl-comments-result`（Agent 回调通道）
- 跑 → GREEN，包含 既有 b1-ws3 integration tests 全通过

---

## Task 3 — _smoke/mock-agent dev-only 端点（TDD）

**RED commit**:
- 写 `apps/api/src/routes/_smoke-mock-agent.test.ts` 占位 + `apps/api/tests/integration/p2-b1-arch/smoke-mock-agent.test.ts`
  - case A: NODE_ENV=production → 404
  - case B: 缺 X-Smoke-Token → 403
  - case C: 正常 → 200 + agents 行已 INSERT
- 跑 → RED

**GREEN commit**:
- 写 `apps/api/src/routes/_smoke-mock-agent.ts` 真 impl，复用 `_smoke-feishu-seed.ts` 双门禁模式
- mount 到 `app.ts`：`app.use('/api/_smoke', smokeMockAgentRouter);`
- 跑 → GREEN

---

## Task 4 — self-test script Step 1-3 真 implement（TDD）

**RED commit**:
- 写 `apps/api/tests/p2-b1-arch/self-test-step123-real.test.ts`
  - 读 `scripts/lead-acceptance/path2-sprint-b1-self-test.cjs`
  - assert 含 `auth/sign-up/email`
  - assert 含 `/api/feishu/oauth/bind`
  - assert 含 `bitable/v1/apps/` 关键字
  - assert 含 `/api/_smoke/mock-agent`
  - assert 不含字面量 `agent_id: 'xian-rog-agent'` 在 qr-bind body
- 跑 → RED

**GREEN commit**:
- 改 `scripts/lead-acceptance/path2-sprint-b1-self-test.cjs`：
  - Step 1: `fetchJson(${API_BASE}/api/auth/sign-up/email, ...)` 真注册（拿 cookie）
  - Step 2: `fetchJson(${API_BASE}/api/feishu/oauth/bind, ...)` 真飞书绑定（args.feishu_app_id, args.feishu_app_secret）
  - Step 3: 真飞书 Bitable POST records（用 step 2 拿的 tenant_access_token）
  - Step 3.5: `fetchJson(${API_BASE}/api/_smoke/mock-agent, ...)` 创 agents 行
  - Step 4: 改 body 为 `{ account_label: '装修小号B1' }`（去 agent_id/tenant_id）
- 跑 → GREEN

---

## Phase 4 — push + PR + 等 35/35 + merge

## Phase 5 — redeploy + curl 验证 endpoint
