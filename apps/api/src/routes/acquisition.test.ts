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

describe('POST /api/acquisition/keyword-search', () => {
  it('returns 400 when keyword is missing', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .set('x-test-tenant-id', '11111111-1111-1111-1111-111111111111')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 400 when keyword is empty string', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .set('x-test-tenant-id', '11111111-1111-1111-1111-111111111111')
      .send({ keyword: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 400 when keyword is not a string', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .set('x-test-tenant-id', '11111111-1111-1111-1111-111111111111')
      .send({ keyword: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 200 with task_id and keywords (VITEST mode)', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .set('x-test-tenant-id', '11111111-1111-1111-1111-111111111111')
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
      .set('x-test-tenant-id', '11111111-1111-1111-1111-111111111111')
      .send({ keyword: '家装' });
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

  // regression: 空评论一直静默 200 不更新任务状态，acquisition_keyword_tasks 永久卡 processing
  it('[REGRESSION] 空评论 → acquisition_keyword_tasks 状态更新为 failed，不再永久卡 processing', async () => {
    vi.stubEnv('VITEST', '');
    try {
      const { default: db } = await import('../db/connection');
      vi.mocked(db.query).mockReset();
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);

      const res = await request(app)
        .post('/api/acquisition/comment-score-result')
        .send({ keyword_task_id: 'kw-empty-1', comments: [] });

      expect(res.status).toBe(200);
      expect(res.body.written_count).toBe(0);
      const updateCall = vi.mocked(db.query).mock.calls.find((c) =>
        String(c[0]).includes('UPDATE') && String(c[0]).includes('acquisition_keyword_tasks'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toContain('kw-empty-1');
      expect(String(updateCall?.[0])).toMatch(/status\s*=\s*'failed'/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // regression: 抓到评论、写库成功(HTTP 200)，但 acquisition_keyword_tasks.status
  // 从未被标记为 done——真机复现:任务永久卡 processing，即使 leads 已经写库成功。
  it('[REGRESSION] 抓到评论写库成功 → acquisition_keyword_tasks 状态更新为 done', async () => {
    vi.stubEnv('VITEST', '');
    try {
      const { default: db } = await import('../db/connection');
      vi.mocked(db.query).mockReset();
      vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('SELECT tenant_id FROM zenithjoy.acquisition_keyword_tasks')) {
          return { rows: [{ tenant_id: 'tenant-done-1' }] } as any;
        }
        if (s.includes('SELECT id FROM zenithjoy.acquisition_leads')) {
          return { rows: [] } as any;
        }
        if (s.includes('INSERT INTO zenithjoy.acquisition_leads')) {
          return { rows: [{ id: 'lead-done-1' }] } as any;
        }
        return { rows: [] } as any;
      });

      const res = await request(app)
        .post('/api/acquisition/comment-score-result')
        .send({
          keyword_task_id: 'kw-done-1',
          video_url: 'https://douyin.com/v/1',
          comments: [{ commenter_id: 'u1', text: '请问怎么联系', grade: '高意向' }],
        });

      expect(res.status).toBe(200);
      const updateCall = vi.mocked(db.query).mock.calls.find((c) =>
        String(c[0]).includes('UPDATE') &&
        String(c[0]).includes('acquisition_keyword_tasks'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toContain('kw-done-1');
      expect(String(updateCall?.[0])).toMatch(/status\s*=\s*'done'/);
    } finally {
      vi.unstubAllEnvs();
    }
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
      .mockResolvedValueOnce({ rows: [] })                           // SELECT 既有 lead → 无
      .mockResolvedValueOnce({ rows: [{ id: 'lead-x' }] })           // INSERT lead RETURNING id
      .mockResolvedValueOnce({ rows: [] });                          // INSERT 评论历史

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

// ────── 每次留言都写进 acquisition_lead_comments 历史表 + rescore [REGRESSION] ──────
// 根因：旧逻辑同一人第二次留言时只把 video_id 追加进 source_video_ids，评论内容与 grade
// 全被丢弃（只保留首条）。现在不管新老用户，每条评论都进历史表并触发 rescoreLead 重算相关性分。
describe('POST /api/acquisition/comment-score-result — 评论历史 + rescore [REGRESSION]', () => {
  beforeEach(async () => {
    vi.stubEnv('VITEST', '');
    vi.clearAllMocks();
    const { default: db } = await import('../db/connection');
    (db.query as any).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('全新 sec_uid 首次留言 → 建新 lead + 也写一条评论历史 + rescore', async () => {
    const { default: db } = await import('../db/connection');
    const { rescoreLead } = await import('../services/acquisition-dispatch');
    const TENANT = 'a1111111-0000-0000-0000-000000000001';

    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }] }) // keyword_task 反查
      .mockResolvedValueOnce({ rows: [] })                      // SELECT 既有 lead → 无
      .mockResolvedValueOnce({ rows: [{ id: 'lead-new' }] })    // INSERT lead RETURNING id
      .mockResolvedValueOnce({ rows: [] });                     // INSERT 评论历史

    const comments = [{ commenter_id: '/user/uid-new', text: '怎么加盟' }];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-hist-1', video_url: 'https://douyin.com/v/1', comments });

    expect(res.status).toBe(200);
    expect(res.body.written_count).toBe(1);

    const calls = (db.query as any).mock.calls;
    // 建了新 lead
    expect(calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_leads/.test(c[0]))).toBeTruthy();
    // 首条留言也进历史表
    const histInsert = calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_lead_comments/.test(c[0]));
    expect(histInsert).toBeTruthy();
    // grade 由 gradeComment mock 返回 '感兴趣'
    expect(histInsert![1]).toEqual(['lead-new', 'https://douyin.com/v/1', '怎么加盟', '感兴趣']);
    expect(rescoreLead).toHaveBeenCalledWith(expect.anything(), TENANT, 'lead-new');
  });

  it('同一 sec_uid 第二次上报不同评论 → 不建新 lead，但写入新评论历史 + rescore（不是只更新 source_video_ids）', async () => {
    const { default: db } = await import('../db/connection');
    const { rescoreLead } = await import('../services/acquisition-dispatch');
    const TENANT = 'b2222222-0000-0000-0000-000000000002';

    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }] }) // keyword_task 反查
      .mockResolvedValueOnce({ rows: [{ id: 'lead-old' }] })    // SELECT 既有 lead → 命中
      .mockResolvedValueOnce({ rows: [] })                      // UPDATE source_video_ids 累加
      .mockResolvedValueOnce({ rows: [] });                     // INSERT 评论历史

    const comments = [{ commenter_id: '/user/uid-old', text: '第二条留言：价格多少', grade: '精准' }];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'kw-hist-2', video_url: 'https://douyin.com/v/2', comments });

    expect(res.status).toBe(200);
    expect(res.body.written_count).toBe(1);

    const calls = (db.query as any).mock.calls;
    // 命中老 lead → 不再 INSERT 新 lead 行
    expect(calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_leads/.test(c[0]))).toBeUndefined();
    // 但一定写了这条评论的历史（内容 + grade 不丢）
    const histInsert = calls.find((c: any[]) => /INSERT INTO zenithjoy\.acquisition_lead_comments/.test(c[0]));
    expect(histInsert).toBeTruthy();
    expect(histInsert![1]).toEqual(['lead-old', 'https://douyin.com/v/2', '第二条留言：价格多少', '精准']);
    // 命中老 lead 也要重算相关性分
    expect(rescoreLead).toHaveBeenCalledWith(expect.anything(), TENANT, 'lead-old');
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

    (db.query as any).mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }] }); // license lookup
    (db.query as any).mockResolvedValueOnce({ rows: [{ balance: 100 }] });         // credit balance check
    (db.query as any).mockResolvedValueOnce({
      rows: [{ id: 'task-a1', keyword: '美甲', expanded_keywords: ['美甲', '指甲'] }],
    });
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // UPDATE to processing

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

    (db.query as any).mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_B }] });  // license lookup
    (db.query as any).mockResolvedValueOnce({ rows: [{ balance: 100 }] });          // credit balance check
    (db.query as any).mockResolvedValueOnce({
      rows: [{ id: 'task-b1', keyword: '装修', expanded_keywords: ['装修'] }],
    });
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // UPDATE

    await request(app)
      .get('/api/acquisition/pending-keyword-tasks')
      .set('x-agent-license', 'ZJ-B-TESTTEST');

    const calls = (db.query as any).mock.calls;
    // SELECT tasks 必须带 tenant_id（calls[2] 因为 calls[1] 是余额校验）
    expect(JSON.stringify(calls[2][1])).toContain(TENANT_B);
    // UPDATE to processing 也必须带 tenant_id（防 TOCTOU 越权更新）
    expect(JSON.stringify(calls[3][1])).toContain(TENANT_B);
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
      .set('x-test-tenant-id', TENANT_C)
      .send({ keyword: '美甲' });

    const insertCall = (db.query as any).mock.calls[1];
    // $4 = tenant_id
    expect(insertCall[1][3]).toBe(TENANT_C);
  });

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
});

describe('GET /api/acquisition/keyword-tasks — 前端列表（租户隔离/只读）', () => {
  beforeEach(() => { vi.stubEnv('VITEST', ''); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it('无租户上下文 → 401 NO_TENANT，不查库', async () => {
    const { default: db } = await import('../db/connection');
    const res = await request(app).get('/api/acquisition/keyword-tasks');
    expect(res.status).toBe(401);
    expect((db.query as any).mock.calls.length).toBe(0);
  });

  it('带 tenant 上下文 → 只 SELECT 本租户任务，不 UPDATE status', async () => {
    const { default: db } = await import('../db/connection');
    const TENANT_K = 'kkkkkkkk-0000-0000-0000-000000000001';
    (db.query as any).mockResolvedValueOnce({
      rows: [{ id: 't1', keyword: '麻婆豆腐', status: 'dispatched', created_at: '2026-07-07T00:00:00Z' }],
    });
    const res = await request(app)
      .get('/api/acquisition/keyword-tasks')
      .set('x-test-tenant-id', TENANT_K);
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
