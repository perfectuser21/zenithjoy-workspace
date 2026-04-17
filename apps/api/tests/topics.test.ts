import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const TOPIC_ROW = {
  id: UUID,
  title: 'PR-a 测试选题',
  angle: null,
  priority: 100,
  status: '待研究',
  target_platforms: ['xiaohongshu', 'douyin'],
  scheduled_date: null,
  pipeline_id: null,
  created_at: '2026-04-16T22:00:00Z',
  updated_at: '2026-04-16T22:00:00Z',
  published_at: null,
  deleted_at: null,
};

describe('Topics API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  describe('GET /api/topics', () => {
    it('returns paginated list with total', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
        .mockResolvedValueOnce({ rows: [TOPIC_ROW] }); // items

      const res = await request(app).get('/api/topics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.limit).toBe(50);
    });

    it('rejects invalid status filter with 400', async () => {
      const res = await request(app).get('/api/topics?status=not-a-real-status');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATUS');
    });

    it('caps limit at 500 even if higher requested', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/api/topics?limit=9999');
      expect(res.status).toBe(200);
      expect(res.body.data.limit).toBe(500);
    });
  });

  describe('GET /api/topics/:id', () => {
    it('returns a topic when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [TOPIC_ROW] });
      const res = await request(app).get(`/api/topics/${UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(UUID);
    });

    it('returns 404 when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get(`/api/topics/${UUID}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects non-UUID id with 400', async () => {
      const res = await request(app).get('/api/topics/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    });
  });

  describe('POST /api/topics', () => {
    it('creates a topic with required fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [TOPIC_ROW] });
      const res = await request(app)
        .post('/api/topics')
        .send({ title: 'PR-a 测试选题' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(UUID);
    });

    it('returns 400 when title is missing', async () => {
      const res = await request(app).post('/api/topics').send({ angle: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TITLE_REQUIRED');
    });

    it('returns 400 when status is invalid', async () => {
      const res = await request(app)
        .post('/api/topics')
        .send({ title: 't', status: '乱填' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS');
    });
  });

  describe('PATCH /api/topics/:id', () => {
    it('patches status to a valid value', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...TOPIC_ROW, status: '研究中' }],
      });
      const res = await request(app)
        .patch(`/api/topics/${UUID}`)
        .send({ status: '研究中' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('研究中');
    });

    it('returns 400 when status is unknown', async () => {
      const res = await request(app)
        .patch(`/api/topics/${UUID}`)
        .send({ status: 'invalid' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS');
    });

    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch(`/api/topics/${UUID}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FIELDS');
    });

    it('returns 404 when topic not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .patch(`/api/topics/${UUID}`)
        .send({ priority: 50 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('notebook_id CRUD（阶段 A+）', () => {
    const NB = '1d928181-4462-47d4-b4c0-89d3696344ab';

    it('POST 支持传 notebook_id 并透传给 INSERT', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...TOPIC_ROW, notebook_id: NB }],
      });
      const res = await request(app)
        .post('/api/topics')
        .send({ title: '龙虾', notebook_id: NB });
      expect(res.status).toBe(201);
      expect(res.body.data.notebook_id).toBe(NB);
      const args = mockQuery.mock.calls[0][1] as unknown[];
      // INSERT 参数末尾必须是 notebookIdClean
      expect(args[args.length - 1]).toBe(NB);
    });

    it('POST 不传 notebook_id 时默认为 null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...TOPIC_ROW, notebook_id: null }],
      });
      const res = await request(app).post('/api/topics').send({ title: '龙虾' });
      expect(res.status).toBe(201);
      const args = mockQuery.mock.calls[0][1] as unknown[];
      expect(args[args.length - 1]).toBeNull();
    });

    it('POST 传超长 notebook_id 返回 400', async () => {
      const res = await request(app)
        .post('/api/topics')
        .send({ title: '龙虾', notebook_id: 'x'.repeat(101) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_NOTEBOOK_ID');
    });

    it('PATCH notebook_id 写入 SQL SET', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...TOPIC_ROW, notebook_id: NB }],
      });
      const res = await request(app)
        .patch(`/api/topics/${UUID}`)
        .send({ notebook_id: NB });
      expect(res.status).toBe(200);
      expect(res.body.data.notebook_id).toBe(NB);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('notebook_id = $');
    });

    it('PATCH notebook_id=null 清空', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...TOPIC_ROW, notebook_id: null }],
      });
      const res = await request(app)
        .patch(`/api/topics/${UUID}`)
        .send({ notebook_id: null });
      expect(res.status).toBe(200);
      const args = mockQuery.mock.calls[0][1] as unknown[];
      expect(args[0]).toBeNull();
    });

    it('PATCH 非字符串 notebook_id 返回 400', async () => {
      const res = await request(app)
        .patch(`/api/topics/${UUID}`)
        .send({ notebook_id: 12345 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_NOTEBOOK_ID');
    });
  });

  describe('DELETE /api/topics/:id', () => {
    it('soft-deletes by default', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: UUID }] });
      const res = await request(app).delete(`/api/topics/${UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.data.hard).toBe(false);
      expect(res.body.data.deleted).toBe(true);
    });

    it('hard-deletes when hard=true', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const res = await request(app).delete(`/api/topics/${UUID}?hard=true`);
      expect(res.status).toBe(200);
      expect(res.body.data.hard).toBe(true);
    });

    it('returns 404 when hard delete target missing', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      const res = await request(app).delete(`/api/topics/${UUID}?hard=true`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('internalAuth gate', () => {
    it('returns 401 when token env set but header missing', async () => {
      process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret-xyz';
      const res = await request(app).get('/api/topics');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('passes when Bearer token matches', async () => {
      process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret-xyz';
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/topics')
        .set('Authorization', 'Bearer secret-xyz');
      expect(res.status).toBe(200);
    });

    it('passes when X-Internal-Token matches', async () => {
      process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret-xyz';
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/topics')
        .set('X-Internal-Token', 'secret-xyz');
      expect(res.status).toBe(200);
    });

    it('returns 401 when token mismatches', async () => {
      process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret-xyz';
      const res = await request(app)
        .get('/api/topics')
        .set('Authorization', 'Bearer wrong');
      expect(res.status).toBe(401);
    });
  });
});
