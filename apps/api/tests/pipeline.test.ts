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
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })          // INSERT pipeline_run
        .mockResolvedValueOnce({ rows: [] });                      // UPDATE cecelia_task_id

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cecelia-task-123' }),
      });

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight', topic: '2026年AI趋势', topic_id: 'topic-001' });

      expect(response.status).toBe(201);
      // PR-e/5: 响应格式统一为 { success, data, error, timestamp }
      expect(response.body.success).toBe(true);
      expect(response.body.data.cecelia_task_id).toBe('cecelia-task-123');
      expect(response.body.data.status).toBe('running');
      expect(response.body.error).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should copy notebook_id from topic into pipeline_runs（阶段 A+）', async () => {
      const NB = '1d928181-4462-47d4-b4c0-89d3696344ab';
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: NB }] })   // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [{ ...PIPELINE_RUN, notebook_id: NB }] }) // INSERT
        .mockResolvedValueOnce({ rows: [] });                       // UPDATE cecelia_task_id

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'task-nb' }),
      });

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight', topic: '龙虾', topic_id: 'topic-lb' });

      expect(response.status).toBe(201);
      // INSERT 调用是第 2 次，最后一个参数应为 notebook_id
      const insertCall = mockQuery.mock.calls[1];
      const sql = insertCall[0] as string;
      const args = insertCall[1] as unknown[];
      expect(sql).toContain('notebook_id');
      expect(args[args.length - 1]).toBe(NB);
    });

    it('should return 400 when content_type is missing', async () => {
      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ topic: '没有类型' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONTENT_TYPE_REQUIRED');
      expect(response.body.error.message).toContain('content_type');
    });

    // 选题池 v1：topic_id 强校验
    it('should return 400 when topic_id is missing (no manual override)', async () => {
      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight', topic: '裸跑' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TOPIC_ID_REQUIRED');
      expect(response.body.error.message).toContain('topic_id');
    });

    it('should accept request when X-Manual-Override is true (no topic_id)', async () => {
      // 无 topic_id → 跳过 SELECT notebook_id，直接 INSERT + UPDATE
      mockQuery
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })
        .mockResolvedValueOnce({ rows: [] });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'task-x' }) });

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .set('X-Manual-Override', 'true')
        .send({ content_type: 'tech_insight', topic: '手动' });

      expect(response.status).toBe(201);
    });

    it('should return 502 when cecelia Brain is unreachable', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })           // INSERT
        .mockResolvedValueOnce({ rows: [] });                       // UPDATE failed status

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Service Unavailable',
      });

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight', topic_id: 'topic-002' });

      expect(response.status).toBe(502);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CECELIA_CALL_FAILED');
      expect(response.body.error.message).toContain('cecelia Brain');
    });

    it('should return 500 on DB error', async () => {
      // SELECT notebook_id 失败被 catch（走 warn），INSERT 失败才冒泡到 500
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT OK
        .mockRejectedValueOnce(new Error('DB connection failed')); // INSERT 失败

      const response = await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'tech_insight', topic_id: 'topic-003' });

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
    it('should return output from local pipeline_runs.output_manifest (not fallback to cecelia)', async () => {
      const MANIFEST = {
        status: 'ready_for_publish',
        keyword: '龙虾',
        article: { path: 'article/article.md', status: 'ready' },
        copy: { path: 'cards/copy.md', status: 'ready' },
        image_set: {
          files: ['龙虾-cover.png', '龙虾-01.png', '龙虾-02.png'],
          status: 'ready',
          framework: '/share-card',
        },
      };
      const runWithManifest = {
        ...PIPELINE_RUN,
        status: 'completed',
        output_manifest: MANIFEST,
      };
      mockQuery.mockResolvedValueOnce({ rows: [runWithManifest] });

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/output`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('output');
      expect(response.body.output.pipeline_id).toBe(PIPELINE_RUN.id);
      expect(response.body.output.keyword).toBe('龙虾');
      expect(response.body.output.status).toBe('ready_for_publish');
      expect(response.body.output.image_urls).toHaveLength(3);
      // URL 必须是 /api/content-images/<pipelineId>/<encoded-filename>
      for (const img of response.body.output.image_urls) {
        expect(img.url).toMatch(/^\/api\/content-images\//);
        expect(img.url).toContain(PIPELINE_RUN.id);
      }
      // cover 检测
      const cover = response.body.output.image_urls.find(
        (i: { type: string }) => i.type === 'cover'
      );
      expect(cover).toBeDefined();
      // 不应调 cecelia（本地读完即止）
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 404 when pipeline_run does not exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })  // pipeline_runs lookup
        .mockResolvedValueOnce({ rows: [] }); // cecelia_events fallback: no events

      const response = await request(app).get('/api/pipeline/00000000-0000-0000-0000-000000000000/output');

      expect(response.status).toBe(404);
    });

    it('should return pending output when output_manifest is null and no LangGraph events', async () => {
      // pipeline_runs 有 row 但 manifest=null，cecelia_events 也为空 → 返回 pending
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...PIPELINE_RUN, status: 'running', output_manifest: null }] })
        .mockResolvedValueOnce({ rows: [] }); // no LangGraph events

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/output`);

      expect(response.status).toBe(200);
      expect(response.body.output.pipeline_id).toBe(PIPELINE_RUN.id);
      expect(response.body.output.status).toBe('running');
      expect(response.body.output.article_text).toBeNull();
      expect(response.body.output.cards_text).toBeNull();
      expect(response.body.output.image_urls).toEqual([]);
      // 严禁 HTTP fallback 到 cecelia Brain（只允许本地 cecelia_events 表查询）
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/pipeline/:id/stages', () => {
    it('should return local status when no LangGraph events', async () => {
      const runWithManifest = {
        ...PIPELINE_RUN,
        status: 'completed',
        output_manifest: { status: 'ready_for_publish' },
      };
      mockQuery
        .mockResolvedValueOnce({ rows: [runWithManifest] })
        .mockResolvedValueOnce({ rows: [] }); // no LangGraph events

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/stages`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stages');
      expect(response.body.overall_status).toBe('ready_for_publish');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 404 when pipeline_run does not exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }); // no LangGraph events

      const response = await request(app).get(`/api/pipeline/${PIPELINE_RUN.id}/stages`);

      expect(response.status).toBe(404);
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

  // ── cecelia contract tests ─────────────────────────────────────────────────
  // 防止字段变更（如 task_type underscore bug）导致 cecelia 静默拒绝请求
  describe('cecelia payload contract', () => {
    it('task_type must be content-pipeline (hyphen, not underscore)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })
        .mockResolvedValueOnce({ rows: [] });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'task-abc' }) });

      await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'solo-company-case', topic: 'contract-test', topic_id: 'topic-contract' });

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.task_type).toBe('content-pipeline');
      expect(body.task_type).not.toContain('_');
    });

    it('payload must include zenithjoy_pipeline_run_id', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })
        .mockResolvedValueOnce({ rows: [] });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'task-abc' }) });

      await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'solo-company-case', topic: 'contract-test', topic_id: 'topic-contract' });

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.payload.zenithjoy_pipeline_run_id).toBe(PIPELINE_RUN.id);
    });

    it('payload.callback_url must point to /api/pipeline/callback', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })
        .mockResolvedValueOnce({ rows: [] });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'task-abc' }) });

      await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'solo-company-case', topic: 'contract-test', topic_id: 'topic-contract' });

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.payload.callback_url).toContain('/api/pipeline/callback');
    });

    it('payload must forward content_type and topic correctly', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ notebook_id: null }] }) // SELECT topic.notebook_id
        .mockResolvedValueOnce({ rows: [PIPELINE_RUN] })
        .mockResolvedValueOnce({ rows: [] });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'task-abc' }) });

      await request(app)
        .post('/api/pipeline/trigger')
        .send({ content_type: 'solo-company-case', topic: 'AI大模型趋势', topic_id: 'topic-contract-3' });

      const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(fetchUrl).toContain('/api/brain/tasks');
      expect(fetchOptions.method).toBe('POST');
      expect(body.payload.content_type).toBe('solo-company-case');
      expect(body.payload.topic).toBe('AI大模型趋势');
    });
  });
});
