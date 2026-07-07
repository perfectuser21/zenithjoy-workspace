# Line02 采集主链 P0 断链修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修好"网页输入关键词点搜索 → 安卓机被唤醒采集"主链的起点断链——让 dashboard 触发的 keyword 采集任务带上租户、被同租户安卓 agent 拉到，并让前端列表看到任务在跑。

**Architecture:** 后端 `POST /keyword-search` 改挂 `tenantContextOptional`（从 session cookie/显式头解析租户，替换现有手读逻辑）；后端新增只读 `GET /keyword-tasks`（租户过滤，不 mutate status）；前端 `AcquisitionConfigPage` 列表改读 `/keyword-tasks`。安卓 agent、租户身份机制零改动。

**Tech Stack:** Express + pg（apps/api）、React 裸 fetch（apps/dashboard）、vitest + supertest、既有 `tenantContextOptional`。

## Global Constraints

- 租户隔离：`/keyword-search` 写库、`/keyword-tasks` 查询、`pending-keyword-tasks` 一律带 `tenant_id=$1`；不得跨租户列/写。
- 向后兼容：`tenantContextOptional` 保留 `X-Tenant-Id` 头 / `body.tenant_id` 显式路径（CI smoke、agent 直调、桌面 agent 照常）。
- 不破坏既有回归：`comment-score-result` 按 `keyword_task_id` 反查租户、禁 `LIMIT 1` 猜租户（`acquisition.test.ts` 既有回归）。
- 第一刀边界：1 关键词；不做视频抓 list、不做 `video-search-result` 回传、不做多关键词；`/keyword-tasks` 不含视频数/Lead 数聚合列。
- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 Task commit 顺序 commit-1 fail test / commit-2 impl。

---

### Task 1: keyword-search 挂租户中间件（修 P0）

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:31-76`（keyword-search handler）
- Test: `apps/api/src/routes/acquisition.test.ts:87-99,997-1041`（改现有用例）

**Interfaces:**
- Consumes: `tenantContextOptional`（已 import at `acquisition.ts:12`）、`req.tenantId`
- Produces: keyword-search 行为——无租户（无头且无 session）→ 401；有 `X-Tenant-Id` 头或 session → 200 且任务 `tenant_id` 写真值。

- [ ] **Step 1: 写复现 failing test（收紧无租户行为）**

改 `acquisition.test.ts` 现有 `describe('POST /api/acquisition/keyword-search — tenant_id 写库')`（:997）里的 `无 tenant header 时 tenant_id 写 null` 用例（:1026-1040），替换为"无租户→401"：

```ts
  it('无 tenant header 且无 session → 401 NO_TENANT（不写库）', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '装修' });

    expect(res.status).toBe(401);
    // 未触达 INSERT（中间件在 handler 前拦截）
    const insertCalls = (db.query as any).mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.acquisition_keyword_tasks')
    );
    expect(insertCalls.length).toBe(0);
  });
```

同时把两个 VITEST-mode 无头 200 用例（:87 `returns 200 with task_id...`、:96 `task_id is UUID format`）各补上 `.set('X-Tenant-Id', '11111111-1111-1111-1111-111111111111')`：

```ts
  it('returns 200 with task_id and keywords (VITEST mode)', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .set('X-Tenant-Id', '11111111-1111-1111-1111-111111111111')
      .send({ keyword: '装修' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task_id');
    expect(res.body).toHaveProperty('keywords');
    expect(Array.isArray(res.body.keywords)).toBe(true);
    expect(typeof res.body.task_id).toBe('string');
  });

  it('task_id is UUID format', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .set('X-Tenant-Id', '11111111-1111-1111-1111-111111111111')
      .send({ keyword: '家装' });
    expect(res.body.task_id).toMatch(/^[0-9a-f-]{36}$/);
  });
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "无 tenant header 且无 session"`
Expected: FAIL — 现状 keyword-search 未挂中间件，无租户返回 200（不是 401）。

- [ ] **Step 3: 挂中间件 + 用 req.tenantId（最小实现）**

`acquisition.ts:31` 改签名挂中间件，并把 :40-42 手读租户替换为 `req.tenantId`：

```ts
acquisitionRouter.post('/keyword-search', tenantContextOptional, async (req: Request, res: Response) => {
  const { keyword } = req.body ?? {};

  if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
    return res.status(400).json({ error: 'MISSING_KEYWORD' });
  }

  const kw = keyword.trim();

  // 租户来自 tenantContextOptional（X-Tenant-Id 头 / body.tenant_id / session cookie）
  const tenantId: string = req.tenantId!;
```

（`tenantContextOptional` 已在无租户时返回 401/403 并终止，故到达 handler 时 `req.tenantId` 必非空。删除原 :40-42 手读块；INSERT 的 `$4` 继续用 `tenantId`，:68 不变。）

> 注意 `MISSING_KEYWORD` 校验现在在中间件之后：无租户 + 无 keyword 会先 401（租户门槛优先），符合"未登录不给用"。既有 `returns 400 when keyword missing`（:76 附近）用例若无租户头会变 401 → 一并给这些 400 用例补 `.set('X-Tenant-Id', ...)`（同 Step 1 手法），保持它们测的是 keyword 校验。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: PASS —— 无租户 401、带头 200 且 `insertCall[1][3]===TENANT_C`（:1008 用例不变）、400 校验用例带头后仍 400。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/acquisition.ts apps/api/src/routes/acquisition.test.ts
git commit -m "fix(line02): keyword-search 挂 tenantContextOptional 修租户断链(P0)"
```

---

### Task 2: 新增 GET /keyword-tasks（前端列表数据源）

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`（在 `pending-keyword-tasks` handler 后、`collect-tasks` 前插入新 handler）
- Test: `apps/api/src/routes/acquisition.test.ts`（新增 describe）

**Interfaces:**
- Consumes: `tenantContextOptional`、`req.tenantId`、表 `zenithjoy.acquisition_keyword_tasks`
- Produces: `GET /api/acquisition/keyword-tasks` → `{ success, data: { tasks: [{id, keyword, status, created_at}], total }, timestamp }`；无租户 → 401；只列本租户；**不 mutate status**。

- [ ] **Step 1: 写 failing test**

在 `acquisition.test.ts` 末尾新增（`TENANT_B` 等常量沿用文件既有定义；若无则本 describe 内定义 `const TENANT_K = 'kkkkkkkk-0000-0000-0000-000000000001';`）：

```ts
describe('GET /api/acquisition/keyword-tasks — 前端列表（租户隔离/只读）', () => {
  beforeEach(() => { vi.stubEnv('VITEST', ''); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it('无租户上下文 → 401 NO_TENANT，不查库', async () => {
    const { default: db } = await import('../db/connection');
    const res = await request(app).get('/api/acquisition/keyword-tasks');
    expect(res.status).toBe(401);
    expect((db.query as any).mock.calls.length).toBe(0);
  });

  it('带 X-Tenant-Id → 只 SELECT 本租户任务，不 UPDATE status', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_K = 'kkkkkkkk-0000-0000-0000-000000000001';
    (db.query as any).mockResolvedValueOnce({
      rows: [{ id: 't1', keyword: '麻婆豆腐', status: 'dispatched', created_at: '2026-07-07T00:00:00Z' }],
    });
    const res = await request(app)
      .get('/api/acquisition/keyword-tasks')
      .set('X-Tenant-Id', TENANT_K);
    expect(res.status).toBe(200);
    expect(res.body.data.tasks[0].keyword).toBe('麻婆豆腐');
    const calls = (db.query as any).mock.calls;
    // 唯一一次查询，且带 tenant_id、是 SELECT 不含 UPDATE
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toContain('SELECT');
    expect(calls[0][0]).not.toContain('UPDATE');
    expect(JSON.stringify(calls[0][1])).toContain(TENANT_K);
  });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "前端列表（租户隔离/只读）"`
Expected: FAIL —— 404（端点不存在）/ 断言不过。

- [ ] **Step 3: 实现 handler**

在 `acquisition.ts` 的 `pending-keyword-tasks` handler 结束（:147）后插入：

```ts
// 前端列表端点 — 返回本租户的 keyword 采集任务（最新 20 条，只读不 mutate）
acquisitionRouter.get('/keyword-tasks', tenantContextOptional, async (req: Request, res: Response) => {
  if (process.env.VITEST) {
    return res.status(200).json({ success: true, data: { tasks: [], total: 0 }, timestamp: new Date().toISOString() });
  }
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ success: false, error: { code: 'NO_TENANT', message: '缺租户上下文（未登录或无 X-Tenant-Id）' }, timestamp: new Date().toISOString() });
  }
  try {
    const pool = (await import('../db/connection')).default;
    const { rows } = await pool.query(
      `SELECT id, keyword, status, created_at
         FROM zenithjoy.acquisition_keyword_tasks
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [tenantId]
    );
    const tasks = rows.map((r: any) => ({
      id: r.id, keyword: r.keyword, status: r.status, created_at: r.created_at,
    }));
    return res.status(200).json({ success: true, data: { tasks, total: tasks.length }, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[acquisition] keyword-tasks error:', (err as Error).message);
    return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: '查询失败' }, timestamp: new Date().toISOString() });
  }
});
```

> `beforeEach` 里 `vi.stubEnv('VITEST','')` 已解除 VITEST，故上面 VITEST 短路不影响测试；两个测试走真实分支（mock db）。无租户测试：中间件 401 早于 handler，`db.query` 0 次调用。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "前端列表（租户隔离/只读）"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/acquisition.ts apps/api/src/routes/acquisition.test.ts
git commit -m "feat(line02): 新增 GET /keyword-tasks 前端列表端点(租户隔离只读)"
```

---

### Task 3: 前端列表对齐到 keyword 管线

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionConfigPage.tsx`（`CollectTasksBlock` 的 `load()` :303 + 渲染列）
- Test: `apps/dashboard/src/pages/AcquisitionConfigPage.tsx` 若有对应 `.test.tsx` 则更新；否则本 Task 的验收靠 smoke(Task 4) + 真机

**Interfaces:**
- Consumes: `GET /api/acquisition/keyword-tasks` 返回 `{ data: { tasks: [{id, keyword, status, created_at}] } }`

- [ ] **Step 1: 读现有 CollectTasksBlock**

先 `Read` `AcquisitionConfigPage.tsx:291-412`，看清 `load()`（:303 `fetch('/api/acquisition/collect-tasks')`）与任务列表渲染（含"视频数/Lead 数"列）。

- [ ] **Step 2: 改 load() 读 /keyword-tasks + 字段映射 + 砍两列**

把 `load()` 里的 `fetch('/api/acquisition/collect-tasks')` 改为 `fetch('/api/acquisition/keyword-tasks')`；响应仍是 `{ data: { tasks } }`，每条用 `{ id, keyword, status, created_at }`。渲染列**移除"视频数""Lead 数"两列**（A 表无此计数），保留 关键词 / 状态 / 创建时间。若列表项类型定义含 `video_count`/`lead_count` 字段，去掉相关引用。

> 提交任务的 `POST /keyword-search`（:331 那次 fetch）**不动**——它本就同源带 cookie，Task 1 后端已能解析租户。

- [ ] **Step 3: 本地类型/lint 检查**

Run: `cd apps/dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep AcquisitionConfigPage || echo "无类型错误"`
Expected: 无 AcquisitionConfigPage 相关类型错误。

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/AcquisitionConfigPage.tsx
git commit -m "feat(line02): 获客配置页任务列表对齐 keyword 管线(/keyword-tasks)"
```

---

### Task 4: 真库端到端 smoke + CI 接线 + test 注册

**Files:**
- Create: `.github/workflows/scripts/smoke/keyword-collect-mainline-smoke.sh`
- Modify: `.github/workflows/ci.yml`（或既有 smoke glob runner —— 先确认哪种机制）
- Modify: `test-registry.yaml`（注册新 smoke + 新单测）

**Interfaces:**
- Consumes: 运行中的 api（`API_BASE` 默认 `http://localhost:5201`）+ `psql $DATABASE_URL`（默认 `postgresql://postgres:postgres@localhost:5432/zenithjoy_test`）

- [ ] **Step 1: 写 smoke.sh（真库全链）**

```bash
#!/usr/bin/env bash
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5201}"
DB="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}"
TEN="59532559-5b4e-48a4-9a8c-80ab26ee8beb"   # staging 已有测试租户
LIC="ZJ-F-ZW8DM464"                           # 同租户 license

echo "== 1. 带租户建 keyword 任务 =="
RESP=$(curl -sf -X POST "$API_BASE/api/acquisition/keyword-search" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TEN" \
  -d '{"keyword":"麻婆豆腐SMOKE"}')
echo "$RESP"
TASK_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['task_id'])")
[ -n "$TASK_ID" ] || { echo "FAIL: 无 task_id"; exit 1; }

echo "== 2. 任务 tenant_id 非空且正确 =="
TID=$(psql "$DB" -tAc "SELECT tenant_id FROM zenithjoy.acquisition_keyword_tasks WHERE id='$TASK_ID'")
[ "$TID" = "$TEN" ] || { echo "FAIL: tenant_id=$TID != $TEN"; exit 1; }

echo "== 3. 同租户 agent 拉得到 =="
PEND=$(curl -sf "$API_BASE/api/acquisition/pending-keyword-tasks" -H "x-agent-license: $LIC")
echo "$PEND" | grep -q "麻婆豆腐SMOKE" || { echo "FAIL: agent 拉不到任务"; echo "$PEND"; exit 1; }

echo "== 4. 前端列表端点能看到 =="
curl -sf "$API_BASE/api/acquisition/keyword-tasks" -H "X-Tenant-Id: $TEN" | grep -q "麻婆豆腐SMOKE" \
  || { echo "FAIL: /keyword-tasks 看不到"; exit 1; }

echo "== 5. 清理 =="
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_keyword_tasks WHERE keyword='麻婆豆腐SMOKE'" >/dev/null
echo "✅ keyword-collect-mainline smoke ALL PASS"
```

- [ ] **Step 2: 本地跑 smoke（staging api 起着）**

Run: `API_BASE=http://localhost:5201 bash .github/workflows/scripts/smoke/keyword-collect-mainline-smoke.sh`
Expected: `✅ keyword-collect-mainline smoke ALL PASS`（注意 pending-keyword-tasks 会把任务标 processing，故 Step 4 在 Step 3 之后仍能查到——list 不筛 status）。

- [ ] **Step 3: 确认 CI 纳入机制**

Run: `grep -rn "smoke/.*-smoke.sh\|ci-smoke-glob\|smoke glob" .github/workflows/*.yml | head`
若有 glob runner（自动纳入 report-only）→ 无需改 yml；否则在对应 smoke job 显式加一行调用。按 memory `feedback_smoke_must_wire_into_ci` 处理。

- [ ] **Step 4: 注册 test-registry**

`test-registry.yaml` 追加（`product: 客户智能获客`）：keyword-collect-mainline-smoke（path 指 smoke.sh）、line02-keyword-search-tenant（acquisition.test.ts）、line02-keyword-tasks-list（acquisition.test.ts）。照现有条目格式（`path:` 缩进对齐，Orphan Test Check grep `^\s+path:`）。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scripts/smoke/keyword-collect-mainline-smoke.sh test-registry.yaml .github/workflows/*.yml
git commit -m "test(line02): keyword 采集主链真库 smoke + CI 接线 + test 注册"
```

---

## Self-Review

**Spec coverage:** ①keyword-search 挂中间件=Task1 ✅ ②新增 /keyword-tasks=Task2 ✅ ③前端对齐=Task3 ✅ 复现 failing test=Task1 Step1 ✅ 收紧 3 无头用例=Task1 ✅ smoke=Task4 ✅ 护栏 WHERE tenant_id=Task1/2 ✅ 砍两列=Task3 ✅。E2E 真机=用户验收（本 plan 外）。

**Placeholder scan:** 无 TBD；Task3 前端因未逐行读现有 render，给了明确改动指令（读→改 URL+字段+砍列），非 placeholder。

**Type consistency:** `/keyword-tasks` 返回 `{id,keyword,status,created_at}` 前后端一致；`req.tenantId` 用法与 collect-tasks 样板一致。

**新识别风险（已并入 Task1 Step3）:** keyword-search 挂中间件后，`MISSING_KEYWORD`/400 校验落在中间件之后 → 无租户的 400 用例会变 401，需给这些用例补 X-Tenant-Id 头。
