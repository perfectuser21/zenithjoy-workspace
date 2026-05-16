import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSvc = vi.hoisted(() => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  listPending: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../src/services/ai-video-pipeline.service', () => ({
  AiVideoPipelineService: vi.fn().mockImplementation(() => mockSvc),
}));

import app from '../src/app';

const JOB = {
  id: 'job-uuid-1',
  status: 'pending',
  progress: 0,
  src_video: 'C:\\Users\\xuxia\\Videos\\test.mp4',
  src_logo: null,
  topic: '测试话题',
  result_url: null,
  output_dir: null,
  error_msg: null,
  created_at: '2026-05-16T00:00:00Z',
  updated_at: '2026-05-16T00:00:00Z',
};

describe('AI Video Pipeline API', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('POST /api/ai-video/jobs — JSON body', () => {
    it('returns 400 when local_path missing', async () => {
      const res = await request(app)
        .post('/api/ai-video/jobs')
        .send({ topic: '没有路径' });
      expect(res.status).toBe(400);
    });

    it('creates job with local_path and returns 201', async () => {
      mockSvc.createJob.mockResolvedValueOnce({ ...JOB, id: 'new-id' });
      const res = await request(app)
        .post('/api/ai-video/jobs')
        .send({ local_path: 'C:\\Users\\xuxia\\Videos\\test.mp4', topic: '测试' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('new-id');
    });
  });

  describe('GET /api/ai-video/jobs?status=pending', () => {
    it('returns pending jobs', async () => {
      mockSvc.listPending.mockResolvedValueOnce([JOB]);
      const res = await request(app).get('/api/ai-video/jobs?status=pending');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty for non-pending filter', async () => {
      const res = await request(app).get('/api/ai-video/jobs?status=completed');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /api/ai-video/jobs/:id', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/ai-video/jobs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns job when found', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('job-uuid-1');
    });
  });

  describe('PATCH /api/ai-video/jobs/:id/progress', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .patch('/api/ai-video/jobs/nonexistent/progress')
        .send({ progress: 10, status: 'processing' });
      expect(res.status).toBe(404);
    });

    it('updates progress', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      mockSvc.updateStatus.mockResolvedValueOnce({ ...JOB, progress: 50, status: 'processing' });
      const res = await request(app)
        .patch('/api/ai-video/jobs/job-uuid-1/progress')
        .send({ progress: 50, status: 'processing' });
      expect(res.status).toBe(200);
      expect(res.body.progress).toBe(50);
    });

    it('returns 400 for invalid status value', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      const res = await request(app)
        .patch('/api/ai-video/jobs/job-uuid-1/progress')
        .send({ progress: 50, status: 'invalid_status' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/ai-video/jobs/:id/complete', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/api/ai-video/jobs/nonexistent/complete')
        .send({ output_dir: 'C:\\out\\job-1' });
      expect(res.status).toBe(404);
    });

    it('stores output_dir and marks completed', async () => {
      const completed = { ...JOB, status: 'completed', progress: 100, output_dir: 'C:\\out\\job-uuid-1' };
      mockSvc.getJob.mockResolvedValue(JOB);
      mockSvc.updateStatus.mockResolvedValue(completed);
      const res = await request(app)
        .put('/api/ai-video/jobs/job-uuid-1/complete')
        .send({ output_dir: 'C:\\out\\job-uuid-1' });
      expect(res.status).toBe(200);
      expect(mockSvc.updateStatus).toHaveBeenCalledWith(
        'job-uuid-1',
        expect.objectContaining({ outputDir: 'C:\\out\\job-uuid-1', status: 'completed' }),
      );
    });
  });

  describe('GET /api/ai-video/jobs/:id/source — 已删除', () => {
    it('returns 404', async () => {
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/source');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/upload-output — 已删除', () => {
    it('returns 404', async () => {
      const res = await request(app).post('/api/ai-video/jobs/job-uuid-1/upload-output');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/ai-video/jobs/:id/output/:file — 已删除', () => {
    it('returns 404', async () => {
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/output/9_16.mp4');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/transcribe (unknown job)', () => {
    it('returns 4xx', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/transcribe');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('POST /api/ai-video/jobs/:id/design (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/design')
        .send({ transcript: 'test', segments: [], duration: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/compose-html (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/compose-html')
        .send({ scenes: [], duration: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/jobs/:id/bgm (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/00000000-0000-0000-0000-000000000000/bgm')
        .send({ style: 'tech corporate' });
      expect(res.status).toBe(404);
    });
  });
});
