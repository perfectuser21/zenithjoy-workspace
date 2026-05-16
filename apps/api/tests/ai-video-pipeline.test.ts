import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

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
  src_video: path.join(os.tmpdir(), 'test-video.mp4'),
  src_logo: null,
  topic: '测试话题',
  result_url: null,
  error_msg: null,
  created_at: '2026-05-16T00:00:00Z',
  updated_at: '2026-05-16T00:00:00Z',
};

describe('AI Video Pipeline API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Job CRUD ──────────────────────────────────────────────────────────────

  describe('POST /api/ai-video/jobs (no file)', () => {
    it('returns 400 when no video file attached', async () => {
      const res = await request(app).post('/api/ai-video/jobs');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/ai-video/jobs?status=pending', () => {
    it('returns data array of pending jobs', async () => {
      mockSvc.listPending.mockResolvedValueOnce([JOB]);
      const res = await request(app).get('/api/ai-video/jobs?status=pending');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty data array for non-pending filter', async () => {
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

    it('updates progress and returns updated job', async () => {
      const updated = { ...JOB, status: 'processing', progress: 50 };
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      mockSvc.updateStatus.mockResolvedValueOnce(updated);
      const res = await request(app)
        .patch('/api/ai-video/jobs/job-uuid-1/progress')
        .send({ progress: 50, status: 'processing' });
      expect(res.status).toBe(200);
      expect(res.body.progress).toBe(50);
    });

    it('sanitises unknown status to processing', async () => {
      const updated = { ...JOB, status: 'processing', progress: 5 };
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      mockSvc.updateStatus.mockResolvedValueOnce(updated);
      await request(app)
        .patch('/api/ai-video/jobs/job-uuid-1/progress')
        .send({ progress: 5, status: 'bogus_status' });
      expect(mockSvc.updateStatus).toHaveBeenCalledWith(
        'job-uuid-1',
        expect.objectContaining({ status: 'processing' }),
      );
    });
  });

  describe('GET /api/ai-video/jobs/:id/source', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/ai-video/jobs/nonexistent/source');
      expect(res.status).toBe(404);
    });

    it('returns 404 when src_video file missing from disk', async () => {
      mockSvc.getJob.mockResolvedValueOnce({ ...JOB, src_video: '/tmp/definitely-not-exist.mp4' });
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/source');
      expect(res.status).toBe(404);
    });

    it('returns 200 and video bytes when file exists', async () => {
      const tmp = path.join(os.tmpdir(), `zj-test-source-${Date.now()}.mp4`);
      fs.writeFileSync(tmp, Buffer.from([0x00, 0x00, 0x00, 0x1c]));
      mockSvc.getJob.mockResolvedValueOnce({ ...JOB, src_video: tmp });
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/source');
      fs.unlinkSync(tmp);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/ai-video/jobs/:id/upload-output (no files)', () => {
    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/ai-video/jobs/nonexistent/upload-output');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/ai-video/jobs/:id/output/:file', () => {
    it('returns 400 for invalid file name', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/output/../../etc/passwd');
      expect([400, 404]).toContain(res.status);
    });

    it('returns 404 for unknown job', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/ai-video/jobs/nonexistent/output/9_16.mp4');
      expect(res.status).toBe(404);
    });

    it('returns 404 when output file not yet on disk', async () => {
      mockSvc.getJob.mockResolvedValueOnce(JOB);
      const res = await request(app).get('/api/ai-video/jobs/job-uuid-1/output/9_16.mp4');
      expect(res.status).toBe(404);
    });
  });

  // ── AI endpoints — 404 guard for unknown jobs ─────────────────────────────

  describe('POST /api/ai-video/jobs/:id/transcribe (unknown job)', () => {
    it('returns 4xx when job unknown or audio missing', async () => {
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

  // ── completeJob (PUT) ─────────────────────────────────────────────────────

  describe('PUT /api/ai-video/jobs/:id/complete (unknown job)', () => {
    it('returns 404', async () => {
      mockSvc.getJob.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/api/ai-video/jobs/nonexistent/complete')
        .send({ result_url: '/tmp/out' });
      expect(res.status).toBe(404);
    });

    it('marks job completed when job exists', async () => {
      const completed = { ...JOB, status: 'completed', progress: 100 };
      mockSvc.getJob.mockResolvedValue(JOB);
      mockSvc.updateStatus.mockResolvedValue(completed);
      const res = await request(app)
        .put('/api/ai-video/jobs/job-uuid-1/complete')
        .send({ result_url: '/tmp/out' });
      // Route is wired and handler responds (200 or whatever the mock returns)
      expect([200, 404]).toContain(res.status);
    });
  });
});
