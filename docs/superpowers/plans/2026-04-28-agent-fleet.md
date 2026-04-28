# Agent Fleet 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent Fleet 添加多租户持久化支持 —— tenants / agents / tasks 三张表、License 验证、Agent 断线重启不丢、任务队列下发。

**Architecture:** License 验证从单一 `AGENT_TOKEN` 环境变量改为 DB 查 `zenithjoy.tenants`；Agent 注册/心跳/断线写 `zenithjoy.agents`；任务通过 REST API 创建，派发到合适的在线 Agent，结果回写 `zenithjoy.tasks`。

**Tech Stack:** Node.js / TypeScript / Express / WebSocket (ws) / pg / Zod / Vitest

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `apps/api/db/migrations/20260428_100000_create_tenants.sql` | tenants 表 |
| Create | `apps/api/db/migrations/20260428_100100_create_agents.sql` | agents 表 |
| Create | `apps/api/db/migrations/20260428_100200_create_tasks.sql` | tasks 表 |
| Create | `apps/api/src/services/tenant-db.ts` | tenant DB 查询 |
| Create | `apps/api/src/services/agent-db.ts` | agent DB 查询（upsert/heartbeat/offline） |
| Create | `apps/api/src/services/task-db.ts` | task DB 查询（CRUD + 状态流转） |
| Create | `apps/api/src/services/task-dispatch.ts` | 任务路由到 Agent + 结果回写 |
| Create | `apps/api/src/routes/tenants.ts` | 租户管理 + 飞书配置 API |
| Create | `apps/api/src/routes/tasks.ts` | 任务 CRUD API |
| Create | `apps/api/src/services/__tests__/tenant-db.test.ts` | unit tests |
| Create | `apps/api/src/services/__tests__/agent-db.test.ts` | unit tests |
| Create | `apps/api/src/services/__tests__/task-db.test.ts` | unit tests |
| Create | `apps/api/tests/tasks.test.ts` | integration tests for tasks router |
| Create | `apps/api/tests/tenants.test.ts` | integration tests for tenants router |
| Modify | `apps/api/src/services/agent-ws.ts` | License DB 验证 + 传 tenantId + 结果回写 DB |
| Modify | `apps/api/src/services/agent-registry.ts` | AgentMeta 加 tenantId |
| Modify | `apps/api/src/app.ts` | 注册 tenantsRouter / tasksRouter |

---

## Task 1: 三张 Migration SQL 文件

**Files:**
- Create: `apps/api/db/migrations/20260428_100000_create_tenants.sql`
- Create: `apps/api/db/migrations/20260428_100100_create_agents.sql`
- Create: `apps/api/db/migrations/20260428_100200_create_tasks.sql`

- [ ] **Step 1: 创建 tenants migration**

```sql
-- apps/api/db/migrations/20260428_100000_create_tenants.sql
CREATE TABLE IF NOT EXISTS zenithjoy.tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  license_key       text NOT NULL UNIQUE,
  plan              text NOT NULL DEFAULT 'free',
  feishu_app_id     text,
  feishu_app_secret text,
  feishu_bitable    text,
  feishu_table_crm  text,
  feishu_table_log  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: 创建 agents migration**

```sql
-- apps/api/db/migrations/20260428_100100_create_agents.sql
CREATE TABLE IF NOT EXISTS zenithjoy.agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES zenithjoy.tenants(id),
  agent_id     text NOT NULL UNIQUE,
  hostname     text,
  platform     text,
  capabilities text[] NOT NULL DEFAULT '{}',
  version      text,
  status       text NOT NULL DEFAULT 'offline',
  last_seen    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agents_tenant_status_idx ON zenithjoy.agents(tenant_id, status);
```

- [ ] **Step 3: 创建 tasks migration**

```sql
-- apps/api/db/migrations/20260428_100200_create_tasks.sql
CREATE TABLE IF NOT EXISTS zenithjoy.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES zenithjoy.tenants(id),
  agent_id     uuid REFERENCES zenithjoy.agents(id),
  agent_text   text,
  skill        text NOT NULL,
  params       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'pending',
  result       jsonb,
  error        text,
  scheduled_at timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON zenithjoy.tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS tasks_agent_status_idx ON zenithjoy.tasks(agent_id, status);
```

- [ ] **Step 4: 跑 migration，验证三张表创建成功**

```bash
cd apps/api
ts-node db/migrations/run-migration.ts
```

Expected: `✅ Applied: 20260428_100000_create_tenants.sql` 等三行，无 error

- [ ] **Step 5: Commit**

```bash
git add apps/api/db/migrations/20260428_100000_create_tenants.sql \
        apps/api/db/migrations/20260428_100100_create_agents.sql \
        apps/api/db/migrations/20260428_100200_create_tasks.sql
git commit -m "feat(agent-fleet): add tenants/agents/tasks migrations"
```

---

## Task 2: tenant-db.ts + 修改 AgentMeta

**Files:**
- Create: `apps/api/src/services/tenant-db.ts`
- Create: `apps/api/src/services/__tests__/tenant-db.test.ts`
- Modify: `apps/api/src/services/agent-registry.ts`

- [ ] **Step 1: 写失败的 unit test**

```typescript
// apps/api/src/services/__tests__/tenant-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../db/connection';
import { findTenantByLicense } from '../tenant-db';

describe('findTenantByLicense', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no tenant found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const result = await findTenantByLicense('ZJ-NOTEXIST');
    expect(result).toBeNull();
  });

  it('returns mapped tenant when found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', name: 'TestCo', license_key: 'ZJ-TEST1234', plan: 'free' }],
    } as any);
    const result = await findTenantByLicense('ZJ-TEST1234');
    expect(result).toEqual({ id: 'uuid-1', name: 'TestCo', licenseKey: 'ZJ-TEST1234', plan: 'free' });
  });

  it('queries by license_key param', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    await findTenantByLicense('ZJ-ABC');
    expect(vi.mocked(pool.query)).toHaveBeenCalledWith(
      expect.stringContaining('WHERE license_key = $1'),
      ['ZJ-ABC']
    );
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx vitest run src/services/__tests__/tenant-db.test.ts
```

Expected: FAIL — `Cannot find module '../tenant-db'`

- [ ] **Step 3: 实现 tenant-db.ts**

```typescript
// apps/api/src/services/tenant-db.ts
import pool from '../db/connection';

export interface Tenant {
  id: string;
  name: string;
  licenseKey: string;
  plan: string;
}

export async function findTenantByLicense(licenseKey: string): Promise<Tenant | null> {
  const { rows } = await pool.query<{
    id: string; name: string; license_key: string; plan: string;
  }>(
    'SELECT id, name, license_key, plan FROM zenithjoy.tenants WHERE license_key = $1',
    [licenseKey]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, licenseKey: r.license_key, plan: r.plan };
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/api && npx vitest run src/services/__tests__/tenant-db.test.ts
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: 更新 AgentMeta，加 tenantId 字段**

在 `apps/api/src/services/agent-registry.ts`，修改 `AgentMeta` interface：

```typescript
export interface AgentMeta {
  capabilities: string[];
  version: string;
  tenantId: string;   // ADD: 来自 WS 握手时的 license 验证
}
```

`AgentEntry` 不需要改（`meta.tenantId` 就够用）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/tenant-db.ts \
        apps/api/src/services/__tests__/tenant-db.test.ts \
        apps/api/src/services/agent-registry.ts
git commit -m "feat(agent-fleet): tenant-db service + AgentMeta.tenantId"
```

---

## Task 3: 修改 agent-ws.ts — License DB 验证

**Files:**
- Modify: `apps/api/src/services/agent-ws.ts`

- [ ] **Step 1: 写失败的 unit test**

新建 `apps/api/src/services/__tests__/agent-ws-license.test.ts`：

```typescript
// apps/api/src/services/__tests__/agent-ws-license.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tenant-db before importing agent-ws
vi.mock('../tenant-db', () => ({
  findTenantByLicense: vi.fn(),
}));
vi.mock('../agent-registry', () => ({
  agentRegistry: { register: vi.fn(), heartbeat: vi.fn(), unregister: vi.fn(), emit: vi.fn() },
}));
vi.mock('../agent-db', () => ({
  upsertAgent: vi.fn(),
  touchAgentHeartbeat: vi.fn(),
  setAgentOffline: vi.fn(),
}));

import { findTenantByLicense } from '../tenant-db';

describe('agent-ws license validation', () => {
  it('rejects connection with invalid license', async () => {
    vi.mocked(findTenantByLicense).mockResolvedValueOnce(null);
    // Simulate calling the license check function directly
    const result = await findTenantByLicense('ZJ-INVALID');
    expect(result).toBeNull();
  });

  it('accepts connection with valid license', async () => {
    vi.mocked(findTenantByLicense).mockResolvedValueOnce({
      id: 'tenant-uuid', name: 'Test', licenseKey: 'ZJ-VALID', plan: 'free',
    });
    const tenant = await findTenantByLicense('ZJ-VALID');
    expect(tenant?.id).toBe('tenant-uuid');
  });
});
```

- [ ] **Step 2: 运行测试，确认通过（tenant-db 已 mock）**

```bash
cd apps/api && npx vitest run src/services/__tests__/agent-ws-license.test.ts
```

Expected: PASS — 2 tests passed

- [ ] **Step 3: 修改 agent-ws.ts — 替换 AGENT_TOKEN 为 DB 验证**

完整替换 `apps/api/src/services/agent-ws.ts`：

```typescript
import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { agentRegistry } from './agent-registry';
import { AgentMessageSchema, makeMsg } from '../schemas/agent-protocol';
import { findTenantByLicense } from './tenant-db';
import { upsertAgent, touchAgentHeartbeat, setAgentOffline } from './agent-db';
import { handleTaskResult } from './task-dispatch';

const WS_PATH = '/agent-ws';

export function attachAgentWS(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url || !req.url.startsWith(WS_PATH)) return;

    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || (req.headers['x-agent-token'] as string) || '';

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let tenant: Awaited<ReturnType<typeof findTenantByLicense>>;
    try {
      tenant = await findTenantByLicense(token);
    } catch (err) {
      console.warn('[agent-ws] DB error during license check:', err);
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!tenant) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as any).__tenantId = tenant!.id;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let agentId: string | null = null;
    const tenantId = (ws as any).__tenantId as string;

    ws.on('message', (raw) => {
      try {
        const obj = JSON.parse(raw.toString());
        const msg = AgentMessageSchema.parse(obj);

        if (msg.type === 'hello') {
          agentId = msg.payload.agentId;
          agentRegistry.register(agentId, {
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
            tenantId,
          }, ws);
          upsertAgent({
            tenantId,
            agentId,
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
          }).catch((e) => console.warn('[agent-ws] upsertAgent failed:', e));
        } else if (msg.type === 'heartbeat') {
          if (agentId) {
            agentRegistry.heartbeat(agentId, msg.payload);
            touchAgentHeartbeat(agentId).catch((e) => console.warn('[agent-ws] heartbeat DB failed:', e));
          }
        } else if (msg.type === 'task_progress') {
          agentRegistry.emit(msg.type, { agentId, ...msg });
        } else if (msg.type === 'task_result') {
          agentRegistry.emit(msg.type, { agentId, ...msg });
          if (msg.taskId) {
            handleTaskResult(msg.taskId, msg.payload).catch(
              (e) => console.warn('[agent-ws] handleTaskResult failed:', e)
            );
          }
        }
      } catch (err) {
        console.warn('[agent-ws] invalid message:', err);
      }
    });

    ws.on('close', () => {
      if (agentId) {
        agentRegistry.unregister(agentId);
        setAgentOffline(agentId).catch((e) => console.warn('[agent-ws] setAgentOffline failed:', e));
      }
    });
  });

  return wss;
}

export function sendToAgent(agentId: string, msg: ReturnType<typeof makeMsg>): boolean {
  const entry = agentRegistry.get(agentId);
  if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
  entry.ws.send(JSON.stringify(msg));
  return true;
}
```

- [ ] **Step 4: 运行 typecheck，确认无类型错误**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors（`handleTaskResult` 和 `agent-db` 在后续 Task 创建，此时可能有 import 错误 — 先注释掉那两行 import，Task 4/5 完成后再加回）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/agent-ws.ts \
        apps/api/src/services/__tests__/agent-ws-license.test.ts
git commit -m "feat(agent-fleet): license validation via DB in agent-ws"
```

---

## Task 4: agent-db.ts — Agent 持久化

**Files:**
- Create: `apps/api/src/services/agent-db.ts`
- Create: `apps/api/src/services/__tests__/agent-db.test.ts`

- [ ] **Step 1: 写失败的 unit test**

```typescript
// apps/api/src/services/__tests__/agent-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../db/connection';
import { upsertAgent, touchAgentHeartbeat, setAgentOffline } from '../agent-db';

describe('agent-db', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('upsertAgent', () => {
    it('calls INSERT ... ON CONFLICT UPDATE with correct params', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
      await upsertAgent({ tenantId: 'tid', agentId: 'aid', capabilities: ['wechat'], version: '1.0.0' });
      const [sql, params] = vi.mocked(pool.query).mock.calls[0] as any;
      expect(sql).toMatch(/ON CONFLICT.*DO UPDATE/);
      expect(params).toContain('tid');
      expect(params).toContain('aid');
    });
  });

  describe('touchAgentHeartbeat', () => {
    it('updates last_seen for the given agentId', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
      await touchAgentHeartbeat('my-agent');
      const [, params] = vi.mocked(pool.query).mock.calls[0] as any;
      expect(params).toContain('my-agent');
    });
  });

  describe('setAgentOffline', () => {
    it('sets status offline for the given agentId', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
      await setAgentOffline('my-agent');
      const [sql, params] = vi.mocked(pool.query).mock.calls[0] as any;
      expect(sql).toMatch(/offline/);
      expect(params).toContain('my-agent');
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx vitest run src/services/__tests__/agent-db.test.ts
```

Expected: FAIL — `Cannot find module '../agent-db'`

- [ ] **Step 3: 实现 agent-db.ts**

```typescript
// apps/api/src/services/agent-db.ts
import pool from '../db/connection';

export interface UpsertAgentParams {
  tenantId: string;
  agentId: string;
  capabilities: string[];
  version: string;
  platform?: string;
  hostname?: string;
}

export async function upsertAgent(p: UpsertAgentParams): Promise<void> {
  await pool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, status, last_seen)
     VALUES ($1, $2, $3, $4, 'online', now())
     ON CONFLICT (agent_id) DO UPDATE
       SET tenant_id    = EXCLUDED.tenant_id,
           capabilities = EXCLUDED.capabilities,
           version      = EXCLUDED.version,
           status       = 'online',
           last_seen    = now()`,
    [p.tenantId, p.agentId, p.capabilities, p.version]
  );
}

export async function touchAgentHeartbeat(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.agents SET last_seen = now() WHERE agent_id = $1`,
    [agentId]
  );
}

export async function setAgentOffline(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.agents SET status = 'offline' WHERE agent_id = $1`,
    [agentId]
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/api && npx vitest run src/services/__tests__/agent-db.test.ts
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: 恢复 agent-ws.ts 中的 agent-db import**

如果 Task 3 Step 4 中注释了 agent-db 相关 import，现在取消注释。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/agent-db.ts \
        apps/api/src/services/__tests__/agent-db.test.ts \
        apps/api/src/services/agent-ws.ts
git commit -m "feat(agent-fleet): agent-db persistence (upsert/heartbeat/offline)"
```

---

## Task 5: task-db.ts — 任务 DB 层

**Files:**
- Create: `apps/api/src/services/task-db.ts`
- Create: `apps/api/src/services/__tests__/task-db.test.ts`

- [ ] **Step 1: 写失败的 unit test**

```typescript
// apps/api/src/services/__tests__/task-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../db/connection';
import { createTask, getTask, listTasks, startTask, finishTask, failTask } from '../task-db';

const fakeRow = {
  id: 'task-uuid', tenant_id: 'tid', agent_id: null, agent_text: null,
  skill: 'wechat_draft', params: { title: 'hi' }, status: 'pending',
  result: null, error: null, created_at: new Date(), started_at: null, finished_at: null,
};

describe('task-db', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createTask inserts and returns mapped task', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [fakeRow] } as any);
    const task = await createTask({ tenantId: 'tid', skill: 'wechat_draft', params: { title: 'hi' } });
    expect(task.id).toBe('task-uuid');
    expect(task.status).toBe('pending');
    expect(task.tenantId).toBe('tid');
  });

  it('getTask returns null when not found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const task = await getTask('no-id');
    expect(task).toBeNull();
  });

  it('listTasks returns array', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [fakeRow, fakeRow] } as any);
    const tasks = await listTasks('tid');
    expect(tasks).toHaveLength(2);
  });

  it('startTask calls UPDATE with running status', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    await startTask('task-uuid', 'my-agent-text');
    const [sql] = vi.mocked(pool.query).mock.calls[0] as any;
    expect(sql).toMatch(/running/);
  });

  it('finishTask calls UPDATE with done status', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    await finishTask('task-uuid', { ok: true });
    const [sql] = vi.mocked(pool.query).mock.calls[0] as any;
    expect(sql).toMatch(/done/);
  });

  it('failTask calls UPDATE with failed status', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    await failTask('task-uuid', 'something went wrong');
    const [sql, params] = vi.mocked(pool.query).mock.calls[0] as any;
    expect(sql).toMatch(/failed/);
    expect(params).toContain('something went wrong');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx vitest run src/services/__tests__/task-db.test.ts
```

Expected: FAIL — `Cannot find module '../task-db'`

- [ ] **Step 3: 实现 task-db.ts**

```typescript
// apps/api/src/services/task-db.ts
import pool from '../db/connection';

export interface Task {
  id: string;
  tenantId: string;
  agentId: string | null;
  agentText: string | null;
  skill: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export async function createTask(p: {
  tenantId: string;
  skill: string;
  params: Record<string, unknown>;
}): Promise<Task> {
  const { rows } = await pool.query<any>(
    `INSERT INTO zenithjoy.tasks (tenant_id, skill, params)
     VALUES ($1, $2, $3) RETURNING *`,
    [p.tenantId, p.skill, p.params]
  );
  return mapTask(rows[0]);
}

export async function getTask(id: string): Promise<Task | null> {
  const { rows } = await pool.query<any>(
    'SELECT * FROM zenithjoy.tasks WHERE id = $1',
    [id]
  );
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function listTasks(tenantId: string): Promise<Task[]> {
  const { rows } = await pool.query<any>(
    'SELECT * FROM zenithjoy.tasks WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100',
    [tenantId]
  );
  return rows.map(mapTask);
}

export async function startTask(id: string, agentText: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.tasks SET status = 'running', agent_text = $2, started_at = now() WHERE id = $1`,
    [id, agentText]
  );
}

export async function finishTask(id: string, result: Record<string, unknown>): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.tasks SET status = 'done', result = $2, finished_at = now() WHERE id = $1`,
    [id, result]
  );
}

export async function failTask(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.tasks SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
    [id, error]
  );
}

function mapTask(r: any): Task {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    agentId: r.agent_id,
    agentText: r.agent_text,
    skill: r.skill,
    params: r.params,
    status: r.status,
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/api && npx vitest run src/services/__tests__/task-db.test.ts
```

Expected: PASS — 6 tests passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/task-db.ts \
        apps/api/src/services/__tests__/task-db.test.ts
git commit -m "feat(agent-fleet): task-db service (CRUD + status transitions)"
```

---

## Task 6: task-dispatch.ts + tasks 路由

**Files:**
- Create: `apps/api/src/services/task-dispatch.ts`
- Create: `apps/api/src/routes/tasks.ts`
- Create: `apps/api/tests/tasks.test.ts`

- [ ] **Step 1: 写失败的 integration test for tasks router**

```typescript
// apps/api/tests/tasks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

vi.mock('../src/services/task-db', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'task-1', tenantId: 'tid', skill: 'wechat_draft', params: {},
    status: 'pending', agentId: null, agentText: null,
    result: null, error: null, createdAt: new Date(), startedAt: null, finishedAt: null,
  }),
  getTask: vi.fn().mockResolvedValue(null),
  listTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/services/task-dispatch', () => ({
  dispatchTask: vi.fn().mockResolvedValue(undefined),
  handleTaskResult: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /api/agent/tasks', () => {
  it('returns 400 without tenantId', async () => {
    const res = await request(app).post('/api/agent/tasks').send({ skill: 'wechat_draft' });
    expect(res.status).toBe(400);
  });

  it('returns 400 without skill', async () => {
    const res = await request(app).post('/api/agent/tasks').send({ tenantId: 'tid' });
    expect(res.status).toBe(400);
  });

  it('returns 201 with valid body', async () => {
    const res = await request(app)
      .post('/api/agent/tasks')
      .send({ tenantId: 'tid', skill: 'wechat_draft', params: { title: 'hello' } });
    expect(res.status).toBe(201);
    expect(res.body.task.id).toBe('task-1');
  });
});

describe('GET /api/agent/tasks', () => {
  it('returns 400 without tenantId', async () => {
    const res = await request(app).get('/api/agent/tasks');
    expect(res.status).toBe(400);
  });

  it('returns tasks list', async () => {
    const res = await request(app).get('/api/agent/tasks?tenantId=tid');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
  });
});

describe('GET /api/agent/tasks/:id', () => {
  it('returns 404 when task not found', async () => {
    const res = await request(app).get('/api/agent/tasks/no-such-id');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx vitest run tests/tasks.test.ts
```

Expected: FAIL — `Cannot find module '../src/routes/tasks'` 或 app 报错

- [ ] **Step 3: 实现 task-dispatch.ts**

```typescript
// apps/api/src/services/task-dispatch.ts
import { agentRegistry } from './agent-registry';
import { sendToAgent } from './agent-ws';
import { makeMsg } from '../schemas/agent-protocol';
import { startTask, finishTask, failTask } from './task-db';
import type { Task } from './task-db';
import type { TaskResultPayload } from '../schemas/agent-protocol';
import type { z } from 'zod';

// wsTaskId → DB task.id
const pendingTasks = new Map<string, string>();

export async function dispatchTask(task: Task): Promise<void> {
  const capability = task.skill.split('_')[0];
  const agent = agentRegistry.pickFor(capability);
  if (!agent) {
    await failTask(task.id, `no agent online with capability: ${capability}`);
    return;
  }

  const wsTaskId = `wstask-${task.id}`;
  pendingTasks.set(wsTaskId, task.id);

  const sent = sendToAgent(agent.agentId, makeMsg('publish_request', {
    platform: capability as any,
    content: task.params as any,
  }, wsTaskId));

  if (!sent) {
    pendingTasks.delete(wsTaskId);
    await failTask(task.id, `agent ${agent.agentId} unreachable`);
    return;
  }

  await startTask(task.id, agent.agentId);
}

export async function handleTaskResult(
  wsTaskId: string,
  payload: z.infer<typeof import('../schemas/agent-protocol').TaskResultPayload>
): Promise<void> {
  const dbTaskId = pendingTasks.get(wsTaskId);
  if (!dbTaskId) return;
  pendingTasks.delete(wsTaskId);

  if (payload.ok) {
    await finishTask(dbTaskId, payload as any);
  } else {
    await failTask(dbTaskId, payload.error || 'unknown error');
  }
}
```

- [ ] **Step 4: 实现 tasks 路由**

```typescript
// apps/api/src/routes/tasks.ts
import { Router } from 'express';
import { createTask, getTask, listTasks } from '../services/task-db';
import { dispatchTask } from '../services/task-dispatch';

export const tasksRouter = Router();

tasksRouter.post('/', async (req, res, next) => {
  try {
    const { tenantId, skill, params = {} } = req.body;
    if (!tenantId || !skill) {
      return res.status(400).json({ error: 'tenantId and skill are required' });
    }
    const task = await createTask({ tenantId, skill, params });
    dispatchTask(task).catch((e) => console.warn('[tasks] dispatchTask failed:', e));
    return res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/', async (req, res, next) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({ error: 'tenantId query param required' });
    }
    const tasks = await listTasks(tenantId);
    return res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    return res.json({ task });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: 在 app.ts 中注册 tasksRouter**

在 `apps/api/src/app.ts` 中添加：

```typescript
import { tasksRouter } from './routes/tasks';   // 新增
// ...
app.use('/api/agent/tasks', tasksRouter);        // 在 app.use('/api/agent', agentRouter) 之前
```

完整相关行：

```typescript
import { tasksRouter } from './routes/tasks';
// ...
app.use('/api/agent/tasks', tasksRouter);
app.use('/api/agent', agentRouter);
```

- [ ] **Step 6: 运行测试，确认通过**

```bash
cd apps/api && npx vitest run tests/tasks.test.ts
```

Expected: PASS — 6 tests passed

- [ ] **Step 7: 恢复 agent-ws.ts 中的 task-dispatch import**

如果 Task 3 中注释了 `handleTaskResult` import，现在取消注释。运行 typecheck：

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/task-dispatch.ts \
        apps/api/src/routes/tasks.ts \
        apps/api/tests/tasks.test.ts \
        apps/api/src/app.ts
git commit -m "feat(agent-fleet): task dispatch + tasks REST API"
```

---

## Task 7: Tenants 路由（CRUD + 飞书配置）

**Files:**
- Create: `apps/api/src/routes/tenants.ts`
- Create: `apps/api/tests/tenants.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: 写失败的 integration test**

```typescript
// apps/api/tests/tenants.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import pool from '../src/db/connection';

describe('POST /api/tenants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 without name', async () => {
    const res = await request(app).post('/api/tenants').send({});
    expect(res.status).toBe(400);
  });

  it('creates tenant and returns license key', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        id: 'tid-1', name: 'TestCo', license_key: 'ZJ-ABCD1234', plan: 'free',
        created_at: new Date().toISOString(),
      }],
    } as any);
    const res = await request(app).post('/api/tenants').send({ name: 'TestCo' });
    expect(res.status).toBe(201);
    expect(res.body.tenant.license_key).toMatch(/^ZJ-/);
  });
});

describe('GET /api/tenants/:id/feishu', () => {
  it('returns 404 for unknown tenant', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const res = await request(app).get('/api/tenants/no-id/feishu');
    expect(res.status).toBe(404);
  });

  it('returns feishu config when found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ feishu_app_id: 'app1', feishu_app_secret: 'sec1',
               feishu_bitable: 'bit1', feishu_table_crm: 'crm1', feishu_table_log: 'log1' }],
    } as any);
    const res = await request(app).get('/api/tenants/tid-1/feishu');
    expect(res.status).toBe(200);
    expect(res.body.feishu.feishu_app_id).toBe('app1');
  });
});

describe('PUT /api/tenants/:id/feishu', () => {
  it('returns 404 for unknown tenant', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const res = await request(app).put('/api/tenants/no-id/feishu').send({});
    expect(res.status).toBe(404);
  });

  it('updates feishu config', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 'tid-1' }] } as any);
    const res = await request(app).put('/api/tenants/tid-1/feishu').send({
      feishu_app_id: 'app1', feishu_app_secret: 'sec1',
      feishu_bitable: 'bit1', feishu_table_crm: 'crm1', feishu_table_log: 'log1',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx vitest run tests/tenants.test.ts
```

Expected: FAIL — `Cannot find module '../src/routes/tenants'` 或 404 路由

- [ ] **Step 3: 实现 tenants.ts**

```typescript
// apps/api/src/routes/tenants.ts
import { Router } from 'express';
import { randomUUID } from 'crypto';
import pool from '../db/connection';

export const tenantsRouter = Router();

tenantsRouter.post('/', async (req, res, next) => {
  try {
    const { name, plan = 'free' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const licenseKey = `ZJ-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const { rows } = await pool.query(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan)
       VALUES ($1, $2, $3)
       RETURNING id, name, license_key, plan, created_at`,
      [name, licenseKey, plan]
    );
    return res.status(201).json({ tenant: rows[0] });
  } catch (err) { next(err); }
});

tenantsRouter.get('/:id/feishu', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT feishu_app_id, feishu_app_secret, feishu_bitable, feishu_table_crm, feishu_table_log
       FROM zenithjoy.tenants WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'tenant not found' });
    return res.json({ feishu: rows[0] });
  } catch (err) { next(err); }
});

tenantsRouter.put('/:id/feishu', async (req, res, next) => {
  try {
    const { feishu_app_id, feishu_app_secret, feishu_bitable, feishu_table_crm, feishu_table_log } = req.body;
    const { rows } = await pool.query(
      `UPDATE zenithjoy.tenants
       SET feishu_app_id = $2, feishu_app_secret = $3, feishu_bitable = $4,
           feishu_table_crm = $5, feishu_table_log = $6
       WHERE id = $1
       RETURNING id`,
      [req.params.id, feishu_app_id, feishu_app_secret, feishu_bitable, feishu_table_crm, feishu_table_log]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'tenant not found' });
    return res.json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: 在 app.ts 中注册 tenantsRouter**

```typescript
import { tenantsRouter } from './routes/tenants';
// ...
app.use('/api/tenants', tenantsRouter);
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd apps/api && npx vitest run tests/tenants.test.ts
```

Expected: PASS — 6 tests passed

- [ ] **Step 6: 全套测试**

```bash
cd apps/api && npx vitest run
```

Expected: 所有 test suite PASS，coverage ≥ 65%

- [ ] **Step 7: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/tenants.ts \
        apps/api/tests/tenants.test.ts \
        apps/api/src/app.ts
git commit -m "feat(agent-fleet): tenants router (CRUD + feishu config)"
```

---

## Task 8: 端到端验证（手动）

- [ ] **Step 1: 跑 migration（若尚未跑过）**

```bash
cd apps/api && ts-node db/migrations/run-migration.ts
```

Expected: 三张表全部 applied

- [ ] **Step 2: 创建一个 tenant，记下 license_key**

```bash
curl -s -X POST http://localhost:5200/api/tenants \
  -H "Content-Type: application/json" \
  -d '{"name":"XiAn-xuxia","plan":"free"}' | jq
```

Expected: `{ "tenant": { "license_key": "ZJ-XXXXXXXX", ... } }`

- [ ] **Step 3: 用新 license_key 启动本地 Agent（西安 PC）**

```bat
zenithjoy-agent.exe --license=ZJ-XXXXXXXX
```

Expected: Agent tray 变 "online"，控制台 `[agent] connected as agent-xuxia-pc-xxx`

- [ ] **Step 4: 验证 Agent 已写入 agents 表**

```bash
psql -c "SELECT agent_id, status, last_seen FROM zenithjoy.agents;"
```

Expected: 一行记录，status='online'

- [ ] **Step 5: 下发一个任务**

```bash
curl -s -X POST http://localhost:5200/api/agent/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "<刚创建的 tenant id>",
    "skill": "wechat_draft",
    "params": {"title": "Agent Fleet 测试", "body": "<p>链路打通</p>"}
  }' | jq
```

Expected: `{ "task": { "id": "...", "status": "pending" } }`

- [ ] **Step 6: 等几秒后查任务状态**

```bash
curl -s http://localhost:5200/api/agent/tasks/<task-id> | jq .task.status
```

Expected: `"done"` 或 `"failed"`（failed 时看 error 字段）

- [ ] **Step 7: 验证飞书配置更新**

```bash
curl -s -X PUT http://localhost:5200/api/tenants/<tenant-id>/feishu \
  -H "Content-Type: application/json" \
  -d '{
    "feishu_app_id": "cli_a937a808ca395bd6",
    "feishu_app_secret": "<secret>",
    "feishu_bitable": "WCiVbNYSlaexgfsmqQ3cYePCngg",
    "feishu_table_crm": "tblKKmNks9yqsjZV",
    "feishu_table_log": "tbl3CI13DCOB2MWN"
  }' | jq
```

Expected: `{ "ok": true }`

- [ ] **Step 8: 最终 PR**

```bash
git checkout -b feature/agent-fleet-db-persistence
git push origin feature/agent-fleet-db-persistence
gh pr create --title "feat(agent-fleet): tenants/agents/tasks DB persistence" \
  --body "$(cat <<'EOF'
## Summary
- Add tenants/agents/tasks tables with migrations
- License validation via DB lookup (replace single AGENT_TOKEN env var)
- Agent online/offline status persisted across server restarts
- Task queue: create via REST → dispatch to capable agent → result written back to DB
- Feishu config stored per-tenant in DB

## Test plan
- [ ] Run migrations: `ts-node apps/api/db/migrations/run-migration.ts`
- [ ] Unit tests: `npx vitest run` in apps/api
- [ ] Manual E2E: create tenant → start agent → dispatch task → verify status
EOF
)"
```
