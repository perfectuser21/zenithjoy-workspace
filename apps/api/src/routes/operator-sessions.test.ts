import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

vi.mock('../middleware/super-admin', () => ({
  superAdminGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/internal-auth', () => ({
  internalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { operatorSessionsRouter } = await import('./operator-sessions');

const app = express();
app.use(express.json());
app.use('/api/operator/sessions', operatorSessionsRouter);

describe('operator-sessions routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const pool = (await import('../db/connection')).default as { query: ReturnType<typeof vi.fn> };
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('POST /api/operator/sessions/trigger-bind', () => {
    it('返回 202 + {ok,platform,taskId}，keys 完全等于期望集合', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/trigger-bind')
        .send({ platform: 'douyin' });
      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.platform).toBe('douyin');
      expect(typeof res.body.taskId).toBe('string');
      expect(Object.keys(res.body).sort()).toEqual(['ok', 'platform', 'taskId']);
    });

    it('response 不含禁用字段 id/task/jobId/requestId', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/trigger-bind')
        .send({ platform: 'kuaishou' });
      expect(res.body).not.toHaveProperty('id');
      expect(res.body).not.toHaveProperty('task');
      expect(res.body).not.toHaveProperty('jobId');
      expect(res.body).not.toHaveProperty('requestId');
    });

    it('非法 platform 返 400 + error 字段（禁用 message/msg）', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/trigger-bind')
        .send({ platform: 'invalid_xyz' });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
      expect(res.body).not.toHaveProperty('message');
    });

    it('缺 platform 返 400', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/trigger-bind')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/operator/sessions', () => {
    it('返回 8 条，每项 keys 完全等于期望集合', async () => {
      const res = await request(app).get('/api/operator/sessions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(8);
      const expectedKeys = ['lastCheckedAt', 'lastValidAt', 'platform', 'secretName', 'status'];
      expect(Object.keys(res.body[0]).sort()).toEqual(expectedKeys);
    });

    it('secretName 以 _COOKIES 结尾，不含 _MAIN', async () => {
      const res = await request(app).get('/api/operator/sessions');
      res.body.forEach((item: { secretName: string }) => {
        expect(item.secretName).toMatch(/_COOKIES$/);
        expect(item.secretName).not.toMatch(/_MAIN/);
      });
    });

    it('status 仅含 active/expired/missing（禁用 ok/healthy）', async () => {
      const res = await request(app).get('/api/operator/sessions');
      const forbidden = ['ok', 'healthy', 'valid', 'inactive', 'error'];
      res.body.forEach((item: { status: string }) => {
        expect(forbidden).not.toContain(item.status);
        expect(['active', 'expired', 'missing']).toContain(item.status);
      });
    });

    it('DB 查询失败时仍返回 8 条 missing 状态', async () => {
      const pool = (await import('../db/connection')).default as { query: ReturnType<typeof vi.fn> };
      pool.query.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(app).get('/api/operator/sessions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(8);
      res.body.forEach((item: { status: string }) => {
        expect(item.status).toBe('missing');
      });
    });
  });

  describe('POST /api/operator/sessions/status', () => {
    it('返回 {ok:true,updated:N}，keys 完全等于 [ok,updated]', async () => {
      const pool = (await import('../db/connection')).default as { query: ReturnType<typeof vi.fn> };
      pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
      const res = await request(app)
        .post('/api/operator/sessions/status')
        .send({ updates: [{ platform: 'douyin', status: 'active', checkedAt: '2026-05-27T10:00:00Z' }] });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.updated).toBe('number');
      expect(Object.keys(res.body).sort()).toEqual(['ok', 'updated']);
    });

    it('updates 非数组返 400', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/status')
        .send({ updates: 'not-array' });
      expect(res.status).toBe(400);
    });

    it('updates 条目缺 platform 跳过（updated=0）', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/status')
        .send({ updates: [{ status: 'active' }] });
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(0);
    });
  });

  describe('POST /api/operator/sessions/upload-cookies', () => {
    it('dev 模式（无 PAT）返 200 + {ok,platform,secretName}', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/upload-cookies')
        .send({ platform: 'douyin', cookies: { token: 'abc' } });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.secretName).toBe('DOUYIN_COOKIES');
      expect(res.body.secretName).not.toMatch(/_MAIN/);
      expect(res.body.platform).toBe('douyin');
    });

    it('secretName = {PLATFORM_UPPER}_COOKIES 格式', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/upload-cookies')
        .send({ platform: 'kuaishou', cookies: {} });
      expect(res.body.secretName).toBe('KUAISHOU_COOKIES');
    });

    it('缺 platform 返 400', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/upload-cookies')
        .send({ cookies: {} });
      expect(res.status).toBe(400);
    });

    it('缺 cookies 返 400', async () => {
      const res = await request(app)
        .post('/api/operator/sessions/upload-cookies')
        .send({ platform: 'douyin' });
      expect(res.status).toBe(400);
    });
  });
});
