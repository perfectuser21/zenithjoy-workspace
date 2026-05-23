import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import app from '../../app';
import pool from '../../db/connection';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('POST /api/brain/sprint-state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts snapshot and returns uuid', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'test-uuid-1234' }] });

    const res = await request(app)
      .post('/api/brain/sprint-state')
      .send({ journey_id: 'path-1', sprint_id: 'sprint-001', snapshot: { steps: [], features: [] } });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('test-uuid-1234');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO zenithjoy.sprint_states');
    expect(params[0]).toBe('path-1');
    expect(params[1]).toBe('sprint-001');
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/brain/sprint-state')
      .send({ journey_id: 'path-1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .post('/api/brain/sprint-state')
      .send({ journey_id: 'path-1', sprint_id: 'sprint-001', snapshot: {} });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DB_ERROR');
  });
});

describe('POST /api/brain/journey-steps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts step and returns journey_id, step_id, status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/journey-steps')
      .send({ journey_id: 'path-1', step_id: 'P1-S1', step_order: 1, status: 'passing', shared: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ journey_id: 'path-1', step_id: 'P1-S1', status: 'passing' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (journey_id, step_id) DO UPDATE');
  });

  it('second call with same journey_id+step_id updates status', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await request(app)
      .post('/api/brain/journey-steps')
      .send({ journey_id: 'path-1', step_id: 'S-AUTH', step_order: 1, status: 'passing' });

    const res = await request(app)
      .post('/api/brain/journey-steps')
      .send({ journey_id: 'path-1', step_id: 'S-AUTH', step_order: 1, status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('done');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('defaults shared to false when omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .post('/api/brain/journey-steps')
      .send({ journey_id: 'path-1', step_id: 'P1-S2', step_order: 2, status: 'not_started' });

    const params = mockQuery.mock.calls[0][1];
    expect(params[4]).toBe(false);
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/brain/journey-steps')
      .send({ journey_id: 'path-1', step_id: 'P1-S1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });
});

describe('GET /api/brain/journey-steps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns steps ordered by step_order', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { step_id: 'P1-S1', step_order: 1, status: 'passing', shared: false, notion_page_id: null },
        { step_id: 'S-AUTH', step_order: 2, status: 'done', shared: true, notion_page_id: 'notion-abc' },
      ],
    });

    const res = await request(app)
      .get('/api/brain/journey-steps?journey_id=path-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].step_id).toBe('P1-S1');
    expect(res.body.data[1].step_id).toBe('S-AUTH');
    expect(res.body.data[1].shared).toBe(true);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY step_order ASC');
    expect(params[0]).toBe('path-1');
  });

  it('returns 400 when journey_id missing', async () => {
    const res = await request(app).get('/api/brain/journey-steps');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_QUERY');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns empty array when no steps for journey', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/brain/journey-steps?journey_id=new-journey');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
