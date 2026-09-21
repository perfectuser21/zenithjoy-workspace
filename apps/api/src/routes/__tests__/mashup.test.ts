/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 批量混剪 S2 端点契约：客户挑模板 → 触发槽位分配 → 查看分配结果。
 * 租户永远从凭据反查，绝不信客户端自报 tenant_id（与 materials.ts 同口径）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));

import { validateLicense } from '../../services/walking-skeleton.service';
import pool from '../../db/connection';
import { createMashupRouter } from '../mashup';

const TOKEN_A = 'ZJ-F-AAAA1111';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mashup', createMashupRouter());
  return app;
}

const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic', license_key: TOKEN_A, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/mashup/templates', () => {
  it('没有凭据 → 401', async () => {
    const r = await request(makeApp()).get('/api/mashup/templates');
    expect(r.status).toBe(401);
  });

  it('已认证：返回全局+租户模板列表', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 'tmpl-1', name: '标准四槽位（钩子/产品/证据/CTA）', slots: [{ key: 'hook' }] }],
    });
    const r = await request(makeApp()).get('/api/mashup/templates').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].name).toContain('标准四槽位');
  });
});

describe('POST /api/mashup/runs', () => {
  it('没有凭据 → 401', async () => {
    const r = await request(makeApp()).post('/api/mashup/runs').send({ templateId: 'tmpl-1', materialIds: [] });
    expect(r.status).toBe(401);
  });

  it('缺 templateId → 400，不触碰 DB', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    const r = await request(makeApp()).post('/api/mashup/runs').set('X-Upload-Token', TOKEN_A).send({ materialIds: [] });
    expect(r.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('已认证 + 合法 body：触发槽位分配并返回结果', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_templates')) {
        return {
          rows: [{ id: 'tmpl-1', slots: [{ key: 'hook', required: true, match_tags: ['开场'] }] }],
        };
      }
      if (sql.includes('FROM zenithjoy.materials')) return { rows: [{ id: 'mat-1', ai_tags: ['开场'] }] };
      if (sql.includes('INSERT INTO zenithjoy.mashup_runs')) return { rows: [{ id: 'run-1' }] };
      return { rows: [] };
    });
    const r = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN_A)
      .send({ templateId: 'tmpl-1', materialIds: ['mat-1'] });

    expect(r.status).toBe(200);
    expect(r.body.data.runId).toBe('run-1');
    expect(r.body.data.status).toBe('completed');
    expect(r.body.data.assignments[0]).toMatchObject({ slotKey: 'hook', materialId: 'mat-1', status: 'assigned' });
  });

  it('模板不存在 → 404（不是 500，不泄露内部异常）', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_templates')) return { rows: [] };
      return { rows: [] };
    });
    const r = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN_A)
      .send({ templateId: 'missing', materialIds: [] });
    expect(r.status).toBe(404);
  });
});

describe('GET /api/mashup/runs/:id', () => {
  it('别的租户的 run → 404（租户隔离，不是"越权可见但拒绝"）', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await request(makeApp()).get('/api/mashup/runs/run-x').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });

  it('本租户的 run：返回 run 状态 + 槽位分配明细', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_runs')) return { rows: [{ id: 'run-1', status: 'completed', template_id: 'tmpl-1' }] };
      if (sql.includes('FROM zenithjoy.mashup_slot_assignments')) {
        return { rows: [{ slot_key: 'hook', material_id: 'mat-1', status: 'assigned', reason: null }] };
      }
      return { rows: [] };
    });
    const r = await request(makeApp()).get('/api/mashup/runs/run-1').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('completed');
    expect(r.body.data.assignments).toHaveLength(1);
  });
});

vi.mock('../../services/mashup-candidate-generation', () => ({ generateCandidates: vi.fn() }));
import { generateCandidates } from '../../services/mashup-candidate-generation';

describe('POST /api/mashup/runs/:id/candidates', () => {
  it('没有凭据 → 401，不触发生成', async () => {
    const r = await request(makeApp()).post('/api/mashup/runs/run-1/candidates');
    expect(r.status).toBe(401);
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it('已认证：触发候选生成并返回结果', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (generateCandidates as any).mockResolvedValue({
      runId: 'run-1',
      candidates: [{ id: 'cand-1', score: 1.8, slotFill: { hook: 'mat-1', product: 'mat-2' } }],
    });
    const r = await request(makeApp()).post('/api/mashup/runs/run-1/candidates').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(200);
    // 第 2 个参数注入缩略图构造器（懒渲染缩略图，路由层提供 storage+抽帧）。
    expect(generateCandidates).toHaveBeenCalledWith(
      { tenantId: 'tenant-a', runId: 'run-1', targetCount: undefined },
      expect.objectContaining({ buildThumbnail: expect.any(Function) }),
    );
    expect(r.body.data.candidates).toHaveLength(1);
  });

  it('run 不存在 → 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (generateCandidates as any).mockRejectedValue(new Error('run not found: run-x'));
    const r = await request(makeApp()).post('/api/mashup/runs/run-x/candidates').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(404);
  });
});

describe('GET /api/mashup/runs/:id/candidates', () => {
  it('别的租户的 run → 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await request(makeApp()).get('/api/mashup/runs/run-x/candidates').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });

  it('本租户的 run：按 score 降序返回候选列表', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_runs')) return { rows: [{ id: 'run-1', selected_candidate_id: null }] };
      if (sql.includes('FROM zenithjoy.mashup_candidates')) {
        return { rows: [{ id: 'cand-1', score: '1.8', slot_fill: { hook: 'mat-1' } }] };
      }
      return { rows: [] };
    });
    const r = await request(makeApp()).get('/api/mashup/runs/run-1/candidates').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data.candidates[0]).toMatchObject({ id: 'cand-1', slotFill: { hook: 'mat-1' } });
    expect(r.body.data.selectedCandidateId).toBeUndefined();
  });
});

describe('POST /api/mashup/candidates/:id/select', () => {
  it('候选不属于当前租户 → 404，不写回 run', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-x/select').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(404);
  });

  it('合法候选：写回 run.selected_candidate_id', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_candidates')) return { rows: [{ id: 'cand-1', run_id: 'run-1' }] };
      if (sql.includes('UPDATE zenithjoy.mashup_runs')) return { rows: [{ id: 'run-1', selected_candidate_id: 'cand-1' }] };
      return { rows: [] };
    });
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-1/select').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.selectedCandidateId).toBe('cand-1');
  });
});

// 渲染改由队列服务（并发=1）承接，路由只透传队列态；这里桩掉 enqueueRender 验路由契约。
vi.mock('../../services/mashup-render-queue', () => ({ enqueueRender: vi.fn() }));
import { enqueueRender } from '../../services/mashup-render-queue';

describe('POST /api/mashup/candidates/:id/render', () => {
  it('没有凭据 → 401，不触发渲染', async () => {
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-1/render');
    expect(r.status).toBe(401);
    expect(enqueueRender).not.toHaveBeenCalled();
  });

  it('已认证：入队渲染并返回队列态（并发满时 queued + queuePosition）', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (enqueueRender as any).mockResolvedValue({
      candidateId: 'cand-1',
      renderStatus: 'queued',
      queuePosition: 1,
      contentId: null,
    });
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-1/render').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.renderStatus).toBe('queued');
    expect(r.body.data.queuePosition).toBe(1);
    expect(r.body.data.contentId).toBeNull();
  });

  it('候选不存在 → 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (enqueueRender as any).mockRejectedValue(new Error('candidate not found: cand-x'));
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-x/render').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(404);
  });
});

// 候选真实轻量预览（决策 623a81d7）：并发=1 独立队列，路由只透传队列态；
// 桩掉 enqueuePreview 验路由契约，与终版渲染路由同口径。
vi.mock('../../services/mashup-preview-queue', () => ({ enqueuePreview: vi.fn() }));
import { enqueuePreview } from '../../services/mashup-preview-queue';

describe('POST /api/mashup/candidates/:id/preview', () => {
  it('没有凭据 → 401，不触发预览渲染', async () => {
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-1/preview');
    expect(r.status).toBe(401);
    expect(enqueuePreview).not.toHaveBeenCalled();
  });

  it('已认证：入队预览并返回队列态', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (enqueuePreview as any).mockResolvedValue({
      candidateId: 'cand-1',
      previewStatus: 'generating',
      queuePosition: 0,
      previewUrl: null,
    });
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-1/preview').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.previewStatus).toBe('generating');
    expect(enqueuePreview).toHaveBeenCalledWith({ tenantId: 'tenant-a', candidateId: 'cand-1' });
  });

  it('候选不存在 → 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (enqueuePreview as any).mockRejectedValue(new Error('candidate not found: cand-x'));
    const r = await request(makeApp()).post('/api/mashup/candidates/cand-x/preview').set('X-Upload-Token', TOKEN_A).send({});
    expect(r.status).toBe(404);
  });
});

describe('GET /api/mashup/candidates/:id', () => {
  it('候选不属于当前租户 → 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await request(makeApp()).get('/api/mashup/candidates/cand-x').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });

  it('渲染中（未产出终版内容）：content 为 null，前端据此继续轮询', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_candidates')) {
        return {
          rows: [{
            id: 'cand-1', run_id: 'run-1', score: '1.5', slot_fill: { hook: 'mat-1' },
            thumbnail_url: null, render_status: 'rendering', preview_status: 'ready', preview_url: 'https://preview.example/cand-1.mp4',
          }],
        };
      }
      if (sql.includes('FROM zenithjoy.contents')) return { rows: [] };
      return { rows: [] };
    });
    const r = await request(makeApp()).get('/api/mashup/candidates/cand-1').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data.renderStatus).toBe('rendering');
    expect(r.body.data.previewStatus).toBe('ready');
    expect(r.body.data.previewUrl).toBe('https://preview.example/cand-1.mp4');
    expect(r.body.data.content).toBeNull();
  });

  it('已渲染完成：带出终版 content 的安全/水印/导出链接', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_candidates')) {
        return {
          rows: [{
            id: 'cand-1', run_id: 'run-1', score: '1.5', slot_fill: { hook: 'mat-1' },
            thumbnail_url: null, render_status: 'rendered', preview_status: 'ready', preview_url: 'https://preview.example/cand-1.mp4',
          }],
        };
      }
      if (sql.includes('FROM zenithjoy.contents')) {
        return {
          rows: [{
            id: 'content-1', safety_check_status: 'passed', watermark_check_status: 'passed',
            export_url: 'https://export.example/cand-1.mp4', download_url: 'https://export.example/cand-1.mp4',
          }],
        };
      }
      return { rows: [] };
    });
    const r = await request(makeApp()).get('/api/mashup/candidates/cand-1').set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data.content).toMatchObject({
      contentId: 'content-1', safetyCheckStatus: 'passed', watermarkCheckStatus: 'passed',
      exportUrl: 'https://export.example/cand-1.mp4',
    });
  });
});

describe('GET /api/mashup/runs — 历史列表', () => {
  it('没有凭据 → 401', async () => {
    const r = await request(makeApp()).get('/api/mashup/runs');
    expect(r.status).toBe(401);
  });

  it('本租户没有 run → 空列表，不是 404', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.data.items).toEqual([]);
    expect(r.body.data.count).toBe(0);
    // 租户永远从凭据反查，SQL 必须按 tenant_id 过滤
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/tenant_id\s*=\s*\$1/);
    expect((pool.query as any).mock.calls[0][1][0]).toBe('tenant-a');
  });

  const runRow = (over: Record<string, unknown>) => ({
    id: 'run-1', template_id: 'tmpl-1', status: 'completed',
    created_at: '2026-09-20T10:00:00.000Z', selected_candidate_id: null,
    candidate_count: '0', thumbnail_url: null, has_export: false,
    ...over,
  });

  it.each([
    ['completed', { selected_candidate_id: 'cand-1', has_export: true, candidate_count: '3' }],
    ['rendering', { selected_candidate_id: 'cand-1', has_export: false, candidate_count: '3' }],
    ['candidates_pending', { selected_candidate_id: null, has_export: false, candidate_count: '3' }],
    ['assigned', { selected_candidate_id: null, has_export: false, candidate_count: '0' }],
  ])('stage 派生为 %s', async (expected, over) => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [runRow(over)] });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.data.items[0].stage).toBe(expected);
  });

  it('渲染跑完但被安全 Gate 拦下（export_url 为空）不算已完成', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    // status 写着 completed，但 contents 没有 export_url ——以 export 为准
    (pool.query as any).mockResolvedValue({
      rows: [runRow({ status: 'completed', selected_candidate_id: 'cand-1', has_export: false })],
    });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(r.body.data.items[0].stage).toBe('rendering');
    expect(r.body.data.items[0].stage).not.toBe('completed');
  });

  it('不把成片地址塞进列表响应', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({
      rows: [runRow({ selected_candidate_id: 'cand-1', has_export: true, candidate_count: '2' })],
    });

    const r = await request(makeApp()).get('/api/mashup/runs').set('X-Upload-Token', TOKEN_A);

    expect(JSON.stringify(r.body)).not.toMatch(/exportUrl|downloadUrl/);
  });

  it('limit 越界夹到 100，不报错', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({ rows: [] });

    const r = await request(makeApp()).get('/api/mashup/runs?limit=9999').set('X-Upload-Token', TOKEN_A);

    expect(r.status).toBe(200);
    expect(r.body.data.limit).toBe(100);
    expect((pool.query as any).mock.calls[0][1][1]).toBe(100);
  });
});
