import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db/connection', () => ({
  default: { query: mockQuery },
}));

describe('createJob with template_id', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('should pass template_id to INSERT query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'abc', status: 'pending', template_id: 'W-G', progress: 0,
        src_video: '/v.mp4', src_logo: null, topic: null,
        result_url: null, output_dir: null, error_msg: null,
        created_at: new Date(), updated_at: new Date()
      }],
    });
    const { AiVideoPipelineService } = await import('../../services/ai-video-pipeline.service');
    const svc = new AiVideoPipelineService();
    const job = await svc.createJob({ srcVideo: '/v.mp4', srcLogo: null, topic: null, templateId: 'W-G' });
    expect(job.template_id).toBe('W-G');
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('template_id');
    expect(call[1]).toContain('W-G');
  });
});
