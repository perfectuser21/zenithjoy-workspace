/**
 * Step3 候选 200+ 懒渲染 + 缩略图（真 Postgres — 禁 mock 边：candidate-generation ↔ mashup_candidates 落库）。
 *
 * 覆盖：候选生成期 render_status 恒 pending / 候选带 thumbnailUrl 与 generatedCount。
 * 用「全 reshoot_skipped 槽位」的 run 驱动 generateCandidates（variableSlots 为空 → 无需 materials/embedding，
 * 稳定跑真库落一条候选），聚焦「生成期不真实渲染 + 落库带渲染态列」这条被改的边。
 * 真实缩略图（抽帧自真视频）为 null 是允许的，thumbnailUrl!=null 的硬断言由 hk-vps L3 E2E 覆盖。
 *
 * TDD Red：generateCandidates 结果无 generatedCount、mashup_candidates 无 render_status/thumbnail_url 列 → 全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { generateCandidates } from '../../../apps/api/src/services/mashup-candidate-generation';

const PGURL = process.env.E2E_DATABASE_URL ?? process.env.DB_URL ?? 'postgresql://postgres@localhost:5432/cecelia';
const TENANT = 'cand-tenant-' + Math.random().toString(16).slice(2, 8);
let client: Client;
let templateId = '';
let runId = '';

beforeAll(async () => {
  client = new Client({ connectionString: PGURL });
  await client.connect();
  templateId = (
    await client.query(
      `INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots)
       VALUES ($1, 'lazy-test', '[{"key":"hook","required":true,"match_tags":["开场"]}]'::jsonb)
       RETURNING id`,
      [TENANT],
    )
  ).rows[0].id;
  runId = (
    await client.query(
      `INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [TENANT, templateId],
    )
  ).rows[0].id;
  // 唯一槽位判为 reshoot_skipped → variableSlots 为空 → 无需 materials/embedding
  await client.query(
    `INSERT INTO zenithjoy.mashup_slot_assignments (run_id, slot_key, status) VALUES ($1, 'hook', 'reshoot_skipped')`,
    [runId],
  );
});

afterAll(async () => {
  await client.query(`DELETE FROM zenithjoy.mashup_runs WHERE id = $1`, [runId]).catch(() => {});
  await client.query(`DELETE FROM zenithjoy.mashup_templates WHERE id = $1`, [templateId]).catch(() => {});
  await client.end();
});

describe('Step3 候选生成懒渲染', () => {
  it('候选带 thumbnailUrl 与 generatedCount（结果形状）', async () => {
    const r = await generateCandidates({ tenantId: TENANT, runId, targetCount: 200 });
    expect(typeof (r as { generatedCount?: number }).generatedCount).toBe('number');
    expect(r.candidates.length).toBeLessThanOrEqual(200);
    for (const c of r.candidates) {
      expect('thumbnailUrl' in c).toBe(true); // 字段存在（值可为 null，真实缩略图 L3 验）
      expect(c.renderStatus).toBe('pending'); // 懒渲染：生成期恒 pending
    }
  });

  it('候选生成期 render_status 恒 pending（落库无真实渲染）', async () => {
    const rows = await client.query(
      `SELECT render_status FROM zenithjoy.mashup_candidates WHERE run_id = $1`,
      [runId],
    );
    expect(rows.rowCount).toBeGreaterThanOrEqual(1);
    for (const row of rows.rows) expect(row.render_status).toBe('pending');
    // 懒渲染硬证据：生成期该 run 无任何成片 contents 产出
    const rendered = await client.query(
      `SELECT count(*)::int AS n FROM zenithjoy.contents c
         JOIN zenithjoy.mashup_candidates mc ON mc.id = c.source_candidate_id
        WHERE mc.run_id = $1`,
      [runId],
    );
    expect(rendered.rows[0].n).toBe(0);
  });
});
