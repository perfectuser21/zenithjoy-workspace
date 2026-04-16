import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

const mockConnectClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../src/db/connection', () => ({
  default: {
    query: vi.fn(),
    end: vi.fn(),
    connect: vi.fn(async () => mockConnectClient),
  },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const PIPELINE_ID = 'eb1dbe4d-a219-4d79-90fc-36c6307414be';
const TOPIC_ID = 'f108b4d8-244e-4663-bcf6-2e7816ab00fe';

describe('Pipelines Worker API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    mockConnectClient.query.mockReset();
    mockConnectClient.release.mockReset();
  });

  describe('GET /api/pipelines/running', () => {
    it('returns running pipelines joined with topics', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: PIPELINE_ID,
            topic_id: TOPIC_ID,
            status: 'running',
            keyword: '2026 内容自动化',
            topic_status: '研究中',
          },
        ],
      });
      const res = await request(app).get('/api/pipelines/running');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].status).toBe('running');
      // SQL must filter status='running'
      const sqlCall = mockQuery.mock.calls[0][0] as string;
      expect(sqlCall).toContain("pr.status = 'running'");
    });

    it('returns empty list when none running', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/api/pipelines/running');
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });

    it('returns 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(app).get('/api/pipelines/running');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/pipelines/:id/stage-complete', () => {
    it('updates to running when non-final stage', async () => {
      // pool.query for existence check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: PIPELINE_ID, status: 'running', topic_id: TOPIC_ID }],
      });
      // client inside tx: BEGIN, UPDATE, COMMIT
      mockConnectClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({});
        return Promise.resolve({ rows: [{ id: PIPELINE_ID, status: 'running' }] });
      });

      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/stage-complete`)
        .send({ stage: 'research', output: { foo: 'bar' } });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('running');
      expect(res.body.data.stage).toBe('research');
    });

    it('transitions to completed and updates topic when final stage', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: PIPELINE_ID, status: 'running', topic_id: TOPIC_ID }],
      });

      let updateCallCount = 0;
      mockConnectClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({});
        updateCallCount += 1;
        if (updateCallCount === 1) {
          // pipeline_runs UPDATE -> completed
          return Promise.resolve({
            rows: [{ id: PIPELINE_ID, status: 'completed', topic_id: TOPIC_ID }],
          });
        }
        // topic UPDATE
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/stage-complete`)
        .send({ stage: 'export', is_final: true, output: { export_path: '/tmp/x' } });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.topic_id).toBe(TOPIC_ID);
    });

    it('returns 400 when stage is invalid', async () => {
      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/stage-complete`)
        .send({ stage: 'cooking' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STAGE_INVALID');
    });

    it('returns 404 when pipeline not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/stage-complete`)
        .send({ stage: 'research' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when id is not a UUID', async () => {
      const res = await request(app)
        .post('/api/pipelines/not-uuid/stage-complete')
        .send({ stage: 'research' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    });
  });

  describe('POST /api/pipelines/:id/fail', () => {
    it('writes error into output_manifest and marks failed', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: PIPELINE_ID,
            status: 'failed',
            output_manifest: { error: 'NotebookLM timeout', failed_stage: 'research' },
          },
        ],
      });
      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/fail`)
        .send({ error: 'NotebookLM timeout', stage: 'research' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('failed');
      expect(res.body.data.error).toBe('NotebookLM timeout');
    });

    it('returns 400 when error message missing', async () => {
      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/fail`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ERROR_REQUIRED');
    });

    it('returns 404 when pipeline missing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post(`/api/pipelines/${PIPELINE_ID}/fail`)
        .send({ error: 'boom' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
