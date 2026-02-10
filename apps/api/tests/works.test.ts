import request from 'supertest';
import app from '../src/app';
import pool from '../src/db/connection';

describe('Works API', () => {
  let testWorkId: string;

  afterAll(async () => {
    // Cleanup: delete test works
    await pool.query(`DELETE FROM zenithjoy.works WHERE title LIKE 'Test Work%'`);
    await pool.end();
  });

  describe('POST /api/works', () => {
    it('should create a new work', async () => {
      const response = await request(app)
        .post('/api/works')
        .send({
          title: 'Test Work 1',
          content_type: 'article',
          body: '# Test content',
          custom_fields: {
            tags: ['test']
          }
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Work 1');
      expect(response.body.content_type).toBe('article');
      expect(response.body.status).toBe('draft');

      testWorkId = response.body.id;
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/works')
        .send({
          body: 'Missing title'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid content_type', async () => {
      const response = await request(app)
        .post('/api/works')
        .send({
          title: 'Test Work',
          content_type: 'invalid_type'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/works', () => {
    it('should list works with default pagination', async () => {
      const response = await request(app).get('/api/works');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('offset');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by content_type', async () => {
      const response = await request(app).get('/api/works?type=article');

      expect(response.status).toBe(200);
      response.body.data.forEach((work: any) => {
        expect(work.content_type).toBe('article');
      });
    });

    it('should support pagination', async () => {
      const response = await request(app).get('/api/works?limit=5&offset=0');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(5);
      expect(response.body.offset).toBe(0);
    });
  });

  describe('GET /api/works/:id', () => {
    it('should get a single work by id', async () => {
      const response = await request(app).get(`/api/works/${testWorkId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(testWorkId);
      expect(response.body.title).toBe('Test Work 1');
    });

    it('should return 404 for non-existent work', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/works/${fakeId}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/works/:id', () => {
    it('should update a work', async () => {
      const response = await request(app)
        .put(`/api/works/${testWorkId}`)
        .send({
          title: 'Updated Test Work 1',
          status: 'published'
        });

      expect(response.status).toBe(200);
      expect(response.body.title).toBe('Updated Test Work 1');
      expect(response.body.status).toBe('published');
    });

    it('should return 404 for non-existent work', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/works/${fakeId}`)
        .send({ title: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/works/:id', () => {
    it('should delete a work', async () => {
      const response = await request(app).delete(`/api/works/${testWorkId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for already deleted work', async () => {
      const response = await request(app).delete(`/api/works/${testWorkId}`);

      expect(response.status).toBe(404);
    });
  });
});
