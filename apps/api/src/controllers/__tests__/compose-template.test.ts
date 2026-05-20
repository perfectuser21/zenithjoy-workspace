import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query: mockQuery } }));

describe('composeTemplate', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('exports composeTemplate function', async () => {
    const mod = await import('../../controllers/ai-video-pipeline-ai.controller');
    expect(typeof mod.composeTemplate).toBe('function');
  });

  it('returns 404 when job not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { composeTemplate } = await import('../../controllers/ai-video-pipeline-ai.controller');
    const req = { params: { id: 'notfound' }, body: { transcript: 'test', duration: 10 } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();
    await composeTemplate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
