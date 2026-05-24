import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db/connection', () => ({
  default: { query: mockQuery },
}));

vi.mock('../../services/langgraph-adapter', () => ({
  listLangGraphOnlyRuns: vi.fn().mockResolvedValue([]),
  isUuid: vi.fn().mockReturnValue(false),
  existsLangGraphTask: vi.fn().mockResolvedValue(false),
  fetchLangGraphEvents: vi.fn().mockResolvedValue([]),
  buildOutputFromEvents: vi.fn().mockReturnValue(null),
  buildStagesFromEvents: vi.fn().mockReturnValue([]),
  overallStatusFromEvents: vi.fn().mockReturnValue('pending'),
}));

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return { body, headers, params: {} } as unknown as import('express').Request;
}

const PIPELINE_RUN_ROW = {
  id: 'run-uuid-1',
  content_type: 'short_video',
  topic: null,
  topic_id: null,
  status: 'pending',
  output_dir: '/tmp/output',
  triggered_by: 'manual',
  notebook_id: null,
  cecelia_task_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PipelineController.trigger — input validation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns 400 CONTENT_TYPE_REQUIRED when content_type is missing', async () => {
    const { PipelineController } = await import('../pipeline.controller');
    const ctrl = new PipelineController();
    const req = makeReq({});
    const res = makeRes();
    await ctrl.trigger(req as import('express').Request, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('CONTENT_TYPE_REQUIRED');
  });

  it('returns 400 TOPIC_ID_REQUIRED when topic_id absent and no manual override', async () => {
    const { PipelineController } = await import('../pipeline.controller');
    const ctrl = new PipelineController();
    const req = makeReq({ content_type: 'short_video' });
    const res = makeRes();
    await ctrl.trigger(req as import('express').Request, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('TOPIC_ID_REQUIRED');
  });

  it('Brain unavailable: run stays pending (graceful fallback)', async () => {
    // Simulate Brain unreachable: INSERT succeeds, then fetch throws, then no UPDATE
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockQuery.mockResolvedValueOnce({ rows: [PIPELINE_RUN_ROW] });

    const { PipelineController } = await import('../pipeline.controller');
    const ctrl = new PipelineController();
    const req = makeReq({ content_type: 'short_video' }, { 'x-manual-override': 'true' });
    const res = makeRes();
    await ctrl.trigger(req as import('express').Request, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.data.status).toBe('pending');
    expect(body.data.cecelia_task_id).toBeNull();

    fetchSpy.mockRestore();
  });
});
