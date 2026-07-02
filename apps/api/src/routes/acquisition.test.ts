/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
