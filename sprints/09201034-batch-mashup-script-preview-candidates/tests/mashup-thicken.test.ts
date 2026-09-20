/**
 * 批量混剪加厚 —— Golden Path 冻结 RED 测试（真 Postgres + 真 app）
 *
 * 覆盖父路 line05/batch_mashup 第 1-4 步（加厚：文案动态分段 / 素材在线预览 /
 * 候选可视化浏览 / 选中才渲染+并发队列+失败态）。每个 describe 1:1 对应一个 GP step。
 *
 * 真验层：本文件是 API 层真验（route↔service↔真 PG）。真机/真渲染/真 TOAPIS 分段
 * 属接缝，在 staging Final-E2E 验（见合同 ## 接缝清单 / ## 未覆盖真实链路清单）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  app,
  request,
  connect,
  seedTenantToken,
  seedMaterial,
  seedTemplate,
  seedRun,
  seedCandidate,
  seedRenderJob,
  cleanupTenant,
  type TenantToken,
} from './_mashup-thicken-fixture';

const H = (token: string) => ({ 'X-Upload-Token': token });

describe('批量混剪加厚 [BEHAVIOR]', () => {
  let client: Client;
  let A: TenantToken;
  let B: TenantToken;

  beforeAll(async () => {
    client = await connect();
    A = await seedTenantToken(client, 'mashupA');
    B = await seedTenantToken(client, 'mashupB');
  });

  afterAll(async () => {
    if (client) {
      await cleanupTenant(client, A.tenantId);
      await cleanupTenant(client, B.tenantId);
      await client.end();
    }
  });

  // ── Step 1：文案粘贴 → 动态分段模板 ─────────────────────────────
  describe('Step1 文案动态分段模板', () => {
    it('空文案返回 400 INVALID_BODY', async () => {
      const res = await request(app)
        .post('/api/mashup/templates/from-script')
        .set(H(A.token))
        .send({ script: '' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('INVALID_BODY');
    });

    it('无 TOAPIS key 时静默降级：返回动态分段 segments + degraded=true 且落 mashup_templates 行', async () => {
      const res = await request(app)
        .post('/api/mashup/templates/from-script')
        .set(H(A.token))
        .send({ script: '开场：主角出现在清晨的厨房。产品展示：拿起保温杯特写。结尾：号召点击下单。' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const d = res.body.data;
      expect(typeof d.templateId).toBe('string');
      // 降级路径（CI 无 TOAPIS 凭据）：source=fallback、degraded=true，但仍产出可用分段
      expect(d.degraded).toBe(true);
      expect(d.source).toBe('fallback');
      expect(Array.isArray(d.segments)).toBe(true);
      expect(d.segments.length).toBeGreaterThanOrEqual(1);
      for (const seg of d.segments) {
        expect(typeof seg.slotKey).toBe('string');
        expect(typeof seg.roleTag).toBe('string');
        expect(typeof seg.suggestedCount).toBe('number');
        expect(typeof seg.mapped).toBe('boolean');
      }
      // 真落库：新模板行归属本租户
      const row = await client.query(
        'SELECT tenant_id FROM zenithjoy.mashup_templates WHERE id = $1',
        [d.templateId],
      );
      expect(row.rows[0]?.tenant_id).toBe(A.tenantId);
    });

    it('租户隔离：新模板只对本租户可见（GET /templates）', async () => {
      const made = await request(app)
        .post('/api/mashup/templates/from-script')
        .set(H(A.token))
        .send({ script: '钩子：悬念开场。产品：细节特写。证据：使用场景。CTA：下单。' });
      const templateId = made.body.data.templateId as string;

      const own = await request(app).get('/api/mashup/templates').set(H(A.token));
      const other = await request(app).get('/api/mashup/templates').set(H(B.token));
      const ownIds = (own.body.data as Array<{ id: string }>).map((x) => x.id);
      const otherIds = (other.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(ownIds).toContain(templateId);
      expect(otherIds).not.toContain(templateId);
    });
  });

  // ── Step 2：素材在线预览（signedUrl 重签） ──────────────────────
  describe('Step2 素材在线预览', () => {
    it('GET /api/materials/:id/signed-url 返回可播放 previewUrl', async () => {
      const materialId = await seedMaterial(client, A.tenantId, { mime: 'video/mp4' });
      const res = await request(app)
        .get(`/api/materials/${materialId}/signed-url`)
        .set(H(A.token));
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.materialId).toBe(materialId);
      expect(typeof d.previewUrl).toBe('string');
      expect(d.previewUrl.length).toBeGreaterThan(0);
      expect(d.playable).toBe(true); // video/* → 可在线播放
    });

    it('租户隔离：他租户素材重签返回 404', async () => {
      const materialId = await seedMaterial(client, A.tenantId, { mime: 'video/mp4' });
      const res = await request(app)
        .get(`/api/materials/${materialId}/signed-url`)
        .set(H(B.token));
      expect(res.status).toBe(404);
    });
  });

  // ── Step 3：候选 200+ 缩略图拼贴可视化浏览 ──────────────────────
  describe('Step3 候选缩略图可视化浏览', () => {
    it('GET /runs/:id/candidates 返回 generatedCount 与每条候选 thumbnailUrl 字段', async () => {
      const materialId = await seedMaterial(client, A.tenantId);
      const templateId = await seedTemplate(client, A.tenantId);
      const runId = await seedRun(client, A.tenantId, templateId);
      await seedCandidate(client, A.tenantId, runId, { seg1: materialId });
      await seedCandidate(client, A.tenantId, runId, { seg2: materialId });

      const res = await request(app).get(`/api/mashup/runs/${runId}/candidates`).set(H(A.token));
      expect(res.status).toBe(200);
      const d = res.body.data;
      // 「共生成 N 条候选」如实计数
      expect(d.generatedCount).toBe(2);
      expect(Array.isArray(d.candidates)).toBe(true);
      expect(d.candidates.length).toBe(2);
      for (const c of d.candidates) {
        // 缩略图拼贴字段必须存在（值可为 null——真实拼贴属接缝，在 staging 验）
        expect(c).toHaveProperty('thumbnailUrl');
      }
    });

    it('候选浏览阶段不触发渲染：contents 表无该 run 产物', async () => {
      const materialId = await seedMaterial(client, A.tenantId);
      const templateId = await seedTemplate(client, A.tenantId);
      const runId = await seedRun(client, A.tenantId, templateId);
      const candId = await seedCandidate(client, A.tenantId, runId, { seg1: materialId });
      await request(app).get(`/api/mashup/runs/${runId}/candidates`).set(H(A.token));
      const cnt = await client.query(
        'SELECT count(*)::int AS n FROM zenithjoy.contents WHERE source_candidate_id = $1',
        [candId],
      );
      expect(cnt.rows[0].n).toBe(0);
    });
  });

  // ── Step 4：选中才渲染 + 并发=1 队列 + 渲染失败态 ────────────────
  describe('Step4 渲染队列与失败态', () => {
    it('并发=1：已有 rendering 作业时再 POST render 返回 queued 且 queuePosition>=1', async () => {
      const materialId = await seedMaterial(client, A.tenantId);
      const templateId = await seedTemplate(client, A.tenantId);
      const runId = await seedRun(client, A.tenantId, templateId);
      const cand1 = await seedCandidate(client, A.tenantId, runId, { seg1: materialId });
      const cand2 = await seedCandidate(client, A.tenantId, runId, { seg2: materialId });
      // 造一个在飞的渲染作业（占满并发=1 的唯一名额）
      await seedRenderJob(client, A.tenantId, runId, cand1, 'rendering');

      const res = await request(app)
        .post(`/api/mashup/candidates/${cand2}/render`)
        .set(H(A.token));
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.status).toBe('queued');
      expect(typeof d.queuePosition).toBe('number');
      expect(d.queuePosition).toBeGreaterThanOrEqual(1);
    });

    it('渲染失败态可重试：仅有 render_failed 作业时 POST render 重新入队/开渲，不 4xx 卡死', async () => {
      const materialId = await seedMaterial(client, A.tenantId);
      const templateId = await seedTemplate(client, A.tenantId);
      const runId = await seedRun(client, A.tenantId, templateId);
      const cand = await seedCandidate(client, A.tenantId, runId, { seg1: materialId });
      // 先占满并发（避免真起 ffmpeg），再让失败候选重试 → 应进 queued（可重试，非死路）
      const other = await seedCandidate(client, A.tenantId, runId, { seg2: materialId });
      await seedRenderJob(client, A.tenantId, runId, other, 'rendering');
      await seedRenderJob(client, A.tenantId, runId, cand, 'render_failed');

      const res = await request(app)
        .post(`/api/mashup/candidates/${cand}/render`)
        .set(H(A.token));
      expect(res.status).toBe(200);
      expect(['queued', 'rendering', 'completed']).toContain(res.body.data.status);
    });
  });
});
