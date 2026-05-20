/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

describe('GET /api/ai-video/jobs?status=processing&stale_minutes=5', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('stale_minutes=5 → 返回超过5分钟未更新的 processing job', async () => {
    const pool = (await import('../../db/connection')).default;
    const fakeJob = {
      id: 'stale-job-1',
      status: 'processing',
      progress: 65,
      src_video: 'C:\\\\video.mp4',
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [fakeJob] } as any);

    const res = await request(app)
      .get('/api/ai-video/jobs?status=processing&stale_minutes=5');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('stale-job-1');

    const queryCall = (vi.mocked(pool.query).mock.calls as any[]).find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('updated_at')
    );
    expect(queryCall).toBeTruthy();
  });

  it('status=processing 不带 stale_minutes → 返回空数组（行为不变）', async () => {
    const res = await request(app)
      .get('/api/ai-video/jobs?status=processing');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
