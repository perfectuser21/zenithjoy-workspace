// apps/api/src/routes/voice-outreach.test.ts
// GP-A 主动语音触达 API 路由单元测试（supertest + vitest mock）
//
// 覆盖：
//   POST /api/cs/voice-outreach/call   — 参数验证 / tenant_id 缺失 / 成功路径（202 + call_id）
//   GET  /api/cs/voice-outreach/records — tenant_id 缺失 / 成功路径（返回数组）
//   POST /api/cs/voice-outreach/records — 通话结果回写（status 校验）

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ─── Mock DB & 中间件 ──────────────────────────────────────────────────────

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery },
}));

// mock tenantContext：从 x-tenant-id header 取 tenantId，注入 req.tenantId
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    if (tenantId) (req as any).tenantId = tenantId;
    next();
  },
}));

// mock requireCsWriteAccess：只验证 x-tenant-id header 存在（单元测试简化）
vi.mock('../middleware/cs-config-guard', () => ({
  requireCsWriteAccess: (_kind: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const tenantId = (req as any).tenantId || req.headers['x-tenant-id'];
      if (!tenantId) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'missing tenant' } });
      }
      next();
    },
}));

import { voiceOutreachRouter } from './voice-outreach';

const app = express();
app.use(express.json());
app.use('/api/cs/voice-outreach', voiceOutreachRouter);
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── POST /call ────────────────────────────────────────────────────────────

describe('POST /api/cs/voice-outreach/call', () => {
  it('202 + call_id 当 tenant_id 和 contact_name 有效', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({ tenant_id: 'tenant-abc', contact_name: '默忆' });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.call_id).toBe('string');
    expect(res.body.data.status).toBe('queued');
    expect(typeof res.body.data.queued_at).toBe('string');
  });

  it('400 当 contact_name 缺失', async () => {
    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({ tenant_id: 'tenant-abc' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_CONTACT_NAME');
  });

  it('400 当 contact_name 为空字符串', async () => {
    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({ tenant_id: 'tenant-abc', contact_name: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('401 当无 x-tenant-id header（auth 中间件拦截）', async () => {
    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .send({ tenant_id: 'tenant-abc', contact_name: '默忆' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('500 当 DB 写入失败', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({ tenant_id: 'tenant-abc', contact_name: '默忆' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DB_ERROR');
  });
});

// ─── GET /records ──────────────────────────────────────────────────────────

describe('GET /api/cs/voice-outreach/records', () => {
  it('200 + 数组 当 tenant_id 有效', async () => {
    const mockRows = [
      {
        id: 'row-1',
        tenant_id: 'tenant-abc',
        contact_name: '默忆',
        wechat_account: null,
        status: 'answered',
        duration_seconds: 45,
        called_at: '2026-07-18T10:00:00Z',
        call_id: 'call-uuid-1',
        bubble_text: '通话时长 00:45',
        error_reason: null,
        created_at: '2026-07-18T10:00:05Z',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: mockRows });

    const res = await request(app)
      .get('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].status).toBe('answered');
    expect(typeof res.body.data[0].call_id).toBe('string');
  });

  it('200 + 空数组 当无通话记录', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('400 当 tenant_id 缺失（无 header 也无 query）', async () => {
    const res = await request(app).get('/api/cs/voice-outreach/records');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_TENANT_ID');
  });

  it('500 当 DB 查询失败', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app)
      .get('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DB_ERROR');
  });
});

// ─── POST /records (Agent 回写) ────────────────────────────────────────────

describe('POST /api/cs/voice-outreach/records', () => {
  it('200 当 call_id 已存在且更新成功', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'row-1', call_id: 'call-uuid-1', status: 'answered', duration_seconds: 45 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        call_id: 'call-uuid-1',
        contact_name: '默忆',
        status: 'answered',
        duration_seconds: 45,
        bubble_text: '通话时长 00:45',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.call_id).toBe('call-uuid-1');
    expect(res.body.data.status).toBe('answered');
  });

  it('201 当 call_id 不存在时新建记录', async () => {
    // UPDATE 返回 0 行 → 触发 INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // UPDATE miss
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT

    const res = await request(app)
      .post('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        call_id: 'call-new',
        contact_name: '默忆',
        status: 'no_answer',
        duration_seconds: 0,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('no_answer');
  });

  it('400 当 status 非法', async () => {
    const res = await request(app)
      .post('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        call_id: 'call-uuid-1',
        contact_name: '默忆',
        status: 'invalid_status',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('400 当 call_id 缺失', async () => {
    const res = await request(app)
      .post('/api/cs/voice-outreach/records')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        contact_name: '默忆',
        status: 'answered',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_FIELDS');
  });
});
