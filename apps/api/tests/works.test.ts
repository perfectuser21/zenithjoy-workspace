import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const WORK = {
  id: 'work-uuid-1',
  title: 'Test Work 1',
  content_type: 'article',
  status: 'draft',
  body: '# Test content',
  custom_fields: { tags: ['test'] },
  archived: false,
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
        .send({ body: 'Missing title' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid content_type', async () => {
      const response = await request(app)
        .post('/api/works')
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

      const response = await request(app).get('/api/works');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('offset');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by content_type', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [WORK] });

      const response = await request(app).get('/api/works?type=article');

      expect(response.status).toBe(200);
      response.body.data.forEach((work: any) => {
        expect(work.content_type).toBe('article');
      });
    });

    it('should support pagination', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/works?limit=5&offset=0');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(5);
      expect(response.body.offset).toBe(0);
    });
  });

  describe('GET /api/works/:id', () => {
    it('should get a single work by id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [WORK] });

      const response = await request(app).get(`/api/works/${WORK.id}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(WORK.id);
      expect(response.body.title).toBe('Test Work 1');
    });

    it('should return 404 for non-existent work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/works/${fakeId}`);

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
        .send({ title: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/works/:id', () => {
    it('should delete a work', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [WORK] })  // getWorkById
        .mockResolvedValueOnce({ rows: [] });     // DELETE

      const response = await request(app).delete(`/api/works/${WORK.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getWorkById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).delete(`/api/works/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });
});
