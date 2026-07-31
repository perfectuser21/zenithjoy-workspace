/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acquisitionRouter } from './acquisition';
import db from '../db/connection';
import { scoreLeads } from '../services/acquisition-dispatch';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
vi.mock('../db/connection', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(async () => ({ query: mockClientQuery, release: mockClientRelease })),
  },
}));

const mockResolveShareToMedia = vi.fn();
vi.mock('../services/douyin-share-resolver', () => ({
  resolveShareToMedia: (...a: any[]) => mockResolveShareToMedia(...a),
  isLikelyRealVideoId: (id: string) => /^\d{10,}$/.test(id ?? ''),
}));

vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'] || req.body?.tenant_id || '';
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));

const mockJudgeVideo = vi.fn();
vi.mock('../services/content-judgment', () => ({
  judgeVideo: (...a: any[]) => mockJudgeVideo(...a),
}));

vi.mock('../services/acquisition-dispatch', () => ({
  scoreLeads: vi.fn().mockResolvedValue({ scored: 1 }),
  buildAssignments: vi.fn().mockResolvedValue({ assigned: 1 }),
  dispatchDue: vi.fn().mockResolvedValue({ dispatched: 1 }),
  rescoreLead: vi.fn().mockResolvedValue({ score: 55, comment_count: 1 }),
}));

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionRouter);
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

describe('GET /api/acquisition/overview', () => {
  it('returns 200 with correct payload', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.feature).toBe('smart-acquisition');
    expect(res.body.capabilities).toEqual(["overview"]);
    expect(res.body.version).toBe('1.0.0');
  });

  it('schema has exactly the expected top-level keys', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(Object.keys(res.body).sort()).toEqual(['capabilities', 'enabled', 'feature', 'version']);
  });

  it('unknown sub-path returns 404', async () => {
    const res = await request(app).get('/api/acquisition/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/acquisition/leads', () => {
  it('returns 400 for invalid grade', async () => {
    const res = await request(app).get('/api/acquisition/leads?grade=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_GRADE');
  });

  it('VITEST mode: returns empty leads for valid grade', async () => {
    const res = await request(app).get('/api/acquisition/leads?grade=%E7%B2%BE%E5%87%86');
    expect(res.status).toBe(200);
    expect(res.body.leads).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('VITEST mode: returns empty leads when no grade filter', async () => {
    const res = await request(app).get('/api/acquisition/leads');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('leads');
    expect(res.body).toHaveProperty('total');
  });
});

// ────── Bug：GET /leads 无租户隔离，返回全平台数据 [REGRESSION] ──────
describe('GET /api/acquisition/leads — tenant 隔离 [REGRESSION]', () => {
  beforeEach(async () => {
    vi.stubEnv('VITEST', '');
    vi.clearAllMocks();
    const { default: db } = await import('../db/connection');
    (db.query as any).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('无 tenant 上下文 → 401 NO_TENANT，不查库', async () => {
    const { default: db } = await import('../db/connection');
    const res = await request(app).get('/api/acquisition/leads');
    expect(res.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('查询必须带 tenant_id 过滤，不能返回全平台数据', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_A = 'eeeeeeee-0000-0000-0000-000000000005';
    (db.query as any).mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/acquisition/leads')
      .set('x-test-tenant-id', TENANT_A);

    const calls = (db.query as any).mock.calls;
    const [sql, params] = calls[0];
    expect(sql).toMatch(/l\.tenant_id\s*=\s*\$/);
    expect(params).toContain(TENANT_A);
  });

  it('grade + tenant 同时过滤时两个条件都要带上', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_B = 'ffffffff-0000-0000-0000-000000000006';
    (db.query as any).mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/acquisition/leads?grade=%E7%B2%BE%E5%87%86')
      .set('x-test-tenant-id', TENANT_B);

    const calls = (db.query as any).mock.calls;
    const [sql, params] = calls[0];
    expect(sql).toMatch(/l\.grade\s*=\s*\$/);
    expect(sql).toMatch(/l\.tenant_id\s*=\s*\$/);
    expect(params).toContain(TENANT_B);
    expect(params).toContain('精准');
  });
});

// ────── Bug 回归：leads 字段映射 — commenter_id=nickname，source_video_url=完整URL，有 profile_url ──────
describe('GET /api/acquisition/leads 字段映射 [REGRESSION]', () => {
  it('commenter_id 映射 nickname（优先），不再映射 sec_uid 乱码', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './acquisition.ts'), 'utf8');
    // 必须是 nickname ?? sec_uid，不能是 sec_uid ?? nickname
    expect(src).toMatch(/commenter_id:\s*r\.nickname\s*\?\?/);
    expect(src).not.toMatch(/commenter_id:\s*r\.sec_uid\s*\?\?\s*r\.nickname/);
  });

  it('source_video_url 拼成完整抖音视频 URL，不是裸 ID', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './acquisition.ts'), 'utf8');
    expect(src).toMatch(/https:\/\/www\.douyin\.com\/video\//);
    // 不再直接返回裸 videoIds[0]
    expect(src).not.toMatch(/source_video_url:\s*videoIds\[0\]/);
  });

  it('返回 profile_url 字段（抖音主页链接）', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './acquisition.ts'), 'utf8');
    expect(src).toMatch(/profile_url:.*douyin\.com\/user\//);
  });
});

// ────── Bug B 回归：pending-collect-tasks 端点 ──────
describe('GET /api/acquisition/pending-collect-tasks — Bug B regression [BEHAVIOR]', () => {
  it('VITEST 模式返回 200 + tasks 数组', async () => {
    const res = await request(app).get('/api/acquisition/pending-collect-tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(typeof res.body.total).toBe('number');
  });

  it('VITEST 模式返回空任务列表', async () => {
    const res = await request(app).get('/api/acquisition/pending-collect-tasks');
    expect(res.body.tasks).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ────── 跨租户/跨机器采集任务隔离 [REGRESSION] ──────
// 根因：/pending-collect-tasks 之前完全不按 tenant_id 过滤，任意 agent 用任意
// x-agent-id 轮询都能拿到全平台所有租户的 pending 采集任务；acquisition_collect_tasks
// 已有的 agent_id 列（20260618 迁移）也从未被写入/过滤，导致同租户多机也会互抢。
describe('GET /api/acquisition/pending-collect-tasks — tenant + agent 隔离 [REGRESSION]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('无 x-agent-id → 200 空列表，不查 DB', async () => {
    const mod = await import('../db/connection');
    const res = await request(app).get('/api/acquisition/pending-collect-tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tasks: [], total: 0 });
    expect(mod.default.query).not.toHaveBeenCalled();
  });

  it('x-agent-id 查不到对应 agent → 200 空列表，不继续查任务表', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] }); // agents 表查不到
    const res = await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', 'agent-unknown');
    expect(res.body).toEqual({ tasks: [], total: 0 });
    expect(mod.default.query).toHaveBeenCalledTimes(1);
  });

  it('查任务表时必须带自己的 tenant_id + agent_id 条件（防跨租户/跨机器抢占）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-A' }] }) // agents 表解析 tenant
      .mockResolvedValueOnce({ rows: [] }); // SELECT pending/stage_1_done tasks（本例返回空，只校验 SQL 条件）
    await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', 'agent-A');

    const selectCall = (mod.default.query as any).mock.calls[1];
    const [sql, params] = selectCall;
    expect(sql).toMatch(/tenant_id\s*=\s*\$1/);
    expect(sql).toMatch(/agent_id/);
    // 真机复现(2026-07-17)：任务表过滤须同时认 UUID/文本两种 agent_id 形式（见下方
    // "任务表 agent_id 过滤也要认 UUID/文本双形式"[REGRESSION]），mock 里 agents 表
    // 未区分两种形式时两者都退化成同一个 xAgentId 值，参数变 3 个但值相同。
    expect(params).toEqual(['tenant-A', 'agent-A', 'agent-A']);
  });

  it('tenant-A 的 agent 轮询时，只能捞到 tenant-A 自己的任务（不是全平台任务）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-A' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'task-a1', keywords: ['装修'], tenant_id: 'tenant-A', status: 'pending' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE running

    const res = await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', 'agent-A');

    expect(res.body.tasks).toEqual([
      { task_id: 'task-a1', tenant_id: 'tenant-A', keywords: ['装修'], stage: 'stage_1', video_urls: undefined },
    ]);
    // UPDATE 抢占任务时必须把 agent_id 写回该任务，避免同租户下一台机再抢
    const updateCall = (mod.default.query as any).mock.calls[2];
    expect(updateCall[0]).toMatch(/agent_id/);
    expect(updateCall[1]).toEqual([['task-a1'], 'agent-A']);
  });
});

// 根因：POST /api/agent/heartbeat 返回给客户端的 agent_id 字段实际是 agents.id（UUID主键），
// 但 agents 表还有一个同名的 agent_id 文本列（如 ws1-xxxx）。真机拿到心跳返回的 UUID 后，
// 后续所有 x-agent-id 请求头都发 UUID，而这里的 SQL 只按文本 agent_id 精确匹配 → 永远查不到
// 该 agent 所属 tenant，接口静默返回空列表，真机采集任务永远卡在 pending。
// 修法对齐 agent-tenant-resolver.ts 已有的双路匹配模式（agent_id = $1 OR id::text = $1）。
describe('GET /api/acquisition/pending-collect-tasks — x-agent-id 传 UUID 也要能匹配 [REGRESSION]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('x-agent-id 传 agents.id(UUID) → 仍能查到 tenant_id，不返回空列表', async () => {
    const mod = await import('../db/connection');
    const agentUuid = '3c886227-c21f-48f6-8570-53dd0369d330';
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-A' }] }) // agents 表按 UUID 也要能命中
      .mockResolvedValueOnce({ rows: [] }); // 任务表查询（本例只校验能走到这一步）

    const res = await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', agentUuid);

    expect(res.body).toEqual({ tasks: [], total: 0 });
    // 关键回归点：agents 表查询的 SQL 必须同时支持文本 agent_id 与 id::text 两种匹配，
    // 不能只查文本列（否则 UUID 永远匹配不到，agents 表查询这一步就会短路返回空数组）。
    const agentsLookupCall = (mod.default.query as any).mock.calls[0];
    expect(agentsLookupCall[0]).toMatch(/agent_id\s*=\s*\$1\s*OR\s*id::text\s*=\s*\$1/i);
    // 走到了任务表查询这一步，说明 tenant_id 解析成功了（没有在 agents 表这步就短路）
    expect(mod.default.query).toHaveBeenCalledTimes(2);
  });
});

// 真机复现(2026-07-17 xian-rog)：/collect/start 用 account_label 绑定小号时，把
// agents.agent_id(文本形式，如 agent-maa-an00-xxx) 写进 acquisition_collect_tasks.agent_id
// 列；但设备轮询 /pending-collect-tasks 时 x-agent-id 头发的是 agents.id(UUID)——上面这条
// [REGRESSION] 只修了"查 tenant_id"这一步的双形式匹配，任务表过滤 `agent_id = $2` 仍然
// 裸比较原始 header 值，UUID 永远匹配不上文本形式的 agent_id 列，接口静默返回空、真机采集
// 任务永远卡在 pending——跟上条同一根因、同一修法模式，只是漏了任务过滤这一步没对齐。
describe('GET /api/acquisition/pending-collect-tasks — 任务表 agent_id 过滤也要认 UUID/文本双形式 [REGRESSION]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('任务的agent_id存的是文本slug，设备用UUID轮询——仍必须捞到该任务', async () => {
    const mod = await import('../db/connection');
    const agentUuid = 'e017953c-bc65-47e0-913e-a2ed5eb54993';
    const agentTextSlug = 'agent-maa-an00-mrn5fxt5';
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-A', agent_id: agentTextSlug, id: agentUuid }] }) // agents 表按 UUID 命中，同时带出文本形式
      .mockResolvedValueOnce({
        rows: [{ id: 'task-1', keywords: ['装修'], tenant_id: 'tenant-A', status: 'pending' }],
      }) // 任务表：该任务 agent_id 列存的是文本 slug
      .mockResolvedValueOnce({ rows: [] }); // UPDATE running

    const res = await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', agentUuid);

    expect(res.body.tasks).toEqual([
      { task_id: 'task-1', tenant_id: 'tenant-A', keywords: ['装修'], stage: 'stage_1', video_urls: undefined },
    ]);
    // 关键回归点：任务表查询的 SQL 参数必须同时带文本 slug 和 UUID 两种形式，
    // 不能只拿原始 header 值($2)去裸比较——否则文本形式的 agent_id 列永远匹配不上 UUID header。
    const taskSelectCall = (mod.default.query as any).mock.calls[1];
    expect(taskSelectCall[1]).toContain(agentTextSlug);
    expect(taskSelectCall[1]).toContain(agentUuid);
  });
});

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

describe('GET /api/acquisition/pending-collect-tasks — Stage2 排除已 rejected 的视频 [REGRESSION]', () => {
  it('stage_1_done 视频查询带 judgment_status != rejected 过滤（已判定不匹配的内容不应被派发抓评论）', async () => {
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
    expect(videoSql).toMatch(/judgment_status\s*!=\s*'rejected'/i);
  });
});

describe('POST /api/acquisition/collect/start — agent_id 写入 [REGRESSION]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('body 带 agent_id → INSERT 时写入 acquisition_collect_tasks.agent_id', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [] }) // 异步 session 探测（fire-and-forget）
      .mockResolvedValueOnce({ rows: [{ id: 'task-new' }] }); // INSERT

    await request(app)
      .post('/api/acquisition/collect/start')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6')
      .send({ keywords: ['装修'], agent_id: 'agent-A' });

    const calls = (mod.default.query as any).mock.calls;
    const insertCall = calls.find((c: any[]) => /acquisition_collect_tasks/.test(c[0]));
    expect(insertCall).toBeTruthy();
    const [sql, params] = insertCall;
    expect(sql).toMatch(/agent_id/);
    expect(params).toContain('agent-A');
  });
});

// ────── 方案 D：burner 账号自动路由 ──────
// 采集任务本质要用某个抖音小号的 cookie session 登录去抓，所以任务必须派到
// 持有该 session 的机器上；account_label 解析出的 agent_id 覆盖客户端直传的 agent_id
// （物理约束优先于用户手选的机器）。
describe('POST /api/acquisition/collect/start — burner account_label 自动路由 [REGRESSION]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('account_label 查不到 active burner session → 400 BURNER_SESSION_NOT_FOUND', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] }); // session 查询查不到

    const res = await request(app)
      .post('/api/acquisition/collect/start')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6')
      .send({ keywords: ['装修'], account_label: 'burner-not-bound' });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('BURNER_SESSION_NOT_FOUND');
  });

  it('account_label 命中 active burner session → INSERT 用该 session 的 agent_id（覆盖 body.agent_id）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ agent_id: 'agent-burner-machine' }] }) // session 查询命中
      .mockResolvedValueOnce({ rows: [] }) // 异步 session 探测（fire-and-forget）
      .mockResolvedValueOnce({ rows: [{ id: 'task-new' }] }); // INSERT

    await request(app)
      .post('/api/acquisition/collect/start')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6')
      .send({ keywords: ['装修'], account_label: 'burner-1', agent_id: 'agent-manually-picked' });

    const calls = (mod.default.query as any).mock.calls;
    const insertCall = calls.find((c: any[]) => /acquisition_collect_tasks/.test(c[0]));
    expect(insertCall).toBeTruthy();
    const [, params] = insertCall;
    expect(params).toContain('agent-burner-machine');
    expect(params).not.toContain('agent-manually-picked');
  });

  it('查 session 时必须限定 role=burner + status=active + 本租户', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ agent_id: 'agent-x' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-new' }] });

    await request(app)
      .post('/api/acquisition/collect/start')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6')
      .send({ keywords: ['装修'], account_label: 'burner-1' });

    const sessionCall = (mod.default.query as any).mock.calls[0];
    const [sql, sqlParams] = sessionCall;
    expect(sql).toMatch(/role\s*=\s*'burner'/);
    expect(sql).toMatch(/status\s*=\s*'active'/);
    expect(sqlParams).toContain('4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(sqlParams).toContain('burner-1');
  });
});

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
    expect(JSON.stringify(firstArgs)).not.toContain('current');
  });

  it('无 tenant 上下文 → 401 NO_TENANT（不是 400 TENANT_ID_REQUIRED、不崩）', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/start')
      .send({ keywords: ['装修'] });
    expect(res.status).toBe(401);
  });
});

describe('collect/report — 无需 smoke token，agent 直接调用 [REGRESSION: Bug-D]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('无 X-Smoke-Token 也能调用（不返回 403）', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-1', tenant_id: 't1', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0, keywords: ['k1'] }] };
      }
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });
    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({ task_id: 'task-1', video_id: 'no_videos', commenters: [], terminal: true });
    // agent 无 smoke token 下不应被 403 拒，status 不能是 403
    expect(res.status).not.toBe(403);
  });

  it('有 task_id + video_id → 终态回报可达（不返回 403 Forbidden）', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-2', tenant_id: 't2', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0, keywords: ['k1'] }] };
      }
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });
    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({ task_id: 'task-2', video_id: '7123456789', commenters: [], terminal: true });
    expect(res.status).not.toBe(403);
  });
});

// ────── collect/report 也把每条评论写进历史表 + rescore [REGRESSION] ──────
describe('POST /api/acquisition/collect/report — 评论历史 + rescore [REGRESSION]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('新 commenter → 建 lead + 写评论历史 + rescore', async () => {
    const { rescoreLead } = await import('../services/acquisition-dispatch');
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-r', tenant_id: 't-r', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0, keywords: ['k1'] }] };
      }
      if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) return { rows: [] }; // 无既有 lead
      if (s.includes('INSERT INTO zenithjoy.acquisition_leads') && s.includes('RETURNING')) return { rows: [{ id: 'lead-r1' }] };
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: 'task-r',
        video_id: '7123456789',
        commenters: [{ sec_uid: 'MS4wABC', nickname: '装修客', comment_text: '想了解报价', grade: '精准' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.inserted).toBe(1);

    const calls = mockClientQuery.mock.calls;
    const histInsert = calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_lead_comments/.test(String(c[0])));
    expect(histInsert).toBeTruthy();
    expect(histInsert![1]).toEqual(['lead-r1', '7123456789', '想了解报价', '精准']);
    expect(rescoreLead).toHaveBeenCalledWith(expect.anything(), 't-r', 'lead-r1');
  });

  it('命中已有 lead（同 sec_uid 二次留言）→ 不建新 lead 但写新评论历史 + rescore', async () => {
    const { rescoreLead } = await import('../services/acquisition-dispatch');
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-r2', tenant_id: 't-r2', status: 'running', error_code: null, video_count: 1, lead_count_raw: 1, keywords: ['k1'] }] };
      }
      if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) return { rows: [{ id: 'lead-existing' }] }; // 命中既有 lead
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: 'task-r2',
        video_id: '7999999999',
        commenters: [{ sec_uid: 'MS4wABC', nickname: '装修客', comment_text: '第二次：什么时候能上门', grade: '高意向' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.deduped).toBe(1);

    const calls = mockClientQuery.mock.calls;
    expect(calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_leads/.test(c[0]))).toBeUndefined();
    const histInsert = calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_lead_comments/.test(c[0]));
    expect(histInsert).toBeTruthy();
    expect(histInsert![1]).toEqual(['lead-existing', '7999999999', '第二次：什么时候能上门', '高意向']);
    expect(rescoreLead).toHaveBeenCalledWith(expect.anything(), 't-r2', 'lead-existing');
  });
});

// ────── 方案A Fix4：sec_uid=null → profile_url=昵称，partial=false [REGRESSION] ──────
// 根因：UIA 树里不含 sec_uid（真机 dump 235 节点 MS4w 零命中），
// profileUrlForSecUid(null)=null → profile_url=null → dispatchDue 跳过 → 私信链死。
// 方案A：profile_url 回退为昵称，dispatchDue 用昵称走 locateProfileBySearch 搜索。
describe('POST /api/acquisition/collect/report — 方案A: sec_uid=null 时 profile_url=昵称 [REGRESSION]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('[方案A] sec_uid=null → profile_url 应为昵称（非 null），partial 应为 false', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-fa', tenant_id: 't-fa', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0, keywords: ['k1'] }] };
      }
      if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) return { rows: [] };
      if (s.includes('INSERT INTO zenithjoy.acquisition_leads') && s.includes('RETURNING')) return { rows: [{ id: 'lead-fa1' }] };
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: 'task-fa',
        video_id: '7000000000001',
        commenters: [{ sec_uid: null, nickname: '小叶子', comment_text: '好看', grade: '感兴趣' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.inserted).toBe(1);

    const calls = mockClientQuery.mock.calls;
    const leadInsert = calls.find((c: any[]) =>
      /INSERT INTO zenithjoy\.acquisition_leads/.test(String(c[0])) && String(c[0]).includes('RETURNING')
    );
    expect(leadInsert).toBeTruthy();
    // $5 (index 4) = profile_url: 无 sec_uid → 回退昵称，供 locateProfileBySearch 搜索
    expect(leadInsert![1][4]).toBe('小叶子');
    // $6 (index 5) = partial: 有昵称可派单，不应标 partial
    expect(leadInsert![1][5]).toBe(false);
  });
});

describe('POST /api/acquisition/collect/report — douyin_id 落库 [REGRESSION: Seg3→Seg4 断链]', () => {
  // 真机根因(2026-07-16)：设备端 Seg3 点评论人头像进主页读出真实抖音号（CommentEntry.douyinId），
  // 但 AgentService.kt 上报 /collect/report 时构建 commenters payload 只塞了 nickname/comment_text，
  // 服务端这个handler也从未读过 douyin_id 字段——即便设备真读到了号，也在这两层各自被吃掉一次。
  // 后果：acquisition_leads.douyin_id 永远 NULL，Seg4 派单（acquisition-dispatch.ts）读不到号，
  // Android 私信通道退化回旧 bug（把 profile_url 当抖音号搜 → NO_MATCH，迁移文件
  // 20260715_150000_acquisition_leads_douyin_id.sql 已建列但从未有人写过它）。
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('commenters[].douyin_id 必须落进 acquisition_leads.douyin_id（新建 lead），否则派单侧永远拿不到号', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-did', tenant_id: 't-did', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0, keywords: ['k1'] }] };
      }
      if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) return { rows: [] };
      if (s.includes('INSERT INTO zenithjoy.acquisition_leads') && s.includes('RETURNING')) return { rows: [{ id: 'lead-did1' }] };
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: 'task-did',
        video_id: '7000000000002',
        commenters: [{ nickname: '小叶子', comment_text: '求联系方式', douyin_id: '1689210742' }],
      });

    expect(res.status).toBe(200);
    const calls = mockClientQuery.mock.calls;
    const leadInsert = calls.find((c: any[]) =>
      /INSERT INTO zenithjoy\.acquisition_leads/.test(String(c[0])) && String(c[0]).includes('RETURNING')
    );
    expect(leadInsert).toBeTruthy();
    expect(String(leadInsert![0])).toMatch(/douyin_id/i);
    expect(leadInsert![1]).toContain('1689210742');
  });

  it('已存在 lead 再次命中带 douyin_id 的评论 → UPDATE 必须 COALESCE 回填号（老 lead 补号，不覆盖已有值）', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-did2', tenant_id: 't-did2', status: 'running', error_code: null, video_count: 0, lead_count_raw: 1, keywords: ['k1'] }] };
      }
      if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) return { rows: [{ id: 'lead-existing' }] };
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: 'task-did2',
        video_id: '7000000000003',
        commenters: [{ sec_uid: 'MS4wLjABAAAA', nickname: '小叶子', comment_text: '还联系吗', douyin_id: '1689210742' }],
      });

    expect(res.status).toBe(200);
    const calls = mockClientQuery.mock.calls;
    const leadUpdate = calls.find((c: any[]) =>
      /UPDATE zenithjoy\.acquisition_leads/.test(String(c[0])) && /source_video_ids/.test(String(c[0]))
    );
    expect(leadUpdate).toBeTruthy();
    expect(String(leadUpdate![0])).toMatch(/douyin_id/i);
    expect(String(leadUpdate![0])).toMatch(/COALESCE/i);
    expect(leadUpdate![1]).toContain('1689210742');
  });
});

// ────── Line02 IA 重设计 Track A — collect-tasks/:id/videos + videos/:videoId/leads ──────
describe('GET /api/acquisition/collect-tasks/:id/videos [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const VALID_TASK_ID = '11111111-1111-1111-1111-111111111111';

  it('无 tenant 上下文 → 401 NO_TENANT', async () => {
    const res = await request(app).get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`);
    expect(res.status).toBe(401);
  });

  it('非法 UUID → 404（不查库、不 500）', async () => {
    const res = await request(app)
      .get('/api/acquisition/collect-tasks/not-a-uuid/videos')
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TASK_NOT_FOUND');
  });

  it('任务不存在（或不属于本 tenant）→ 404', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] }); // task 查询空
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TASK_NOT_FOUND');
  });

  it('跨 tenant 访问他人任务 → 404（IDOR，不泄露存在性）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] }); // WHERE tenant_id=$2 过滤掉别人的任务
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-b');
    expect(res.status).toBe(404);
  });

  it('本 tenant 任务下有视频 → 200 + videos 数组含 video_id/title/thumbnail_url/publish_date/comment_count', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: VALID_TASK_ID, status: 'done', error_code: null, video_count: 1 }] }) // task 归属校验
      .mockResolvedValueOnce({
        rows: [{
          video_id: '7123456789',
          task_id: VALID_TASK_ID,
          title: null,
          thumbnail_url: null,
          publish_date: null,
          comment_count: 3,
        }],
      });
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.videos).toHaveLength(1);
    const v = res.body.data.videos[0];
    expect(v).toHaveProperty('video_id', '7123456789');
    expect(v).toHaveProperty('title');
    expect(v).toHaveProperty('thumbnail_url');
    expect(v).toHaveProperty('publish_date');
    expect(v).toHaveProperty('comment_count', 3);
    // 禁用字段
    expect(res.body.data).not.toHaveProperty('videoList');
    expect(res.body.data).not.toHaveProperty('items');
  });

  it('videos[] 含 judgment_status/judgment_reason（Seg2 判定字段，供 smoke 断言）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: VALID_TASK_ID, status: 'done', error_code: null, video_count: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          video_id: '7123456789',
          task_id: VALID_TASK_ID,
          title: null,
          thumbnail_url: null,
          publish_date: null,
          comment_count: 3,
          judgment_status: 'matched',
          judgment_reason: '目标画像命中',
        }],
      });
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    const v = res.body.data.videos[0];
    expect(v).toHaveProperty('judgment_status', 'matched');
    expect(v).toHaveProperty('judgment_reason', '目标画像命中');
  });

  // regression(2026-07-04): 空状态需按任务真实状态判断，不能无条件显示"采集中"
  it('响应含 task.status/error_code/video_count，供前端区分进行中/失败/真的没抓到 [REGRESSION]', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: VALID_TASK_ID, status: 'failed', error_code: 'NO_VIDEOS_FOUND', video_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] }); // 无视频记录
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    expect(res.body.data.task).toEqual({ status: 'failed', error_code: 'NO_VIDEOS_FOUND', video_count: 0 });
    expect(res.body.data.videos).toEqual([]);
  });

  it('任务终态(done)但视频列表为空 → task.status=done 而不是伪装成进行中 [REGRESSION]', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: VALID_TASK_ID, status: 'stage_1_done', error_code: null, video_count: 2 }] })
      .mockResolvedValueOnce({ rows: [] }); // acquisition_collect_videos 历史缺口（该表比部分任务晚上线）
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    expect(res.body.data.task.status).toBe('stage_1_done');
    expect(res.body.data.videos).toEqual([]);
  });
});

describe('GET /api/acquisition/videos/:videoId/leads [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('无 tenant 上下文 → 401 NO_TENANT', async () => {
    const res = await request(app).get('/api/acquisition/videos/7123456789/leads');
    expect(res.status).toBe(401);
  });

  it('视频不存在（或不属于本 tenant）→ 404', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/acquisition/videos/no-such-video/leads')
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VIDEO_NOT_FOUND');
  });

  it('跨 tenant 访问他人视频 → 404（IDOR）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/acquisition/videos/7123456789/leads')
      .set('x-test-tenant-id', 'tenant-b');
    expect(res.status).toBe(404);
  });

  it('本 tenant 视频命中 leads → 200 + schema(leads:array,total:number) + entry 字段 + 禁用字段不出现', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ video_id: '7123456789' }] }) // 视频归属校验
      .mockResolvedValueOnce({
        rows: [{ sec_uid: 'MS4wXYZ', nickname: '装修达人', comment_text: '怎么联系', grade: '感兴趣' }],
      });
    const res = await request(app)
      .get('/api/acquisition/videos/7123456789/leads')
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.leads)).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
    const l = res.body.data.leads[0];
    expect(l).toHaveProperty('commenter_id', '装修达人');
    expect(l).toHaveProperty('comment_text', '怎么联系');
    expect(l).toHaveProperty('source_video_url', 'https://www.douyin.com/video/7123456789');
    expect(l).toHaveProperty('grade', '感兴趣');
    expect(l).toHaveProperty('profile_url', 'https://www.douyin.com/user/MS4wXYZ');
    expect(res.body.data).not.toHaveProperty('comments');
    expect(res.body.data).not.toHaveProperty('items');
    expect(res.body.data).not.toHaveProperty('results');
  });
});

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

  it('同一任务 60 秒内第 181 次上报 → 429 RATE_LIMITED', async () => {
    const rateLimitedTaskId = '00000000-0000-0000-0000-00000000c181';
    for (let attempt = 1; attempt <= 180; attempt += 1) {
      const res = await request(app)
        .post('/api/acquisition/collect/report-videos')
        .send({ task_id: rateLimitedTaskId, videos: [{ video_id: 'v1' }] });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post('/api/acquisition/collect/report-videos')
      .send({ task_id: rateLimitedTaskId, videos: [{ video_id: 'v1' }] });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
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
    expect(res.body.data.status).toBe('stage_1_done');
    expect(res.body.data.video_count).toBe(2);
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
    expect(res.body.data.status).toBe('partial');
  });

  it('空清单 + search_result=empty 与 error_code 共存 → search_result 优先，partial', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { search_result: 'empty', error_code: 'DOUYIN_RISK' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('partial');
  });

  it('空清单 + error_code → failed 终态', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'DOUYIN_RISK' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
  });

  it('error_code 不在五分类枚举里时，落库前归一为 UNKNOWN（防御未来 Android 版本传入新值）', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'SOME_BRAND_NEW_CODE' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    expect((updateCall as any)[1][2]).toBe('UNKNOWN');
  });

  it('error_code 不在五分类枚举里时，原始值必须持久化进 checkpoint.raw_error_code', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'ALL_SHARE_FAILED' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('UNKNOWN');
    expect(params[3]).toBe(JSON.stringify({ raw_error_code: 'ALL_SHARE_FAILED' }));
  });

  it('error_code 已经是合法五分类值时，不写 checkpoint（保持改动前行为）', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'NETWORK_ERROR' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('NETWORK_ERROR');
    expect(params[3]).toBeNull();
  });

  it('error_code 已经是合法五分类值时，落库前原样透传', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'NETWORK_ERROR' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect((updateCall as any)[1][2]).toBe('NETWORK_ERROR');
  });

  it('videos 非空但全部解析失败（后端合成 ALL_RESOLVE_FAILED，无 reason.error_code）→ 归一为 PLATFORM_LIMITED，不得降级为 UNKNOWN [全分支复审]', async () => {
    mockResolveShareToMedia.mockResolvedValue(null); // 所有卡片解析失败 → list.length===0 但 rawList.length>0
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [{ share_url: 'https://v.douyin.com/dead/' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    expect((updateCall as any)[1][2]).toBe('PLATFORM_LIMITED');
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
    expect(res.body.data.status).toBe('cancelled');
    const upd = mockClientQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes("'cancelled'") || s.includes('cancelled'));
    expect(upd).toBeTruthy();
  });

  it('新取消合同等待物理回执时，普通视频回报不得提前写 cancelled', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: TASK_ID,
            tenant_id: TENANT,
            status: 'cancelling',
            agent_id: 'agent-1',
            lead_count_raw: 3,
            cancel_command_id: '00000000-0000-0000-0000-00000000ca11',
          }],
        };
      }
      return { rows: [] };
    });
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1').send({ task_id: TASK_ID, videos: [{ video_id: 'v1' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ignored: true, status: 'cancelling' });
    const prematureTerminalWrite = mockClientQuery.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => /UPDATE zenithjoy\.acquisition_collect_tasks[\s\S]*status\s*=\s*'cancelled'/i.test(sql));
    expect(prematureTerminalWrite).toBeUndefined();
  });
});

// ────── Bug C 回归：share_url → 服务端解析真实 video_id ──────
// 根因：抖音搜索结果节点树无 ≥10 位真实 ID，agent 造假 card_N_<taskId8> → Stage2 深链打不开。
// 修法：agent 上报每张卡片的 v.douyin.com 短链 share_url，服务端 resolveShareToMedia 跟随 302
// 拿真实 (kind,id) 才登记；解析失败的卡片跳过不造假；note 类型写入 checkpoint.media_kinds。
describe('POST /api/acquisition/collect/report-videos — share_url 解析真实 video_id [REGRESSION: Bug-C]', () => {
  const TASK_ID = '00000000-0000-0000-0000-00000000c001';
  const TENANT = '00000000-0000-0000-0000-0000000000aa';

  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockResolveShareToMedia.mockReset();
    vi.mocked(db.query).mockResolvedValue({ rows: [{ tenant_id: TENANT }] } as any);
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: TASK_ID, tenant_id: TENANT, status: 'running', agent_id: 'agent-1', lead_count_raw: 0, checkpoint: {} }] };
      }
      if (s.includes('count(*)')) return { rows: [{ total: 1 }] };
      return { rows: [] };
    });
  });

  it('share_url 解析成功 → upsert 用真实数字 id（不是 card_N 假 id）', async () => {
    mockResolveShareToMedia.mockImplementation(async (url: string) =>
      url.includes('good') ? { kind: 'video', id: '7412345678901234567' } : null,
    );
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [{ share_url: 'https://v.douyin.com/good/' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('stage_1_done');
    expect(mockResolveShareToMedia).toHaveBeenCalledWith('https://v.douyin.com/good/');
    const upsertCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT (task_id, video_id)'));
    expect(upsertCall).toBeTruthy();
    expect(JSON.stringify(upsertCall![1])).toContain('7412345678901234567');
    // 绝不出现 card_ 假 id
    expect(JSON.stringify(mockClientQuery.mock.calls)).not.toMatch(/card_\d+_/);
  });

  it('share_url 解析失败（死链/登录页）→ 该卡片跳过不登记，不造假 id', async () => {
    mockResolveShareToMedia.mockResolvedValue(null);
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [{ share_url: 'https://v.douyin.com/dead/' }, { share_url: 'https://v.douyin.com/dead2/' }] });
    expect(res.status).toBe(200);
    const upsertCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT (task_id, video_id)'));
    expect(upsertCall).toBeFalsy();
  });

  it('note 图文类型 → 登记 id 且 checkpoint.media_kinds 记 note', async () => {
    mockResolveShareToMedia.mockResolvedValue({ kind: 'note', id: '7499999999999999999' });
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [{ share_url: 'https://v.douyin.com/note/' }] });
    expect(res.status).toBe(200);
    const checkpointWrite = mockClientQuery.mock.calls
      .find((c) => /UPDATE zenithjoy\.acquisition_collect_tasks/.test(String(c[0])) && /media_kinds|checkpoint/.test(String(c[0])));
    expect(checkpointWrite).toBeTruthy();
    expect(JSON.stringify(checkpointWrite![1])).toContain('note');
  });

  it('兼容旧路径：直接带真实数字 video_id（无 share_url）仍登记且不调 resolver', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [{ video_id: '7400000000000000000' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('stage_1_done');
    const upsertCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT (task_id, video_id)'));
    expect(upsertCall).toBeTruthy();
    expect(JSON.stringify(upsertCall![1])).toContain('7400000000000000000');
    expect(mockResolveShareToMedia).not.toHaveBeenCalled();
  });
});

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
    // 先前 describe 可能 vi.resetAllMocks() 清空了 scoreLeads 的默认 resolvedValue，这里重新钉住
    vi.mocked(scoreLeads).mockReset().mockResolvedValue({ scored: 1 } as any);
  });

  const clientImpl = (row: Record<string, unknown>, videoStats = { total: 1, done: 1 }) =>
    async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) return { rows: [row] };
      if (s.includes('count(*)')) return { rows: [{ total: videoStats.total, done: videoStats.done }] };
      if (s.includes('SELECT 1 FROM zenithjoy.acquisition_collect_videos')) return { rows: [{ ok: 1 }] }; // 视频已登记
      if (s.includes('INSERT INTO zenithjoy.acquisition_leads') && s.includes('RETURNING')) return { rows: [{ id: 'lead-1' }] };
      return { rows: [] };
    };

  it('终态任务回报 → 200 ignored:true，零写库', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'done' })));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.ignored).toBe(true);
    expect(res.body.data.status).toBe('done');
    const writes = mockClientQuery.mock.calls.map((c) => String(c[0]))
      .filter((s) => s.startsWith('INSERT') || s.startsWith('UPDATE'));
    expect(writes).toHaveLength(0);
  });

  it('cancelling 任务回报 → 落章 cancelled，不写 leads', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'cancelling' })));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    const leadWrites = mockClientQuery.mock.calls.map((c) => String(c[0]))
      .filter((s) => s.includes('acquisition_leads'));
    expect(leadWrites).toHaveLength(0);
  });

  it('新取消合同等待物理回执时，普通评论回报保持 cancelling', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({
      status: 'cancelling',
      cancel_command_id: '00000000-0000-0000-0000-00000000ca11',
    })));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ignored: true, status: 'cancelling' });
    const prematureTerminalWrite = mockClientQuery.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => /UPDATE zenithjoy\.acquisition_collect_tasks[\s\S]*status\s*=\s*'cancelled'/i.test(sql));
    expect(prematureTerminalWrite).toBeUndefined();
  });

  it('回报 upsert 用 (task_id, video_id) 并打 comments_reported_at', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [] });
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const upsert = calls.find((s) => s.includes('INSERT INTO zenithjoy.acquisition_collect_videos'));
    expect(upsert).toMatch(/ON CONFLICT \(task_id, video_id\)/);
    expect(upsert).toMatch(/comments_reported_at/);
  });

  it('倒推逻辑已删：running 任务非终态回报不再因计数推进 stage_1_done', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ video_count: 2, keywords: ['k1'] }), { total: 3, done: 3 }));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v3', commenters: [] });
    expect(res.body.data.status).toBe('running');
  });

  it('stage_1_done 最后一个视频回完（无 terminal）→ 服务端自动 done + dispatch 点火一次', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'stage_1_done', lead_count_raw: 4 }), { total: 2, done: 2 }));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v2', commenters: [{ nickname: 'n9' }] });
    expect(res.body.data.status).toBe('done');
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(scoreLeads)).toHaveBeenCalledTimes(1);
  });

  it('未进终态的回报不点火 dispatch', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow({ status: 'stage_1_done' }), { total: 3, done: 1 }));
    await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [{ nickname: 'n1' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(scoreLeads)).not.toHaveBeenCalled();
  });

  it('error_code 不在五分类枚举里时，落库前归一为 UNKNOWN（防御未来 Android 版本传入新值）', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'SOME_BRAND_NEW_CODE' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    expect((updateCall as any)[1][2]).toBe('UNKNOWN');
  });

  it('error_code 不在五分类枚举里时，原始值必须持久化进 checkpoint.raw_error_code（不带客户端 checkpoint）', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'ALL_SHARE_FAILED' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('UNKNOWN');
    expect(JSON.parse(params[5])).toEqual({ raw_error_code: 'ALL_SHARE_FAILED' });
  });

  it('error_code 降级时，若客户端已传 checkpoint，合并写入而非覆盖', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({
        task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed',
        error_code: 'ALL_SHARE_FAILED',
        checkpoint: { last_video_id: 'v9' },
      });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    const params = (updateCall as any)[1];
    expect(JSON.parse(params[5])).toEqual({ last_video_id: 'v9', raw_error_code: 'ALL_SHARE_FAILED' });
  });

  it('error_code 已经是合法五分类值时，不追加 raw_error_code（保持改动前行为）', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'NETWORK_ERROR' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('NETWORK_ERROR');
    expect(params[5]).toBeNull();
  });

  it('error_code 已经是合法五分类值时，落库前原样透传', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'NETWORK_ERROR' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect((updateCall as any)[1][2]).toBe('NETWORK_ERROR');
  });
});

describe('POST /api/acquisition/collect/sweep-timeouts — stage_1_done 收尸 [BEHAVIOR]', () => {
  beforeEach(() => {
    // 先前 describe 可能 vi.resetAllMocks() 清空了 scoreLeads/buildAssignments/dispatchDue 的默认 resolvedValue，这里重新钉住
    vi.mocked(scoreLeads).mockReset().mockResolvedValue({ scored: 1 } as any);
  });

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
      .set('X-Smoke-Token', 'smoke-secret-2026').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.swept).toBe(2);
    const calls = vi.mocked(db.query).mock.calls.map((c) => String(c[0]));
    const sel = calls.find((s) => s.includes('lead_count'));
    expect(sel).toMatch(/stage_1_done/);
    expect(sel).toMatch(/updated_at/);
    const updateCalls = vi.mocked(db.query).mock.calls.filter((c) => String(c[0]).trim().startsWith('UPDATE'));
    expect(updateCalls).toHaveLength(2);
    // 各条 UPDATE 都带乐观守卫 AND status = $4，且参数里分别带各自结算后的状态值
    for (const c of updateCalls) {
      expect(String(c[0])).toMatch(/AND status = \$4/);
    }
    const statuses = updateCalls.map((c) => (c[1] as unknown[])[1]);
    expect(statuses).toContain('partial');
    expect(statuses).toContain('failed');
  });

  it('sweep 收尸 partial 且有 leads → 补点火 dm-dispatch 链（同租户只触发一次）', async () => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('SELECT') && s.includes('lead_count')) {
        return { rows: [
          { id: 'task-a', tenant_id: 'tenant-1', status: 'stage_1_done', lead_count: 3 },
          { id: 'task-b', tenant_id: 'tenant-1', status: 'running', lead_count: 0 },
        ] } as any;
      }
      return { rows: [{ id: 'x' }] } as any;
    });
    const res = await request(app).post('/api/acquisition/collect/sweep-timeouts')
      .set('X-Smoke-Token', 'smoke-secret-2026').send({});
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    // task-a 结算为 partial 且 lead_count=3>0 → 点火一次；task-b 结算为 failed → 不点火
    expect(vi.mocked(scoreLeads)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scoreLeads)).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
  });
});

// ────── bug D 回归：Stage2 失败重发风暴（2026-07-10 Honor 真机实锤）──────
// 根因链：/pending-collect-tasks 只发 video_urls 不带 video_id → agent 对非数字 ID
// 用 hash fallback 反推 → /collect/report 收到未登记 video_id 盲插新行并落章，
// 原登记行永不落章 → 每次轮询重发同一批视频，无限风暴 + 视频表污染。
// 服务端两层防御：①report 拒绝未登记 video_id 的视频行写入 ②派发计数超上限强制落章。
describe('POST /api/acquisition/collect/report — 未登记 video_id 不建视频行 [REGRESSION]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('video_id 未在 Stage1 登记 → 不写 acquisition_collect_videos（防 hash fallback ID 污染），leads 照常入库', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-d1', tenant_id: 't-d', status: 'stage_1_done', error_code: null, video_count: 3, lead_count_raw: 0, keywords: ['k'] }] };
      }
      // 登记校验：该 (task_id, video_id) 不存在
      if (s.includes('FROM zenithjoy.acquisition_collect_videos') && s.includes('video_id')) return { rows: [] };
      if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) return { rows: [] };
      if (s.includes('INSERT INTO zenithjoy.acquisition_leads') && s.includes('RETURNING')) return { rows: [{ id: 'lead-d1' }] };
      if (s.includes('count(*)')) return { rows: [{ total: 3, done: 0 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: 'task-d1',
        video_id: 'video_e33nwu',
        commenters: [{ nickname: '路人甲', comment_text: '多少钱' }],
      });

    expect(res.status).toBe(200);
    const calls = mockClientQuery.mock.calls;
    const videoWrite = calls.find((c: any[]) =>
      /(INSERT INTO|UPDATE) zenithjoy\.acquisition_collect_videos/.test(String(c[0])));
    expect(videoWrite).toBeUndefined();
    // leads 数据不因视频行拒写而丢
    const leadInsert = calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_leads/.test(String(c[0])));
    expect(leadInsert).toBeTruthy();
  });

  it('已登记 video_id → 照常落章 comments_reported_at（守卫不破坏正常路径）', async () => {
    mockClientQuery.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'task-d2', tenant_id: 't-d', status: 'stage_1_done', error_code: null, video_count: 1, lead_count_raw: 0, keywords: ['k'] }] };
      }
      if (s.includes('FROM zenithjoy.acquisition_collect_videos') && s.includes('video_id') && s.trimStart().startsWith('SELECT')) {
        return { rows: [{ video_id: '7123456789' }] }; // 已登记
      }
      if (s.includes('count(*)')) return { rows: [{ total: 1, done: 1 }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({ task_id: 'task-d2', video_id: '7123456789', commenters: [] });

    expect(res.status).toBe(200);
    const videoWrite = mockClientQuery.mock.calls.find((c: any[]) =>
      /(INSERT INTO|UPDATE) zenithjoy\.acquisition_collect_videos/.test(String(c[0])));
    expect(videoWrite).toBeTruthy();
    expect(String(videoWrite![0])).toMatch(/comments_reported_at/);
  });
});

describe('GET /api/acquisition/pending-collect-tasks — Stage2 派发上限 [REGRESSION]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const mockAgentAndTask = (checkpoint: Record<string, unknown>, videos: Array<{ task_id: string; video_id: string }>) => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FROM zenithjoy.agents')) return { rows: [{ tenant_id: 't-1' }] } as any;
      if (s.includes('FROM zenithjoy.acquisition_collect_tasks')) {
        return { rows: [{ id: 'task-cap', keywords: ['k'], tenant_id: 't-1', status: 'stage_1_done', checkpoint }] } as any;
      }
      if (s.includes('FROM zenithjoy.acquisition_collect_videos')) return { rows: videos } as any;
      return { rows: [] } as any;
    });
  };

  it('视频派发次数达上限 → 强制落章、不再下发、任务结算 partial/STAGE2_DISPATCH_EXHAUSTED', async () => {
    mockAgentAndTask(
      { stage2_dispatch_counts: { 'card_0_dead': 10 } },
      [{ task_id: 'task-cap', video_id: 'card_0_dead' }]
    );

    const res = await request(app).get('/api/acquisition/pending-collect-tasks').set('x-agent-id', 'agent-1');
    expect(res.status).toBe(200);

    // 耗尽视频不再出现在下发列表
    const dispatched = (res.body.tasks as Array<{ task_id: string; video_urls?: string[] }>)
      .find((t) => t.task_id === 'task-cap');
    expect(dispatched?.video_urls ?? []).toEqual([]);

    const calls = vi.mocked(db.query).mock.calls.map((c) => [String(c[0]), c[1]] as const);
    // 强制落章耗尽视频
    const settleVideo = calls.find(([s]) => /UPDATE zenithjoy\.acquisition_collect_videos/.test(s) && /comments_reported_at/.test(s));
    expect(settleVideo).toBeTruthy();
    // 无视频可派 → 任务结算 partial + STAGE2_DISPATCH_EXHAUSTED
    const settleTask = calls.find(([s]) => /UPDATE zenithjoy\.acquisition_collect_tasks/.test(s) && /STAGE2_DISPATCH_EXHAUSTED|partial/.test(s + ''));
    expect(settleTask).toBeTruthy();
  });

  it('未达上限 → 正常下发，且派发计数写回 checkpoint', async () => {
    mockAgentAndTask(
      { stage2_dispatch_counts: { 'card_0_live': 2 } },
      [{ task_id: 'task-cap', video_id: 'card_0_live' }]
    );

    const res = await request(app).get('/api/acquisition/pending-collect-tasks').set('x-agent-id', 'agent-1');
    expect(res.status).toBe(200);
    const dispatched = (res.body.tasks as Array<{ task_id: string; video_urls?: string[] }>)
      .find((t) => t.task_id === 'task-cap');
    expect(dispatched?.video_urls).toEqual(['https://www.douyin.com/video/card_0_live']);

    // 计数 +1 写回 checkpoint
    const checkpointWrite = vi.mocked(db.query).mock.calls
      .find((c) => /UPDATE zenithjoy\.acquisition_collect_tasks/.test(String(c[0])) && /checkpoint/.test(String(c[0])));
    expect(checkpointWrite).toBeTruthy();
    expect(JSON.stringify(checkpointWrite![1])).toContain('"card_0_live":3');
  });
});

// ────── Bug C 回归：note 图文类型 Stage2 URL 分流 ──────
// checkpoint.media_kinds 标记为 note 的视频，下发 URL 用 /note/ 而非 /video/，
// 使 agent Stage2 深链能按类型正确打开图文详情页。
describe('GET /api/acquisition/pending-collect-tasks — note 类型 URL 分流 [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const mockAgentAndTask = (checkpoint: Record<string, unknown>, videos: Array<{ task_id: string; video_id: string }>) => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('FROM zenithjoy.agents')) return { rows: [{ tenant_id: 't-1' }] } as any;
      if (s.includes('FROM zenithjoy.acquisition_collect_tasks')) {
        return { rows: [{ id: 'task-note', keywords: ['k'], tenant_id: 't-1', status: 'stage_1_done', checkpoint }] } as any;
      }
      if (s.includes('FROM zenithjoy.acquisition_collect_videos')) return { rows: videos } as any;
      return { rows: [] } as any;
    });
  };

  it('media_kinds 标 note → 下发 /note/ URL；未标记默认 /video/', async () => {
    mockAgentAndTask(
      { media_kinds: { '7411111111111111111': 'note' } },
      [
        { task_id: 'task-note', video_id: '7411111111111111111' },
        { task_id: 'task-note', video_id: '7422222222222222222' },
      ],
    );
    const res = await request(app).get('/api/acquisition/pending-collect-tasks').set('x-agent-id', 'agent-1');
    expect(res.status).toBe(200);
    const dispatched = (res.body.tasks as Array<{ task_id: string; video_urls?: string[] }>)
      .find((t) => t.task_id === 'task-note');
    expect(dispatched?.video_urls).toContain('https://www.douyin.com/note/7411111111111111111');
    expect(dispatched?.video_urls).toContain('https://www.douyin.com/video/7422222222222222222');
  });
});
// ============================================================================
// POST /api/acquisition/judge-video — 从 x-agent-id 反查真 tenant [REGRESSION]
// 背景：安卓 agent 按设计发 X-Tenant-Id = agentId（设备不持有真 tenant）。
// 服务端必须像 pending-collect-tasks / report-videos 一样用 x-agent-id 反查
// zenithjoy.agents 拿真 tenant_id，而不是信 header 里的假值 → 否则查空画像
// 只返回 matched 不写库，judgment_status 永远 pending。
// ============================================================================
describe('POST /api/acquisition/judge-video — x-agent-id 反查 tenant [REGRESSION]', () => {
  const REAL_TENANT = 'a7a7b36c-1111-2222-3333-444455556666';
  const AGENT_ID = 'agent-maa-an00-xxx';

  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    mockJudgeVideo.mockReset().mockResolvedValue({ status: 'matched', reason: 'ok' });
  });

  it('用 x-agent-id 反查出的真 tenant 调 judgeVideo（忽略 X-Tenant-Id header 假值）', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ tenant_id: REAL_TENANT }] } as any);
    const res = await request(app)
      .post('/api/acquisition/judge-video')
      .set('x-agent-id', AGENT_ID)
      .set('X-Tenant-Id', 'fake-tenant-from-agent') // agent 发的假值，服务端不能信
      .send({ video_id: '7412345678901234567', capture_type: 'screenshot', data_b64: 'AAAA' });

    expect(res.status).toBe(200);

    // 反查走 zenithjoy.agents 表，参数 = x-agent-id
    const lookup = vi.mocked(db.query).mock.calls.find((c) => /FROM zenithjoy\.agents/.test(String(c[0])));
    expect(lookup).toBeTruthy();
    expect(lookup?.[1]).toEqual([AGENT_ID]);

    // judgeVideo 用反查出的真 tenant，而不是 header 里的假值
    expect(mockJudgeVideo).toHaveBeenCalledTimes(1);
    expect(mockJudgeVideo.mock.calls[0][1]).toBe(REAL_TENANT);
    expect(mockJudgeVideo.mock.calls[0][1]).not.toBe('fake-tenant-from-agent');
  });

  it('缺 x-agent-id → 401 MISSING_AGENT_ID，不调 judgeVideo', async () => {
    const res = await request(app)
      .post('/api/acquisition/judge-video')
      .send({ video_id: '7412345678901234567', capture_type: 'screenshot', data_b64: 'AAAA' });

    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('MISSING_AGENT_ID');
    expect(mockJudgeVideo).not.toHaveBeenCalled();
  });

  it('x-agent-id 查不到 agent → 403 AGENT_NOT_FOUND，不调 judgeVideo', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
    const res = await request(app)
      .post('/api/acquisition/judge-video')
      .set('x-agent-id', 'agent-unknown')
      .send({ video_id: '7412345678901234567', capture_type: 'screenshot', data_b64: 'AAAA' });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('AGENT_NOT_FOUND');
    expect(mockJudgeVideo).not.toHaveBeenCalled();
  });
});

describe('POST /api/acquisition/account-scan/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无在线 android 设备 → 400 NO_ONLINE_ANDROID_AGENT', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // 查在线 android agent 为空

    const res = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-1')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NO_ONLINE_ANDROID_AGENT');
  });

  it('有在线 android 设备 → 200，写入 publish_tasks(task_type=account_scan)', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] }) // 查在线 android agent
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid-1' }] }); // INSERT publish_tasks

    // 用独立租户 id（而非上一个用例的 'tenant-1'）：本路由挂了 max=1/60s 的按租户限流
    // 中间件，express-rate-limit 的计数器是模块级单例、跨同文件内的用例持久存在，且
    // 默认对所有响应状态码计数（无 skipFailedRequests）。若复用 'tenant-1'，上一个
    // 用例（400 NO_ONLINE_ANDROID_AGENT）会先占满这个租户 60 秒内仅有的 1 次配额，
    // 导致本用例被限流命中 429 而非验证到位的 200——用独立租户隔离两个用例互不干扰。
    const res = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-account-scan-success')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.task_id).toBe('task-uuid-1');

    const insertCall = (db.query as any).mock.calls[1];
    expect(insertCall[0]).toContain('publish_tasks');
    expect(insertCall[0]).toContain('account_scan');

    // 真机链路关键点：walking-skeleton.ts 心跳拉取端点只把 payload JSON 列内容
    // 透传给设备，DB COLUMN task_type 从不下发。payload 里必须自带 task_type，
    // 否则设备端 AgentService.kt 读不到 task.payload["task_type"]，任务写进库
    // 但设备永远不会识别执行（对照 agent-burner.ts dm_outreach 的写法）。
    const payloadParam = insertCall[1].find(
      (p: unknown) => typeof p === 'string' && p.includes('task_type'),
    );
    expect(payloadParam).toBeDefined();
    expect(JSON.parse(payloadParam)).toMatchObject({ task_type: 'account_scan' });
  });

  it('缺租户上下文 → 401 NO_TENANT', async () => {
    const res = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TENANT');
  });

  it('60秒内重复触发同一租户 → 第二次 429 RATE_LIMITED', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValue({ rows: [{ id: 'agent-uuid-1' }] });

    const first = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-rate-limit-test')
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-rate-limit-test')
      .send({});
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
  });
});

// ────── Android 信号上报 sprint Task5 — 最小消费验证端点 ──────
describe('GET /api/acquisition/leads/:id/signal-status [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const VALID_LEAD_ID = '22222222-2222-2222-2222-222222222222';

  it('无 tenant 上下文 → 401 NO_TENANT', async () => {
    const res = await request(app).get(`/api/acquisition/leads/${VALID_LEAD_ID}/signal-status`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TENANT');
  });

  it('非法 UUID → 404（不查库、不 500）', async () => {
    const res = await request(app)
      .get('/api/acquisition/leads/not-a-uuid/signal-status')
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
  });

  it('线索不存在（或不属于本 tenant）→ 404', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] }); // lead 查询空
    const res = await request(app)
      .get(`/api/acquisition/leads/${VALID_LEAD_ID}/signal-status`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
  });

  it('跨 tenant 访问他人线索 → 404（IDOR，不泄露存在性）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any).mockResolvedValueOnce({ rows: [] }); // WHERE tenant_id=$2 过滤掉别人的线索
    const res = await request(app)
      .get(`/api/acquisition/leads/${VALID_LEAD_ID}/signal-status`)
      .set('x-test-tenant-id', 'tenant-b');
    expect(res.status).toBe(404);
  });

  it('GET /leads/:id/signal-status 能读出在线状态+失败原因+评论同步时间戳', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({
        rows: [{ latest_reply: '好的，加一下', latest_reply_at: '2026-07-22T09:00:00Z' }],
      }) // lead 归属校验 + latest_reply
      .mockResolvedValueOnce({
        rows: [{ account_label: 'burner-1', status: 'active', last_heartbeat_at: new Date().toISOString() }],
      }) // burner session 在线状态
      .mockResolvedValueOnce({ rows: [{ error_code: 'NETWORK_ERROR' }] }); // 最近一次采集任务失败原因

    const res = await request(app)
      .get(`/api/acquisition/leads/${VALID_LEAD_ID}/signal-status`)
      .set('x-test-tenant-id', 'tenant-a');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('account_online');
    expect(res.body.data.account_online).toEqual([
      expect.objectContaining({ account_label: 'burner-1', status: 'active', heartbeat_fresh: true }),
    ]);
    expect(res.body.data).toHaveProperty('last_collect_error_code', 'NETWORK_ERROR');
    expect(res.body.data).toHaveProperty('latest_reply', '好的，加一下');
    expect(res.body.data).toHaveProperty('latest_reply_at', '2026-07-22T09:00:00Z');
  });

  it('account_online 查询须过滤 platform=douyin，避免未来其它平台 burner session 混入 [全分支复审]', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ latest_reply: null, latest_reply_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get(`/api/acquisition/leads/${VALID_LEAD_ID}/signal-status`)
      .set('x-test-tenant-id', 'tenant-a');

    const onlineCall = (mod.default.query as any).mock.calls.find((c: unknown[]) =>
      /FROM zenithjoy\.agent_platform_sessions/i.test(String(c[0]))
    );
    expect(onlineCall).toBeDefined();
    expect(String(onlineCall[0])).toMatch(/platform\s*=\s*'douyin'/);
  });
});
