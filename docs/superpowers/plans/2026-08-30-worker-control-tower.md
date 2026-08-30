# 工作机控制塔可视化·第一刀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中台新增 worker 活动协议（开始任务/上报步骤+截图/推帧/完成/租约），Dashboard 新增 `/dashboard/workers` 总览页与 `/dashboard/workers/:agentId` 实时详情页，让主理人在任何地方看到每台 worker 在干什么。

**Architecture:** 新表 `worker_tasks`/`worker_task_steps` 与现有 `publish_tasks` 完全隔离；执行器面路由走 `internalAuth`，读面路由走 `tenantContextOptional` 并按 `tenant_id` 过滤（跨租户 404）；画面帧存进程内环形缓冲，`GET live` 输出 MJPEG；60s sweeper 把租约过期任务标 `failed/executor_lost`。前端只依赖这套 HTTP 协议。

**Tech Stack:** Express + pg（apps/api，TypeScript，vitest+supertest）；React + Vite（apps/dashboard，vitest + Playwright）；SQL migration（`zenithjoy.` schema）。

**Spec:** `docs/superpowers/specs/2026-08-30-worker-control-tower-design.md`。TDD 铁律：**NO PRODUCTION CODE WITHOUT FAILING TEST FIRST**；每个 task 两次 commit（commit-1 失败测试 / commit-2 实现）。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `apps/api/db/migrations/20260830_120000_worker_tasks.sql` | 两张表 + partial unique index |
| `apps/api/src/services/agent-machines-normalize.ts` | 从 agent-machines.ts 抽出的 `normMachine` + `ONLINE_WINDOW_SQL`（可复用） |
| `apps/api/src/services/worker-live.ts` | 帧环形缓冲（内存），`pushFrame/latestFrame/subscribe` |
| `apps/api/src/services/worker-tasks-service.ts` | DB 读写：开始/上报步骤/完成/查询/sweeper |
| `apps/api/src/services/worker-shots.ts` | 截图落盘 + ref 生成/解析（防路径穿越） |
| `apps/api/src/routes/workers-executor.ts` | 执行器面 4 端点（internalAuth） |
| `apps/api/src/routes/workers-read.ts` | 读面 4 端点（租户） |
| `apps/api/src/routes/__tests__/workers-executor.test.ts` / `workers-read.test.ts` | 路由契约单测（mock service） |
| `apps/api/src/services/__tests__/worker-live.test.ts` | 帧缓冲单测 |
| `apps/api/src/services/__tests__/worker-tasks-service.test.ts` | 三件套校验/租约/sweeper 纯函数单测（mock pool） |
| `apps/api/src/app.ts` | 注册两个 router + sweeper 启动 |
| `apps/dashboard/src/api/workers.api.ts` | 前端客户端 + 类型 |
| `apps/dashboard/src/pages/WorkersPage.tsx` | 总览卡片页 |
| `apps/dashboard/src/pages/WorkerLivePage.tsx` | 详情页（画面+步骤+历史） |
| `apps/dashboard/src/pages/__tests__/WorkersPage.test.tsx` / `WorkerLivePage.test.tsx` | 组件测试 |
| `apps/dashboard/src/config/navigation.config.ts` | 注册页面与菜单 |
| `apps/dashboard/e2e/workers.spec.ts` | Playwright E2E（page.route stub） |
| `.github/workflows/scripts/smoke/worker-activity-smoke.sh` | 协议全链 smoke（curl） |

---

### Task 1: Migration — worker_tasks / worker_task_steps

**Files:**
- Create: `apps/api/db/migrations/20260830_120000_worker_tasks.sql`
- Test: `apps/api/src/services/__tests__/worker-tasks-migration.test.ts`

- [ ] **Step 1: Write the failing test**（校验 migration 文件存在且含关键 DDL——CI 会重放全部 migration，这里只做静态契约）

```ts
// apps/api/src/services/__tests__/worker-tasks-migration.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIG = path.resolve(__dirname, '../../../db/migrations/20260830_120000_worker_tasks.sql');

describe('worker_tasks migration', () => {
  const sql = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : '';
  it('文件存在', () => { expect(fs.existsSync(MIG)).toBe(true); });
  it('建 worker_tasks 与 worker_task_steps（幂等）', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zenithjoy\.worker_tasks/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zenithjoy\.worker_task_steps/);
  });
  it('同 worker 同时仅一条 running 的 partial unique index', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tasks_running_per_agent[\s\S]*WHERE status = 'running'/);
  });
  it('状态枚举含 needs_review 与 executor 三件套字段', () => {
    expect(sql).toMatch(/'running',\s*'completed',\s*'failed',\s*'needs_review'/);
    expect(sql).toMatch(/foreground_pkg TEXT/);
    expect(sql).toMatch(/diag_line TEXT/);
    expect(sql).toMatch(/screenshot_ref TEXT/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=apps/api run test -- src/services/__tests__/worker-tasks-migration.test.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 3: Write the migration**

```sql
-- apps/api/db/migrations/20260830_120000_worker_tasks.sql
-- 工作机控制塔可视化·第一刀（决策 e14297d4）：worker 活动协议正表。
-- 与 publish_tasks 完全隔离（安卓 Agent 心跳只拉 publish_tasks，不会误领这里的任务）。
-- 失败信息写正表列（failed_step / error_code），不藏 JSONB——四次盲修的教训。
-- 全部 DDL 幂等：CI 重放全部 migration。

BEGIN;

CREATE TABLE IF NOT EXISTS zenithjoy.worker_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  agent_id      UUID NOT NULL REFERENCES zenithjoy.agents(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  executor_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'completed', 'failed', 'needs_review')),
  steps_total   INTEGER NOT NULL DEFAULT 0,
  current_step  INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  failed_step   INTEGER,
  error_code    TEXT,
  lease_until   TIMESTAMPTZ NOT NULL,
  evidence      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tasks_running_per_agent
  ON zenithjoy.worker_tasks (agent_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_worker_tasks_tenant_agent_started
  ON zenithjoy.worker_tasks (tenant_id, agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_tasks_running_lease
  ON zenithjoy.worker_tasks (lease_until) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS zenithjoy.worker_task_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES zenithjoy.worker_tasks(id) ON DELETE CASCADE,
  step_index     INTEGER NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'doing', 'done', 'failed')),
  screenshot_ref TEXT,
  foreground_pkg TEXT,
  diag_line      TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, step_index)
);

COMMIT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace=apps/api run test -- src/services/__tests__/worker-tasks-migration.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**（两次：先测试后实现，保持 lint-tdd-commit-order）

```bash
git add apps/api/src/services/__tests__/worker-tasks-migration.test.ts
git commit -m "test(workers): worker_tasks migration 契约测试（red）"
git add apps/api/db/migrations/20260830_120000_worker_tasks.sql
git commit -m "feat(workers): worker_tasks/worker_task_steps 表 + running 唯一索引"
```

---

### Task 2: 抽出 normMachine 到 service（可复用，行为不变）

**Files:**
- Create: `apps/api/src/services/agent-machines-normalize.ts`
- Modify: `apps/api/src/routes/agent-machines.ts:44-80`（删除本地 `normMachine`，改 import）
- Test: `apps/api/src/services/__tests__/agent-machines-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/__tests__/agent-machines-normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normMachine, ONLINE_WINDOW_SQL } from '../agent-machines-normalize';

describe('normMachine', () => {
  it('last_seen 在 3 分钟内 → online，offline_minutes=null', () => {
    const m = normMachine({ id: 'a', last_seen: new Date(Date.now() - 60_000).toISOString() });
    expect(m.status).toBe('online');
    expect(m.offline_minutes).toBeNull();
  });
  it('last_seen 超 3 分钟 → offline，offline_minutes 取整', () => {
    const m = normMachine({ id: 'a', last_seen: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect(m.status).toBe('offline');
    expect(m.offline_minutes).toBe(10);
  });
  it('row.status 为字符串时直接采用；session_count 转 number；owner_type 缺省 customer', () => {
    const m = normMachine({ id: 'a', status: 'online', session_count: '3' });
    expect(m.status).toBe('online');
    expect(m.session_count).toBe(3);
    expect(m.owner_type).toBe('customer');
  });
  it('导出在线判据 SQL 片段', () => {
    expect(ONLINE_WINDOW_SQL).toContain("INTERVAL '3 minutes'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=apps/api run test -- src/services/__tests__/agent-machines-normalize.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Create service and rewire route**

```ts
// apps/api/src/services/agent-machines-normalize.ts
/** 机器行规范化（从 routes/agent-machines.ts 抽出，供 workers 读面复用；行为不变） */
export const VALID_OWNER_TYPES = ['internal_fleet', 'customer'] as const;
export type OwnerType = typeof VALID_OWNER_TYPES[number];
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;
/** SQL 侧同口径：a.last_seen > NOW() - INTERVAL '3 minutes' */
export const ONLINE_WINDOW_SQL = "a.last_seen > NOW() - INTERVAL '3 minutes'";

export interface NormalizedMachine {
  id: unknown; agent_id: unknown; hostname: unknown; nickname: unknown; machine_role: unknown;
  os_type: unknown; owner_type: OwnerType; status: string; version: unknown; last_seen: unknown;
  session_count: number; offline_minutes: number | null;
}

export function normMachine(row: Record<string, unknown>): NormalizedMachine {
  const status =
    typeof row.status === 'string'
      ? row.status
      : row.last_seen && Date.now() - new Date(row.last_seen as string).getTime() <= ONLINE_WINDOW_MS
        ? 'online'
        : 'offline';
  let offlineMinutes: number | null = null;
  if (status !== 'online' && row.last_seen) {
    offlineMinutes = Math.floor((Date.now() - new Date(row.last_seen as string).getTime()) / 60000);
  }
  return {
    id: row.id, agent_id: row.agent_id, hostname: row.hostname, nickname: row.nickname,
    machine_role: row.machine_role, os_type: row.os_type ?? null,
    owner_type: (row.owner_type as OwnerType) ?? 'customer', status,
    version: row.version, last_seen: row.last_seen,
    session_count: Number(row.session_count ?? 0), offline_minutes: offlineMinutes,
  };
}
```

在 `apps/api/src/routes/agent-machines.ts`：删除第 44-80 行的 `VALID_OWNER_TYPES`/`OwnerType`/`normMachine` 定义，顶部加：
```ts
import { normMachine, VALID_OWNER_TYPES, type OwnerType } from '../services/agent-machines-normalize';
```
（其余用法不变。）

- [ ] **Step 4: Run tests（新测试 + 既有 agent-machines 测试）**

Run: `npm --workspace=apps/api run test -- agent-machines`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/__tests__/agent-machines-normalize.test.ts
git commit -m "test(workers): normMachine 抽 service 契约测试（red）"
git add apps/api/src/services/agent-machines-normalize.ts apps/api/src/routes/agent-machines.ts
git commit -m "refactor(agent-machines): normMachine 抽到 services/agent-machines-normalize 供 workers 复用"
```

---

### Task 3: 帧缓冲服务 worker-live

**Files:**
- Create: `apps/api/src/services/worker-live.ts`
- Test: `apps/api/src/services/__tests__/worker-live.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/__tests__/worker-live.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WorkerLiveBuffer } from '../worker-live';

describe('WorkerLiveBuffer', () => {
  it('pushFrame 后 latest 返回该帧与递增 seq', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 3 });
    b.pushFrame('agent-1', Buffer.from('a'));
    b.pushFrame('agent-1', Buffer.from('b'));
    const f = b.latest('agent-1');
    expect(f?.seq).toBe(2);
    expect(f?.bytes.toString()).toBe('b');
  });
  it('环形：超过 maxFrames 丢最旧', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 2 });
    for (const s of ['1', '2', '3']) b.pushFrame('a', Buffer.from(s));
    expect(b.frames('a').map((f) => f.bytes.toString())).toEqual(['2', '3']);
  });
  it('订阅者收到新帧；取消后不再收到', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 2 });
    const cb = vi.fn();
    const off = b.subscribe('a', cb);
    b.pushFrame('a', Buffer.from('x'));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    b.pushFrame('a', Buffer.from('y'));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('未知 agent latest 为 null', () => {
    expect(new WorkerLiveBuffer().latest('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=apps/api run test -- src/services/__tests__/worker-live.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/worker-live.ts
/** worker 实时画面帧缓冲（进程内，环形 ≤ maxFrames；不落盘） */
export interface LiveFrame { seq: number; at: number; bytes: Buffer; }
type Listener = (frame: LiveFrame) => void;

export class WorkerLiveBuffer {
  private readonly maxFrames: number;
  private readonly byAgent = new Map<string, LiveFrame[]>();
  private readonly seqs = new Map<string, number>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(opts: { maxFrames?: number } = {}) { this.maxFrames = opts.maxFrames ?? 10; }

  pushFrame(agentId: string, bytes: Buffer): LiveFrame {
    const seq = (this.seqs.get(agentId) ?? 0) + 1;
    this.seqs.set(agentId, seq);
    const frame: LiveFrame = { seq, at: Date.now(), bytes };
    const arr = this.byAgent.get(agentId) ?? [];
    arr.push(frame);
    while (arr.length > this.maxFrames) arr.shift();
    this.byAgent.set(agentId, arr);
    for (const l of this.listeners.get(agentId) ?? []) l(frame);
    return frame;
  }
  frames(agentId: string): LiveFrame[] { return [...(this.byAgent.get(agentId) ?? [])]; }
  latest(agentId: string): LiveFrame | null { const a = this.byAgent.get(agentId); return a?.length ? a[a.length - 1] : null; }
  subscribe(agentId: string, l: Listener): () => void {
    const set = this.listeners.get(agentId) ?? new Set<Listener>();
    set.add(l); this.listeners.set(agentId, set);
    return () => { set.delete(l); };
  }
}

export const workerLive = new WorkerLiveBuffer();
```

- [ ] **Step 4: Run test** — Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/__tests__/worker-live.test.ts
git commit -m "test(workers): 帧环形缓冲单测（red）"
git add apps/api/src/services/worker-live.ts
git commit -m "feat(workers): WorkerLiveBuffer 帧环形缓冲 + 订阅"
```

---

### Task 4: 截图落盘 worker-shots + 任务 service（含三件套校验与 sweeper）

**Files:**
- Create: `apps/api/src/services/worker-shots.ts`, `apps/api/src/services/worker-tasks-service.ts`
- Test: `apps/api/src/services/__tests__/worker-tasks-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/__tests__/worker-tasks-service.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../worker-shots', () => ({
  saveShot: vi.fn(async () => 'tenant-a/task-1/3.jpg'),
  shotPath: vi.fn((ref: string) => `/tmp/shots/${ref}`),
}));

import pool from '../../db/connection';
import {
  validateStepReport, sweepExpiredLeases, LEASE_MS, startTask, WorkerTaskError,
} from '../worker-tasks-service';

beforeEach(() => vi.clearAllMocks());

describe('validateStepReport', () => {
  it('failed 缺三件套任一 → FAILURE_SCENE_REQUIRED', () => {
    expect(() => validateStepReport({ step_index: 1, status: 'failed', executor_id: 'x' }))
      .toThrow(/FAILURE_SCENE_REQUIRED/);
    expect(() => validateStepReport({ step_index: 1, status: 'failed', executor_id: 'x', foreground_pkg: 'p', diag_line: 'd' }))
      .toThrow(/FAILURE_SCENE_REQUIRED/);
  });
  it('failed 三件套齐 → 通过', () => {
    expect(() => validateStepReport({ step_index: 1, status: 'failed', executor_id: 'x', foreground_pkg: 'p', diag_line: 'd', screenshot_jpeg_b64: 'AAAA' })).not.toThrow();
  });
  it('status 非法 / step_index 非整数 / 缺 executor_id → INVALID_STEP', () => {
    expect(() => validateStepReport({ step_index: 1, status: 'weird' as any, executor_id: 'x' })).toThrow(/INVALID_STEP/);
    expect(() => validateStepReport({ step_index: 1.5, status: 'done', executor_id: 'x' })).toThrow(/INVALID_STEP/);
    expect(() => validateStepReport({ step_index: 1, status: 'done' } as any)).toThrow(/INVALID_STEP/);
  });
  it('截图 base64 超 200KB → SCREENSHOT_TOO_LARGE', () => {
    const big = 'A'.repeat(200 * 1024 * 4 / 3 + 100);
    expect(() => validateStepReport({ step_index: 1, status: 'done', executor_id: 'x', screenshot_jpeg_b64: big })).toThrow(/SCREENSHOT_TOO_LARGE/);
  });
});

describe('sweepExpiredLeases', () => {
  it('把租约过期的 running 任务标 failed/executor_lost，返回条数', async () => {
    (pool.query as any).mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 't1' }, { id: 't2' }] });
    const n = await sweepExpiredLeases();
    expect(n).toBe(2);
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/status = 'failed'/);
    expect(sql).toMatch(/error_code = 'executor_lost'/);
    expect(sql).toMatch(/lease_until < NOW\(\)/);
  });
});

describe('startTask', () => {
  it('同 agent 已有 running（唯一索引 23505）→ WORKER_BUSY', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    (pool.connect as any).mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid', tenant_id: 'tenant-a' }] }) // agent lookup
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(startTask({ agentId: 'agent-uuid', title: 't', steps: ['a'], executorId: 'ex' }))
      .rejects.toBeInstanceOf(WorkerTaskError);
    await expect(startTask({ agentId: 'agent-uuid', title: 't', steps: ['a'], executorId: 'ex' }))
      .rejects.toMatchObject({ code: 'WORKER_BUSY' });
  });
  it('LEASE_MS 为 10 分钟', () => { expect(LEASE_MS).toBe(10 * 60 * 1000); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace=apps/api run test -- src/services/__tests__/worker-tasks-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement worker-shots + worker-tasks-service**

```ts
// apps/api/src/services/worker-shots.ts
import fs from 'node:fs/promises';
import path from 'node:path';

/** 截图根目录：与 SCREENSHOTS_DIR 同源，子目录 worker-shots */
export const SHOTS_ROOT = path.join(process.env.SCREENSHOTS_DIR || '/opt/zenithjoy/screenshots', 'worker-shots');
const SAFE_SEG = /^[A-Za-z0-9_-]+$/;

/** 写入截图，返回 ref（`<tenant>/<task>/<step>.jpg`），ref 各段只允许安全字符 */
export async function saveShot(tenantId: string, taskId: string, stepIndex: number, jpegBase64: string): Promise<string> {
  const dir = path.join(SHOTS_ROOT, tenantId, taskId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${stepIndex}.jpg`);
  await fs.writeFile(file, Buffer.from(jpegBase64, 'base64'));
  return `${tenantId}/${taskId}/${stepIndex}.jpg`;
}

/** ref → 绝对路径；非法 ref 返回 null（防路径穿越） */
export function shotPath(ref: string): string | null {
  const parts = ref.split('/');
  if (parts.length !== 3) return null;
  const [t, k, f] = parts;
  if (!SAFE_SEG.test(t) || !SAFE_SEG.test(k) || !/^\d+\.jpg$/.test(f)) return null;
  return path.join(SHOTS_ROOT, t, k, f);
}
```

```ts
// apps/api/src/services/worker-tasks-service.ts
import pool from '../db/connection';
import { saveShot } from './worker-shots';

export const LEASE_MS = 10 * 60 * 1000;
const MAX_SHOT_B64 = Math.ceil(200 * 1024 * 4 / 3);
export type StepStatus = 'doing' | 'done' | 'failed';
export type Outcome = 'completed' | 'failed' | 'needs_review';

export class WorkerTaskError extends Error {
  constructor(public code: string, message: string, public httpStatus: number) { super(message); }
}

export interface StepReport {
  step_index: number; status: StepStatus; executor_id: string;
  screenshot_jpeg_b64?: string; foreground_pkg?: string; diag_line?: string; note?: string;
}

export function validateStepReport(r: StepReport): void {
  if (!r || !Number.isInteger(r.step_index) || r.step_index < 0
      || !['doing', 'done', 'failed'].includes(r.status)
      || typeof r.executor_id !== 'string' || !r.executor_id) {
    throw new WorkerTaskError('INVALID_STEP', 'step_index 须为非负整数，status ∈ doing|done|failed，executor_id 必填', 400);
  }
  if (r.screenshot_jpeg_b64 && r.screenshot_jpeg_b64.length > MAX_SHOT_B64) {
    throw new WorkerTaskError('SCREENSHOT_TOO_LARGE', '截图 ≤200KB', 400);
  }
  if (r.status === 'failed' && !(r.foreground_pkg && r.diag_line && r.screenshot_jpeg_b64)) {
    throw new WorkerTaskError('FAILURE_SCENE_REQUIRED', '失败上报必须带现场三件套：foreground_pkg + diag_line + screenshot_jpeg_b64', 400);
  }
}

export async function startTask(input: { agentId: string; title: string; steps: string[]; executorId: string }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agent = await client.query(`SELECT id, tenant_id FROM zenithjoy.agents WHERE id = $1`, [input.agentId]);
    if (agent.rows.length === 0) throw new WorkerTaskError('AGENT_NOT_FOUND', 'worker 不存在', 404);
    const tenantId = agent.rows[0].tenant_id as string;
    let task;
    try {
      task = await client.query(
        `INSERT INTO zenithjoy.worker_tasks (tenant_id, agent_id, title, executor_id, steps_total, lease_until)
         VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' milliseconds')::interval)
         RETURNING id, lease_until`,
        [tenantId, input.agentId, input.title, input.executorId, input.steps.length, String(LEASE_MS)],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new WorkerTaskError('WORKER_BUSY', '该 worker 已有执行中的任务', 409);
      throw e;
    }
    const taskId = task.rows[0].id as string;
    for (let i = 0; i < input.steps.length; i++) {
      await client.query(
        `INSERT INTO zenithjoy.worker_task_steps (task_id, step_index, title) VALUES ($1, $2, $3)`,
        [taskId, i, input.steps[i]],
      );
    }
    await client.query('COMMIT');
    return { task_id: taskId, lease_until: task.rows[0].lease_until as string };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally { client.release(); }
}

async function loadRunning(taskId: string, executorId: string) {
  const r = await pool.query(`SELECT id, tenant_id, status, executor_id FROM zenithjoy.worker_tasks WHERE id = $1`, [taskId]);
  if (r.rows.length === 0) throw new WorkerTaskError('TASK_NOT_FOUND', '任务不存在', 404);
  const t = r.rows[0];
  if (t.status !== 'running') throw new WorkerTaskError('TASK_NOT_RUNNING', '任务已结束，执行器必须停手', 409);
  if (t.executor_id !== executorId) throw new WorkerTaskError('EXECUTOR_MISMATCH', '租约不属于该执行器', 409);
  return t as { id: string; tenant_id: string };
}

export async function reportStep(taskId: string, r: StepReport) {
  validateStepReport(r);
  const t = await loadRunning(taskId, r.executor_id);
  const ref = r.screenshot_jpeg_b64 ? await saveShot(t.tenant_id, taskId, r.step_index, r.screenshot_jpeg_b64) : null;
  await pool.query(
    `UPDATE zenithjoy.worker_task_steps SET status = $3, screenshot_ref = COALESCE($4, screenshot_ref),
        foreground_pkg = $5, diag_line = $6, note = $7, updated_at = NOW()
      WHERE task_id = $1 AND step_index = $2`,
    [taskId, r.step_index, r.status, ref, r.foreground_pkg ?? null, r.diag_line ?? null, r.note ?? null],
  );
  await pool.query(
    `UPDATE zenithjoy.worker_tasks SET current_step = GREATEST(current_step, $2),
        lease_until = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW()
      WHERE id = $1`,
    [taskId, r.step_index + 1, String(LEASE_MS)],
  );
  return { ok: true, screenshot_ref: ref };
}

export async function completeTask(taskId: string, body: {
  outcome: Outcome; executor_id: string; evidence?: Record<string, unknown>; error_code?: string; failed_step?: number;
}) {
  if (!['completed', 'failed', 'needs_review'].includes(body.outcome) || !body.executor_id) {
    throw new WorkerTaskError('INVALID_OUTCOME', 'outcome ∈ completed|failed|needs_review，executor_id 必填', 400);
  }
  if (body.outcome === 'failed' && (!body.error_code || !Number.isInteger(body.failed_step))) {
    throw new WorkerTaskError('FAILURE_DETAIL_REQUIRED', 'failed 必带 error_code + failed_step', 400);
  }
  const t = await loadRunning(taskId, body.executor_id);
  let evidence = body.evidence ?? null;
  if (evidence && typeof evidence.screenshot_jpeg_b64 === 'string') {
    const ref = await saveShot(t.tenant_id, taskId, 9999, evidence.screenshot_jpeg_b64 as string);
    evidence = { ...evidence, screenshot_ref: ref, screenshot_jpeg_b64: undefined };
  }
  await pool.query(
    `UPDATE zenithjoy.worker_tasks SET status = $2, finished_at = NOW(), error_code = $3, failed_step = $4,
        evidence = $5, updated_at = NOW() WHERE id = $1`,
    [taskId, body.outcome, body.error_code ?? null, body.failed_step ?? null, evidence ? JSON.stringify(evidence) : null],
  );
  return { ok: true };
}

export async function sweepExpiredLeases(): Promise<number> {
  const r = await pool.query(
    `UPDATE zenithjoy.worker_tasks SET status = 'failed', error_code = 'executor_lost', finished_at = NOW(), updated_at = NOW()
      WHERE status = 'running' AND lease_until < NOW() RETURNING id`,
  );
  return r.rowCount ?? 0;
}

/** 读面：本租户 worker 列表 + 运行中任务摘要 + 今日完成数 */
export async function listWorkers(tenantId: string) {
  const r = await pool.query(
    `SELECT a.id, a.agent_id, a.hostname, a.nickname, a.machine_role, a.os_type, a.owner_type, a.version, a.last_seen,
            CASE WHEN a.last_seen > NOW() - INTERVAL '3 minutes' THEN 'online' ELSE 'offline' END AS status,
            rt.id AS running_task_id, rt.title AS running_title, rt.current_step, rt.steps_total,
            (SELECT COUNT(*) FROM zenithjoy.worker_tasks d WHERE d.agent_id = a.id AND d.status = 'completed'
               AND d.finished_at >= date_trunc('day', NOW())) AS completed_today
       FROM zenithjoy.agents a
       LEFT JOIN zenithjoy.worker_tasks rt ON rt.agent_id = a.id AND rt.status = 'running'
      WHERE a.tenant_id = $1
      ORDER BY (a.last_seen > NOW() - INTERVAL '3 minutes') DESC, a.hostname ASC`,
    [tenantId],
  );
  return r.rows;
}

/** 读面：某 worker 当前任务 + 步骤 + 历史 20 条；跨租户返回 null */
export async function getActivity(tenantId: string, agentId: string) {
  const a = await pool.query(`SELECT id FROM zenithjoy.agents WHERE id = $1 AND tenant_id = $2`, [agentId, tenantId]);
  if (a.rows.length === 0) return null;
  const cur = await pool.query(
    `SELECT id, title, executor_id, status, steps_total, current_step, started_at, lease_until
       FROM zenithjoy.worker_tasks WHERE agent_id = $1 AND status = 'running' LIMIT 1`, [agentId]);
  const current = cur.rows[0] ?? null;
  const steps = current
    ? (await pool.query(`SELECT step_index, title, status, screenshot_ref, foreground_pkg, diag_line, note, updated_at
                           FROM zenithjoy.worker_task_steps WHERE task_id = $1 ORDER BY step_index`, [current.id])).rows
    : [];
  const history = (await pool.query(
    `SELECT id, title, status, steps_total, started_at, finished_at, failed_step, error_code, evidence
       FROM zenithjoy.worker_tasks WHERE agent_id = $1 AND status <> 'running'
      ORDER BY started_at DESC LIMIT 20`, [agentId])).rows;
  return { current, steps, history };
}

export async function agentBelongsToTenant(tenantId: string, agentId: string): Promise<boolean> {
  const a = await pool.query(`SELECT 1 FROM zenithjoy.agents WHERE id = $1 AND tenant_id = $2`, [agentId, tenantId]);
  return a.rows.length > 0;
}
```

- [ ] **Step 4: Run test** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/__tests__/worker-tasks-service.test.ts
git commit -m "test(workers): 三件套校验/租约sweeper/WORKER_BUSY 单测（red）"
git add apps/api/src/services/worker-shots.ts apps/api/src/services/worker-tasks-service.ts
git commit -m "feat(workers): worker 任务 service（开始/上报/完成/sweeper/读面）+ 截图落盘"
```

---

### Task 5: 执行器面路由 workers-executor

**Files:**
- Create: `apps/api/src/routes/workers-executor.ts`
- Test: `apps/api/src/routes/__tests__/workers-executor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/__tests__/workers-executor.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/worker-tasks-service', async () => {
  const actual = await vi.importActual<any>('../../services/worker-tasks-service');
  return {
    ...actual,
    startTask: vi.fn(), reportStep: vi.fn(), completeTask: vi.fn(),
  };
});
vi.mock('../../services/worker-live', () => {
  const pushFrame = vi.fn(() => ({ seq: 1, at: Date.now(), bytes: Buffer.alloc(0) }));
  return { workerLive: { pushFrame } };
});

import { startTask, reportStep, completeTask, WorkerTaskError } from '../../services/worker-tasks-service';
import { workerLive } from '../../services/worker-live';
import { workersExecutorRouter } from '../workers-executor';

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/workers', workersExecutorRouter);
  return app;
}
const app = makeApp();
beforeEach(() => { vi.clearAllMocks(); delete process.env.ZENITHJOY_INTERNAL_TOKEN; });

describe('POST /api/workers/:agentId/tasks', () => {
  it('缺 title/steps/executor_id → 400', async () => {
    const r = await request(app).post('/api/workers/a1/tasks').send({ title: 'x' });
    expect(r.status).toBe(400);
    expect(startTask).not.toHaveBeenCalled();
  });
  it('成功 → 201 + task_id', async () => {
    (startTask as any).mockResolvedValue({ task_id: 't1', lease_until: '2026-01-01T00:00:00Z' });
    const r = await request(app).post('/api/workers/a1/tasks').send({ title: '发布', steps: ['a', 'b'], executor_id: 'ex' });
    expect(r.status).toBe(201);
    expect(r.body.data.task_id).toBe('t1');
  });
  it('WORKER_BUSY → 409', async () => {
    (startTask as any).mockRejectedValue(new WorkerTaskError('WORKER_BUSY', 'busy', 409));
    const r = await request(app).post('/api/workers/a1/tasks').send({ title: '发布', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('WORKER_BUSY');
  });
  it('设置 ZENITHJOY_INTERNAL_TOKEN 后无 token → 401', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    const r = await request(app).post('/api/workers/a1/tasks').send({ title: '发布', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(401);
  });
});

describe('POST /api/workers/tasks/:id/steps', () => {
  it('failed 缺三件套 → 400 FAILURE_SCENE_REQUIRED', async () => {
    (reportStep as any).mockRejectedValue(new WorkerTaskError('FAILURE_SCENE_REQUIRED', 'x', 400));
    const r = await request(app).post('/api/workers/tasks/t1/steps').send({ step_index: 2, status: 'failed', executor_id: 'ex' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('FAILURE_SCENE_REQUIRED');
  });
  it('任务已结束 → 409', async () => {
    (reportStep as any).mockRejectedValue(new WorkerTaskError('TASK_NOT_RUNNING', 'x', 409));
    const r = await request(app).post('/api/workers/tasks/t1/steps').send({ step_index: 0, status: 'done', executor_id: 'ex' });
    expect(r.status).toBe(409);
  });
  it('成功 → 200', async () => {
    (reportStep as any).mockResolvedValue({ ok: true, screenshot_ref: null });
    const r = await request(app).post('/api/workers/tasks/t1/steps').send({ step_index: 0, status: 'done', executor_id: 'ex' });
    expect(r.status).toBe(200);
  });
});

describe('POST /api/workers/tasks/:id/complete', () => {
  it('成功 → 200', async () => {
    (completeTask as any).mockResolvedValue({ ok: true });
    const r = await request(app).post('/api/workers/tasks/t1/complete').send({ outcome: 'completed', executor_id: 'ex' });
    expect(r.status).toBe(200);
  });
});

describe('POST /api/workers/:agentId/frame', () => {
  it('image/jpeg 原始字节 → 202 seq', async () => {
    const r = await request(app).post('/api/workers/a1/frame').set('Content-Type', 'image/jpeg').send(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.status).toBe(202);
    expect(workerLive.pushFrame).toHaveBeenCalledWith('a1', expect.any(Buffer));
  });
  it('非 jpeg → 415', async () => {
    const r = await request(app).post('/api/workers/a1/frame').set('Content-Type', 'text/plain').send('x');
    expect(r.status).toBe(415);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm --workspace=apps/api run test -- workers-executor` → FAIL

- [ ] **Step 3: Implement**

```ts
// apps/api/src/routes/workers-executor.ts
/**
 * worker 活动协议 · 执行器面（internalAuth）
 *   POST /api/workers/:agentId/tasks          开始任务
 *   POST /api/workers/tasks/:id/steps          上报步骤（failed 必带三件套）
 *   POST /api/workers/tasks/:id/complete       完成
 *   POST /api/workers/:agentId/frame           推画面帧（image/jpeg ≤120KB）
 * 设计：docs/superpowers/specs/2026-08-30-worker-control-tower-design.md
 */
import express, { Router, Request, Response } from 'express';
import { internalAuth } from '../middleware/internal-auth';
import { startTask, reportStep, completeTask, WorkerTaskError } from '../services/worker-tasks-service';
import { workerLive } from '../services/worker-live';

const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown, status = 200) => ({ status, body: { success: true, data } });

function sendErr(res: Response, e: unknown, where: string) {
  if (e instanceof WorkerTaskError) return res.status(e.httpStatus).json(ERR(e.code, e.message));
  console.error(`[workers-executor] ${where} error:`, e);
  return res.status(500).json(ERR('DB_ERROR', '内部错误'));
}

export const workersExecutorRouter = Router();
workersExecutorRouter.use(internalAuth);

workersExecutorRouter.post('/:agentId/tasks', async (req: Request, res: Response) => {
  const { title, steps, executor_id } = req.body ?? {};
  if (typeof title !== 'string' || !title || !Array.isArray(steps) || steps.length === 0
      || !steps.every((s) => typeof s === 'string') || typeof executor_id !== 'string' || !executor_id) {
    return res.status(400).json(ERR('INVALID_TASK', 'title、steps[string]、executor_id 必填'));
  }
  try {
    const r = await startTask({ agentId: req.params.agentId, title, steps, executorId: executor_id });
    const { status, body } = OK(r, 201);
    return res.status(status).json(body);
  } catch (e) { return sendErr(res, e, 'tasks'); }
});

workersExecutorRouter.post('/tasks/:id/steps', async (req: Request, res: Response) => {
  try {
    const r = await reportStep(req.params.id, req.body ?? {});
    return res.json(OK(r).body);
  } catch (e) { return sendErr(res, e, 'steps'); }
});

workersExecutorRouter.post('/tasks/:id/complete', async (req: Request, res: Response) => {
  try {
    const r = await completeTask(req.params.id, req.body ?? {});
    return res.json(OK(r).body);
  } catch (e) { return sendErr(res, e, 'complete'); }
});

workersExecutorRouter.post('/:agentId/frame',
  express.raw({ type: 'image/jpeg', limit: '120kb' }),
  (req: Request, res: Response) => {
    if (!req.is('image/jpeg') || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(415).json(ERR('UNSUPPORTED_MEDIA', '需要 image/jpeg 原始字节'));
    }
    const f = workerLive.pushFrame(req.params.agentId, req.body);
    return res.status(202).json({ success: true, data: { seq: f.seq } });
  });

export default workersExecutorRouter;
```

- [ ] **Step 4: Run test** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/__tests__/workers-executor.test.ts
git commit -m "test(workers): 执行器面路由契约（red）"
git add apps/api/src/routes/workers-executor.ts
git commit -m "feat(workers): 执行器面路由 tasks/steps/complete/frame（internalAuth）"
```

---

### Task 6: 读面路由 workers-read（列表 / activity / live / 截图，租户隔离）

**Files:**
- Create: `apps/api/src/routes/workers-read.ts`
- Test: `apps/api/src/routes/__tests__/workers-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/__tests__/workers-read.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/worker-tasks-service', () => ({
  listWorkers: vi.fn(), getActivity: vi.fn(), agentBelongsToTenant: vi.fn(),
}));
vi.mock('../../services/worker-live', () => {
  const listeners: any[] = [];
  return {
    workerLive: {
      latest: vi.fn(() => ({ seq: 1, at: Date.now(), bytes: Buffer.from('JPEG1') })),
      subscribe: vi.fn((_: string, l: any) => { listeners.push(l); return () => {}; }),
      __emit: (b: Buffer) => listeners.forEach((l) => l({ seq: 2, at: Date.now(), bytes: b })),
    },
  };
});
vi.mock('../../services/worker-shots', () => ({ shotPath: vi.fn((ref: string) => ref === 't/a/1.jpg' ? '/tmp/x.jpg' : null) }));
vi.mock('../../middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: any) => { req.tenantId = req.headers['x-tenant-id'] || ''; next(); },
}));

import { listWorkers, getActivity, agentBelongsToTenant } from '../../services/worker-tasks-service';
import { workersReadRouter } from '../workers-read';

function makeApp() { const app = express(); app.use('/api/workers', workersReadRouter); return app; }
const app = makeApp();
beforeEach(() => vi.clearAllMocks());

describe('GET /api/workers', () => {
  it('缺租户 → 401', async () => {
    const r = await request(app).get('/api/workers');
    expect(r.status).toBe(401);
  });
  it('返回卡片数据（os_type/status/running 摘要/completed_today）', async () => {
    (listWorkers as any).mockResolvedValue([{
      id: 'a1', agent_id: 'ag', hostname: 'MAA-AN00', nickname: null, machine_role: 'main', os_type: 'android',
      owner_type: 'customer', version: '2.1', last_seen: new Date().toISOString(), status: 'online',
      running_task_id: 't1', running_title: '发布', current_step: 3, steps_total: 10, completed_today: '2',
    }]);
    const r = await request(app).get('/api/workers').set('X-Tenant-Id', 'tenant-a');
    expect(r.status).toBe(200);
    const w = r.body.data[0];
    expect(w.os_type).toBe('android');
    expect(w.status).toBe('online');
    expect(w.running).toEqual({ task_id: 't1', title: '发布', current_step: 3, steps_total: 10 });
    expect(w.completed_today).toBe(2);
  });
});

describe('GET /api/workers/:agentId/activity', () => {
  it('跨租户/不存在 → 404', async () => {
    (getActivity as any).mockResolvedValue(null);
    const r = await request(app).get('/api/workers/a9/activity').set('X-Tenant-Id', 'tenant-b');
    expect(r.status).toBe(404);
  });
  it('screenshot_ref 转成可访问 URL', async () => {
    (getActivity as any).mockResolvedValue({
      current: { id: 't1', title: '发布', status: 'running', steps_total: 2, current_step: 1, started_at: 'x', lease_until: 'y', executor_id: 'ex' },
      steps: [{ step_index: 0, title: '打开抖音', status: 'done', screenshot_ref: 't/a/1.jpg' }],
      history: [],
    });
    const r = await request(app).get('/api/workers/a1/activity').set('X-Tenant-Id', 'tenant-a');
    expect(r.status).toBe(200);
    expect(r.body.data.steps[0].screenshot_url).toBe('/api/workers/shots/t/a/1.jpg');
  });
});

describe('GET /api/workers/:agentId/live', () => {
  it('跨租户 → 404', async () => {
    (agentBelongsToTenant as any).mockResolvedValue(false);
    const r = await request(app).get('/api/workers/a1/live').set('X-Tenant-Id', 'tenant-b');
    expect(r.status).toBe(404);
  });
  it('multipart/x-mixed-replace 且首帧立即输出', async () => {
    (agentBelongsToTenant as any).mockResolvedValue(true);
    const r = await request(app).get('/api/workers/a1/live').set('X-Tenant-Id', 'tenant-a')
      .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c: Buffer) => { d += c.toString('latin1'); if (d.includes('JPEG1')) { res.destroy(); cb(null, d); } }); });
    expect(r.headers['content-type']).toMatch(/multipart\/x-mixed-replace; boundary=frame/);
    expect(r.body).toContain('Content-Type: image/jpeg');
    expect(r.body).toContain('JPEG1');
  });
});

describe('GET /api/workers/shots/:ref', () => {
  it('非法 ref → 400', async () => {
    const r = await request(app).get('/api/workers/shots/..%2F..%2Fetc%2Fpasswd').set('X-Tenant-Id', 'tenant-a');
    expect([400, 404]).toContain(r.status);
  });
  it('ref 租户前缀不匹配 → 404', async () => {
    const r = await request(app).get('/api/workers/shots/t/a/1.jpg').set('X-Tenant-Id', 'other');
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm --workspace=apps/api run test -- workers-read` → FAIL

- [ ] **Step 3: Implement**

```ts
// apps/api/src/routes/workers-read.ts
/**
 * worker 活动协议 · 读面（登录/租户，跨租户一律 404）
 *   GET /api/workers                        本租户 worker 卡片
 *   GET /api/workers/:agentId/activity      当前任务+步骤+历史 20 条
 *   GET /api/workers/:agentId/live          MJPEG（multipart/x-mixed-replace）
 *   GET /api/workers/shots/:tenant/:task/:file  截图
 */
import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import { tenantContextOptional } from '../middleware/tenant-context';
import { listWorkers, getActivity, agentBelongsToTenant } from '../services/worker-tasks-service';
import { workerLive, type LiveFrame } from '../services/worker-live';
import { shotPath } from '../services/worker-shots';

const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown) => ({ success: true, data });

export const workersReadRouter = Router();
workersReadRouter.use(tenantContextOptional);

function requireTenant(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) { res.status(401).json(ERR('NO_TENANT', '缺租户上下文')); return null; }
  return t;
}

workersReadRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  try {
    const rows = await listWorkers(tenantId);
    return res.json(OK(rows.map((r: Record<string, unknown>) => ({
      id: r.id, agent_id: r.agent_id, hostname: r.hostname, nickname: r.nickname, machine_role: r.machine_role,
      os_type: r.os_type ?? null, owner_type: r.owner_type ?? 'customer', version: r.version, last_seen: r.last_seen,
      status: r.status,
      running: r.running_task_id
        ? { task_id: r.running_task_id, title: r.running_title, current_step: Number(r.current_step ?? 0), steps_total: Number(r.steps_total ?? 0) }
        : null,
      completed_today: Number(r.completed_today ?? 0),
    }))));
  } catch (e) { console.error('[workers-read] list error:', e); return res.status(500).json(ERR('DB_ERROR', '查询失败')); }
});

workersReadRouter.get('/shots/:tenant/:task/:file', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const ref = `${req.params.tenant}/${req.params.task}/${req.params.file}`;
  const p = shotPath(ref);
  if (!p) return res.status(400).json(ERR('BAD_REF', '截图引用非法'));
  if (req.params.tenant !== tenantId || !fs.existsSync(p)) return res.status(404).json(ERR('NOT_FOUND', '截图不存在'));
  res.type('image/jpeg');
  return fs.createReadStream(p).pipe(res);
});

workersReadRouter.get('/:agentId/activity', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  try {
    const a = await getActivity(tenantId, req.params.agentId);
    if (!a) return res.status(404).json(ERR('NOT_FOUND', 'worker 不存在'));
    const withUrl = (s: Record<string, unknown>) => ({ ...s, screenshot_url: s.screenshot_ref ? `/api/workers/shots/${s.screenshot_ref}` : null });
    return res.json(OK({ current: a.current, steps: a.steps.map(withUrl), history: a.history }));
  } catch (e) { console.error('[workers-read] activity error:', e); return res.status(500).json(ERR('DB_ERROR', '查询失败')); }
});

workersReadRouter.get('/:agentId/live', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const agentId = req.params.agentId;
  if (!(await agentBelongsToTenant(tenantId, agentId))) return res.status(404).json(ERR('NOT_FOUND', 'worker 不存在'));
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', Pragma: 'no-cache',
  });
  const write = (f: LiveFrame) => {
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.bytes.length}\r\n\r\n`);
    res.write(f.bytes); res.write('\r\n');
  };
  const first = workerLive.latest(agentId);
  if (first) write(first);
  const off = workerLive.subscribe(agentId, write);
  req.on('close', () => { off(); });
});

export default workersReadRouter;
```

- [ ] **Step 4: Run test** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/__tests__/workers-read.test.ts
git commit -m "test(workers): 读面路由契约（租户隔离/MJPEG/截图）（red）"
git add apps/api/src/routes/workers-read.ts
git commit -m "feat(workers): 读面路由 列表/activity/live/shots（跨租户 404）"
```

---

### Task 7: 挂载路由 + sweeper 启动

**Files:**
- Modify: `apps/api/src/app.ts`（import 区 + `app.use('/api/agent/machines', ...)` 之后）
- Test: `apps/api/src/__tests__/app-workers-mount.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/__tests__/app-workers-mount.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('app.ts 挂载 workers 路由与 sweeper', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../app.ts'), 'utf8');
  it('注册执行器面与读面路由（执行器面在前，避免 /tasks 被 :agentId 吞）', () => {
    const exec = src.indexOf("app.use('/api/workers', workersExecutorRouter)");
    const read = src.indexOf("app.use('/api/workers', workersReadRouter)");
    expect(exec).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(exec);
  });
  it('启动租约 sweeper（60s，非 test 环境）', () => {
    expect(src).toMatch(/startWorkerLeaseSweeper\(/);
  });
});
```

- [ ] **Step 2: Run** — `npm --workspace=apps/api run test -- app-workers-mount` → FAIL

- [ ] **Step 3: Implement**

在 `apps/api/src/app.ts` import 区（`import agentMachinesRouter` 附近）加：
```ts
import workersExecutorRouter from './routes/workers-executor';
import workersReadRouter from './routes/workers-read';
import { sweepExpiredLeases } from './services/worker-tasks-service';
```
在 `app.use('/api/agent/machines', agentMachinesRouter);` 之后加：
```ts
// 工作机控制塔（决策 e14297d4）：执行器面先注册（internalAuth，路径 /tasks/:id/* 与 /:agentId/*），
// 读面后注册；执行器面对不匹配的 GET 会 next() 落到读面。
app.use('/api/workers', workersExecutorRouter);
app.use('/api/workers', workersReadRouter);

export function startWorkerLeaseSweeper(intervalMs = 60_000): NodeJS.Timeout {
  const t = setInterval(() => {
    sweepExpiredLeases().then((n) => { if (n > 0) console.log(`[workers] sweeper: ${n} 个任务租约过期 → executor_lost`); })
      .catch((e) => console.error('[workers] sweeper error:', e));
  }, intervalMs);
  t.unref();
  return t;
}
if (process.env.NODE_ENV !== 'test') startWorkerLeaseSweeper();
```
注意：执行器面路由里 `/:agentId/tasks` 只匹配 POST；GET `/:agentId/activity` 会自然落到读面。

- [ ] **Step 4: Run** — `npm --workspace=apps/api run test -- app-workers-mount` → PASS；再跑 `npm --workspace=apps/api run typecheck`（或 `tsc --noEmit`）→ 无错

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/__tests__/app-workers-mount.test.ts
git commit -m "test(workers): app 挂载顺序与 sweeper 启动契约（red）"
git add apps/api/src/app.ts
git commit -m "feat(workers): 挂载 /api/workers 执行器面+读面，启动租约 sweeper"
```

---

### Task 8: Dashboard API 客户端 + 总览页 WorkersPage

**Files:**
- Create: `apps/dashboard/src/api/workers.api.ts`, `apps/dashboard/src/pages/WorkersPage.tsx`
- Modify: `apps/dashboard/src/config/navigation.config.ts`（`autopilotPageComponents` + `additionalRoutes` + 菜单项）
- Test: `apps/dashboard/src/pages/__tests__/WorkersPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/src/pages/__tests__/WorkersPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/workers.api', () => ({
  fetchWorkers: vi.fn(),
}));
import { fetchWorkers } from '../../api/workers.api';
import WorkersPage from '../WorkersPage';

beforeEach(() => vi.clearAllMocks());

const workers = [
  { id: 'a1', agent_id: 'ag1', hostname: 'MAA-AN00', nickname: '小龙虾', os_type: 'android', status: 'online',
    running: { task_id: 't1', title: '发布视频到抖音', current_step: 6, steps_total: 10 }, completed_today: 2, last_seen: 'x' },
  { id: 'w1', agent_id: 'ag2', hostname: 'XX-ROG', nickname: null, os_type: 'win32', status: 'offline',
    running: null, completed_today: 0, last_seen: 'x' },
];

describe('WorkersPage', () => {
  it('渲染 worker 卡片：类型徽章、在线态、正在执行第 x/y 步、今日完成、实时链接', async () => {
    (fetchWorkers as any).mockResolvedValue(workers);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('小龙虾')).toBeInTheDocument());
    expect(screen.getByText(/安卓/)).toBeInTheDocument();
    expect(screen.getByText(/Windows/)).toBeInTheDocument();
    expect(screen.getByText(/正在执行：发布视频到抖音/)).toBeInTheDocument();
    expect(screen.getByText(/第 6\/10 步/)).toBeInTheDocument();
    expect(screen.getByText('空闲')).toBeInTheDocument();
    expect(screen.getByText(/今日完成 2/)).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /实时/ });
    expect(links[0]).toHaveAttribute('href', '/dashboard/workers/a1');
  });
  it('无 worker → 空态引导', async () => {
    (fetchWorkers as any).mockResolvedValue([]);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/还没有工作机/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run** — `npm --workspace=apps/dashboard run test -- WorkersPage` → FAIL

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/api/workers.api.ts
/** 工作机控制塔 API 客户端（决策 e14297d4）。契约见 docs/superpowers/specs/2026-08-30-worker-control-tower-design.md */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface WorkerRunning { task_id: string; title: string; current_step: number; steps_total: number; }
export interface Worker {
  id: string; agent_id: string; hostname: string; nickname: string | null;
  os_type: 'android' | 'win32' | string | null; status: 'online' | 'offline';
  running: WorkerRunning | null; completed_today: number; last_seen: string | null;
}
export interface WorkerStep {
  step_index: number; title: string; status: 'pending' | 'doing' | 'done' | 'failed';
  screenshot_url: string | null; foreground_pkg?: string | null; diag_line?: string | null; note?: string | null; updated_at?: string;
}
export interface WorkerTaskSummary {
  id: string; title: string; status: 'running' | 'completed' | 'failed' | 'needs_review';
  steps_total: number; started_at: string; finished_at: string | null; failed_step: number | null; error_code: string | null;
}
export interface WorkerActivity { current: (WorkerTaskSummary & { current_step: number }) | null; steps: WorkerStep[]; history: WorkerTaskSummary[]; }

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.data as T;
}
export const fetchWorkers = () => getJson<Worker[]>(`${API_BASE}/workers`);
export const fetchWorkerActivity = (agentId: string) => getJson<WorkerActivity>(`${API_BASE}/workers/${encodeURIComponent(agentId)}/activity`);
export const workerLiveUrl = (agentId: string) => `${API_BASE}/workers/${encodeURIComponent(agentId)}/live`;
```

```tsx
// apps/dashboard/src/pages/WorkersPage.tsx
/** 工作机控制塔 · 总览（/dashboard/workers）：每台 worker 一张卡片，5s 轮询 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchWorkers, type Worker } from '../api/workers.api';

const POLL_MS = 5000;

function osBadge(os: Worker['os_type']) {
  if (os === 'android') return '📱 安卓';
  if (os === 'win32') return '🖥️ Windows';
  return `💻 ${os ?? '未知'}`;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetchWorkers().then((w) => { if (alive) { setWorkers(w); setError(null); } })
      .catch((e) => { if (alive) setError(String(e)); });
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (error && !workers) return <div className="p-6 text-red-600">加载失败：{error}</div>;
  if (!workers) return <div className="p-6 text-gray-500">加载中…</div>;
  if (workers.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">工作机</h1>
        <p className="text-gray-600">还没有工作机。安装 Agent 并用你的 license 注册后，它会出现在这里。</p>
      </div>
    );
  }
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">工作机</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workers.map((w) => (
          <div key={w.id} className="rounded-xl border p-4 shadow-sm bg-white">
            <div className="flex items-center justify-between">
              <div className="font-medium">{w.nickname || w.hostname}</div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${w.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {w.status === 'online' ? '● 在线' : '○ 离线'}
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1">{osBadge(w.os_type)} · {w.hostname}</div>
            <div className="mt-3 text-sm">
              {w.running ? (
                <div className="text-amber-700">
                  正在执行：{w.running.title}
                  <span className="ml-2 text-xs">第 {w.running.current_step}/{w.running.steps_total} 步</span>
                </div>
              ) : <div className="text-gray-600">空闲</div>}
            </div>
            <div className="mt-2 text-xs text-gray-500">今日完成 {w.completed_today}</div>
            <div className="mt-3">
              <Link to={`/dashboard/workers/${w.id}`} className="text-sm text-blue-600 hover:underline">实时画面 →</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

在 `apps/dashboard/src/config/navigation.config.ts`：
1. `autopilotPageComponents` 加两行：
```ts
  'WorkersPage': () => import('../pages/WorkersPage'),
  'WorkerLivePage': () => import('../pages/WorkerLivePage'),
```
2. `additionalRoutes` 加（放在 `/dashboard/machines` 那行旁）：
```ts
  { path: '/dashboard/workers', component: 'WorkersPage', requireAuth: true },
  { path: '/dashboard/workers/:agentId', component: 'WorkerLivePage', requireAuth: true },
```
3. 菜单：在含 `'/dashboard/machines'` 的 nav 组（若无则第一组 items 末尾）加：
```ts
  { path: '/dashboard/workers', icon: Monitor, label: '工作机', featureKey: 'workers', component: 'WorkersPage' },
```
（`Monitor` 从 `lucide-react` 导入，文件顶部已有其它 lucide 图标 import，追加即可。）

- [ ] **Step 4: Run** — `npm --workspace=apps/dashboard run test -- WorkersPage` → PASS（WorkerLivePage 在 Task 9 才建；本步骤 navigation 的懒加载引用在测试中不会执行，但 `tsc`/vite 会要求文件存在——先建占位：`apps/dashboard/src/pages/WorkerLivePage.tsx` 内容 `export default function WorkerLivePage() { return null; }`，Task 9 覆盖）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/__tests__/WorkersPage.test.tsx
git commit -m "test(dashboard): 工作机总览卡片页组件测试（red）"
git add apps/dashboard/src/api/workers.api.ts apps/dashboard/src/pages/WorkersPage.tsx apps/dashboard/src/pages/WorkerLivePage.tsx apps/dashboard/src/config/navigation.config.ts
git commit -m "feat(dashboard): 工作机控制塔总览页 /dashboard/workers + 菜单"
```

---

### Task 9: 详情页 WorkerLivePage（画面 + 步骤流 + 历史）

**Files:**
- Modify: `apps/dashboard/src/pages/WorkerLivePage.tsx`
- Test: `apps/dashboard/src/pages/__tests__/WorkerLivePage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/src/pages/__tests__/WorkerLivePage.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../api/workers.api', () => ({
  fetchWorkerActivity: vi.fn(),
  workerLiveUrl: (id: string) => `/api/workers/${id}/live`,
}));
import { fetchWorkerActivity } from '../../api/workers.api';
import WorkerLivePage from '../WorkerLivePage';

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/workers/${id}`]}>
      <Routes><Route path="/dashboard/workers/:agentId" element={<WorkerLivePage />} /></Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => vi.useRealTimers());

describe('WorkerLivePage', () => {
  it('步骤列表按状态渲染 ✅/▶️/⬜，缩略图链接，画面 img 指向 live', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({
      current: { id: 't1', title: '发布视频到抖音', status: 'running', steps_total: 3, current_step: 2, started_at: 'x', finished_at: null, failed_step: null, error_code: null },
      steps: [
        { step_index: 0, title: '打开抖音', status: 'done', screenshot_url: '/api/workers/shots/t/t1/0.jpg' },
        { step_index: 1, title: '选视频', status: 'doing', screenshot_url: null },
        { step_index: 2, title: '发作品', status: 'pending', screenshot_url: null },
      ],
      history: [{ id: 'h1', title: '昨天的任务', status: 'failed', steps_total: 5, started_at: 'x', finished_at: 'y', failed_step: 3, error_code: 'adb_unreachable' }],
    });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('发布视频到抖音')).toBeInTheDocument());
    expect(screen.getByText('打开抖音').closest('li')).toHaveTextContent('✅');
    expect(screen.getByText('选视频').closest('li')).toHaveTextContent('▶️');
    expect(screen.getByText('发作品').closest('li')).toHaveTextContent('⬜');
    expect(screen.getByRole('img', { name: /实时画面/ })).toHaveAttribute('src', '/api/workers/a1/live');
    expect(screen.getByText(/adb_unreachable/)).toBeInTheDocument();
  });
  it('15 秒无新帧显示"画面不可用"', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({ current: null, steps: [], history: [] });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('空闲')).toBeInTheDocument());
    await act(async () => { vi.advanceTimersByTime(16_000); });
    expect(screen.getByText('画面不可用')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** — `npm --workspace=apps/dashboard run test -- WorkerLivePage` → FAIL

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/pages/WorkerLivePage.tsx
/** 工作机控制塔 · 实时详情（/dashboard/workers/:agentId）：左画面（MJPEG）右步骤流，底部历史 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchWorkerActivity, workerLiveUrl, type WorkerActivity, type WorkerStep } from '../api/workers.api';

const POLL_MS = 1000;
const FRAME_STALE_MS = 15_000;

function icon(s: WorkerStep['status']) { return s === 'done' ? '✅' : s === 'doing' ? '▶️' : s === 'failed' ? '❌' : '⬜'; }
function statusLabel(s: string) {
  return ({ running: '执行中', completed: '已完成', failed: '失败', needs_review: '待人工核实' } as Record<string, string>)[s] ?? s;
}

export default function WorkerLivePage() {
  const { agentId = '' } = useParams();
  const [activity, setActivity] = useState<WorkerActivity | null>(null);
  const [frameStale, setFrameStale] = useState(false);
  const lastFrameAt = useRef<number>(Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => fetchWorkerActivity(agentId).then((a) => { if (alive) setActivity(a); }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [agentId]);

  // MJPEG <img> 每到一帧会触发 load；15s 无 load 视为画面不可用
  useEffect(() => {
    const t = setInterval(() => setFrameStale(Date.now() - lastFrameAt.current > FRAME_STALE_MS), 1000);
    return () => clearInterval(t);
  }, []);

  const current = activity?.current ?? null;
  return (
    <div className="p-6">
      <div className="mb-3 text-sm"><Link to="/dashboard/workers" className="text-blue-600 hover:underline">← 工作机</Link></div>
      <div className="flex gap-6 flex-col lg:flex-row">
        <div className="lg:w-[360px] shrink-0">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/19.5]">
            <img
              alt="实时画面"
              src={workerLiveUrl(agentId)}
              className="w-full h-full object-contain"
              onLoad={() => { lastFrameAt.current = Date.now(); setFrameStale(false); }}
            />
            {frameStale && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">画面不可用</div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{current ? current.title : '空闲'}</h2>
          {current && <div className="text-xs text-gray-500 mt-1">第 {current.current_step}/{current.steps_total} 步 · {statusLabel(current.status)}</div>}
          <ul className="mt-4 divide-y">
            {(activity?.steps ?? []).map((s) => (
              <li key={s.step_index} className="py-2 flex items-center gap-3 text-sm">
                <span className="w-6 text-center">{icon(s.status)}</span>
                <span className={s.status === 'doing' ? 'text-amber-700' : s.status === 'pending' ? 'text-gray-400' : ''}>{s.title}</span>
                {s.screenshot_url && (
                  <a href={s.screenshot_url} target="_blank" rel="noreferrer" className="ml-auto">
                    <img src={s.screenshot_url} alt={`第 ${s.step_index + 1} 步截图`} className="h-10 rounded border" />
                  </a>
                )}
                {s.status === 'failed' && (
                  <div className="ml-auto text-xs text-red-600">{s.foreground_pkg} · {s.diag_line}</div>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-8 text-sm font-semibold text-gray-700">最近任务</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th>开始</th><th>任务</th><th>结果</th><th>失败信息</th></tr></thead>
            <tbody>
              {(activity?.history ?? []).map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(h.started_at).toLocaleString()}</td>
                  <td className="py-1 pr-3">{h.title}</td>
                  <td className="py-1 pr-3">{statusLabel(h.status)}</td>
                  <td className="py-1 text-red-600">{h.error_code ? `第 ${h.failed_step ?? '?'} 步 · ${h.error_code}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run** — `npm --workspace=apps/dashboard run test -- WorkerLivePage` → PASS；`npm --workspace=apps/dashboard run typecheck`（或 `tsc --noEmit -p apps/dashboard`）无错

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/__tests__/WorkerLivePage.test.tsx
git commit -m "test(dashboard): worker 实时详情页组件测试（red）"
git add apps/dashboard/src/pages/WorkerLivePage.tsx
git commit -m "feat(dashboard): worker 实时详情页 画面+步骤流+历史"
```

---

### Task 10: Playwright E2E（page.route stub，windows_cloud）

**Files:**
- Create: `apps/dashboard/e2e/workers.spec.ts`

- [ ] **Step 1: Write the E2E（写完即为 failing——页面存在前会红；此处在 Task 8/9 之后写，验证真实页面）**

```ts
// apps/dashboard/e2e/workers.spec.ts
/**
 * 工作机控制塔 E2E — /dashboard/workers 总览 + /dashboard/workers/:id 详情
 * API 用 page.route stub（与 machine-events.spec.ts 同法，不依赖真后端）；VITE_SKIP_AUTH=true。
 * 运行：VITE_SKIP_AUTH=true npm run dev:dashboard && npm run -w apps/dashboard e2e -- workers
 */
import { test, expect } from '@playwright/test';

const workers = [
  { id: 'a1', agent_id: 'ag1', hostname: 'MAA-AN00', nickname: '小龙虾', os_type: 'android', status: 'online',
    running: { task_id: 't1', title: '发布视频到抖音', current_step: 3, steps_total: 5 }, completed_today: 1, last_seen: null },
  { id: 'w1', agent_id: 'ag2', hostname: 'XX-ROG', nickname: null, os_type: 'win32', status: 'online', running: null, completed_today: 0, last_seen: null },
];
const activity = {
  current: { id: 't1', title: '发布视频到抖音', status: 'running', steps_total: 5, current_step: 3, started_at: new Date().toISOString(), finished_at: null, failed_step: null, error_code: null },
  steps: [
    { step_index: 0, title: '打开抖音', status: 'done', screenshot_url: null },
    { step_index: 1, title: '选择视频', status: 'done', screenshot_url: null },
    { step_index: 2, title: '填写文案', status: 'done', screenshot_url: null },
    { step_index: 3, title: '设置可见范围', status: 'doing', screenshot_url: null },
    { step_index: 4, title: '点击发布', status: 'pending', screenshot_url: null },
  ],
  history: [],
};
// 1x1 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/workers', (r) => r.fulfill({ json: { success: true, data: workers } }));
  await page.route('**/api/workers/a1/activity', (r) => r.fulfill({ json: { success: true, data: activity } }));
  await page.route('**/api/workers/a1/live', (r) => r.fulfill({ contentType: 'image/jpeg', body: JPEG }));
});

test('总览列出安卓与 Windows worker，显示正在执行第 3/5 步', async ({ page }) => {
  await page.goto('/dashboard/workers');
  await expect(page.getByText('小龙虾')).toBeVisible();
  await expect(page.getByText(/安卓/)).toBeVisible();
  await expect(page.getByText(/Windows/)).toBeVisible();
  await expect(page.getByText(/正在执行：发布视频到抖音/)).toBeVisible();
  await expect(page.getByText(/第 3\/5 步/)).toBeVisible();
  await expect(page.getByText('空闲')).toBeVisible();
});

test('详情页：3 个 ✅ 1 个 ▶️，画面 img 加载', async ({ page }) => {
  await page.goto('/dashboard/workers/a1');
  await expect(page.getByText('发布视频到抖音')).toBeVisible();
  await expect(page.locator('li', { hasText: '打开抖音' })).toContainText('✅');
  await expect(page.locator('li', { hasText: '设置可见范围' })).toContainText('▶️');
  await expect(page.locator('li', { hasText: '点击发布' })).toContainText('⬜');
  await expect(page.getByRole('img', { name: '实时画面' })).toBeVisible();
});

test('画面 15 秒无帧显示"画面不可用"', async ({ page }) => {
  await page.route('**/api/workers/a1/live', (r) => r.abort());
  await page.goto('/dashboard/workers/a1');
  await expect(page.getByText('画面不可用')).toBeVisible({ timeout: 20_000 });
});
```

- [ ] **Step 2: Run locally**

Run: `VITE_SKIP_AUTH=true npm run dev:dashboard &` 然后 `npm run -w apps/dashboard e2e -- workers`
Expected: 3 passed

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/e2e/workers.spec.ts
git commit -m "test(e2e): 工作机控制塔总览/详情/画面不可用 Playwright 用例"
```

---

### Task 11: smoke 脚本（协议全链 curl）+ 接进 CI

**Files:**
- Create: `.github/workflows/scripts/smoke/worker-activity-smoke.sh`
- Modify: `.github/workflows/ci-l4-e2e-smoke.yml`（`smoke-e2e-worker` job，在启动 apps/api 的 step 之后追加一步；先 `grep -n "smoke-e2e-worker" -A 80 .github/workflows/ci-l4-e2e-smoke.yml | grep -n "npm run\|node .*apps/api\|Start" ` 找到启动 API 的 step）

- [ ] **Step 1: Write the smoke script**

```bash
#!/usr/bin/env bash
# worker 活动协议 smoke（决策 e14297d4）：开始任务→上报 3 步→推 2 帧→live 出帧→failed 缺三件套 400→complete。
# 用法：API_BASE=http://localhost:5200 AGENT_ID=<agents.id> [ZENITHJOY_INTERNAL_TOKEN=...] [TENANT_ID=...] bash worker-activity-smoke.sh
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5200}"
AGENT_ID="${AGENT_ID:?need AGENT_ID (zenithjoy.agents.id)}"
TENANT_ID="${TENANT_ID:-}"
AUTH=(); [ -n "${ZENITHJOY_INTERNAL_TOKEN:-}" ] && AUTH=(-H "X-Internal-Token: $ZENITHJOY_INTERNAL_TOKEN")
TEN=(); [ -n "$TENANT_ID" ] && TEN=(-H "X-Tenant-Id: $TENANT_ID")
J='Content-Type: application/json'
fail(){ echo "❌ $*"; exit 1; }

echo "[1] start task"
R=$(curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/$AGENT_ID/tasks" \
  -d '{"title":"smoke 发布","steps":["打开","选视频","发布"],"executor_id":"smoke"}') || fail "start task"
TID=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["task_id"])')
echo "    task=$TID"

echo "[2] second start on same worker → 409"
C=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/$AGENT_ID/tasks" \
  -d '{"title":"x","steps":["a"],"executor_id":"smoke2"}'); [ "$C" = "409" ] || fail "expected 409 got $C"

echo "[3] report steps"
for i in 0 1; do
  curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/steps" \
    -d "{\"step_index\":$i,\"status\":\"done\",\"executor_id\":\"smoke\"}" >/dev/null || fail "step $i"
done
C=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/steps" \
  -d '{"step_index":2,"status":"failed","executor_id":"smoke"}'); [ "$C" = "400" ] || fail "failed without scene expected 400 got $C"

echo "[4] push 2 frames + live has ≥2 frames"
JPG=$(printf '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=' | base64 -d)
TMP=$(mktemp); printf '%s' "$JPG" > "$TMP"
for i in 1 2; do curl -sf "${AUTH[@]}" -H 'Content-Type: image/jpeg' --data-binary "@$TMP" "$API_BASE/api/workers/$AGENT_ID/frame" >/dev/null || fail "frame $i"; done
( curl -s -m 4 "${TEN[@]}" "$API_BASE/api/workers/$AGENT_ID/live" > "$TMP.live" ) || true
N=$(grep -a -c -- '--frame' "$TMP.live" || true); [ "$N" -ge 1 ] || fail "live frames=$N"

echo "[5] activity shows current task with 2 done"
A=$(curl -sf "${TEN[@]}" "$API_BASE/api/workers/$AGENT_ID/activity") || fail "activity"
echo "$A" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];assert d["current"]["title"]=="smoke 发布";assert sum(1 for s in d["steps"] if s["status"]=="done")==2' || fail "activity content"

echo "[6] complete"
curl -sf "${AUTH[@]}" -H "$J" -X POST "$API_BASE/api/workers/tasks/$TID/complete" -d '{"outcome":"completed","executor_id":"smoke"}' >/dev/null || fail "complete"
echo "✅ worker-activity smoke PASS"
```

- [ ] **Step 2: chmod + local run**（需本地 API + Postgres；`AGENT_ID` 取 `SELECT id FROM zenithjoy.agents LIMIT 1`）

Run: `chmod +x .github/workflows/scripts/smoke/worker-activity-smoke.sh && API_BASE=http://localhost:5200 AGENT_ID=<uuid> bash .github/workflows/scripts/smoke/worker-activity-smoke.sh`
Expected: `✅ worker-activity smoke PASS`

- [ ] **Step 3: CI 接线**：在 `ci-l4-e2e-smoke.yml` 的 `smoke-e2e-worker` job 中、启动 apps/api 的 step 之后追加：

```yaml
      - name: Smoke · worker 活动协议
        env:
          API_BASE: http://localhost:5200
          PGPASSWORD: cecelia
        run: |
          AGENT_ID=$(psql -h localhost -U cecelia -d cecelia -tA -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, os_type, status) VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'smoke-worker', 'SMOKE-ANDROID', 'android', 'online') RETURNING id")
          AGENT_ID="$AGENT_ID" bash .github/workflows/scripts/smoke/worker-activity-smoke.sh
```
（若该 job 没有启动 apps/api 的 step，则用 `NODE_ENV=test PORT=5200 npm --workspace=apps/api run start &` + `npx wait-on http://localhost:5200/health` 先起服务；tenants 表若无行，先 `INSERT INTO zenithjoy.tenants (name) VALUES ('smoke') ON CONFLICT DO NOTHING`。）

- [ ] **Step 4: Commit**（smoke 进 CI 的 PR 标题须含 `[CONFIG]`——仓库规矩）

```bash
git add .github/workflows/scripts/smoke/worker-activity-smoke.sh .github/workflows/ci-l4-e2e-smoke.yml
git commit -m "[CONFIG] test(smoke): worker 活动协议全链 smoke 进 CI"
```

---

### Task 12: 全量验证 + 收尾

- [ ] `npm --workspace=apps/api run test` 全绿；`npm --workspace=apps/dashboard run test` 全绿
- [ ] `npm run lint`（根）无错；`tsc --noEmit` 两个 workspace 无错
- [ ] 删除调试输出/未用 import；确认 `apps/api/src/routes/agent-machines.ts` 行为未变（既有测试绿）
- [ ] PrepPRD「不包含」核对：未动 publish_tasks、未加上传表单、未写安卓端
- [ ] 进入 finishing（push + PR，标题：`[CONFIG] feat(workers): 工作机控制塔可视化第一刀——worker 活动协议 + 总览 + 实时详情`）

## Self-Review
- 覆盖：协议 4 执行器端点 ✓（T5）、读面 4 端点 ✓（T6）、租约/sweeper ✓（T4/T7）、三件套 400 ✓（T4/T5）、跨租户 404 ✓（T6）、总览页 ✓（T8）、详情页含 15s 画面不可用 ✓（T9）、E2E ✓（T10）、smoke 进 CI ✓（T11）、normMachine 复用 ✓（T2）。
- 类型一致：`WorkerTaskError(code,message,httpStatus)` T4 定义、T5/T6 使用一致；`workerLive.pushFrame/latest/subscribe` T3 定义、T5/T6 使用一致；`fetchWorkers/fetchWorkerActivity/workerLiveUrl` T8 定义、T8/T9 使用一致。
- 占位扫描：无 TBD；T11 的 CI step 位置给了确定的 grep 定位指令与兜底起服务命令。
