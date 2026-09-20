// 批量混剪加厚 — DB 边真验（禁 mock 边：真 Postgres，不 mock pool）
//
// 覆盖被改的两条 DB 写路径 / 状态机边（合同 ## 禁 mock 边清单）：
//   1. 代码 ↔ zenithjoy.mashup_templates —— segmentScriptToTemplate 真落一行模板
//   2. 代码 ↔ zenithjoy.mashup_render_jobs —— 渲染并发闸 enqueueRenderJob 顺序入队时
//      任一时刻 status='rendering' 至多一行（并发=1 的 DB 落地）
//
// RED：服务 segmentScriptToTemplate / enqueueRenderJob 与 mashup_render_jobs 表未实现。
// 需真 PG：由 root vitest.config.cjs（include sprints/**/tests/** + fileParallelism:false +
// 同一真 Postgres）在 CI/evaluator 真库执行；proposer 容器 postgres:false，本文件不在
// proposer 侧确认 RED（纯逻辑 RED 见 mashup-thickening.test.ts）。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import pool from '../../../apps/api/src/db/connection';
import { segmentScriptToTemplate } from '../../../apps/api/src/services/mashup-script-segment';
import { enqueueRenderJob } from '../../../apps/api/src/services/render-concurrency';

const SFX = `it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId: string;
let candidateId: string;

beforeAll(async () => {
  const t = await pool.query(
    `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
    [`e2e-${SFX}`, `ZJ-${SFX}`],
  );
  tenantId = t.rows[0].id;

  const tmpl = await pool.query(
    `INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots)
     VALUES ($1, $2, '[{"key":"hook","required":true,"match_tags":["开场"]}]'::jsonb) RETURNING id`,
    [tenantId, `tmpl-${SFX}`],
  );
  const run = await pool.query(
    `INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ($1, $2, 'completed') RETURNING id`,
    [tenantId, tmpl.rows[0].id],
  );
  const cand = await pool.query(
    `INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature)
     VALUES ($1, $2, '{}'::jsonb, 1, $3) RETURNING id`,
    [run.rows[0].id, tenantId, `sig-${SFX}`],
  );
  candidateId = cand.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.mashup_render_jobs WHERE tenant_id = $1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.mashup_runs WHERE tenant_id = $1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.mashup_templates WHERE tenant_id = $1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.licenses WHERE license_key = $1`, [`ZJ-${SFX}`]).catch(() => {});
  await pool.query(`DELETE FROM zenithjoy.tenants WHERE id = $1`, [tenantId]).catch(() => {});
  await pool.end();
});

describe('mashup DB 边真验 [BEHAVIOR]', () => {
  it('from-script 真的往 mashup_templates 落一行', async () => {
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM zenithjoy.mashup_templates WHERE tenant_id = $1`,
      [tenantId],
    );
    const res = await segmentScriptToTemplate({
      tenantId,
      script: '开场悬念钩子，产品特写细节，行动号召引导下单',
    });
    expect(typeof res.templateId).toBe('string');
    const row = await pool.query(
      `SELECT id, slots FROM zenithjoy.mashup_templates WHERE id = $1 AND tenant_id = $2`,
      [res.templateId, tenantId],
    );
    expect(row.rows).toHaveLength(1);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM zenithjoy.mashup_templates WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it('渲染并发上限1 render_jobs 任一时刻 rendering 至多一行', async () => {
    const first = await enqueueRenderJob({ tenantId, candidateId });
    const second = await enqueueRenderJob({ tenantId, candidateId });
    expect(first.status).toBe('rendering');
    expect(second.status).toBe('queued');
    const rendering = await pool.query(
      `SELECT count(*)::int AS n FROM zenithjoy.mashup_render_jobs WHERE tenant_id = $1 AND status = 'rendering'`,
      [tenantId],
    );
    expect(rendering.rows[0].n).toBeLessThanOrEqual(1);
  });
});
