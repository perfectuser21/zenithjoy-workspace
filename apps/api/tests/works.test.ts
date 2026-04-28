import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

// Sprint B 多租户：所有 works 端点要求 X-Feishu-User-Id；fixture 需 owner_id 匹配
const TEST_USER = 'ou_test_user_001';

const WORK = {
  id: 'work-uuid-1',
  title: 'Test Work 1',
  content_type: 'article',
  status: 'draft',
  body: '# Test content',
  custom_fields: { tags: ['test'] },
  archived_at: null,   // DB 实际列名，非 archived
  owner_id: TEST_USER,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('Works API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/works', () => {
    it('should create a new work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [WORK] });

      const response = await request(app)
        .post('/api/works')
        .set('X-Feishu-User-Id', TEST_USER)
        .send({
          title: 'Test Work 1',
          content_type: 'article',
          body: '# Test content',
          custom_fields: { tags: ['test'] },
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Work 1');
      expect(response.body.content_type).toBe('article');
      expect(response.body.status).toBe('draft');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/works')
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ body: 'Missing title' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid content_type', async () => {
      const response = await request(app)
        .post('/api/works')
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ title: 'Test Work', content_type: 'invalid_type' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/works', () => {
    it('should list works with default pagination', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [WORK] });

      const response = await request(app)
        .get('/api/works')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('offset');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('[SCHEMA GUARD] should use archived_at IS NULL, not archived = false', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/works')
        .set('X-Feishu-User-Id', TEST_USER);

      // 取第一次 pool.query 调用的 SQL（COUNT 查询）
      const countSql: string = mockQuery.mock.calls[0][0];
      expect(countSql).toContain('archived_at IS NULL');
      expect(countSql).not.toMatch(/archived\s*=/);
    });

    it('should filter by content_type', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [WORK] });

      const response = await request(app)
        .get('/api/works?type=article')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(200);
      response.body.data.forEach((work: any) => {
        expect(work.content_type).toBe('article');
      });
    });

    it('should support pagination', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/works?limit=5&offset=0')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(5);
      expect(response.body.offset).toBe(0);
    });
  });

  describe('GET /api/works/:id', () => {
    it('should get a single work by id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [WORK] });

      const response = await request(app)
        .get(`/api/works/${WORK.id}`)
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(WORK.id);
      expect(response.body.title).toBe('Test Work 1');
    });

    it('should return 404 for non-existent work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/works/${fakeId}`)
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/works/:id', () => {
    it('should update a work', async () => {
      const updatedWork = { ...WORK, title: 'Updated Test Work 1', status: 'published' };
      mockQuery
        .mockResolvedValueOnce({ rows: [WORK] })          // getWorkById
        .mockResolvedValueOnce({ rows: [updatedWork] });  // UPDATE

      const response = await request(app)
        .put(`/api/works/${WORK.id}`)
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ title: 'Updated Test Work 1', status: 'published' });

      expect(response.status).toBe(200);
      expect(response.body.title).toBe('Updated Test Work 1');
      expect(response.body.status).toBe('published');
    });

    it('should return 404 for non-existent work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getWorkById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/works/${fakeId}`)
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ title: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/works/:id', () => {
    it('should delete a work', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [WORK] })  // getWorkById
        .mockResolvedValueOnce({ rows: [] });     // DELETE

      const response = await request(app)
        .delete(`/api/works/${WORK.id}`)
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getWorkById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .delete(`/api/works/${fakeId}`)
        .set('X-Feishu-User-Id', TEST_USER);

      expect(response.status).toBe(404);
    });
  });
});
