/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acquisitionRouter } from './acquisition';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
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

vi.mock('../services/keyword-expander', () => ({
  expandKeywords: vi.fn().mockResolvedValue(['装修', '装修公司', '室内装修', '家装', '装修报价']),
}));
vi.mock('../services/comment-grader', () => ({
  gradeComment: vi.fn().mockResolvedValue('感兴趣'),
}));
vi.mock('../services/lead-writer', () => ({
  writeLeadsFromComments: vi.fn().mockResolvedValue({ written_count: 1, lead_write_status: 'success' }),
}));
vi.mock('../services/acquisition-dispatch', () => ({
  scoreLeads: vi.fn().mockResolvedValue({ scored: 1 }),
  buildAssignments: vi.fn().mockResolvedValue({ assigned: 1 }),
  dispatchDue: vi.fn().mockResolvedValue({ dispatched: 1 }),
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

describe('POST /api/acquisition/keyword-search', () => {
  it('returns 400 when keyword is missing', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 400 when keyword is empty string', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 400 when keyword is not a string', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 200 with task_id and keywords (VITEST mode)', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: '装修' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task_id');
    expect(res.body).toHaveProperty('keywords');
    expect(Array.isArray(res.body.keywords)).toBe(true);
    expect(typeof res.body.task_id).toBe('string');
  });

  it('task_id is UUID format', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: '家装' });
    expect(res.body.task_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /api/acquisition/pending-keyword-tasks', () => {
  it('returns 200 with empty tasks in VITEST mode', async () => {
    const res = await request(app).get('/api/acquisition/pending-keyword-tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.total).toBe(0);
  });
});

describe('POST /api/acquisition/video-search-result', () => {
  it('returns 400 when keyword_task_id is missing', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ videos: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD_TASK_ID');
  });

  it('returns 200 with received:true and video_count', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({
        keyword_task_id: 'test-id',
        keyword: '装修',
        videos: [{ video_url: 'https://douyin.com/v/1' }, { video_url: 'https://douyin.com/v/2' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.video_count).toBe(2);
  });

  it('video_count is 0 for empty videos array', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ keyword_task_id: 'test-id', videos: [] });
    expect(res.body.video_count).toBe(0);
  });

  it('video_count is 0 when videos is not an array', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ keyword_task_id: 'test-id', videos: null });
    expect(res.body.video_count).toBe(0);
  });
});

describe('POST /api/acquisition/comment-score-result', () => {
  // regression(2026-07-02): 评论写库后必须自动触发 buildAssignments+dispatchDue
  it('triggers dm dispatch after writing leads', async () => {
    const { buildAssignments, dispatchDue } = await import('../services/acquisition-dispatch');
    vi.mocked(buildAssignments).mockClear();
    vi.mocked(dispatchDue).mockClear();

    const comments = [{ commenter_id: '/user/uid1', text: '请问怎么联系您' }];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-001', video_url: 'https://douyin.com/v/1', comments });

    expect(res.status).toBe(200);
    expect(res.body.written_count).toBe(1);
    // 等 fire-and-forget promise 完成
    await new Promise(r => setTimeout(r, 20));
    expect(buildAssignments).toHaveBeenCalledTimes(1);
    expect(dispatchDue).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger dm dispatch when comments are empty', async () => {
    const { buildAssignments } = await import('../services/acquisition-dispatch');
    vi.mocked(buildAssignments).mockClear();

    await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-001', comments: [] });

    await new Promise(r => setTimeout(r, 20));
    expect(buildAssignments).not.toHaveBeenCalled();
  });

  it('returns 400 when keyword_task_id is missing', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ comments: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD_TASK_ID');
  });

  it('returns 200 with written_count=0 for empty comments', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'test-id', comments: [] });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.written_count).toBe(0);
    expect(res.body.comment_count).toBe(0);
  });

  it('VITEST mode: written_count equals comment count', async () => {
    const comments = [
      { commenter_id: 'u1', text: '请问怎么联系', publish_time: '2026-05-25T00:00:00Z' },
      { commenter_id: 'u2', text: '感觉不错', publish_time: '2026-05-25T00:00:00Z' },
    ];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'test-id', video_url: 'https://douyin.com/v/1', comments });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.written_count).toBe(2);
    expect(res.body.comment_count).toBe(2);
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

// ────── Bug：comment-score-result 用 SELECT ... LIMIT 1 猜租户，写错客户账号 [REGRESSION] ──────
describe('POST /api/acquisition/comment-score-result — tenant 从 keyword_task_id 反查 [REGRESSION]', () => {
  beforeEach(async () => {
    vi.stubEnv('VITEST', '');
    vi.clearAllMocks();
    const { default: db } = await import('../db/connection');
    (db.query as any).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('按 keyword_task_id 反查真实 tenant_id 写入 lead，不是 SELECT tenants LIMIT 1', async () => {
    const { default: db } = await import('../db/connection');
    const REAL_TENANT = 'dddddddd-0000-0000-0000-000000000004';

    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: REAL_TENANT }] }) // 反查 keyword_task 归属
      .mockResolvedValueOnce({ rows: [] }); // INSERT acquisition_leads

    const comments = [{ commenter_id: '/user/uid-x', text: '怎么联系' }];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-real-001', video_url: 'https://douyin.com/v/1', comments });

    expect(res.status).toBe(200);
    expect(res.body.written_count).toBe(1);

    const calls = (db.query as any).mock.calls;
    expect(calls[0][0]).not.toMatch(/tenants\s+LIMIT\s+1/i);
    expect(calls[0][0]).toMatch(/acquisition_keyword_tasks/);
    expect(calls[0][1]).toEqual(['kw-real-001']);

    const insertCall = calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_leads/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall![1][0]).toBe(REAL_TENANT);
  });

  it('keyword_task_id 查不到归属租户 → 不写入任何 lead（不再兜底猜任意租户）', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // 查不到归属

    const comments = [{ commenter_id: '/user/uid-y', text: '价格多少' }];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-orphan', video_url: 'https://douyin.com/v/1', comments });

    expect(res.status).toBe(200);
    expect(res.body.written_count).toBe(0);
    const calls = (db.query as any).mock.calls;
    expect(calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_leads/.test(c[0]))).toBeUndefined();
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

// ────── Bug A 回归：keyword-search agent 门禁改用 agents 表 ──────
describe('POST /api/acquisition/keyword-search — agent 门禁用 agents 表 [REGRESSION]', () => {
  it('源码不再检查 agent_platform_sessions role=main（只能用 burner 的 rog 不再被拦）', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, './acquisition.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/agent_platform_sessions.*role.*main/);
    expect(src).not.toMatch(/role.*main.*agent_platform_sessions/);
  });
  it('源码改为检查 agents 表 status=online', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, './acquisition.ts'),
      'utf8',
    );
    expect(src).toMatch(/agents.*status.*=.*online|agents.*online/);
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
    expect(params).toEqual(['tenant-A', 'agent-A']);
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
  beforeEach(() => { vi.clearAllMocks(); });

  it('无 X-Smoke-Token 也能调用（不返回 403）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', tenant_id: 't1', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0 }] }) // SELECT task
      .mockResolvedValueOnce({ rows: [] }) // SELECT for sec_uid dedup (empty commenters batch, won't hit)
      .mockResolvedValueOnce({ rows: [] }); // UPDATE status
    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({ task_id: 'task-1', video_id: 'no_videos', commenters: [], terminal: true });
    // agent 无 smoke token 下不应被 403 拒，status 不能是 403
    expect(res.status).not.toBe(403);
  });

  it('有 task_id + video_id → 终态回报可达（不返回 403 Forbidden）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', tenant_id: 't2', status: 'running', error_code: null, video_count: 0, lead_count_raw: 0 }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({ task_id: 'task-2', video_id: '7123456789', commenters: [], terminal: true });
    expect(res.status).not.toBe(403);
  });
});

  it('scoreLeads is called before buildAssignments so dm_assignments get created', async () => {
    const { scoreLeads, buildAssignments, dispatchDue } = await import('../services/acquisition-dispatch');
    vi.mocked(scoreLeads).mockClear();
    vi.mocked(buildAssignments).mockClear();
    vi.mocked(dispatchDue).mockClear();
    const comments = [{ commenter_id: '/user/score_test_001', text: '怎么联系您' }];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-score-test', video_url: 'https://douyin.com/v/score1', comments });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    // scoreLeads 必须先于 buildAssignments 被调用
    expect(scoreLeads).toHaveBeenCalledTimes(1);
    expect(buildAssignments).toHaveBeenCalledTimes(1);
    const scoreOrder = vi.mocked(scoreLeads).mock.invocationCallOrder[0];
    const buildOrder = vi.mocked(buildAssignments).mock.invocationCallOrder[0];
    expect(scoreOrder).toBeLessThan(buildOrder);
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
      .mockResolvedValueOnce({ rows: [{ id: VALID_TASK_ID }] }) // task 归属校验
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

describe('GET /api/acquisition/pending-keyword-tasks — tenant 隔离', () => {
  beforeEach(() => {
    vi.stubEnv('VITEST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('无 x-agent-license header 时返回空任务列表（不泄漏任何租户数据）', async () => {
    // 无 license header → handler 提前返回，不会查 DB，无需设置 mock
    const res = await request(app)
      .get('/api/acquisition/pending-keyword-tasks');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  // regression(2026-07-03): license 无效时不能把别人的任务返回出去
  it('license 无效（licenses 表无此 key）→ 返回空任务，不查 acquisition_keyword_tasks', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // licenses 表无记录

    const res = await request(app)
      .get('/api/acquisition/pending-keyword-tasks')
      .set('x-agent-license', 'ZJ-INVALID-KEY');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.total).toBe(0);
    // 只查过 licenses 表一次，没有继续查 acquisition_keyword_tasks
    expect((db.query as any).mock.calls).toHaveLength(1);
  });

  it('只返回本租户任务，不返回其他租户任务', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';

    (db.query as any).mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }] });
    (db.query as any).mockResolvedValueOnce({
      rows: [{ id: 'task-a1', keyword: '美甲', expanded_keywords: ['美甲', '指甲'] }],
    });
    (db.query as any).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/acquisition/pending-keyword-tasks')
      .set('x-agent-license', 'ZJ-A-TESTTEST');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].task_id).toBe('task-a1');
    expect(res.body.tasks[0].keyword).toBe('美甲');
  });

  // regression(2026-07-03): SELECT 和 UPDATE 必须都过 tenant_id，防 TOCTOU 越权抢占
  it('SELECT 和 UPDATE 都用 tenant_id 过滤（防跨租户任务抢占）', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

    (db.query as any).mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_B }] });
    (db.query as any).mockResolvedValueOnce({
      rows: [{ id: 'task-b1', keyword: '装修', expanded_keywords: ['装修'] }],
    });
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // UPDATE

    await request(app)
      .get('/api/acquisition/pending-keyword-tasks')
      .set('x-agent-license', 'ZJ-B-TESTTEST');

    const calls = (db.query as any).mock.calls;
    // SELECT tasks 必须带 tenant_id
    expect(JSON.stringify(calls[1][1])).toContain(TENANT_B);
    // UPDATE to processing 也必须带 tenant_id（防 TOCTOU 越权更新）
    expect(JSON.stringify(calls[2][1])).toContain(TENANT_B);
  });
});

// regression(2026-07-03): keyword-search 必须把 tenant_id 写进任务行
describe('POST /api/acquisition/keyword-search — tenant_id 写库', () => {
  beforeEach(() => {
    vi.stubEnv('VITEST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('带 X-Tenant-Id header 时 tenant_id 作为 $4 写入 INSERT', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_C = 'cccccccc-0000-0000-0000-000000000003';

    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] }) // agents online 检查
      .mockResolvedValueOnce({ rows: [] });                  // INSERT

    await request(app)
      .post('/api/acquisition/keyword-search')
      .set('X-Tenant-Id', TENANT_C)
      .send({ keyword: '美甲' });

    const insertCall = (db.query as any).mock.calls[1];
    // $4 = tenant_id
    expect(insertCall[1][3]).toBe(TENANT_C);
  });

  it('无 tenant header 时 tenant_id 写 null，不返回 500', async () => {
    const { default: db } = await import('../db/connection');

    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '装修' });

    expect(res.status).toBe(200);
    const insertCall = (db.query as any).mock.calls[1];
    expect(insertCall[1][3]).toBeNull();
  });
});
