import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const PIPELINE_RUN = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  cecelia_task_id: null,
  content_type: 'tech_insight',
  topic: '2026年AI趋势',
  status: 'pending',
  output_dir: '/home/user/content-output',
  output_manifest: null,
  triggered_by: 'manual',
  created_at: '2026-04-11T00:00:00Z',
  updated_at: '2026-04-11T00:00:00Z',
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Pipeline API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/pipeline/trigger', () => {
    it('should create pipeline run and call cecelia Brain', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })       // INSERT pipeline_run
        .mockResolvedValueOnce({ rows: [] });                   // UPDATE cecelia_task_id

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cecelia-task-123' }),
      });

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight', topic: '2026年AI趋势' });

      expect(response.status).toBe(201);
      expect(response.body.cecelia_task_id).toBe('cecelia-task-123');
      expect(response.body.status).toBe('running');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when content_type is missing', async () => {
      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ topic: '没有类型' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('content_type');
    });

    it('should return 502 when cecelia Brain is unreachable', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })   // INSERT
        .mockResolvedValueOnce({ rows: [] });               // UPDATE failed status

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Service Unavailable',
      });

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight' });

      expect(response.status).toBe(502);
      expect(response.body.error).toContain('cecelia Brain');
    });

    it('should return 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight' });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/pipeline/:id', () => {
    it('should return pipeline run by id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PIPELINE_RUN] });

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(PIPELINE_RUN.id);
      expect(response.body.content_type).toBe('tech_insight');
    });

    it('should return 404 for non-existent id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/pipeline/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/pipeline', () => {
    it('should return list of pipeline runs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PIPELINE_RUN] });

      const response = await request(app).get('/api/pipeline');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
    });

    it('should return empty array when no runs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/pipeline');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('POST /api/pipeline/callback', () => {
    it('should update pipeline run status on callback', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/pipeline/callback')
        .send({
          zenithjoy_pipeline_run_id: PIPELINE_RUN.id,
          cecelia_task_id: 'cecelia-task-123',
          status: 'completed',
          output_manifest: { files: ['output.md'] },
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it('should return 400 when zenithjoy_pipeline_run_id is missing', async () => {
      const response = await request(app)
        .post('/api/pipeline/callback')
        .send({ status: 'completed' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('zenithjoy_pipeline_run_id');
    });

    it('should map unknown status to running', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/pipeline/callback')
        .send({
          zenithjoy_pipeline_run_id: PIPELINE_RUN.id,
          status: 'in_progress',
        });

      expect(response.status).toBe(200);
      const updateCall = mockQuery.mock.calls[0];
      expect(updateCall[1][0]).toBe('running');
    });
  });

  describe('GET /api/pipeline/:id/output', () => {
    it('should proxy to cecelia and return output', async () => {
      const runWithTask = { ...PIPELINE_RUN, cecelia_task_id: 'cecelia-task-123' };
      mockQuery.mockResolvedValueOnce({ rows: [runWithTask] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keyword: '测试', status: 'completed', article_text: 'content', cards_text: null, image_urls: [] }),
      });

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/output`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('keyword');
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('cecelia-task-123/output'));
    });

    it('should return 404 when cecelia_task_id is null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PIPELINE_RUN] }); // cecelia_task_id is null

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/output`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/pipeline/:id/stages', () => {
    it('should proxy to cecelia and return stages', async () => {
      const runWithTask = { ...PIPELINE_RUN, cecelia_task_id: 'cecelia-task-123' };
      mockQuery.mockResolvedValueOnce({ rows: [runWithTask] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stages: { 'content-research': { status: 'completed' } } }),
      });

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/stages`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stages');
    });

    it('should return empty stages when cecelia_task_id is null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PIPELINE_RUN] });

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/stages`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ stages: {} });
    });
  });

  describe('POST /api/pipeline/:id/rerun', () => {
    it('should proxy rerun to cecelia', async () => {
      const runWithTask = { ...PIPELINE_RUN, cecelia_task_id: 'cecelia-task-123' };
      mockQuery.mockResolvedValueOnce({ rows: [runWithTask] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      const response = await request(app).post(`/api/pipeline/${PIPELINE_RUN.id}/rerun`);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cecelia-task-123/run'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('GET /api/pipeline/dashboard-stats', () => {
    it('should return today stats', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ pending: '1', running: '2', completed: '5', failed: '0', total: '8' }],
      });

      const response = await request(app).get('/api/pipeline/dashboard-stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pending');
      expect(response.body).toHaveProperty('completed');
      expect(response.body).toHaveProperty('total');
    });

    it('should return 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/api/pipeline/dashboard-stats');

      expect(response.status).toBe(500);
    });
  });
});
