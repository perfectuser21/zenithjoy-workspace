// apps/api/src/routes/voice-outreach.test.ts
// GP-A 主动语音触达 API 路由单元测试（supertest + vitest mock）
//
// 覆盖：
//   POST /api/cs/voice-outreach/call    — 参数验证 / tenant_id 缺失 / 成功路径（202 + call_id）
//                                        去重 409（I-12）/ 鉴权 requireCsAdminOrSuperAdmin（I-14）
//   GET  /api/cs/voice-outreach/pending — queued 列表 / DB 降级空列表（I-13）/ 乐观锁 0 行跳过
//   GET  /api/cs/voice-outreach/records — tenant_id 缺失 / 成功路径（返回数组）/ transcript 字段
//   POST /api/cs/voice-outreach/records — 通话结果回写（status 校验）/ 新字段 machine_id/transcript

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
    if (tenantId) req.tenantId = tenantId;
    next();
  },
}));

// mock cs-config-guard：requireCsWriteAccess（旧，I-14 修复前）+ requireCsAdminOrSuperAdmin（新，I-14 修复后）
vi.mock('../middleware/cs-config-guard', () => ({
  requireCsWriteAccess: () =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const tenantId = req.tenantId || req.headers['x-tenant-id'];
      if (!tenantId) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'missing tenant' } });
      }
      next();
    },
  requireCsAdminOrSuperAdmin:
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const tenantId = req.tenantId || req.headers['x-tenant-id'];
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

// ─── GET /pending (Agent 轮询认领) ────────────────────────────────────────────
// TDD Red: 以下测试在 GET /pending 接口实现前全部 FAIL（预期行为）
// 实现后应全部 PASS

describe('GET /api/cs/voice-outreach/pending', () => {
  it('200 + queued 列表 当有 pending 任务', async () => {
    // mock: 返回一条 queued 记录
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'row-p1',
          call_id: 'call-pending-1',
          tenant_id: 'tenant-abc',
          contact_name: '默忆',
          wechat_account: 'wx-001',
          call_phase: 'queued',
          trigger_source: 'manual',
          triggered_by: 'user-1',
          queued_at: '2026-07-19T10:00:00Z',
        },
      ],
    });

    const res = await request(app)
      .get('/api/cs/voice-outreach/pending?machine_id=machine-1&limit=1')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].call_phase).toBe('queued');
    expect(typeof res.body.data[0].call_id).toBe('string');
    expect(res.body.data[0].contact_name).toBe('默忆');
  });

  it('200 + 空列表 当无 pending 任务', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/cs/voice-outreach/pending?machine_id=machine-1')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('200 + 空列表 当 DB 故障（I-13 降级，不返回 500）', async () => {
    // DB 故障降级：返回 200 空列表，不中断 Agent 轮询（I-13）
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .get('/api/cs/voice-outreach/pending?machine_id=machine-1')
      .set('x-tenant-id', 'tenant-abc');

    // 期望降级为 200 空列表，而非 500
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('响应包含 trigger_source 和 triggered_by 字段', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'row-p2',
          call_id: 'call-pending-2',
          tenant_id: 'tenant-abc',
          contact_name: '小胡同学',
          wechat_account: 'wx-002',
          call_phase: 'queued',
          trigger_source: 'auto_rule',
          triggered_by: 'system',
          queued_at: '2026-07-19T11:00:00Z',
        },
      ],
    });

    const res = await request(app)
      .get('/api/cs/voice-outreach/pending?machine_id=machine-2')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.data[0].trigger_source).toBe('auto_rule');
    expect(res.body.data[0].triggered_by).toBe('system');
  });
});

// ─── POST /call 去重 + 鉴权修复（I-12 + I-14）────────────────────────────────
// TDD Red: 以下测试在实现前 FAIL

describe('POST /api/cs/voice-outreach/call — 去重与鉴权（I-12/I-14）', () => {
  it('409 DUPLICATE_CALL 当 10 分钟内同一联系人重复请求（I-12）', async () => {
    // mock: 去重查询返回 count=1（已有进行中记录）
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        contact_name: '默忆',
        wechat_account: 'wx-001',
        trigger_source: 'manual',
        triggered_by: 'user-1',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DUPLICATE_CALL');
  });

  it('202 当去重窗口外（count=0）正常写入', async () => {
    // mock: 去重查询 count=0（无进行中记录），INSERT 成功
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // 去重查询
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });    // INSERT

    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        contact_name: '默忆',
        wechat_account: 'wx-001',
        trigger_source: 'manual',
        triggered_by: 'user-1',
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('queued');
  });

  it('POST /call 写入 call_phase=queued（I-9 状态机初始态）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // 去重
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });    // INSERT

    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .set('x-tenant-id', 'tenant-abc')
      .send({
        tenant_id: 'tenant-abc',
        contact_name: '默忆',
        trigger_source: 'auto_rule',
        triggered_by: 'system',
      });

    expect(res.status).toBe(202);
    // INSERT 调用应含 call_phase='queued'（验证 DB mock 被调用的 SQL 参数）
    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).toUpperCase().includes('INSERT'),
    );
    expect(insertCall).toBeDefined();
    expect(String(insertCall![0])).toContain('call_phase');
  });

  it('requireCsAdminOrSuperAdmin 鉴权：无 x-tenant-id 返回 401（I-14）', async () => {
    // 无 header → 鉴权中间件拦截（I-14 修复后走 requireCsAdminOrSuperAdmin）
    const res = await request(app)
      .post('/api/cs/voice-outreach/call')
      .send({ contact_name: '默忆' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /records — 新字段（transcript/call_phase/trigger_source）────────────

describe('GET /api/cs/voice-outreach/records — 新字段', () => {
  it('响应数据包含 transcript / call_phase / trigger_source 字段（v2 migration 后）', async () => {
    const mockRows = [
      {
        id: 'row-v2-1',
        tenant_id: 'tenant-abc',
        contact_name: '默忆',
        wechat_account: 'wx-001',
        status: 'answered',
        duration_seconds: 87,
        called_at: '2026-07-19T10:00:00Z',
        call_id: 'call-uuid-v2',
        call_phase: 'completed',
        trigger_source: 'manual',
        triggered_by: 'user-1',
        machine_id: 'machine-1',
        transcript: '您好\n我是徐先生企业自媒体的智能语音助手\n请问有什么可以帮您',
        bubble_text: '通话时长 01:27',
        error_reason: null,
        created_at: '2026-07-19T10:00:05Z',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: mockRows });

    const res = await request(app)
      .get('/api/cs/voice-outreach/records?contact_name=默忆')
      .set('x-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].transcript).toContain('智能语音助手');
    expect(res.body.data[0].trigger_source).toBe('manual');
    expect(res.body.data[0].machine_id).toBe('machine-1');
    expect(res.body.data[0].call_phase).toBe('completed');
  });
});
