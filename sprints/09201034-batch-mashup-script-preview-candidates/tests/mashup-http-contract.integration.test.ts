/* eslint-disable @typescript-eslint/no-explicit-any */
// 批量混剪加厚 HTTP 契约集成测试（真 pool，禁 mock DB / 相邻 service）。
// 锁：真实调用方 X-Upload-Token 鉴权 shape、Step1 from-script 落库 tenant 归属、
// Step3 候选 thumbnailUrls + generatedCount 诚实计数、租户隔离 404。
// 需真 Postgres（CI Sprint Tests job 提供）；实现缺失时 RED（新端点 404 / 缺字段）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pool from '../../../apps/api/src/db/connection';
import { createMashupRouter } from '../../../apps/api/src/routes/mashup';

const SFX = `mashit${Date.now()}`;
const TOKEN = `ZJ-F-${SFX}`;
let tenantId = '';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mashup', createMashupRouter());
  return app;
}

beforeAll(async () => {
  const t = await pool.query(
    `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1,$2,'free') RETURNING id`,
    [SFX, TOKEN],
  );
  tenantId = t.rows[0].id;
  await pool.query(
    `INSERT INTO zenithjoy.licenses (license_key, tenant_id, status, expires_at) VALUES ($1,$2,'active', NOW()+interval '1 year')`,
    [TOKEN, tenantId],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.mashup_runs WHERE tenant_id=$1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.mashup_templates WHERE tenant_id=$1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.materials WHERE tenant_id=$1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.licenses WHERE license_key=$1`, [TOKEN]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [tenantId]).catch(() => {});
  await pool.end();
});

describe('POST /api/mashup/templates/from-script [BEHAVIOR] 真实调用方 X-Upload-Token', () => {
  it('无凭据 → 401', async () => {
    const r = await request(makeApp()).post('/api/mashup/templates/from-script').send({ script: 'x' });
    expect(r.status).toBe(401);
  });

  it('空 script → 400 INVALID_BODY', async () => {
    const r = await request(makeApp())
      .post('/api/mashup/templates/from-script')
      .set('X-Upload-Token', TOKEN)
      .send({ script: '' });
    expect(r.status).toBe(400);
  });

  it('AI 不可用 → 200 + fallbackUsed + 模板落库 tenant 归属（非阻断 INV-4 / INV-2）', async () => {
    delete process.env.TOAPIS_API_KEY;
    const r = await request(makeApp())
      .post('/api/mashup/templates/from-script')
      .set('X-Upload-Token', TOKEN)
      .send({ script: '开场三秒钩子，接着产品特写展示细节，最后引导下单购买' });
    expect(r.status).toBe(200);
    expect(r.body.data.templateId).toBeTruthy();
    expect(Array.isArray(r.body.data.segments)).toBe(true);
    expect(r.body.data.segments.length).toBeGreaterThanOrEqual(1);
    expect(typeof r.body.data.fallbackUsed).toBe('boolean');
    const row = await pool.query(`SELECT tenant_id FROM zenithjoy.mashup_templates WHERE id=$1`, [r.body.data.templateId]);
    expect(row.rows[0]?.tenant_id).toBe(tenantId);
  });
});

describe('候选 thumbnailUrls + generatedCount 诚实计数 + 租户隔离 [BEHAVIOR]', () => {
  it('别租户 run 候选 → 404（租户隔离 INV-2）', async () => {
    const r = await request(makeApp())
      .get('/api/mashup/runs/00000000-0000-4000-8000-000000000000/candidates')
      .set('X-Upload-Token', TOKEN);
    expect(r.status).toBe(404);
  });

  it('生成候选：generatedCount == candidates.length ≤ 200，每条含 thumbnailUrls', async () => {
    const tmpl = await pool.query(
      `INSERT INTO zenithjoy.mashup_templates (tenant_id,name,slots) VALUES ($1,'it-tmpl',$2::jsonb) RETURNING id`,
      [tenantId, JSON.stringify([
        { key: 'hook', required: true, match_tags: ['开场'] },
        { key: 'cta', required: true, match_tags: ['行动号召'] },
      ])],
    );
    const mkMat = async (tag: string, k: string): Promise<string> => (await pool.query(
      `INSERT INTO zenithjoy.materials (tenant_id,storage_key,file_name,mime_type,size_bytes,dedupe_key,tag_status,ai_tags)
       VALUES ($1,$2,$3,'video/mp4',1024,$4,'tagged',$5::jsonb) RETURNING id`,
      [tenantId, `it/${k}.mp4`, `${k}.mp4`, `dk-${k}-${SFX}`, JSON.stringify([tag])],
    )).rows[0].id;
    const m1 = await mkMat('开场', 'hook');
    const m2 = await mkMat('行动号召', 'cta');

    const run = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN)
      .send({ templateId: tmpl.rows[0].id, materialIds: [m1, m2] });
    const runId = run.body.data.runId;

    const gen = await request(makeApp())
      .post(`/api/mashup/runs/${runId}/candidates`)
      .set('X-Upload-Token', TOKEN)
      .send({ targetCount: 200 });
    expect(gen.status).toBe(200);
    expect(typeof gen.body.data.generatedCount).toBe('number');
    expect(gen.body.data.generatedCount).toBe(gen.body.data.candidates.length);
    expect(gen.body.data.candidates.length).toBeLessThanOrEqual(200);
    for (const c of gen.body.data.candidates) {
      expect(Array.isArray(c.thumbnailUrls)).toBe(true);
      expect(c.thumbnailUrls.length).toBeGreaterThanOrEqual(1);
    }
  }, 60000);
});
