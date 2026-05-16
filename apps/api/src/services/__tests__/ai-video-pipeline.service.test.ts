import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiVideoPipelineService } from '../ai-video-pipeline.service';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
const mockQuery = vi.mocked(pool.query);

describe('AiVideoPipelineService', () => {
  let svc: AiVideoPipelineService;

  beforeEach(() => {
    svc = new AiVideoPipelineService();
    vi.clearAllMocks();
  });

  it('createJob returns new job with pending status', async () => {
    const fakeJob = {
      id: 'abc-123',
      status: 'pending',
      progress: 0,
      src_video: '/tmp/video.mp4',
      src_logo: null,
      topic: 'test topic',
      result_url: null,
      error_msg: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeJob] } as never);

    const result = await svc.createJob({
      srcVideo: '/tmp/video.mp4',
      srcLogo: null,
      topic: 'test topic',
    });

    expect(result.status).toBe('pending');
    expect(result.id).toBe('abc-123');
  });

  it('getJob returns null for unknown id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const result = await svc.getJob('nonexistent');
    expect(result).toBeNull();
  });

  it('listPending returns only pending jobs', async () => {
    const jobs = [{ id: '1', status: 'pending' }, { id: '2', status: 'pending' }];
    mockQuery.mockResolvedValueOnce({ rows: jobs } as never);
    const result = await svc.listPending();
    expect(result).toHaveLength(2);
  });

  it('updateStatus updates job fields', async () => {
    const updated = { id: '1', status: 'completed', progress: 100 };
    mockQuery.mockResolvedValueOnce({ rows: [updated] } as never);
    const result = await svc.updateStatus('1', { status: 'completed', progress: 100 });
    expect(result.status).toBe('completed');
  });
});
