import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('Pacing Config API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  describe('GET /api/pacing-config', () => {
    it('returns daily_limit as integer', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ key: 'daily_limit', value: '1' }],
      });
      const res = await request(app).get('/api/pacing-config');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.daily_limit).toBe(1);
    });

    it('defaults daily_limit to 1 when table is empty', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/api/pacing-config');
      expect(res.status).toBe(200);
      expect(res.body.data.daily_limit).toBe(1);
    });

    it('returns 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(app).get('/api/pacing-config');
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /api/pacing-config', () => {
    it('updates daily_limit successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .patch('/api/pacing-config')
        .send({ daily_limit: 3 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.daily_limit).toBe(3);
    });

    it('rejects missing daily_limit with 400', async () => {
      const res = await request(app).patch('/api/pacing-config').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FIELDS');
    });

    it('rejects out-of-range daily_limit', async () => {
      const res = await request(app)
        .patch('/api/pacing-config')
        .send({ daily_limit: 999 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DAILY_LIMIT');
    });

    it('rejects non-integer daily_limit', async () => {
      const res = await request(app)
        .patch('/api/pacing-config')
        .send({ daily_limit: 2.5 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DAILY_LIMIT');
    });
  });
});
