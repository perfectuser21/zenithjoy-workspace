# 设备类型(安卓/Windows) UI 区分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 机器管理页和账号管理页补上设备类型(安卓/Windows)展示——后端字段(`agents.os_type`、`agent_platform_sessions.device_type`)都已存在，只是从未接线到前端。

**Architecture:** 两个独立的后端 SELECT 各加一列 → 两个前端 TS interface 各加一个可选字段 → 两个 React 组件各加一个设备类型徽标。四个改动互相独立，不共享状态，可分别测试。

**Tech Stack:** Express + node-postgres (pool.query)，Vitest + Supertest（后端单测），React + TypeScript（前端，无需新测试框架，现有页面无 Playwright 覆盖故不新增）。

---

### Task 1: 机器管理页后端 — GET /machines 返回 os_type

**Files:**
- Modify: `apps/api/src/routes/agent-machines.ts:38-74`
- Test: `apps/api/tests/routes/agent-machines.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/api/tests/routes/agent-machines.test.ts` 的 `describe('GET /api/agent/machines', ...)` 块内（紧跟在已有的两个 `it(...)` 之后，`describe` 收尾 `});` 之前）新增：

```ts
  it('返回体含 os_type（区分安卓/Windows设备 — decision 8dbe91ee）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [machineRow({ os_type: 'android' })] });

    const res = await request(app).get('/api/agent/machines').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data[0].os_type).toBe('android');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/a\.os_type/);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npx vitest run tests/routes/agent-machines.test.ts -t "os_type"`
Expected: FAIL — `expect(res.body.data[0].os_type).toBe('android')` 收到 `undefined`（`normMachine()` 还没返回这个字段）

- [ ] **Step 3: 最小实现**

在 `apps/api/src/routes/agent-machines.ts` 的 `normMachine()`（第 38-50 行）里加一行：

```ts
function normMachine(row: Record<string, unknown>) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    hostname: row.hostname,
    nickname: row.nickname,
    machine_role: row.machine_role,
    status: row.status,
    version: row.version,
    last_seen: row.last_seen,
    session_count: Number(row.session_count ?? 0),
    os_type: row.os_type ?? null,
  };
}
```

在 GET `/` 的 SQL（第 59-71 行）SELECT 里加 `a.os_type,`：

```ts
  const r = await pool.query(
    `SELECT a.id, a.agent_id, a.hostname, a.nickname, a.machine_role, a.os_type,
            CASE WHEN a.last_seen > NOW() - INTERVAL '3 minutes'
                 THEN 'online' ELSE 'offline' END AS status,
            a.version, a.last_seen,
            COUNT(s.id) AS session_count
       FROM zenithjoy.agents a
       LEFT JOIN zenithjoy.agent_platform_sessions s ON s.agent_id = a.id
      WHERE a.tenant_id = $1
      GROUP BY a.id
      ORDER BY (a.last_seen > NOW() - INTERVAL '3 minutes') DESC, a.hostname ASC`,
    [tenantId],
  );
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run tests/routes/agent-machines.test.ts`
Expected: PASS（全文件所有用例，包括新增的 os_type 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agent-machines.ts apps/api/tests/routes/agent-machines.test.ts
git commit -m "feat(agent-machines): GET /machines 返回 os_type 区分安卓/Windows设备"
```

---

### Task 2: 账号管理页后端 — GET /sessions 返回 device_type

**Files:**
- Modify: `apps/api/src/routes/agent-burner.ts:163-195`
- Test: `apps/api/src/routes/agent-burner.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/routes/agent-burner.test.ts` 的 `describe('GET /sessions — tenant 从 session 解析，不信 query [BEHAVIOR]', ...)` 块内（紧跟在已有的"返回结构带 hostname + nickname"用例之后，`describe` 收尾 `});` 之前）新增：

```ts
  it('返回结构带 device_type（区分Web小号/安卓设备账号 — decision 8dbe91ee）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        account_label: 'live101942', role: 'burner', status: 'active',
        bound_at: null, created_at: null, account_nickname: null,
        hostname: 'ROG-PC', nickname: '西安ROG', device_type: 'android',
      }],
    } as any);
    const app = buildApp();
    const res = await request(app)
      .get('/api/agent/burner/sessions')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.body?.data?.sessions?.[0]?.device_type).toBe('android');
    const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.device_type/);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts -t "device_type"`
Expected: FAIL — SQL 断言 `sql).toMatch(/s\.device_type/)` 失败（当前 SELECT 还没有这一列）

- [ ] **Step 3: 最小实现**

在 `apps/api/src/routes/agent-burner.ts` 的 GET `/sessions`（第 163-195 行）SQL 里加 `s.device_type,`：

```ts
router.get('/sessions', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT s.account_label, s.role, s.status, s.bound_at, s.device_type,
              s.created_at, s.agent_id,
              a.hostname AS agent_hostname,
              a.nickname AS agent_nickname,
              a.status AS agent_status,
              (SELECT response->>'account_nickname'
                 FROM zenithjoy.publish_tasks
                WHERE agent_id=s.agent_id
                  AND task_type='qr_bind/douyin_burner'
                  AND payload->>'account_label' = s.account_label
                ORDER BY created_at DESC LIMIT 1) AS account_nickname
         FROM zenithjoy.agent_platform_sessions s
         LEFT JOIN zenithjoy.agents a ON a.id = s.agent_id
        WHERE s.agent_id IN (
              SELECT id FROM zenithjoy.agents WHERE tenant_id=$1
            )
          AND s.role='burner'
          AND s.platform='douyin'
        ORDER BY s.created_at DESC`,
      [tenantId],
    );
    return res.json(OK({ sessions: r.rows }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[burner/sessions] query failed:', msg);
    return res.status(500).json(ERR('SESSIONS_QUERY_FAILED', msg));
  }
});
```

（只改了 SELECT 列清单，其余逻辑不动）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts`
Expected: PASS（全文件所有用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agent-burner.ts apps/api/src/routes/agent-burner.test.ts
git commit -m "feat(agent-burner): GET /sessions 返回 device_type 区分Web小号/安卓设备账号"
```

---

### Task 3: 前端类型 — Machine/BurnerSession 加字段

**Files:**
- Modify: `apps/dashboard/src/api/machines.api.ts:32-64`

- [ ] **Step 1: 加字段（无独立单测，随 Task 4/5 组件测试间接覆盖；本项目该文件历来无 .test.ts）**

```ts
/** 一台机器（列表 / 详情共用） */
export interface Machine {
  id: string;
  agent_id: string;
  hostname: string;
  nickname: string | null;
  machine_role: 'main' | 'sub';
  status: 'online' | 'offline';
  version: string;
  last_seen: string;
  session_count: number;
  os_type: string | null;
}
```

```ts
/** 一个租户下的 burner（小号）session，含它绑定的机器信息（采集任务派单要用） */
export interface BurnerSession {
  account_label: string;
  role: string;
  status: string;
  bound_at: string | null;
  created_at: string | null;
  account_nickname: string | null;
  hostname: string | null;
  nickname: string | null;
  device_type: 'web' | 'android' | null;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: 无新增报错（新增字段是可选属性风格但类型本身非 optional；由于当前接口无任何字面量对象直接实现这两个 interface 手工赋值——都来自 fetch JSON 断言——不会触发 "missing property" 编译错误）

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/api/machines.api.ts
git commit -m "feat(dashboard): Machine/BurnerSession 类型加 os_type/device_type 字段"
```

---

### Task 4: 机器管理页 UI — 加设备类型徽标

**Files:**
- Modify: `apps/dashboard/src/pages/MachineManagementPage.tsx:42-115`

- [ ] **Step 1: 加 OsBadge 组件**

在 `RoleBadge` 组件定义（第 42-53 行）之后新增：

```tsx
function OsBadge({ osType }: { osType: Machine['os_type'] }) {
  const label = osType === 'android' ? '📱 安卓' : osType === 'win32' ? '🖥️ Windows' : '💻 其他';
  return <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>;
}
```

- [ ] **Step 2: 在"机器"列渲染里加徽标**

第 97-100 行改为：

```tsx
              <td className="border border-gray-200 px-4 py-3">
                <div className="font-medium">{m.nickname || m.hostname}</div>
                <div className="text-xs text-gray-400">{m.hostname}</div>
                <OsBadge osType={m.os_type} />
              </td>
```

- [ ] **Step 3: 类型检查**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/MachineManagementPage.tsx
git commit -m "feat(dashboard): 机器管理页机器列表加设备类型徽标(安卓/Windows)"
```

---

### Task 5: 账号管理页 UI — 加设备类型徽标

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx:12-22, 185-200`

- [ ] **Step 1: interface 补字段**

第 12-22 行改为：

```ts
interface BurnerSession {
  account_label: string;
  role: string;
  status: string;
  account_nickname?: string;
  bound_at?: string;
  agent_id?: string | null;
  agent_hostname?: string | null;
  agent_nickname?: string | null;
  agent_status?: string | null;
  device_type?: 'web' | 'android' | null;
}
```

- [ ] **Step 2: "绑定机器"列渲染里加徽标**

第 197-198 行（`data-testid="machine-hostname-cell"` 那个 `<td>`）改为：

```tsx
                    <td className="py-2 text-gray-700 dark:text-gray-300" data-testid="machine-hostname-cell">
                      {s.agent_hostname ?? '—'}
                      <span className="ml-1 text-xs text-gray-400">
                        {s.device_type === 'android' ? '📱' : s.device_type === 'web' ? '🖥️' : ''}
                      </span>
                    </td>
```

- [ ] **Step 3: 类型检查**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/AcquisitionAccountsPage.tsx
git commit -m "feat(dashboard): 账号管理页绑定机器列加设备类型徽标(安卓/Web)"
```

---

### Task 6: 全量校验 + 收尾

**Files:** 无新文件

- [ ] **Step 1: 后端全量测试**

Run: `cd apps/api && npx vitest run`
Expected: PASS（无既有测试因新增列被破坏——新增列不影响任何既有断言的字段清单，除非某处测试对返回体做严格 `toEqual` 全字段匹配；若有，需要把该测试的 expected 对象补上新字段）

- [ ] **Step 2: 前端全量类型检查 + lint**

Run: `cd apps/dashboard && npx tsc --noEmit && npx eslint src/pages/MachineManagementPage.tsx src/pages/AcquisitionAccountsPage.tsx src/api/machines.api.ts`
Expected: 0 error

- [ ] **Step 3: 确认 smoke 门槛**

本次改动是纯展示字段透传，不改变任何 Golden Path 步骤的通过/失败判据（不修改 `golden-path-2-smoke.sh`）。PR 描述里需声明：「本 PR 保持 Path2 smoke 全绿，推进 Step 6/7 展示层完整度（decision 8dbe91ee）」。

- [ ] **Step 4: 最终 commit（如有遗漏文件）**

```bash
git status --short
# 若有遗漏，补 add + commit；若干净，跳过
```
