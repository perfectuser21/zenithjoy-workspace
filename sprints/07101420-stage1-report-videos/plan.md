# Stage1 视频清单回报端点 + 服务端终态结算 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补上两阶段采集协议缺失的 Stage1 清单回报端点，并把终态判定收敛进服务端纯函数 `settleCollectTask`，修掉 cancelled 永不落章 bug。

**Architecture:** 新端点 `POST /api/acquisition/collect/report-videos`（幂等可重入、鉴权、事务）；纯函数 `settleCollectTask` 统一 done/partial/failed/cancelled 结算，report / report-videos / sweep-timeouts 三处共用；migration 把 `acquisition_collect_videos` 主键改 (task_id, video_id) 并加 `comments_reported_at`。

**Tech Stack:** Express + pg（裸 SQL）、vitest（`vi.mock('../db/connection')` 模式）、bash smoke。

**设计 spec:** `sprints/07101420-stage1-report-videos/design.md`（Research Subagent 已 APPROVE，修正点已并入）

## Global Constraints

- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 task commit 顺序 = commit-1 failing test / commit-2 impl。
- 所有输出简体中文；commit message 尾部带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 旧 `/collect/report` **不加鉴权**（在网 agent 会断）；其终态守卫返回 **200 + `ignored:true`**（非 409，防老 agent 死循环重试）。新端点才用 403/409。
- 事务内一律用同一个 client（含 `rescoreLead(client, ...)`）；SSE 与 dispatch 链放 COMMIT 之后。
- 测试命令：`cd apps/api && npx vitest run <文件>`（CI 同 vitest）。
- 范围外：安卓端多视频循环、dispatch 链内部逻辑。

---

### Task 1: `settleCollectTask` 纯函数

**Files:**
- Modify: `apps/api/src/services/acquisition-collect.ts`（文件尾追加）
- Test: `apps/api/src/services/acquisition-collect.test.ts`（追加 describe）

**Interfaces:**
- Produces（后续 Task 3/4/6 依赖，签名必须一字不差）：

```ts
export const TERMINAL_COLLECT_STATUSES = ['done', 'partial', 'failed', 'cancelled'] as const;

export interface SettleInput {
  currentStatus: string;            // 任务当前 status（pending 调用方先归一成 running）
  agentTerminal?: TerminalReport | null; // agent 声称的终态（可无）
  videoTotal: number;               // 该任务 acquisition_collect_videos 总数
  videoDone: number;                // 其中 comments_reported_at 非空数
  leadCount: number;                // 该任务累计 leads 数（sweep 用）
}

export interface SettleResult {
  status: CollectStatus;
  error_code: string | null;
  changed: boolean;                 // true = 本次调用把任务推进了状态
}

export function settleCollectTask(input: SettleInput): SettleResult;
```

- [ ] **Step 1: 写 failing test**（追加到 `acquisition-collect.test.ts`）

```ts
import { settleCollectTask } from './acquisition-collect';

describe('settleCollectTask — 服务端终态结算 [BEHAVIOR]', () => {
  it('已终态 → changed=false 原样返回（终态守卫）', () => {
    for (const s of ['done', 'partial', 'failed', 'cancelled']) {
      const r = settleCollectTask({ currentStatus: s, videoTotal: 3, videoDone: 3, leadCount: 5 });
      expect(r).toEqual({ status: s, error_code: null, changed: false });
    }
  });

  it('cancelling → cancelled 落章（修 cancelled 永不落章 bug）', () => {
    const r = settleCollectTask({ currentStatus: 'cancelling', agentTerminal: { terminal: 'done' }, videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'cancelled', error_code: null, changed: true });
  });

  it('agent 报 failed → failed + error_code 字面落库', () => {
    const r = settleCollectTask({ currentStatus: 'running', agentTerminal: { terminal: 'failed', error_code: 'DOUYIN_RISK' }, videoTotal: 3, videoDone: 1, leadCount: 0 });
    expect(r).toEqual({ status: 'failed', error_code: 'DOUYIN_RISK', changed: true });
  });

  it('agent 报 done 且全部视频完成 → done', () => {
    const r = settleCollectTask({ currentStatus: 'stage_1_done', agentTerminal: { terminal: 'done' }, videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'done', error_code: null, changed: true });
  });

  it('agent 报 done 但视频未收全 → 诚实结算 partial', () => {
    const r = settleCollectTask({ currentStatus: 'stage_1_done', agentTerminal: { terminal: 'done' }, videoTotal: 3, videoDone: 1, leadCount: 5 });
    expect(r.status).toBe('partial');
    expect(r.error_code).toBe('videos_incomplete');
    expect(r.changed).toBe(true);
  });

  it('agent 报 partial → partial + partial_reason 优先', () => {
    const r = settleCollectTask({ currentStatus: 'running', agentTerminal: { terminal: 'partial', partial_reason: 'comments_closed' }, videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'partial', error_code: 'comments_closed', changed: true });
  });

  it('无 terminal 且 stage_1_done 全部视频完成 → 服务端自动 done', () => {
    const r = settleCollectTask({ currentStatus: 'stage_1_done', videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'done', error_code: null, changed: true });
  });

  it('无 terminal 且 running（Stage1 清单未报，逐视频自然 total==done）→ 不自动结算', () => {
    const r = settleCollectTask({ currentStatus: 'running', videoTotal: 1, videoDone: 1, leadCount: 2 });
    expect(r.changed).toBe(false);
    expect(r.status).toBe('running');
  });

  it("旧 agent 报 terminal:'stage_1'（非标准值）→ stage_1_done（向后兼容）", () => {
    const r = settleCollectTask({ currentStatus: 'running', agentTerminal: { terminal: 'stage_1' }, videoTotal: 1, videoDone: 0, leadCount: 0 });
    expect(r).toEqual({ status: 'stage_1_done', error_code: null, changed: true });
  });
});
```

- [ ] **Step 2: 跑测确认 FAIL**

Run: `cd apps/api && npx vitest run src/services/acquisition-collect.test.ts`
Expected: FAIL，报 `settleCollectTask` is not exported / not a function。

- [ ] **Step 3: commit-1 failing test**

```bash
git add apps/api/src/services/acquisition-collect.test.ts
git commit -m "test: settleCollectTask 终态结算纯函数 failing test

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 最小实现**（`acquisition-collect.ts` 文件尾追加）

```ts
/** 终态集合（cancelling 不是终态，是待落章）。 */
export const TERMINAL_COLLECT_STATUSES = ['done', 'partial', 'failed', 'cancelled'] as const;

export interface SettleInput {
  currentStatus: string;
  agentTerminal?: TerminalReport | null;
  videoTotal: number;
  videoDone: number;
  leadCount: number;
}

export interface SettleResult {
  status: CollectStatus;
  error_code: string | null;
  changed: boolean;
}

/**
 * 服务端终态结算（纯函数，report / report-videos / sweep-timeouts 三处共用）：
 *  - 已终态 → changed=false（终态守卫，杜绝二次结算/二次点火）
 *  - cancelling → cancelled（唯一落章路径，修「全 repo 无人写 cancelled」bug）
 *  - agent 报 failed → failed + error_code 字面落库
 *  - agent 报 done：视频全完成 → done；未收全 → 诚实结算 partial(videos_incomplete)
 *  - agent 报 partial → partial（partial_reason 优先）
 *  - 无 terminal：仅当 stage_1_done 且清单全完成才自动 done（running 阶段 total==done 是
 *    逐视频回报的自然态，不能据此结算）
 *  - 其他非标准 terminal（如旧 agent 的 'stage_1'）→ stage_1_done（向后兼容）
 */
export function settleCollectTask(input: SettleInput): SettleResult {
  const cur = input.currentStatus as CollectStatus;
  if ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(cur)) {
    return { status: cur, error_code: null, changed: false };
  }
  if (cur === 'cancelling') {
    return { status: 'cancelled', error_code: null, changed: true };
  }
  const t = input.agentTerminal;
  const allDone = input.videoTotal > 0 && input.videoDone >= input.videoTotal;
  if (t?.terminal === 'failed') {
    return { status: 'failed', error_code: t.error_code ?? null, changed: true };
  }
  if (t?.terminal === 'done') {
    return allDone
      ? { status: 'done', error_code: null, changed: true }
      : { status: 'partial', error_code: t.partial_reason ?? 'videos_incomplete', changed: true };
  }
  if (t?.terminal === 'partial') {
    return { status: 'partial', error_code: t.partial_reason ?? t.error_code ?? null, changed: true };
  }
  if (t?.terminal) {
    // 非标准值（旧 agent 'stage_1'）→ stage_1_done，与 resolveTerminalStatus 兜底一致
    return { status: 'stage_1_done', error_code: null, changed: cur !== 'stage_1_done' };
  }
  if (cur === 'stage_1_done' && allDone) {
    return { status: 'done', error_code: null, changed: true };
  }
  return { status: cur, error_code: null, changed: false };
}
```

- [ ] **Step 5: 跑测确认 PASS**

Run: `cd apps/api && npx vitest run src/services/acquisition-collect.test.ts`
Expected: 全绿。

- [ ] **Step 6: commit-2 impl**

```bash
git add apps/api/src/services/acquisition-collect.ts
git commit -m "feat: settleCollectTask 服务端终态结算纯函数（含 cancelling→cancelled 落章）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — 复合主键 + comments_reported_at

**Files:**
- Create: `apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql`

**Interfaces:**
- Produces：`acquisition_collect_videos` 主键 (task_id, video_id)；新列 `comments_reported_at timestamptz`（NULL=Stage2 未回报）。Task 3/4/5 的 SQL 依赖两者。

（migration 无 vitest；正确性由 Task 3/4 路由测试的 SQL 断言 + smoke 兜底。）

- [ ] **Step 1: 写 migration 文件**

```sql
-- apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql
-- 多视频协议闭环 PR1-2（Brain task 4fad361c）：
-- 1. 主键 video_id → (task_id, video_id)：旧全局唯一键会让同一抖音视频被两个任务命中时互相覆盖。
--    全库无 FK 引用本表（20260702 migration 是唯一 DDL），无数据清洗前置（旧单列 PK 保证无跨 task 重复）。
-- 2. comments_reported_at：Stage2 评论回报完成标记（NULL=未完成），pending-collect-tasks 只下发未完成视频，
--    settleCollectTask 据 count(comments_reported_at) 结算终态。
-- 生产落地：hk-vps + mmv 两台独立 postgres 各跑一遍（死规则）。

ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS comments_reported_at timestamptz;

DO $$
DECLARE
  pk_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO pk_cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
   WHERE n.nspname = 'zenithjoy' AND t.relname = 'acquisition_collect_videos' AND c.contype = 'p';

  IF pk_cols IS DISTINCT FROM 'task_id,video_id' THEN
    ALTER TABLE zenithjoy.acquisition_collect_videos DROP CONSTRAINT IF EXISTS acquisition_collect_videos_pkey;
    ALTER TABLE zenithjoy.acquisition_collect_videos ADD PRIMARY KEY (task_id, video_id);
  END IF;
END $$;

COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.comments_reported_at IS
  'Stage2 评论回报完成时间（NULL=未完成）；pending-collect-tasks 只下发 NULL 的视频';
```

- [ ] **Step 2: 本地验证 SQL 语法**（有本地 postgres 时；无则跳过，CI migration job 兜底）

Run: `psql "$DATABASE_URL" -f apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql`（在测试库跑两遍验证幂等）
Expected: 两遍均无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql
git commit -m "feat: acquisition_collect_videos 复合主键(task_id,video_id) + comments_reported_at 列

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 新端点 `POST /collect/report-videos`

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`（`/collect/report` 前插入新 handler；顶部 import 增加 `settleCollectTask`、`TERMINAL_COLLECT_STATUSES`）
- Test: `apps/api/src/routes/acquisition.test.ts`（顶部 db mock 增加 `connect`；追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `settleCollectTask` / `TERMINAL_COLLECT_STATUSES`；Task 2 的 `ON CONFLICT (task_id, video_id)` 与 `comments_reported_at`。
- Produces: 端点契约（Task 7 契约文档照此写）：
  - 请求：`POST /api/acquisition/collect/report-videos`，header `x-agent-id` 必带；body `{task_id, videos?: [{video_id, keyword?, title?, thumbnail_url?, publish_date?}], reason?: {search_result?: 'empty', error_code?: string}}`（video 条目的 `keyword` 仅供观测，服务端暂不落库）。
  - 响应：200 `{task_id, status, video_count, accepted}`；400 缺 task_id / 空清单无 reason；401 缺 x-agent-id；403 agent 未注册或与任务绑定不符；404 任务不存在（含跨租户）；409 任务已终态。
  - 幂等：重复回报同一清单 → 同结果，video_count 不变。

- [ ] **Step 1: 扩 db mock**（`acquisition.test.ts` 顶部现有 `vi.mock('../db/connection', ...)` 改为）

```ts
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
vi.mock('../db/connection', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(async () => ({ query: mockClientQuery, release: mockClientRelease })),
  },
}));
```

（`mockClientQuery`/`mockClientRelease` 声明必须在 `vi.mock` 之前、文件顶部，供各 describe 复用。改完先整文件跑一遍确认存量测试不受影响。）

- [ ] **Step 2: 写 failing test**（追加 describe）

```ts
describe('POST /api/acquisition/collect/report-videos — Stage1 清单回报 [BEHAVIOR]', () => {
  const TASK_ID = '00000000-0000-0000-0000-00000000c001';
  const TENANT = '00000000-0000-0000-0000-0000000000aa';

  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    // pool.query 第一击：agents 反查 tenant
    vi.mocked(db.query).mockResolvedValue({ rows: [{ tenant_id: TENANT }] } as any);
    // client 默认行为：BEGIN/COMMIT/UPSERT 成功；FOR UPDATE 返回 running 任务；count 返回 2
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: TASK_ID, tenant_id: TENANT, status: 'running', agent_id: 'agent-1', lead_count_raw: 0 }] };
      }
      if (s.includes('count(*)')) return { rows: [{ total: 2 }] };
      return { rows: [] };
    });
  });

  it('缺 x-agent-id → 401', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos').send({ task_id: TASK_ID, videos: [{ video_id: 'v1' }] });
    expect(res.status).toBe(401);
  });

  it('agent 与任务绑定不符 → 403', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) return { rows: [{ id: TASK_ID, tenant_id: TENANT, status: 'running', agent_id: 'agent-OTHER', lead_count_raw: 0 }] };
      return { rows: [] };
    });
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1').send({ task_id: TASK_ID, videos: [{ video_id: 'v1' }] });
    expect(res.status).toBe(403);
  });

  it('空清单无 reason → 400', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1').send({ task_id: TASK_ID, videos: [] });
    expect(res.status).toBe(400);
  });

  it('清单回报 → upsert (task_id,video_id) + status=stage_1_done + video_count 重算', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [{ video_id: 'v1' }, { video_id: 'v2', title: 't2' }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stage_1_done');
    expect(res.body.video_count).toBe(2);
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes('ON CONFLICT (task_id, video_id)'))).toBe(true);
    const upd = calls.find((s) => s.includes('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(upd).toMatch(/stage_1_done/);
    expect(calls.some((s) => s === 'COMMIT')).toBe(true);
  });

  it('空清单 + search_result=empty → partial 终态', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { search_result: 'empty' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('partial');
  });

  it('空清单 + error_code → failed 终态', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'DOUYIN_RISK' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
  });

  it('任务已终态 → 409', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) return { rows: [{ id: TASK_ID, tenant_id: TENANT, status: 'done', agent_id: 'agent-1', lead_count_raw: 3 }] };
      return { rows: [] };
    });
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1').send({ task_id: TASK_ID, videos: [{ video_id: 'v1' }] });
    expect(res.status).toBe(409);
  });

  it('cancelling 任务回报 → 落章 cancelled', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) return { rows: [{ id: TASK_ID, tenant_id: TENANT, status: 'cancelling', agent_id: 'agent-1', lead_count_raw: 3 }] };
      return { rows: [] };
    });
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1').send({ task_id: TASK_ID, videos: [{ video_id: 'v1' }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const upd = mockClientQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes("'cancelled'") || s.includes('cancelled'));
    expect(upd).toBeTruthy();
  });
});
```

（`request`/`app`/`db` 沿用文件里已有的 import 与初始化方式，照现有 describe 抄。）

- [ ] **Step 3: 跑测确认 FAIL**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 新 describe 全 FAIL（404 路由不存在）；存量测试仍绿（只加了 connect mock）。

- [ ] **Step 4: commit-1 failing test**

```bash
git add apps/api/src/routes/acquisition.test.ts
git commit -m "test: collect/report-videos Stage1 清单回报端点 failing tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 实现端点**（`acquisition.ts`，插在 `POST /collect/report` handler 之前；import 行改为 `import { SWEEP_TIMEOUT_MS, profileUrlForSecUid, resolveTerminalStatus, settleCollectTask, TERMINAL_COLLECT_STATUSES } from '../services/acquisition-collect';`）

```ts
// POST /api/acquisition/collect/report-videos — Stage1 视频清单回报（幂等可重入）
// 鉴权：x-agent-id 反查 tenant → 任务按 (id, tenant_id) 查 → agent 绑定校验。
// 幂等：ON CONFLICT (task_id, video_id) + video_count 按 distinct 重算，重复回报同结果不重计数。
acquisitionRouter.post('/collect/report-videos', async (req: Request, res: Response) => {
  const { task_id: taskId, videos, reason } = req.body || {};
  if (!taskId) return fail(res, 400, 'MISSING_TASK_ID', '缺 task_id');

  const xAgentId = req.header('x-agent-id') ?? '';
  if (!xAgentId) return fail(res, 401, 'MISSING_AGENT_ID', '缺 x-agent-id');
  const agentRes = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM zenithjoy.agents WHERE agent_id = $1 LIMIT 1`,
    [xAgentId]
  );
  const tenantId = agentRes.rows[0]?.tenant_id;
  if (!tenantId) return fail(res, 403, 'UNKNOWN_AGENT', 'agent 未注册');

  const list: Array<{ video_id: string; title?: string; thumbnail_url?: string; publish_date?: string }> =
    Array.isArray(videos) ? videos.filter((v) => v && v.video_id) : [];
  const searchEmpty = reason?.search_result === 'empty';
  const reasonErrorCode: string | null = reason?.error_code ?? null;
  if (list.length === 0 && !searchEmpty && !reasonErrorCode) {
    return fail(res, 400, 'MISSING_REASON', '空清单必须带 reason（search_result=empty 或 error_code）');
  }

  const client = await pool.connect();
  let sseEvent: { terminal: boolean; payload: Record<string, unknown> } | null = null;
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(
      `SELECT id, tenant_id, status, agent_id, lead_count_raw
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [taskId, tenantId]
    );
    if (taskRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'NO_COLLECT_TASK', '采集任务不存在');
    }
    const task = taskRes.rows[0] as { id: string; status: string; agent_id: string | null; lead_count_raw: number };
    if (task.agent_id && task.agent_id !== xAgentId) {
      await client.query('ROLLBACK');
      return fail(res, 403, 'AGENT_MISMATCH', '任务已绑定其他 agent');
    }
    if ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(task.status)) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'TASK_TERMINAL', `任务已终态 ${task.status}`);
    }
    if (task.status === 'cancelling') {
      // 唯一落章路径：cancelling → cancelled（settleCollectTask 语义）
      const s = settleCollectTask({ currentStatus: 'cancelling', videoTotal: 0, videoDone: 0, leadCount: task.lead_count_raw });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status]
      );
      await client.query('COMMIT');
      sseService.close(taskId, { task_id: taskId, status: s.status });
      return ok(res, { task_id: taskId, status: s.status, video_count: 0, accepted: 0 });
    }

    if (list.length === 0) {
      // 空清单终态：empty → partial(stage1_empty)；error_code → failed（checkpoint 保留可重试）
      const s = settleCollectTask({
        currentStatus: task.status === 'pending' ? 'running' : task.status,
        agentTerminal: searchEmpty
          ? { terminal: 'partial', partial_reason: 'stage1_empty' }
          : { terminal: 'failed', error_code: reasonErrorCode },
        videoTotal: 0,
        videoDone: 0,
        leadCount: task.lead_count_raw,
      });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, error_code = $3, started_at = COALESCE(started_at, NOW()),
                ended_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status, s.error_code]
      );
      await client.query('COMMIT');
      sseService.close(taskId, { task_id: taskId, status: s.status, video_count: 0 });
      return ok(res, { task_id: taskId, status: s.status, video_count: 0, accepted: 0 });
    }

    for (const v of list) {
      await client.query(
        `INSERT INTO zenithjoy.acquisition_collect_videos
           (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count)
         VALUES ($1, $2, $3, $4, $5, $6, 0)
         ON CONFLICT (task_id, video_id) DO UPDATE
           SET title         = COALESCE(EXCLUDED.title, zenithjoy.acquisition_collect_videos.title),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, zenithjoy.acquisition_collect_videos.thumbnail_url),
               publish_date  = COALESCE(EXCLUDED.publish_date, zenithjoy.acquisition_collect_videos.publish_date),
               updated_at    = NOW()`,
        [v.video_id, taskId, tenantId, v.title ?? null, v.thumbnail_url ?? null, v.publish_date ?? null]
      );
    }
    const vcRes = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1`,
      [taskId]
    );
    const total = vcRes.rows[0]?.total ?? list.length;
    await client.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status = 'stage_1_done', agent_id = COALESCE(agent_id, $2), video_count = $3,
              started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $1`,
      [taskId, xAgentId, total]
    );
    await client.query('COMMIT');
    sseEvent = { terminal: false, payload: { task_id: taskId, status: 'stage_1_done', video_count: total } };
    return ok(res, { task_id: taskId, status: 'stage_1_done', video_count: total, accepted: list.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  } finally {
    client.release();
    if (sseEvent) sseService.emit(taskId, sseEvent.payload);
  }
});
```

- [ ] **Step 6: 跑测确认 PASS**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 新旧全绿。

- [ ] **Step 7: commit-2 impl**

```bash
git add apps/api/src/routes/acquisition.ts
git commit -m "feat: POST /collect/report-videos Stage1 清单回报端点（鉴权+幂等+事务+空清单终态）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 重写 `POST /collect/report`（事务 + 终态守卫 + settle + 联动）

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:869-1085`（整个 handler 重写）
- Test: `apps/api/src/routes/acquisition.test.ts`（追加 describe；存量 `collect/report` 相关 describe 需按新 mock 形态调整——它们原先 mock `db.query`，现在 handler 用事务 client，需把任务查询/写入挪到 `mockClientQuery` 上）

**Interfaces:**
- Consumes: Task 1 `settleCollectTask`；Task 2 复合键与 `comments_reported_at`。
- Produces: 行为契约——终态任务回报 → 200 `{task_id, ignored: true, status}` 零写库；`video_count` 改为按 distinct 重算；回报即打 `comments_reported_at`；dispatch 只在本次真进终态且任务有 leads 时点火。

- [ ] **Step 1: 写 failing test**（追加 describe）

```ts
describe('POST /api/acquisition/collect/report — 终态守卫 + settle 结算 [BEHAVIOR]', () => {
  const TASK_ID = '00000000-0000-0000-0000-00000000c002';
  const TENANT = '00000000-0000-0000-0000-0000000000aa';

  const taskRow = (over: Record<string, unknown> = {}) => ({
    id: TASK_ID, tenant_id: TENANT, status: 'running', error_code: null,
    video_count: 0, lead_count_raw: 0, keywords: ['k1'], ...over,
  });

  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    vi.mocked(scoreLeads).mockClear();
  });

  const clientImpl = (row: Record<string, unknown>, videoStats = { total: 1, done: 1 }) =>
    async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) return { rows: [row] };
      if (s.includes('count(*)')) return { rows: [{ total: videoStats.total, done: videoStats.done }] };
      if (s.includes('INSERT INTO zenithjoy.acquisition_leads') && s.includes('RETURNING')) return { rows: [{ id: 'lead-1' }] };
      return { rows: [] };
    };

  it('终态任务回报 → 200 ignored:true，零写库', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'done' })));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(res.body.status).toBe('done');
    const writes = mockClientQuery.mock.calls.map((c) => String(c[0]))
      .filter((s) => s.startsWith('INSERT') || s.startsWith('UPDATE'));
    expect(writes).toHaveLength(0);
  });

  it('cancelling 任务回报 → 落章 cancelled，不写 leads', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'cancelling' })));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const leadWrites = mockClientQuery.mock.calls.map((c) => String(c[0]))
      .filter((s) => s.includes('acquisition_leads'));
    expect(leadWrites).toHaveLength(0);
  });

  it('回报 upsert 用 (task_id, video_id) 并打 comments_reported_at', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [] });
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const upsert = calls.find((s) => s.includes('acquisition_collect_videos'));
    expect(upsert).toMatch(/ON CONFLICT \(task_id, video_id\)/);
    expect(upsert).toMatch(/comments_reported_at/);
  });

  it('倒推逻辑已删：running 任务非终态回报不再因计数推进 stage_1_done', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ video_count: 2, keywords: ['k1'] }), { total: 3, done: 3 }));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v3', commenters: [] });
    expect(res.body.status).toBe('running');
  });

  it('stage_1_done 最后一个视频回完（无 terminal）→ 服务端自动 done + dispatch 点火一次', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'stage_1_done', lead_count_raw: 4 }), { total: 2, done: 2 }));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v2', commenters: [{ nickname: 'n9' }] });
    expect(res.body.status).toBe('done');
    expect(vi.mocked(scoreLeads)).toHaveBeenCalledTimes(1);
  });

  it('未进终态的回报不点火 dispatch', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'stage_1_done' }), { total: 3, done: 1 }));
    await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    expect(vi.mocked(scoreLeads)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测确认 FAIL**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 新 describe FAIL（现实现无 ignored / 无事务 client / 有倒推逻辑）。

- [ ] **Step 3: commit-1 failing test**

```bash
git add apps/api/src/routes/acquisition.test.ts
git commit -m "test: collect/report 终态守卫+settle 结算 failing tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 重写 handler**（替换 acquisition.ts:869-1085 整段；保持既有 400 校验与响应字段兼容）

```ts
// POST /api/acquisition/collect/report — 客户机 Agent 增量回报（无需 smoke token，agent 直接调用；
// 不加鉴权：在网旧 agent 会断。终态守卫返回 200+ignored（非 409，防旧 agent 对非 200 死循环重试）。
acquisitionRouter.post('/collect/report', async (req: Request, res: Response) => {
  const {
    task_id: taskId,
    keyword,
    video_id: videoId,
    commenters,
    checkpoint,
    partial_reason: partialReason,
    terminal,
    error_code: errorCode,
    video_title: videoTitle,
    thumbnail_url: thumbnailUrl,
    publish_date: publishDate,
  } = req.body || {};

  if (!taskId) return fail(res, 400, 'MISSING_TASK_ID', '缺 task_id');
  if (!videoId) return fail(res, 400, 'MISSING_VIDEO_ID', '缺 video_id');

  const batch: Array<{ sec_uid?: string | null; nickname: string; comment_text?: string; grade?: string; keyword?: string }> =
    Array.isArray(commenters) ? commenters : [];

  const client = await pool.connect();
  // COMMIT 后才发的副作用（SSE / dispatch），事务内只记录不执行
  let afterCommit: (() => void) | null = null;
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(
      `SELECT id, tenant_id, status, error_code, video_count, lead_count_raw, keywords
         FROM zenithjoy.acquisition_collect_tasks WHERE id = $1
         FOR UPDATE`,
      [taskId]
    );
    if (taskRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'NO_COLLECT_TASK', '采集任务不存在');
    }
    const task = taskRes.rows[0] as {
      id: string; tenant_id: string; status: string; error_code: string | null;
      video_count: number; lead_count_raw: number; keywords: string[] | null;
    };
    const tenantId = task.tenant_id;

    // ── 终态守卫：终态任务回报 → 200 + ignored，零写库 ──
    if ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(task.status)) {
      await client.query('ROLLBACK');
      return ok(res, { task_id: taskId, ignored: true, status: task.status });
    }
    // ── cancelling → 落章 cancelled（唯一落章路径），不再写数据 ──
    if (task.status === 'cancelling') {
      const s = settleCollectTask({ currentStatus: 'cancelling', videoTotal: 0, videoDone: 0, leadCount: task.lead_count_raw });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status]
      );
      await client.query('COMMIT');
      sseService.close(taskId, { task_id: taskId, status: s.status });
      return ok(res, { task_id: taskId, ignored: true, status: s.status });
    }

    // ── 去重落库：先处理 commenters（已抓先落库不丢，即使本次是终态回报）──
    let inserted = 0;
    let deduped = 0;
    const seenSec = new Set<string>();
    const seenNick = new Set<string>();

    for (const c of batch) {
      const secUid = c.sec_uid ?? null;
      let matchId: string | null = null;
      if (secUid) {
        if (seenSec.has(secUid)) matchId = 'batch';
        else {
          const found = await client.query(
            `SELECT id FROM zenithjoy.acquisition_leads WHERE tenant_id = $1 AND sec_uid = $2 LIMIT 1`,
            [tenantId, secUid]
          );
          if (found.rows.length > 0) matchId = found.rows[0].id;
        }
      } else {
        if (seenNick.has(c.nickname)) matchId = 'batch';
        else {
          const found = await client.query(
            `SELECT id FROM zenithjoy.acquisition_leads
               WHERE tenant_id = $1 AND sec_uid IS NULL AND nickname = $2 LIMIT 1`,
            [tenantId, c.nickname]
          );
          if (found.rows.length > 0) matchId = found.rows[0].id;
        }
      }

      if (matchId) {
        deduped += 1;
        if (matchId !== 'batch') {
          await client.query(
            `UPDATE zenithjoy.acquisition_leads
                SET source_video_ids = CASE
                      WHEN source_video_ids ? $2 THEN source_video_ids
                      ELSE source_video_ids || to_jsonb($2::text)
                    END,
                    updated_at = NOW()
              WHERE id = $1`,
            [matchId, videoId]
          );
          await client.query(
            `INSERT INTO zenithjoy.acquisition_lead_comments
               (lead_id, video_id, comment_text, grade, commented_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [matchId, videoId, c.comment_text ?? null, c.grade ?? null]
          );
          await rescoreLead(client, tenantId, matchId); // 事务内传 client，别传 pool（读不到未提交数据）
        }
        continue;
      }

      inserted += 1;
      if (secUid) seenSec.add(secUid);
      else seenNick.add(c.nickname);
      const insRes = await client.query(
        `INSERT INTO zenithjoy.acquisition_leads
           (tenant_id, collect_task_id, sec_uid, nickname, profile_url, partial, source_video_ids,
            comment_text, grade, keyword, feishu_write_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'local_only')
         RETURNING id`,
        [tenantId, taskId, secUid, c.nickname, profileUrlForSecUid(secUid), !secUid,
         JSON.stringify([videoId]), c.comment_text ?? null, c.grade ?? null, c.keyword ?? keyword ?? null]
      );
      const newLeadId = insRes.rows[0].id as string;
      await client.query(
        `INSERT INTO zenithjoy.acquisition_lead_comments
           (lead_id, video_id, comment_text, grade, commented_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [newLeadId, videoId, c.comment_text ?? null, c.grade ?? null]
      );
      await rescoreLead(client, tenantId, newLeadId);
    }

    // ── 视频维度：upsert (task_id, video_id) + 打 Stage2 完成标记 ──
    await client.query(
      `INSERT INTO zenithjoy.acquisition_collect_videos
         (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count, comments_reported_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (task_id, video_id) DO UPDATE
         SET comment_count        = zenithjoy.acquisition_collect_videos.comment_count + EXCLUDED.comment_count,
             title                = COALESCE(EXCLUDED.title, zenithjoy.acquisition_collect_videos.title),
             thumbnail_url        = COALESCE(EXCLUDED.thumbnail_url, zenithjoy.acquisition_collect_videos.thumbnail_url),
             publish_date         = COALESCE(EXCLUDED.publish_date, zenithjoy.acquisition_collect_videos.publish_date),
             comments_reported_at = NOW(),
             updated_at           = NOW()`,
      [videoId, taskId, tenantId, videoTitle ?? null, thumbnailUrl ?? null, publishDate ?? null, batch.length]
    );

    // ── 计数重算 + settle 结算（倒推逻辑已删，Stage1 推进只走 report-videos）──
    const vcRes = await client.query<{ total: number; done: number }>(
      `SELECT count(*)::int AS total, count(comments_reported_at)::int AS done
         FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1`,
      [taskId]
    );
    const videoTotal = vcRes.rows[0]?.total ?? 0;
    const videoDone = vcRes.rows[0]?.done ?? 0;
    const leadCountAfter = task.lead_count_raw + batch.length;
    const s = settleCollectTask({
      currentStatus: task.status === 'pending' ? 'running' : task.status,
      agentTerminal: terminal ? { terminal, error_code: errorCode, partial_reason: partialReason } : null,
      videoTotal,
      videoDone,
      leadCount: leadCountAfter,
    });
    const newStatus = s.changed ? s.status : (task.status === 'pending' ? 'running' : task.status);
    const newErrorCode = s.changed ? s.error_code : task.error_code;
    const isTerminal = (TERMINAL_COLLECT_STATUSES as readonly string[]).includes(newStatus);

    await client.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status         = $2,
              error_code     = $3,
              video_count    = $4,
              lead_count_raw = lead_count_raw + $5,
              checkpoint     = COALESCE($6::jsonb, checkpoint),
              started_at     = COALESCE(started_at, NOW()),
              ended_at       = CASE WHEN $7 THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
              updated_at     = NOW()
        WHERE id = $1`,
      [taskId, newStatus, newErrorCode, videoTotal, batch.length,
       checkpoint ? JSON.stringify(checkpoint) : null, isTerminal]
    );
    await client.query('COMMIT');

    // ── COMMIT 之后：SSE + dispatch（只在本次真进终态且任务有 leads 时点火一次）──
    afterCommit = () => {
      const ssePayload = { task_id: taskId, status: newStatus, video_count: videoTotal, lead_count_raw: leadCountAfter };
      if (isTerminal) sseService.close(taskId, ssePayload);
      else sseService.emit(taskId, ssePayload);
      if (s.changed && isTerminal && leadCountAfter > 0) {
        void scoreLeads(pool, tenantId)
          .then(() => buildAssignments(pool, tenantId))
          .then(() => dispatchDue(pool, tenantId))
          .catch((e: Error) => console.error('[acquisition] collect/report dm-dispatch error:', e.message));
      }
    };

    return ok(res, {
      task_id: taskId,
      inserted,
      deduped,
      lead_write_status: 'local_only',
      status: newStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  } finally {
    client.release();
    if (afterCommit) afterCommit();
  }
});
```

同时删掉 handler 内已不存在的 `MAX_VIDEOS_PER_KEYWORD` 及相关注释（倒推逻辑整段随重写消失）。

- [ ] **Step 5: 修存量 collect/report 相关旧测试**

存量 describe（`collect/report — 无需 smoke token [REGRESSION: Bug-D]` 等）原先把任务查询 mock 在 `db.query` 上；逐个改为 mock 在 `mockClientQuery` 上（FOR UPDATE 返回任务行、count 返回 `{total, done}`），断言不变。**行为兼容性断言（400 校验、inserted/deduped 计数、dedup 累加 source_video_ids）必须全部保留原语义。**

- [ ] **Step 6: 跑测确认 PASS**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全绿（新 describe + 修完的存量 describe）。

- [ ] **Step 7: commit-2 impl**

```bash
git add apps/api/src/routes/acquisition.ts apps/api/src/routes/acquisition.test.ts
git commit -m "feat: collect/report 事务化+终态守卫+settle 结算，删倒推 stage_1_done 逻辑

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `GET /pending-collect-tasks` 只下发未完成视频

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:379-389`（stage_1_done 视频列表查询加过滤）
- Test: `apps/api/src/routes/acquisition.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 2 的 `comments_reported_at`。

- [ ] **Step 1: 写 failing test**

```ts
describe('GET /api/acquisition/pending-collect-tasks — Stage2 只发未完成视频 [BEHAVIOR]', () => {
  it('stage_1_done 视频查询带 comments_reported_at IS NULL 过滤', async () => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FROM zenithjoy.agents')) return { rows: [{ tenant_id: 't-1' }] } as any;
      if (s.includes('FROM zenithjoy.acquisition_collect_tasks')) {
        return { rows: [{ id: '00000000-0000-0000-0000-00000000c003', keywords: ['k'], tenant_id: 't-1', status: 'stage_1_done' }] } as any;
      }
      if (s.includes('FROM zenithjoy.acquisition_collect_videos')) return { rows: [{ task_id: '00000000-0000-0000-0000-00000000c003', video_id: 'v-pending' }] } as any;
      return { rows: [] } as any;
    });
    const res = await request(app).get('/api/acquisition/pending-collect-tasks').set('x-agent-id', 'agent-1');
    expect(res.status).toBe(200);
    const videoSql = vi.mocked(db.query).mock.calls.map((c) => String(c[0]))
      .find((s) => s.includes('FROM zenithjoy.acquisition_collect_videos'));
    expect(videoSql).toMatch(/comments_reported_at IS NULL/);
  });
});
```

- [ ] **Step 2: 跑测确认 FAIL** → Run 同上，Expected: FAIL（现 SQL 无过滤）。

- [ ] **Step 3: commit-1 failing test**

```bash
git add apps/api/src/routes/acquisition.test.ts
git commit -m "test: pending-collect-tasks Stage2 只发未完成视频 failing test

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现**（:379-389 的查询改一行 WHERE）

```ts
      const vRes = await pool.query<{ task_id: string; video_id: string }>(
        `SELECT task_id, video_id FROM zenithjoy.acquisition_collect_videos
          WHERE task_id = ANY($1::uuid[])
            AND comments_reported_at IS NULL
          ORDER BY created_at ASC`,
        [stage1DoneIds]
      );
```

- [ ] **Step 5: 跑测 PASS → commit-2**

```bash
git add apps/api/src/routes/acquisition.ts
git commit -m "feat: pending-collect-tasks Stage2 只下发 comments_reported_at IS NULL 的视频

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /collect/sweep-timeouts` 扩 stage_1_done 收尸

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:1088-1103`（handler 重写为 select+settle 循环）
- Test: `apps/api/src/routes/acquisition.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 `settleCollectTask`。
- 语义：running 用 `COALESCE(started_at, updated_at, created_at)` 基准（不变）；**stage_1_done 用 `updated_at` 基准**（started_at 首报即定格，会误杀正在跑 Stage2 的任务；Stage2 每次 report 都 touch updated_at）。

- [ ] **Step 1: 写 failing test**

```ts
describe('POST /api/acquisition/collect/sweep-timeouts — stage_1_done 收尸 [BEHAVIOR]', () => {
  it('候选查询含 stage_1_done 且其基准是 updated_at；有 lead→partial 无→failed', async () => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('SELECT') && s.includes('lead_count')) {
        return { rows: [
          { id: 'task-a', status: 'stage_1_done', lead_count: 3 },
          { id: 'task-b', status: 'running', lead_count: 0 },
        ] } as any;
      }
      return { rows: [{ id: 'x' }] } as any;
    });
    const res = await request(app).post('/api/acquisition/collect/sweep-timeouts')
      .set('x-smoke-token', 'smoke-test-token').send({});
    expect(res.status).toBe(200);
    expect(res.body.swept).toBe(2);
    const calls = vi.mocked(db.query).mock.calls.map((c) => String(c[0]));
    const sel = calls.find((s) => s.includes('lead_count'));
    expect(sel).toMatch(/stage_1_done/);
    expect(sel).toMatch(/updated_at/);
    const updates = calls.filter((s) => s.trim().startsWith('UPDATE'));
    expect(updates.some((s) => s.includes('$2')) || updates.length >= 2).toBe(true);
  });
});
```

（smoke gate 的调用方式照文件里现有 sweep-timeouts 用例抄——若现有用例用别的 header/token 形态，以现有为准。）

- [ ] **Step 2: 跑测确认 FAIL** → 现实现单条 UPDATE 不含 stage_1_done。

- [ ] **Step 3: commit-1 failing test**

```bash
git add apps/api/src/routes/acquisition.test.ts
git commit -m "test: sweep-timeouts stage_1_done 收尸 failing test

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现**（替换 :1088-1103）

```ts
// POST /api/acquisition/collect/sweep-timeouts — stale running + stage_1_done 收尸；pending(离线) 保留不丢
// running 基准 COALESCE(started_at, updated_at, created_at)；stage_1_done 基准 updated_at
//（Stage2 每次 report 都 touch updated_at，用 started_at 会误杀正在跑 Stage2 的任务）
acquisitionRouter.post('/collect/sweep-timeouts', smokeOrAgentGate, async (_req: Request, res: Response) => {
  const cutoffMs = SWEEP_TIMEOUT_MS;
  const { rows } = await pool.query<{ id: string; status: string; lead_count: number }>(
    `SELECT t.id, t.status,
            (SELECT count(*) FROM zenithjoy.acquisition_leads l WHERE l.collect_task_id = t.id)::int AS lead_count
       FROM zenithjoy.acquisition_collect_tasks t
      WHERE (t.status = 'running'
             AND COALESCE(t.started_at, t.updated_at, t.created_at) < NOW() - ($1::int || ' milliseconds')::interval)
         OR (t.status = 'stage_1_done'
             AND t.updated_at < NOW() - ($1::int || ' milliseconds')::interval)`,
    [cutoffMs]
  );
  let swept = 0;
  for (const t of rows) {
    const s = settleCollectTask({
      currentStatus: t.status,
      agentTerminal: t.lead_count > 0
        ? { terminal: 'partial', partial_reason: 'COLLECT_TIMEOUT' }
        : { terminal: 'failed', error_code: 'COLLECT_TIMEOUT' },
      videoTotal: 0,
      videoDone: 0,
      leadCount: t.lead_count,
    });
    if (!s.changed) continue;
    const r = await pool.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status = $2, error_code = COALESCE(error_code, $3),
              ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = $4
        RETURNING id`,
      [t.id, s.status, s.error_code, t.status]
    );
    swept += r.rows.length;
  }
  return ok(res, { swept });
});
```

- [ ] **Step 5: 跑测 PASS → commit-2**

```bash
git add apps/api/src/routes/acquisition.ts
git commit -m "feat: sweep-timeouts 扩 stage_1_done 收尸（updated_at 基准，settle 统一结算）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 契约文档 + smoke 扩展 + 全量验证

**Files:**
- Create: `sprints/07091806-android-collect-protocol-v2/contract-stage1-report-videos.md`
- Modify: `.github/workflows/scripts/smoke/android-collect-protocol-v2-smoke.sh`（已在 smoke-baseline.txt，免新登记）

**Interfaces:**
- Consumes: Task 3 的端点契约（照 Produces 块原样成文）。

- [ ] **Step 1: 写契约文档**（补 prep-prd 缺口#1；内容 = Task 3 Produces 块的完整展开：端点/鉴权/请求 schema/响应码表/幂等语义/空清单三分支/状态机图 pending→running→stage_1_done→done|partial|failed 与 cancelling→cancelled；加一节「旧 report 行为变更」：终态 ignored、计数改 distinct 重算、倒推逻辑删除、Stage2 只发未完成视频、sweep 扩容）

- [ ] **Step 2: smoke 加第 4 步**（在现脚本 exit 0 之前追加）

```bash
# 4. 验证 collect/report-videos 端点 — 缺 x-agent-id 返回 401（端点存在且鉴权生效）
RV_RESP=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000000","videos":[{"video_id":"smoke_vid"}]}' 2>/dev/null || true)
echo "[smoke] collect/report-videos (no x-agent-id) status=$RV_RESP"
if [ "$RV_RESP" != "401" ]; then
  echo "[smoke] FAIL: collect/report-videos without x-agent-id returned $RV_RESP (expected 401)"
  exit 1
fi
echo "[smoke] PASS: collect/report-videos auth gate 401"
```

- [ ] **Step 3: 全量验证**

```bash
cd apps/api && npx vitest run          # 全 apps/api 测试
npx tsc --noEmit -p apps/api           # 类型检查（若 repo 用别的 typecheck 脚本以 repo 为准）
```
Expected: 全绿、零类型错误。

- [ ] **Step 4: Commit**

```bash
git add sprints/07091806-android-collect-protocol-v2/contract-stage1-report-videos.md .github/workflows/scripts/smoke/android-collect-protocol-v2-smoke.sh
git commit -m "docs: Stage1 report-videos 契约文档 + smoke 扩鉴权探测

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 验收对照（PrepPRD）

- settleCollectTask 单测四终态分支 → Task 1
- 幂等重报不重计数 → Task 3（distinct 重算 + ON CONFLICT）
- 终态后回报被拒 → Task 3（409）/ Task 4（200+ignored）
- 契约文档落 sprint 目录 → Task 7
- CI 绿 → Task 7 Step 3 + push 后 CI
