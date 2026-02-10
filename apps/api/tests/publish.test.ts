import request from 'supertest';
import app from '../src/app';
import pool from '../src/db/connection';

describe('Publish Logs API', () => {
  let testWorkId: string;
  let testLogId: string;

  beforeAll(async () => {
    // Create a test work
    const workResult = await pool.query(`
      INSERT INTO zenithjoy.works (title, content_type)
      VALUES ('Test Work for Publish', 'article')
      RETURNING id
    `);
    testWorkId = workResult.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await pool.query(`DELETE FROM zenithjoy.publish_logs WHERE work_id = $1`, [testWorkId]);
    await pool.query(`DELETE FROM zenithjoy.works WHERE id = $1`, [testWorkId]);
    await pool.end();
  });

  describe('POST /api/works/:workId/publish-logs', () => {
    it('should create a new publish log', async () => {
      const response = await request(app)
        .post(`/api/works/${testWorkId}/publish-logs`)
        .send({
          work_id: testWorkId,
          platform: 'douyin',
          status: 'pending'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.work_id).toBe(testWorkId);
      expect(response.body.platform).toBe('douyin');
      expect(response.body.status).toBe('pending');

      testLogId = response.body.id;
    });

    it('should return 400 for missing work_id', async () => {
      const response = await request(app)
        .post(`/api/works/${testWorkId}/publish-logs`)
        .send({
          platform: 'xiaohongshu'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid platform', async () => {
      const response = await request(app)
        .post(`/api/works/${testWorkId}/publish-logs`)
        .send({
          work_id: testWorkId,
          platform: 'invalid_platform'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate (work_id, platform)', async () => {
      const response = await request(app)
        .post(`/api/works/${testWorkId}/publish-logs`)
        .send({
          work_id: testWorkId,
          platform: 'douyin'
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('GET /api/works/:workId/publish-logs', () => {
    it('should get publish logs for a work', async () => {
      const response = await request(app).get(`/api/works/${testWorkId}/publish-logs`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].work_id).toBe(testWorkId);
    });

    it('should return empty array for work with no logs', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/works/${fakeId}/publish-logs`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('PUT /api/publish-logs/:id', () => {
    it('should update a publish log', async () => {
      const response = await request(app)
        .put(`/api/publish-logs/${testLogId}`)
        .send({
          status: 'published',
          platform_post_id: '123456',
          published_at: new Date().toISOString()
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('published');
      expect(response.body.platform_post_id).toBe('123456');
      expect(response.body).toHaveProperty('published_at');
    });

    it('should return 404 for non-existent log', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/publish-logs/${fakeId}`)
        .send({ status: 'published' });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .put(`/api/publish-logs/${testLogId}`)
        .send({ status: 'invalid_status' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
