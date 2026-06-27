# Line02 staging 主链 502 — tenant 从 session 解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让 line02 dashboard-facing 端点从已认证 session 解析 tenant（不信前端占位 tenant_id），消除 `/sessions`、`/collect/*` 因假 tenant 撞 UUID 列崩进程返 502。

**Architecture:** 照 codebase 已有样板 `acquisition-dispatch.ts`：端点挂 `tenantContextOptional` 中间件 + `tenantOf(req,res)` 读 `req.tenantId`（无则 401 JSON），handler body 包 try/catch（绝不让进程崩）。前端去掉硬编码占位 tenant（`'current'` / `'e2e-acq-tenant'`），靠 cookie session 让后端解析。`tenantContextOptional` 只读 header/body 不读 query，故前端 query 占位自动失效；但它**会读 body.tenant_id**，所以前端必须同时去掉 body 里的占位 tenant。

**Tech Stack:** Express, TypeScript, vitest + supertest, React（apps/dashboard）。

工作目录：worktree `~/worktrees/zenithjoy/line02-tenant-resolve-502`，分支 `cp-06272156-line02-tenant-resolve-502`。命令在仓库根跑（`apps/api` / `apps/dashboard` 各自 vitest）。

---

## Task 1: agent-burner.ts — /sessions + /crawl-tasks/latest 从 session 解析 tenant

**Files:**
- Modify: `apps/api/src/routes/agent-burner.ts`
- Test: `apps/api/src/routes/agent-burner.test.ts`（追加 describe，旧测试不动）

- [ ] **Step 1: 写失败的回归测试（commit-1）**

在 `agent-burner.test.ts` 末尾追加（harness 已 mock pool + tenantContextOptional 读 `x-test-tenant-id`/body；文件顶部 import 已有 express/request/vi）。注意需要拿到被测 app —— 文件里已有挂载 router 的 `app`（沿用现有 `makeApp()` 或同款；若没有工厂，照现有 supertest 用例同样方式 `const app = express(); app.use(express.json()); app.use('/api/agent/burner', router);` 构造，router 从 `'./agent-burner'` 默认导入——查文件现有写法对齐）：

```ts
describe('GET /sessions — tenant 从 session 解析，不信 query [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('带 x-test-tenant-id → 200，pool 用该 tenant 查（不用 query）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [{ account_label: 'live101942', role: 'burner', status: 'active', bound_at: null, created_at: null, account_nickname: null }] });
    const res = await request(app)
      .get('/api/agent/burner/sessions?tenant_id=current')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.status).toBe(200);
    expect(res.body?.data?.sessions?.[0]?.account_label).toBe('live101942');
    // 关键：pool 拿的是 session tenant，不是 query 的 'current'
    const calledWith = (mod.default.query as any).mock.calls[0][1];
    expect(calledWith).toContain('4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(JSON.stringify(calledWith)).not.toContain('current');
  });

  it('无 tenant 上下文（只带 ?tenant_id=current）→ 401，绝不崩/不拿 current 查', async () => {
    const mod = await import('../db/connection');
    const res = await request(app).get('/api/agent/burner/sessions?tenant_id=current');
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('NO_TENANT');
    expect((mod.default.query as any)).not.toHaveBeenCalled();
  });

  it('pool 抛错 → 500 JSON（try/catch 兜，不抛崩进程）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
    const res = await request(app)
      .get('/api/agent/burner/sessions')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.status).toBe(500);
    expect(res.body?.success).toBe(false);
  });
});
```

> 若文件现有用例不是用顶层 `app` 而是每个用例内构造，照其写法在每个 it 内构造 app（关键是 router 挂在 `/api/agent/burner`）。实现者先读文件现有 supertest 用例对齐 app 构造方式。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts`
Expected: 新 3 个 FAIL（现状 /sessions 无中间件、读 query.tenant_id、无 401/500 分支）。

- [ ] **Step 3: 改 agent-burner.ts**

(a) 在 `OK`/`ERR` helper 下方（约 line 33 后）加 `tenantOf` helper：

```ts
function tenantOf(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) {
    res.status(401).json(ERR('NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）'));
    return null;
  }
  return t;
}
```

(b) `/sessions`（现 `router.get('/sessions', async (req, res) => {...}`）整段替换为：

```ts
router.get('/sessions', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT s.account_label, s.role, s.status, s.bound_at,
              s.created_at,
              (SELECT response->>'account_nickname'
                 FROM zenithjoy.publish_tasks
                WHERE agent_id=s.agent_id
                  AND task_type='qr_bind/douyin_burner'
                  AND payload->>'account_label' = s.account_label
                ORDER BY created_at DESC LIMIT 1) AS account_nickname
         FROM zenithjoy.agent_platform_sessions s
         JOIN zenithjoy.agents a ON a.id = s.agent_id
        WHERE a.tenant_id=$1
          AND s.role='burner'
          AND s.platform='douyin'
        ORDER BY s.created_at DESC`,
      [tenantId],
    );
    return res.json(OK({ sessions: r.rows }));
  } catch (err) {
    console.error('[burner/sessions] query failed:', (err as Error).message);
    return res.status(500).json(ERR('SESSIONS_QUERY_FAILED', (err as Error).message));
  }
});
```

(c) `/crawl-tasks/latest`（现 `router.get('/crawl-tasks/latest', async ...)` 读 `req.query.tenant_id`）整段替换为：

```ts
router.get('/crawl-tasks/latest', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT id, status, response, created_at, updated_at
         FROM zenithjoy.publish_tasks
        WHERE task_type='crawl_comments/douyin' AND tenant_id=$1
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json(ERR('NO_CRAWL_TASK', '暂无 crawl task'));
    }
    const row = r.rows[0];
    const resp = row.response || {};
    return res.json(
      OK({
        task_id: row.id,
        status: row.status,
        comment_count: resp.comment_count ?? 0,
        lead_write_status: resp.lead_write_status,
        feishu_bitable_url: resp.feishu_bitable_url,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
    );
  } catch (err) {
    console.error('[burner/crawl-tasks/latest] query failed:', (err as Error).message);
    return res.status(500).json(ERR('CRAWL_LATEST_QUERY_FAILED', (err as Error).message));
  }
});
```

> `tenantContextOptional` 已在文件顶部 import（line 19），无需新增 import。

- [ ] **Step 4: 跑测试确认通过（含旧用例）**

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts`
Expected: 全 PASS（旧 qr-bind/crawl-comments 用例 + 新 3 个）。

- [ ] **Step 5: 两次 commit（TDD）**

```bash
cd ~/worktrees/zenithjoy/line02-tenant-resolve-502
git add apps/api/src/routes/agent-burner.test.ts
git commit -m "test(line02): /sessions+/crawl-tasks/latest 从 session 解析 tenant 守卫（failing）"
git add apps/api/src/routes/agent-burner.ts
git commit -m "fix(line02): burner /sessions+/crawl-tasks/latest 挂 tenantContextOptional+tenantOf+try/catch，不信 query.tenant_id（修 502）"
```

---

## Task 2: acquisition.ts — collect/expand + collect/start 从 session 解析 tenant

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`
- Test: `apps/api/src/routes/acquisition.test.ts`（追加；若不存在则新建，harness 照 agent-burner.test.ts 同款 mock）

- [ ] **Step 1: 写失败的回归测试（commit-1）**

实现者先读 `acquisition.test.ts`（若有）的 app 构造 + mock 方式；无则照 `agent-burner.test.ts` 顶部同款建（`vi.mock('../db/connection')` + `vi.mock('../middleware/tenant-context')` 读 `x-test-tenant-id`/body + supertest 挂 `acquisitionRouter` 到 `/api/acquisition`）。追加：

```ts
describe('collect/start — tenant 从 session，不信前端占位 [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('带 x-test-tenant-id + keywords → 用 session tenant 派单（不拿 body 占位）', async () => {
    const mod = await import('../db/connection');
    // loadBindingLite 命中 + INSERT 返 id（按实现里 query 次序 mock）
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'real', app_token: 'x', enterprise_doc_token: 'd' }] }) // loadBindingLite
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] }); // INSERT
    const res = await request(app)
      .post('/api/acquisition/collect/start')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6')
      .send({ keywords: ['装修'] }); // 不传 tenant_id
    expect([200, 400]).toContain(res.status); // 200 派单 / 400 仅当 binding 判定不过——关键是不 401、不崩
    // 至少 loadBindingLite 用的是 session tenant
    const firstArgs = (mod.default.query as any).mock.calls[0][1];
    expect(JSON.stringify(firstArgs)).toContain('4807edc7-da2a-4e8d-9223-31f4d25c12c6');
  });

  it('无 tenant 上下文 → 401 NO_TENANT（不是 400 TENANT_ID_REQUIRED、不崩）', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/start')
      .send({ keywords: ['装修'] });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: FAIL（现状读 body.tenant_id、无中间件、无 401）。

- [ ] **Step 3: 改 acquisition.ts**

(a) 顶部 import 加（若未引）：

```ts
import { tenantContextOptional } from '../middleware/tenant-context';
```

(b) 在文件 helper 区加 `tenantOf`（若文件已有 `fail`，用它；放在 `fail` 定义之后）：

```ts
function tenantOf(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) {
    fail(res, 401, 'NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）');
    return null;
  }
  return t;
}
```

(c) `collect/expand`：路由加中间件 + 改 tenant 来源 + 包 try/catch。把 `acquisitionRouter.post('/collect/expand', async (req, res) => {` 改为 `acquisitionRouter.post('/collect/expand', tenantContextOptional, async (req, res) => {`，并把开头：

```ts
  const tenantId = req.body?.tenant_id;
  const manualKeywords: unknown = req.body?.manual_keywords;
  if (!tenantId) return fail(res, 400, 'TENANT_ID_REQUIRED', '缺 tenant_id');
```
替换为：
```ts
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const manualKeywords: unknown = req.body?.manual_keywords;
```
并把该 handler 余下 body 整体包进 `try { ... } catch (err) { console.error('[acquisition/expand]', (err as Error).message); return fail(res, 500, 'EXPAND_FAILED', (err as Error).message); }`（保留内部已有的局部 try/catch 不动）。

(d) `collect/start`：同样把路由改 `acquisitionRouter.post('/collect/start', tenantContextOptional, async (req, res) => {`，开头：
```ts
  const tenantId = req.body?.tenant_id;
  const keywords: unknown = req.body?.keywords;
  if (!tenantId) return fail(res, 400, 'TENANT_ID_REQUIRED', '缺 tenant_id');
```
替换为：
```ts
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const keywords: unknown = req.body?.keywords;
```
并把 handler 余下 body 包进 `try { ... } catch (err) { console.error('[acquisition/start]', (err as Error).message); return fail(res, 500, 'START_FAILED', (err as Error).message); }`。

> 注：`tenantContextOptional` 仍读 body.tenant_id；前端 Task 3 会去掉 body 占位，浏览器请求走 session 解析真 tenant。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: 两次 commit**

```bash
cd ~/worktrees/zenithjoy/line02-tenant-resolve-502
git add apps/api/src/routes/acquisition.test.ts
git commit -m "test(line02): collect/start 从 session 解析 tenant 守卫（failing）"
git add apps/api/src/routes/acquisition.ts
git commit -m "fix(line02): acquisition collect/expand+start 挂 tenantContextOptional+tenantOf+try/catch（修采集 502）"
```

---

## Task 3: 前端去掉硬编码占位 tenant

**Files:**
- Modify: `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx`
- Modify: `apps/dashboard/src/pages/LeadsPage.tsx`
- Test: 各页对应 `.test.tsx`（若有则改断言；无则加源码断言测试，见 Step 1）

- [ ] **Step 1: 写失败的回归测试（commit-1）**

新建 `apps/dashboard/src/pages/__tests__/no-placeholder-tenant.test.ts`（纯源码断言，不渲染）：

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGES = path.resolve(__dirname, '..');

describe('line02 页面不再硬编码占位 tenant [BEHAVIOR]', () => {
  it('DouyinBurnerBindPage 不含 tenant_id=current', () => {
    const src = fs.readFileSync(path.join(PAGES, 'DouyinBurnerBindPage.tsx'), 'utf8');
    expect(src).not.toMatch(/tenant_id=current/);
  });
  it('LeadsPage 不再向请求 body 塞硬编码 TENANT_ID', () => {
    const src = fs.readFileSync(path.join(PAGES, 'LeadsPage.tsx'), 'utf8');
    expect(src).not.toMatch(/tenant_id:\s*TENANT_ID/);
    expect(src).not.toMatch(/const\s+TENANT_ID\s*=\s*['"]e2e-acq-tenant['"]/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/dashboard && npx vitest run src/pages/__tests__/no-placeholder-tenant.test.ts`
Expected: FAIL（现状两页都含占位）。

- [ ] **Step 3: 改前端**

(a) `DouyinBurnerBindPage.tsx` line 51：
```ts
const sr = await fetch('/api/agent/burner/sessions?tenant_id=current');
```
改为：
```ts
const sr = await fetch('/api/agent/burner/sessions');
```

(b) `LeadsPage.tsx`：
- 删掉 line 35 `const TENANT_ID = 'e2e-acq-tenant';`。
- line 77 `body: JSON.stringify({ tenant_id: TENANT_ID }),` 改为 `body: JSON.stringify({}),`（collect/expand 不再传 tenant，靠 cookie session）。
- line 98 `body: JSON.stringify({ tenant_id: TENANT_ID, keywords: acqKeywords.map((k) => k.word) }),` 改为 `body: JSON.stringify({ keywords: acqKeywords.map((k) => k.word) }),`。
- 这些 fetch 必须带 cookie：确认 fetch 调用同源（同域 cookie 自动带）；若现有 fetch 已工作（config/plan 等同源调用成功）则无需加 credentials。

- [ ] **Step 4: 跑测试确认通过 + 前端 build 不破**

Run:
```bash
cd apps/dashboard
npx vitest run src/pages/__tests__/no-placeholder-tenant.test.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "LeadsPage|DouyinBurnerBind" || echo "no new tsc error in touched files"
```
Expected: 测试 PASS；touched 文件无新 tsc 错（删 TENANT_ID 后若有 unused 引用要一并清）。

- [ ] **Step 5: 两次 commit**

```bash
cd ~/worktrees/zenithjoy/line02-tenant-resolve-502
git add apps/dashboard/src/pages/__tests__/no-placeholder-tenant.test.ts
git commit -m "test(line02): 前端不再硬编码占位 tenant 守卫（failing）"
git add apps/dashboard/src/pages/DouyinBurnerBindPage.tsx apps/dashboard/src/pages/LeadsPage.tsx
git commit -m "fix(line02): 前端去掉占位 tenant_id（current/e2e-acq-tenant），靠 session 解析"
```

---

## Self-Review

- **Spec coverage**：单元1 agent-burner /sessions+/crawl-tasks=Task1 / 单元2 acquisition collect=Task2 / 单元3 前端占位=Task3。全覆盖。grade=INVALID_GRADE 经核实非真 bug（前端用中文 VALID_GRADES）已剔除；飞书 Base Table / agent 重复号 / 下载配 staging 明确不做（设计已列）。
- **Type 一致**：`tenantOf(req,res)` 两文件各自定义（agent-burner 用 ERR、acquisition 用 fail），签名一致返回 `string|null`。
- **proven-to-fire**：逻辑守卫（query 占位被无视 + try/catch 容错）在 CI；真 502（PG UUID cast）由部署后 staging e2e 验（我自己点）。
- **Placeholder**：无 TBD，所有 step 给确切代码/命令。
