# cron 每次触发在 Brain 建 device_job 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 harvest-cron / outreach-tick 每次触发产生的 worker_task，在 Brain 建一条对应的 device_job，使工作机页能看到手机当天真实跑过的每一批活。

**Architecture:** 桥接点在 `worker-tasks-service.ts`（真机脚本几乎不改）。本地 `worker_tasks` 事务 COMMIT 后，best-effort 往 Brain 库 `tasks` 建 device_job；失败落本地 outbox 下次补投。领单器领 Brain 单产生的 worker_task 走"关联"而非"新建"，避免回环。

**Tech Stack:** TypeScript / Express / node-pg（双池：本地 `db/connection` + Brain `db/brain-pool`）/ vitest / zsh+bash 真机脚本

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `apps/api/src/services/brain-device-job-mirror.ts` | **新建**。桥接的全部逻辑：title 构造、状态映射、payload 构造、建单/回写/补投。纯函数与 IO 分离，纯函数可单测 |
| `apps/api/src/services/__tests__/brain-device-job-mirror.test.ts` | **新建**。纯函数与 IO 分支的单测 |
| `apps/api/db/migrations/20260924_*_brain_sync_outbox.sql` | **新建**。补投队列表 |
| `apps/api/src/services/worker-tasks-service.ts` | **改**。startTask/completeTask/sweepExpiredLeases 三处调用桥接 |
| `apps/api/src/routes/workers-executor.ts` | **改**。`POST /:agentId/tasks` 透传可选 `brain_job_id` |
| `apps/api/src/routes/schedule.ts` | **改**。改时间(259)/取消(277) 两处拒绝 read_only 行 |
| `services/phone-adb-controller/wall-report.sh` | **改**。`start` 支持第 4 个可选位置参数 brain_job_id |
| `services/phone-adb-controller/device-job-claimer.sh` | **改**。第 113 行 `wr start` 带上 `${JOB_ID}` |
| `services/phone-adb-controller/deploy.sh` | **改**。确认上述两脚本在分发清单内 |
| `.github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh` | **新建**。守卫 + 变异测试目标 |

---

## Task 1: 桥接纯函数（title 构造 + 状态映射 + payload）

**Files:**
- Create: `apps/api/src/services/brain-device-job-mirror.ts`
- Test: `apps/api/src/services/__tests__/brain-device-job-mirror.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/services/__tests__/brain-device-job-mirror.test.ts
import { describe, it, expect } from 'vitest';
import { buildMirrorTitle, mapWorkerStatus, buildMirrorPayload } from '../brain-device-job-mirror';

describe('buildMirrorTitle', () => {
  // Brain 有唯一索引 UNIQUE(title, goal_id, project_id) WHERE status IN ('queued','in_progress')。
  // 金诺两台同时跑同一个词，title 一样就会 23505 被咽掉 —— 这正是本次要修的病。
  it('带上序列号尾4位与时分，同词不同机不撞', () => {
    const a = buildMirrorTitle('获客采收·AI人工智能训练师', 'ANGYVB4227006983', '2026-09-24T14:30:00Z', 'w1abc234');
    const b = buildMirrorTitle('获客采收·AI人工智能训练师', 'ANGYVB4402004137', '2026-09-24T14:30:00Z', 'w2def567');
    expect(a).not.toBe(b);
    expect(a).toContain('6983');
    expect(a).toContain('1430');
  });

  it('同机同词同分钟由 task id 前6位兜底', () => {
    const a = buildMirrorTitle('获客采收·X', 'S0001234', '2026-09-24T14:30:00Z', 'aaaaaa11');
    const b = buildMirrorTitle('获客采收·X', 'S0001234', '2026-09-24T14:30:59Z', 'bbbbbb22');
    expect(a).not.toBe(b);
  });

  it('原标题保留在开头，人能一眼认出这是什么活', () => {
    expect(buildMirrorTitle('触达·单#246 小海', 'S0001234', '2026-09-24T14:30:00Z', 'aaaaaa11'))
      .toMatch(/^触达·单#246 小海 · /);
  });
});

describe('mapWorkerStatus', () => {
  // 页面 STATUS_MAP: queued/in_progress/completed/failed/blocked，未知一律落 blocked 不静默骗人
  it('四档映射到页面认得的状态', () => {
    expect(mapWorkerStatus('running')).toBe('in_progress');
    expect(mapWorkerStatus('completed')).toBe('completed');
    expect(mapWorkerStatus('failed')).toBe('failed');
    expect(mapWorkerStatus('needs_review')).toBe('blocked');
  });
  it('未知状态落 blocked，不猜成 completed', () => {
    expect(mapWorkerStatus('whatever')).toBe('blocked');
  });
});

describe('buildMirrorPayload', () => {
  const p = buildMirrorPayload({ serial: 'ANGYVB4227006983', workerTaskId: 'wt-1', startedAt: '2026-09-24T14:30:00Z' });

  it('标只读：页面不该给改时间/取消按钮，点了对真机零作用', () => {
    expect(p.read_only).toBe(true);
  });
  it('source=cron 而非 oneoff：领单器只认 oneoff，否则会把已在跑的活再领一遍', () => {
    expect(p.source).toBe('cron');
  });
  it('headed_manual 防 Brain tick 把这条活派给 LLM 执行体真去跑一轮采收', () => {
    expect(p.headed_manual).toBe(true);
  });
  it('serial 存 adb 看得到的裸序列号', () => {
    expect(p.serial).toBe('ANGYVB4227006983');
  });
  it('幂等键用 worker_task id，curl 重试不会重复建', () => {
    expect(p.idempotency_key).toBe('wt-1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/brain-device-job-mirror.test.ts`
Expected: FAIL — `Failed to resolve import "../brain-device-job-mirror"`

- [ ] **Step 3: 写最小实现**

```ts
// apps/api/src/services/brain-device-job-mirror.ts
/**
 * worker_tasks（执行记录，本地库）→ Brain tasks.device_job（计划真身，us-vps）的桥接。
 *
 * 为什么需要：工作机页只读 Brain 的 device_job，而 cron 触发的采收/触达只写本地
 * worker_tasks —— 手机整天在跑，页面却是 0 任务（09-24 实证：13:50 出线索 19/15，页面 0）。
 *
 * 为什么写 Brain 而不是在中台另建表：`db/brain-pool.ts` 的既定用途就是
 * 「只读排程 + 写 device_job 任务单」，决策 e1ec93b2「Brain tasks = 唯一真身」。
 */

/** Brain 侧任务状态（页面 STATUS_MAP 认得的值域） */
export type MirrorStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'blocked';

/**
 * 构造 Brain 单标题。
 *
 * Brain 有 `idx_tasks_dedup_active` = UNIQUE(title, goal_id, project_id)
 * WHERE status IN ('queued','in_progress')。金诺两台同时跑「获客采收·AI人工智能训练师」
 * 时 title 相同 → 第二条 23505 → 被 best-effort 咽掉 → 页面还是 0 条。
 *
 * 所以带上序列号尾 4 位 + 起跑时分。这不是为绕索引而变丑：页面本来就需要
 * 区分哪台手机、哪一批，是信息增益。同机同词同分钟的极端情况用 task id 前 6 位兜底。
 */
export function buildMirrorTitle(title: string, serial: string, startedAt: string, workerTaskId: string): string {
  const tail = String(serial ?? '').slice(-4) || '????';
  const d = new Date(startedAt);
  const hhmm = Number.isFinite(d.getTime())
    ? `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`
    : '0000';
  return `${title} · ${tail} · ${hhmm} · ${String(workerTaskId).slice(0, 6)}`;
}

const STATUS: Record<string, MirrorStatus> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  needs_review: 'blocked',
};

/** 未知状态落 blocked —— 与页面 toScheduleSlot 同款态度：不静默变成"待跑"骗人。 */
export function mapWorkerStatus(s: string): MirrorStatus {
  return STATUS[s] ?? 'blocked';
}

export interface MirrorPayload {
  read_only: true;
  source: 'cron';
  headed_manual: true;
  serial: string;
  idempotency_key: string;
  executed_at: string;
  [k: string]: unknown;
}

/**
 * payload 三道闸，少一道都会出事：
 *  - source='cron'：领单器 /claim 只认 `source='oneoff'`，写错会把"已经在本机跑着的活"
 *    再领走跑第二遍，两个进程抢同一台手机。
 *  - read_only：页面对每条活都给「改时间/取消」按钮，但对镜像行做 CAS 对真机零作用 ——
 *    运营点了取消，手机照跑。写面必须据此拒绝。
 *  - headed_manual：防 Brain tick 把这条活派给 LLM 执行体真去跑一轮采收。
 */
export function buildMirrorPayload(a: { serial: string; workerTaskId: string; startedAt: string }): MirrorPayload {
  return {
    read_only: true,
    source: 'cron',
    headed_manual: true,
    serial: a.serial,
    idempotency_key: a.workerTaskId,
    executed_at: a.startedAt,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/brain-device-job-mirror.test.ts`
Expected: PASS（14 个断言全绿）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/brain-device-job-mirror.ts apps/api/src/services/__tests__/brain-device-job-mirror.test.ts
git commit -m "feat(schedule): worker_task→Brain device_job 桥接的纯函数层"
```

---

## Task 2: 补投队列表

**Files:**
- Create: `apps/api/db/migrations/20260924_160000_brain_sync_outbox.sql`
- Test: `apps/api/src/services/__tests__/brain-sync-outbox-migration.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/services/__tests__/brain-sync-outbox-migration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('brain_sync_outbox migration', () => {
  const dir = join(__dirname, '../../../db/migrations');
  const file = readdirSync(dir).find((f) => f.includes('brain_sync_outbox'));

  it('migration 文件存在', () => {
    expect(file).toBeTruthy();
  });

  const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

  it('建表用 IF NOT EXISTS，重复跑不炸', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zenithjoy\.brain_sync_outbox/i);
  });

  it('没有破坏性语句', () => {
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
  });

  it('字段齐：区分操作类型、可重试、留错因', () => {
    for (const col of ['worker_task_id', 'op', 'payload', 'attempts', 'last_error', 'created_at']) {
      expect(sql).toContain(col);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/brain-sync-outbox-migration.test.ts`
Expected: FAIL — `expect(file).toBeTruthy()` 收到 undefined

- [ ] **Step 3: 写 migration**

```sql
-- apps/api/db/migrations/20260924_160000_brain_sync_outbox.sql
-- Brain 同步补投队列。
--
-- 为什么要：桥接往 Brain 写是 best-effort（记账是附属，采收是正事，绝不能阻断）。
-- 但直接丢掉会造成系统性偏差 —— 跨境网络坏的那晚正是最需要看见的晚上，却恰恰
-- 一条记录都没有，页面从"0 任务"变成"只显示好天气的任务"，比现在更骗人。
CREATE TABLE IF NOT EXISTS zenithjoy.brain_sync_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_task_id uuid NOT NULL,
  op           text NOT NULL CHECK (op IN ('create', 'complete', 'sweep')),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_sync_outbox_pending
  ON zenithjoy.brain_sync_outbox (created_at) WHERE attempts < 10;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/brain-sync-outbox-migration.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/db/migrations/20260924_160000_brain_sync_outbox.sql apps/api/src/services/__tests__/brain-sync-outbox-migration.test.ts
git commit -m "feat(schedule): Brain 同步补投队列表"
```

---

## Task 3: 建单（createMirrorJob）

**Files:**
- Modify: `apps/api/src/services/brain-device-job-mirror.ts`
- Test: `apps/api/src/services/__tests__/brain-device-job-mirror.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 brain-device-job-mirror.test.ts 末尾
import { vi } from 'vitest';
vi.mock('../../db/brain-pool', () => ({ getBrainPool: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));
import { getBrainPool } from '../../db/brain-pool';
import localPool from '../../db/connection';
import { createMirrorJob } from '../brain-device-job-mirror';

describe('createMirrorJob', () => {
  const args = {
    workerTaskId: 'wt-1', agentId: 'agent-uuid-1', serial: 'ANGYVB4227006983',
    title: '获客采收·AI人工智能训练师', startedAt: '2026-09-24T14:30:00Z',
  };

  beforeEach(() => vi.clearAllMocks());

  it('建单成功时返回 brain task id', async () => {
    (getBrainPool as any).mockReturnValue({ query: vi.fn(async () => ({ rows: [{ id: 'brain-1' }] })) });
    expect(await createMirrorJob(args)).toBe('brain-1');
  });

  it('due_at 必须传值 —— 传 NULL 页面会渲染成 1970-01-01', async () => {
    const q = vi.fn(async () => ({ rows: [{ id: 'brain-1' }] }));
    (getBrainPool as any).mockReturnValue({ query: q });
    await createMirrorJob(args);
    const params = q.mock.calls[0][1] as unknown[];
    expect(params).toContain(args.startedAt);
    expect(params.some((p) => p === null)).toBe(false);
  });

  it('trigger_source 不能用库默认的 brain_auto —— 会被 Brain escalation 静默 paused', async () => {
    const q = vi.fn(async () => ({ rows: [{ id: 'brain-1' }] }));
    (getBrainPool as any).mockReturnValue({ query: q });
    await createMirrorJob(args);
    expect((q.mock.calls[0][1] as unknown[])).toContain('cron');
    expect((q.mock.calls[0][1] as unknown[])).not.toContain('brain_auto');
  });

  it('Brain 没配时不崩，落 outbox 返回 null', async () => {
    (getBrainPool as any).mockReturnValue(null);
    expect(await createMirrorJob(args)).toBeNull();
    expect((localPool as any).query).toHaveBeenCalledWith(
      expect.stringContaining('brain_sync_outbox'), expect.anything(),
    );
  });

  it('Brain 写失败时吞掉异常并落 outbox —— 记账绝不能阻断采收', async () => {
    (getBrainPool as any).mockReturnValue({ query: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) });
    await expect(createMirrorJob(args)).resolves.toBeNull();
    expect((localPool as any).query).toHaveBeenCalledWith(
      expect.stringContaining('brain_sync_outbox'), expect.anything(),
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/brain-device-job-mirror.test.ts -t createMirrorJob`
Expected: FAIL — `createMirrorJob is not a function`

- [ ] **Step 3: 实现**

```ts
// 追加到 apps/api/src/services/brain-device-job-mirror.ts
import { getBrainPool } from '../db/brain-pool';
import localPool from '../db/connection';

async function toOutbox(workerTaskId: string, op: 'create' | 'complete' | 'sweep', payload: unknown, err?: unknown) {
  try {
    await localPool.query(
      `INSERT INTO zenithjoy.brain_sync_outbox (worker_task_id, op, payload, last_error)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [workerTaskId, op, JSON.stringify(payload ?? {}), err instanceof Error ? err.message : err ? String(err) : null],
    );
  } catch (e) {
    // outbox 都写不进就只剩日志了。绝不再往上抛 —— 这是记账的记账。
    console.error('[brain-mirror] outbox 写入失败:', e);
  }
}

/**
 * 在 Brain 建一条 device_job。失败一律吞掉并落 outbox，绝不阻断调用方。
 * 返回 brain task id；没建成返回 null。
 */
export async function createMirrorJob(a: {
  workerTaskId: string; agentId: string; serial: string; title: string; startedAt: string;
}): Promise<string | null> {
  const brain = getBrainPool();
  const payload = buildMirrorPayload({ serial: a.serial, workerTaskId: a.workerTaskId, startedAt: a.startedAt });
  const title = buildMirrorTitle(a.title, a.serial, a.startedAt, a.workerTaskId);
  if (!brain) { await toOutbox(a.workerTaskId, 'create', { ...a, title, payload }); return null; }
  try {
    const r = await brain.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, dept, assigned_to, due_at, payload, trigger_source)
       VALUES ($1, $2, 'device_job', 'in_progress', 'P2', $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [title, `工作机自发活 · ${a.serial}`, '智能获客', a.agentId, a.startedAt, JSON.stringify(payload), 'cron'],
    );
    return (r.rows[0]?.id as string) ?? null;
  } catch (e) {
    await toOutbox(a.workerTaskId, 'create', { ...a, title, payload }, e);
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/brain-device-job-mirror.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/brain-device-job-mirror.ts apps/api/src/services/__tests__/brain-device-job-mirror.test.ts
git commit -m "feat(schedule): Brain 建单 + 失败落 outbox"
```

---

## Task 4: startTask 接入（含 brain_job_id 关联分支）

**Files:**
- Modify: `apps/api/src/services/worker-tasks-service.ts:41-70`
- Modify: `apps/api/src/routes/workers-executor.ts:65`
- Test: `apps/api/src/services/__tests__/worker-tasks-service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 apps/api/src/services/__tests__/worker-tasks-service.test.ts
import { createMirrorJob } from '../brain-device-job-mirror';
vi.mock('../brain-device-job-mirror', () => ({
  createMirrorJob: vi.fn(async () => 'brain-1'),
  attachMirrorJob: vi.fn(async () => undefined),
}));

describe('startTask 桥接 Brain', () => {
  it('cron 自发的活会在 Brain 建单', async () => {
    // pool.connect 返回的 client 依次响应 BEGIN/agents/INSERT/steps/COMMIT
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})                                            // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'a1', tenant_id: 't1' }] })      // agents
        .mockResolvedValueOnce({ rows: [{ id: 'wt-1', lease_until: 'L' }] })   // INSERT worker_tasks
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    (pool as any).connect = vi.fn(async () => client);
    (pool as any).query = vi.fn(async () => ({ rows: [{ agent_id: 'phone-S123' }] }));

    await startTask({ agentId: 'a1', title: '获客采收·X', steps: ['s1'], executorId: 'adb-wall' });
    expect(createMirrorJob).toHaveBeenCalled();
  });

  it('领单器领 Brain 单产生的活走关联，不重复建单（否则每条真派单都镜像一条，页面重复计数）', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'a1', tenant_id: 't1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wt-2', lease_until: 'L' }] })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    (pool as any).connect = vi.fn(async () => client);
    (pool as any).query = vi.fn(async () => ({ rows: [{ agent_id: 'phone-S123' }] }));

    await startTask({ agentId: 'a1', title: '[派活演示] 小蓝', steps: ['s1'], executorId: 'adb-wall', brainJobId: 'brain-existing' });
    expect(createMirrorJob).not.toHaveBeenCalled();
  });

  it('Brain 建单抛错也不能让 startTask 失败 —— 采收是正事', async () => {
    (createMirrorJob as any).mockRejectedValueOnce(new Error('boom'));
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'a1', tenant_id: 't1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wt-3', lease_until: 'L' }] })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    (pool as any).connect = vi.fn(async () => client);
    (pool as any).query = vi.fn(async () => ({ rows: [{ agent_id: 'phone-S123' }] }));

    await expect(startTask({ agentId: 'a1', title: 'X', steps: ['s'], executorId: 'adb-wall' }))
      .resolves.toMatchObject({ task_id: 'wt-3' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/worker-tasks-service.test.ts -t "startTask 桥接"`
Expected: FAIL — `createMirrorJob` 未被调用

- [ ] **Step 3: 实现**

在 `worker-tasks-service.ts` 顶部加 import：

```ts
import { createMirrorJob, attachMirrorJob } from './brain-device-job-mirror';
```

把 `startTask` 签名与 COMMIT 后逻辑改成：

```ts
export async function startTask(input: {
  agentId: string; title: string; steps: string[]; executorId: string;
  /** 领单器领到 Brain device_job 时带上它的 id：此时本 worker_task 是那条单的执行记录，
   *  只做关联、不再新建，否则每条真派单都会镜像出一条，页面重复计数 + 永久孤儿。 */
  brainJobId?: string;
}) {
  const client = await pool.connect();
  let taskId: string;
  let leaseUntil: string;
  let tenantId: string;
  try {
    await client.query('BEGIN');
    const agent = await client.query(`SELECT id, tenant_id FROM zenithjoy.agents WHERE id = $1`, [input.agentId]);
    if (agent.rows.length === 0) throw new WorkerTaskError('AGENT_NOT_FOUND', 'worker 不存在', 404);
    tenantId = agent.rows[0].tenant_id as string;
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
    taskId = task.rows[0].id as string;
    leaseUntil = task.rows[0].lease_until as string;
    for (let i = 0; i < input.steps.length; i++) {
      await client.query(`INSERT INTO zenithjoy.worker_task_steps (task_id, step_index, title) VALUES ($1, $2, $3)`, [taskId, i, input.steps[i]]);
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally { client.release(); }

  // ── 桥接到 Brain（COMMIT 之后，跨池不能同事务）────────────────────────
  // 整段 try 包住：记账是附属，采收是正事，桥接出任何问题都不能让 startTask 失败。
  try {
    if (input.brainJobId) {
      await attachMirrorJob(taskId, input.brainJobId);
    } else {
      const a = await pool.query(`SELECT agent_id FROM zenithjoy.agents WHERE id = $1`, [input.agentId]);
      const serial = String(a.rows[0]?.agent_id ?? '').replace(/^phone-/, '');
      const brainId = await createMirrorJob({
        workerTaskId: taskId, agentId: input.agentId, serial,
        title: input.title, startedAt: new Date().toISOString(),
      });
      if (brainId) await attachMirrorJob(taskId, brainId);
    }
  } catch (e) {
    console.error('[worker-tasks] Brain 桥接失败（不影响本次执行）:', e);
  }

  return { task_id: taskId, lease_until: leaseUntil };
}
```

在 `brain-device-job-mirror.ts` 追加：

```ts
/** 把 brain task id 记进 worker_tasks.evidence。用 jsonb 合并而非覆盖 —— completeTask
 *  的 `evidence = $5` 是整体覆盖，直接写会被后续收尾抹掉。 */
export async function attachMirrorJob(workerTaskId: string, brainTaskId: string): Promise<void> {
  try {
    await localPool.query(
      `UPDATE zenithjoy.worker_tasks
          SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object('brain_task_id', $2::text),
              updated_at = NOW()
        WHERE id = $1`,
      [workerTaskId, brainTaskId],
    );
  } catch (e) {
    console.error('[brain-mirror] 关联 brain_task_id 失败:', e);
  }
}
```

在 `workers-executor.ts:65` 的建任务路由里透传（这是该路由的完整替换版，
保持它原有的参数校验与错误处理，只多解析并透传 `brain_job_id`）：

```ts
workersExecutorRouter.post('/:agentId/tasks', requireAgentUuid, async (req: Request, res: Response) => {
  const { title, steps, executor_id, brain_job_id } = req.body ?? {};
  if (typeof title !== 'string' || !title || !Array.isArray(steps) || steps.length === 0
      || !steps.every((s) => typeof s === 'string') || typeof executor_id !== 'string' || !executor_id) {
    return res.status(400).json(ERR('INVALID_TASK', 'title、steps[string]、executor_id 必填'));
  }
  try {
    const r = await startTask({
      agentId: req.params.agentId, title, steps, executorId: executor_id,
      // 领单器带它上来时走"关联已有 Brain 单"，不再镜像新建。
      // 老版本 wall-report 不传 → undefined → 走新建分支，向后兼容（分发滞后不会炸）。
      brainJobId: typeof brain_job_id === 'string' && brain_job_id ? brain_job_id : undefined,
    });
    return res.status(201).json(OK(r));
  } catch (e) { return sendErr(res, e, 'tasks'); }
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/worker-tasks-service.test.ts`
Expected: PASS（原有用例也要全绿）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/worker-tasks-service.ts apps/api/src/services/brain-device-job-mirror.ts apps/api/src/routes/workers-executor.ts apps/api/src/services/__tests__/worker-tasks-service.test.ts
git commit -m "feat(schedule): startTask 桥接 Brain，领单器走关联不重复建"
```

---

## Task 5: completeTask 回写（evidence 必须合并不能覆盖）

**Files:**
- Modify: `apps/api/src/services/brain-device-job-mirror.ts`
- Modify: `apps/api/src/services/worker-tasks-service.ts:104-126`
- Test: `apps/api/src/services/__tests__/worker-tasks-service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// 注意：Task 4 已经 mock 过本模块，这里要把 completeMirrorJob 一起加进同一个
// vi.mock 工厂里（漏了它，下面的 expect(completeMirrorJob) 会拿到 undefined 直接报错）：
//   vi.mock('../brain-device-job-mirror', () => ({
//     createMirrorJob: vi.fn(async () => 'brain-1'),
//     attachMirrorJob: vi.fn(async () => undefined),
//     completeMirrorJob: vi.fn(async () => undefined),
//   }));
// 并在文件顶部 import { completeMirrorJob } from '../brain-device-job-mirror';
describe('completeTask 回写 Brain', () => {
  it('收尾时按 evidence.brain_task_id 回写 Brain 状态', async () => {
    (pool as any).query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wt-1', tenant_id: 't1', status: 'running', executor_id: 'adb-wall', steps_total: 3, evidence: { brain_task_id: 'brain-1' } }] })
      .mockResolvedValue({ rows: [] });
    await completeTask('wt-1', { outcome: 'completed', executor_id: 'adb-wall' });
    expect(completeMirrorJob).toHaveBeenCalledWith('brain-1', 'completed', expect.anything());
  });

  it('UPDATE 不能整体覆盖 evidence —— 会把 brain_task_id 抹掉，下次 sweep 就找不到它了', async () => {
    (pool as any).query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wt-1', tenant_id: 't1', status: 'running', executor_id: 'adb-wall', steps_total: 3, evidence: { brain_task_id: 'brain-1' } }] })
      .mockResolvedValue({ rows: [] });
    await completeTask('wt-1', { outcome: 'completed', executor_id: 'adb-wall', evidence: { leads: 19 } });
    const updateCall = (pool as any).query.mock.calls.find((c: any[]) => /UPDATE zenithjoy\.worker_tasks/.test(c[0]));
    expect(updateCall[0]).toMatch(/evidence\s*=\s*COALESCE\(evidence/i);
  });

  it('没有 brain_task_id 时不报错，静默跳过', async () => {
    (pool as any).query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wt-9', tenant_id: 't1', status: 'running', executor_id: 'adb-wall', steps_total: 1, evidence: null }] })
      .mockResolvedValue({ rows: [] });
    await expect(completeTask('wt-9', { outcome: 'completed', executor_id: 'adb-wall' })).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/worker-tasks-service.test.ts -t "completeTask 回写"`
Expected: FAIL — `completeMirrorJob` 未定义 / evidence 仍是 `= $5`

- [ ] **Step 3: 实现**

`brain-device-job-mirror.ts` 追加：

```ts
/** 回写 Brain 单的终态。失败落 outbox，不抛。 */
export async function completeMirrorJob(
  brainTaskId: string, workerStatus: string, extra?: Record<string, unknown>,
): Promise<void> {
  const brain = getBrainPool();
  const status = mapWorkerStatus(workerStatus);
  if (!brain) { await toOutbox(brainTaskId, 'complete', { brainTaskId, status, extra }); return; }
  try {
    await brain.query(
      `UPDATE tasks
          SET status = $2,
              completed_at = CASE WHEN $2 IN ('completed','failed') THEN NOW() ELSE completed_at END,
              payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [brainTaskId, status, JSON.stringify({ finished_at: new Date().toISOString(), ...(extra ?? {}) })],
    );
  } catch (e) {
    await toOutbox(brainTaskId, 'complete', { brainTaskId, status, extra }, e);
  }
}
```

`worker-tasks-service.ts` 的 `completeTask`：把 `loadRunning` 改为同时取 evidence（若 `loadRunning` 的 SELECT 未含 evidence 则补上），UPDATE 的 evidence 改成合并，并在末尾回写：

```ts
  await pool.query(
    `UPDATE zenithjoy.worker_tasks SET status = $2, finished_at = NOW(), error_code = $3, failed_step = $4,
        evidence = COALESCE(evidence, '{}'::jsonb) || $5::jsonb, updated_at = NOW() WHERE id = $1`,
    [taskId, body.outcome, body.error_code ?? null, body.failed_step ?? null, JSON.stringify(evidence ?? {})],
  );

  // 回写 Brain。整段吞异常：收尾成功与否不取决于记账。
  try {
    const brainTaskId = (t as { evidence?: { brain_task_id?: string } }).evidence?.brain_task_id;
    if (brainTaskId) {
      await completeMirrorJob(brainTaskId, body.outcome, {
        error_code: body.error_code ?? null,
        leads_local: (evidence as Record<string, unknown> | null)?.leads_local ?? null,
        leads_persisted: (evidence as Record<string, unknown> | null)?.leads_persisted ?? null,
      });
    }
  } catch (e) {
    console.error('[worker-tasks] Brain 回写失败（不影响本次收尾）:', e);
  }
  return { ok: true };
```

> `loadRunning` 的 SELECT 需补 `evidence` 列，否则这里永远拿不到 brain_task_id。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/worker-tasks-service.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/brain-device-job-mirror.ts apps/api/src/services/worker-tasks-service.ts apps/api/src/services/__tests__/worker-tasks-service.test.ts
git commit -m "fix(schedule): 收尾回写 Brain，evidence 改合并防抹掉 brain_task_id"
```

---

## Task 6: 租约过期同步回写（消除幽灵 in_progress）

**Files:**
- Modify: `apps/api/src/services/worker-tasks-service.ts:128-134`
- Test: `apps/api/src/services/__tests__/worker-lease-sweeper.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 worker-lease-sweeper.test.ts
describe('sweepExpiredLeases 同步 Brain', () => {
  it('执行器丢失时把 Brain 单也置 failed —— 否则 Brain 侧永远 in_progress，还占住 dedup 槽位挡住后续建单', async () => {
    (pool as any).query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{ id: 'wt-1', evidence: { brain_task_id: 'brain-1' } }],
    }));
    await sweepExpiredLeases();
    expect(completeMirrorJob).toHaveBeenCalledWith('brain-1', 'failed', expect.objectContaining({ error_code: 'executor_lost' }));
  });

  it('没关联 Brain 单的行跳过，不报错', async () => {
    (pool as any).query = vi.fn(async () => ({ rowCount: 1, rows: [{ id: 'wt-2', evidence: null }] }));
    await expect(sweepExpiredLeases()).resolves.toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/worker-lease-sweeper.test.ts -t "同步 Brain"`
Expected: FAIL — `completeMirrorJob` 未被调用

- [ ] **Step 3: 实现**

```ts
export async function sweepExpiredLeases(): Promise<number> {
  const r = await pool.query(
    `UPDATE zenithjoy.worker_tasks SET status = 'failed', error_code = 'executor_lost', finished_at = NOW(), updated_at = NOW()
      WHERE status = 'running' AND lease_until < NOW() RETURNING id, evidence`,
  );
  // 本地置了 failed，Brain 侧不同步就会永远挂 in_progress，并持续占住
  // idx_tasks_dedup_active 的槽位，把后续同名建单全挡在外面。
  for (const row of r.rows ?? []) {
    const brainTaskId = (row as { evidence?: { brain_task_id?: string } }).evidence?.brain_task_id;
    if (!brainTaskId) continue;
    try {
      await completeMirrorJob(brainTaskId, 'failed', { error_code: 'executor_lost' });
    } catch (e) {
      console.error('[worker-tasks] sweep 回写 Brain 失败:', e);
    }
  }
  return r.rowCount ?? 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/worker-lease-sweeper.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/worker-tasks-service.ts apps/api/src/services/__tests__/worker-lease-sweeper.test.ts
git commit -m "fix(schedule): 租约过期同步回写 Brain，消除幽灵 in_progress"
```

---

## Task 7: 写面拒绝只读行（防"点了取消手机照跑"）

**Files:**
- Modify: `apps/api/src/routes/schedule.ts` 改时间(约259行) / 取消(约277行)
- Test: `apps/api/src/routes/__tests__/schedule.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 schedule.test.ts
describe('只读行拒绝写操作', () => {
  it('改时间：镜像行必须拒绝 —— CAS 对真机零作用，让人以为改了其实没改', async () => {
    const res = await request(app).patch('/api/schedule/jobs/brain-1')
      .set('X-Feishu-User-Id', 'u1')
      .send({ planned_at: new Date(Date.now() + 3600_000).toISOString(), row_version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('READ_ONLY_JOB');
  });

  it('取消：镜像行必须拒绝 —— 运营点了取消，手机照跑，这比看不见更坏', async () => {
    const res = await request(app).post('/api/schedule/jobs/brain-1/cancel')
      .set('X-Feishu-User-Id', 'u1').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('READ_ONLY_JOB');
  });

  it('错误信息要说人话，告诉运营该去哪停，不能只甩错误码', async () => {
    const res = await request(app).post('/api/schedule/jobs/brain-1/cancel')
      .set('x-feishu-user-id', 'tenant-1').send({});
    expect(res.body.message).toContain('工作机');
    expect(res.body.message).toMatch(/cron|自发/);
  });
});
```

本文件既有的 mock 形态（照它接上，别另起一套）：

```ts
vi.mock('../../db/brain-pool', () => ({
  getBrainPool: () => (brainAvailable ? { query: (...a: any[]) => brainQuery(...a) } : null),
}));
```

所以本组用例只需在 `beforeEach` 里让 `brainQuery` 返回一条带 `read_only` 的行：

```ts
beforeEach(() => {
  brainQuery.mockResolvedValue({
    rows: [{ id: 'brain-1', status: 'in_progress', row_version: 1,
             payload: { read_only: true, source: 'cron', serial: 'ANGYVB4227006983' } }],
  });
});
```

注意 header 用小写 `x-feishu-user-id`（与同文件其他用例一致）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/__tests__/schedule.test.ts -t "只读行"`
Expected: FAIL — 收到 200 而非 409

- [ ] **Step 3: 实现**

在两个写面 handler 里，取到行之后、执行 CAS/取消之前插入：

```ts
    // 真机自发的活（cron 触发）在页面上是只读镜像：它的执行由手机上的 cron 决定，
    // 改这里的 due_at 或 status 对真机零作用。放行 = 让运营以为取消了，手机照跑。
    if ((row.payload ?? {}).read_only === true) {
      return res.status(409).json(ERR('READ_ONLY_JOB',
        '这是工作机自发执行的活（cron 触发），页面上只能看不能改；要停它得去对应工作机停 cron'));
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/__tests__/schedule.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/routes/schedule.ts apps/api/src/routes/__tests__/schedule.test.ts
git commit -m "fix(schedule): 只读镜像行拒绝改时间/取消"
```

---

## Task 8: 真机脚本传 brain_job_id + 分发清单

**Files:**
- Modify: `services/phone-adb-controller/wall-report.sh:59`
- Modify: `services/phone-adb-controller/device-job-claimer.sh:113`
- Verify: `services/phone-adb-controller/deploy.sh` —— 两个脚本必须在分发清单里，否则改了到不了机器：

```bash
grep -E 'wall-report\.sh|device-job-claimer\.sh' services/phone-adb-controller/deploy.sh
```

Expected: 两个文件名都出现在 `DEVICE_SH_FILES` 里。缺任何一个就补进去——
0924 刚栽过同款（`workflow-result.sh` 分发了、它硬依赖的 `ledger.mjs` 没分发，静默失败三天）。

- [ ] **Step 1: 写失败测试（smoke 守卫）**

```bash
# 追加到 .github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh（Task 9 建，此处先写断言）
_CODE=$(grep -vE '^[[:space:]]*#' "$D/device-job-claimer.sh")
if ! grep -q 'wr start .*JOB_ID' <<< "$_CODE"; then
  fail "device-job-claimer 没把 Brain 的 JOB_ID 传给 wr start —— 每条真派单都会在 Brain 再镜像一条，页面重复计数"
fi
```

- [ ] **Step 2: 跑确认失败**

Run: `bash .github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh`
Expected: FAIL，报上面那句

- [ ] **Step 3: 改脚本**

`wall-report.sh` 第 59 行 start 的 body 构造，增加可选第 4 参数：

```bash
  # $4 = brain_job_id（可选）。领单器领到 Brain device_job 时带上它：服务端据此
  # 把本 worker_task 关联到那条单，而不是再镜像建一条（否则页面重复计数 + 永久孤儿）。
  body=$(python3 -c 'import json,sys
d={"title":sys.argv[1][:80],"steps":[s for s in sys.argv[2].split(",") if s],"executor_id":sys.argv[3]}
if len(sys.argv)>4 and sys.argv[4]: d["brain_job_id"]=sys.argv[4]
print(json.dumps(d))' "$1" "$2" "$EXECUTOR" "${4:-}" 2>/dev/null)
```

`device-job-claimer.sh` 第 113 行：

```bash
wr start "${JOB_SERIAL}" "${JOB_TITLE}" "执行工作机页派下来的活" "${JOB_ID}"
```

- [ ] **Step 4: 跑确认通过**

Run: `bash .github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh`
Expected: PASS

Run: `bash -n services/phone-adb-controller/wall-report.sh && bash -n services/phone-adb-controller/device-job-claimer.sh`
Expected: 无输出（语法 OK）

- [ ] **Step 5: 提交**

```bash
git add services/phone-adb-controller/wall-report.sh services/phone-adb-controller/device-job-claimer.sh
git commit -m "feat(leadgen): 领单器上报带 brain_job_id，服务端据此关联不重复建单"
```

---

## Task 9: smoke 守卫 + 变异测试

**Files:**
- Create: `.github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh`
- Modify: smoke 基线清单（与 `phone-adb-controller-smoke.sh` 同一注册处）

- [ ] **Step 1: 写守卫**

```bash
#!/usr/bin/env bash
# brain-device-job-mirror-smoke.sh —— 守 worker_task → Brain device_job 桥接的四条命门。
#
# 这四条每一条失守，表现都是「页面还是 0 任务」或「页面骗人」，且都不会报错：
#   ① title 不带区分位 → dedup 唯一索引 23505 → best-effort 咽掉
#   ② payload.source 写成 oneoff → 领单器把已在跑的活再领一遍，两进程抢同一台手机
#   ③ read_only 丢了 → 运营点取消，手机照跑
#   ④ evidence 整体覆盖 → brain_task_id 被抹掉，收尾和 sweep 都找不到它
set -uo pipefail
D="apps/api/src/services"
fail() { echo "::error::brain-device-job-mirror-smoke: $1"; exit 1; }

M="$D/brain-device-job-mirror.ts"
[[ -s "$M" ]] || fail "brain-device-job-mirror.ts 缺失"

_CODE=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$M")

grep -q "read_only" <<< "$_CODE" || fail "payload 没有 read_only —— 页面会给这些真机自发的活配上改时间/取消按钮，点了对手机零作用"
grep -q "'cron'" <<< "$_CODE" || fail "payload.source 不是 cron —— 领单器 /claim 只认 oneoff，写错会把已在跑的活再领一遍"
grep -q "headed_manual" <<< "$_CODE" || fail "payload 没有 headed_manual —— Brain tick 会把这条活派给 LLM 执行体真去跑一轮采收"
grep -qE "slice\(-4\)|serial.*slice" <<< "$_CODE" || fail "title 没带序列号区分位 —— 两台机同跑一个词会撞 dedup 唯一索引,第二条被静默吞掉"

W="$D/worker-tasks-service.ts"
_WCODE=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$W")
grep -qE "evidence\s*=\s*COALESCE\(evidence" <<< "$_WCODE" \
  || fail "completeTask 仍在整体覆盖 evidence —— 会把 startTask 存的 brain_task_id 抹掉,收尾和 sweep 都将找不到它"
grep -q "RETURNING id, evidence" <<< "$_WCODE" \
  || fail "sweepExpiredLeases 没取 evidence —— 拿不到 brain_task_id,Brain 侧会永远挂 in_progress 并占住 dedup 槽位"

C="services/phone-adb-controller/device-job-claimer.sh"
grep -vE '^[[:space:]]*#' "$C" | grep -q 'wr start .*JOB_ID' \
  || fail "device-job-claimer 没把 JOB_ID 传给 wr start —— 每条真派单都会再镜像一条,页面重复计数"

echo "✅ brain-device-job-mirror-smoke 全部通过"
```

- [ ] **Step 2: 变异测试（proven-to-fire，必须亲眼看它报红）**

```bash
cp apps/api/src/services/brain-device-job-mirror.ts /tmp/m.bak
sm(){ bash .github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh >/dev/null 2>&1 && echo "PASS(没拦住)" || echo "FAIL(拦住了 ✅)"; }
echo "基线                  → $(sm)"
python3 -c "
p='apps/api/src/services/brain-device-job-mirror.ts'
s=open(p,encoding='utf-8').read()
open(p,'w',encoding='utf-8').write(s.replace('read_only: true','read_only: false',1))"
echo "变异1 去掉 read_only  → $(sm)"; cp /tmp/m.bak apps/api/src/services/brain-device-job-mirror.ts
python3 -c "
p='apps/api/src/services/brain-device-job-mirror.ts'
s=open(p,encoding='utf-8').read()
open(p,'w',encoding='utf-8').write(s.replace(\"source: 'cron'\",\"source: 'oneoff'\",1))"
echo "变异2 source→oneoff   → $(sm)"; cp /tmp/m.bak apps/api/src/services/brain-device-job-mirror.ts
python3 -c "
p='apps/api/src/services/brain-device-job-mirror.ts'
s=open(p,encoding='utf-8').read()
open(p,'w',encoding='utf-8').write(s.replace('slice(-4)','slice(0,0)',1))"
echo "变异3 title 去区分位  → $(sm)"; cp /tmp/m.bak apps/api/src/services/brain-device-job-mirror.ts
echo "还原后                → $(sm)"
```

Expected: 基线 PASS，三条变异全 FAIL，还原后 PASS。任何一条变异 PASS = 守卫没守住，回去改守卫。

- [ ] **Step 3: 接进 CI 基线**

基线清单是 `.github/workflows/scripts/smoke-baseline.txt`，一行一个文件名
（`phone-adb-controller-smoke.sh` 在第 44 行）。追加一行：

```bash
echo 'brain-device-job-mirror-smoke.sh' >> .github/workflows/scripts/smoke-baseline.txt
sort -o .github/workflows/scripts/smoke-baseline.txt .github/workflows/scripts/smoke-baseline.txt
grep -n 'brain-device-job-mirror' .github/workflows/scripts/smoke-baseline.txt
```

Expected: 输出含该行。**不在基线里 = 不阻断合并 = 等于没守卫。**

- [ ] **Step 4: 全量跑一次**

Run: `cd apps/api && npx vitest run src/services/__tests__ src/routes/__tests__`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/scripts/smoke/brain-device-job-mirror-smoke.sh
git commit -m "test(smoke): 桥接四条命门守卫,四变异全拦"
```

---

## 上机验收（合并后当晚）

1. 分发：`bash services/phone-adb-controller/deploy.sh`，确认 `wall-report.sh` / `device-job-claimer.sh` 两台机都更新
2. 判活证据用**日志出现新行**，不是 "scp 成功"
3. 夜批跑完后查：

```sql
-- Brain 库
SELECT title, status, due_at, payload->>'serial'
FROM tasks WHERE task_type='device_job'
  AND assigned_to IN ('e78461d8-8c1c-47ba-9dcc-8ffa497b570a','84979aba-fc11-40ee-be91-fbc0f236be8f')
  AND created_at > NOW() - INTERVAL '1 day' ORDER BY created_at DESC;
```

4. 打开工作机页，金诺两台应显示当天批次；触达单也显示且**没有**改时间/取消按钮
5. 查 outbox 有没有积压：`SELECT op, count(*) FROM zenithjoy.brain_sync_outbox GROUP BY 1`

## 已知既有问题（不是本次引入，别误判）

`worker_tasks` 里采收批次存在 `executor_lost`（12~19 分钟的批次租约续期不稳被判执行器失联），
7 天 25 条 failed 中占多数。桥接后 Brain 侧会同样显示 failed。本刀不修，交接单需写明。
