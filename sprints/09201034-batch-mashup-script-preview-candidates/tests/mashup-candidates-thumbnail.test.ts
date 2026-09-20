/**
 * 批量混剪加厚 · Step3 候选 200+ 缩略图拼贴（GP line05/batch_mashup）合同测试（TDD Red）。
 *
 * 禁 mock 边：code ↔ zenithjoy.mashup_candidates（本 Step 改写候选落库并新增缩略图 URL）——
 * 用真 Postgres（真 pool）。仅 mock 外层付费边界 embedding 模型（deterministic 向量），
 * 不 mock 被改的候选落库边。
 *
 * 现在必红：generateCandidates 返回体尚无 generatedCount / candidates[].thumbnailUrl。
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

// embedding 是外层付费模型边界，允许替身：给可控向量，驱动真实 cosineSimilarity。
vi.mock('../../../apps/api/src/services/embedding', async () => {
  const actual = await vi.importActual<typeof import('../../../apps/api/src/services/embedding')>(
    '../../../apps/api/src/services/embedding',
  );
  return { embedText: async () => [1, 0, 0], cosineSimilarity: actual.cosineSimilarity };
});

import pool from '../../../apps/api/src/db/connection';
import { generateCandidates } from '../../../apps/api/src/services/mashup-candidate-generation';

const TENANT = `tnt-cand-${Math.floor(Math.random() * 1e6)}`;
let templateId: string;
let runId: string;

async function seed() {
  const tmpl = await pool.query(
    `INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots) VALUES ($1,$2,$3::jsonb) RETURNING id`,
    [TENANT, 't', JSON.stringify([{ key: 'hook', required: true, match_tags: ['开场'] }])],
  );
  templateId = tmpl.rows[0].id;
  const run = await pool.query(
    `INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ($1,$2,'completed') RETURNING id`,
    [TENANT, templateId],
  );
  runId = run.rows[0].id;
  await pool.query(
    `INSERT INTO zenithjoy.mashup_slot_assignments (run_id, slot_key, status) VALUES ($1,'hook','assigned')`,
    [runId],
  );
  // 多个已打标签素材，预置 embedding 避免真模型调用
  for (let i = 0; i < 12; i += 1) {
    await pool.query(
      `INSERT INTO zenithjoy.materials (tenant_id, file_name, size_bytes, mime_type, storage_key, tag_status, ai_tags, embedding)
       VALUES ($1,$2,1,'video/mp4',$3,'tagged',$4,$5::jsonb)`,
      [TENANT, `m${i}.mp4`, `key/${TENANT}/${i}`, ['开场'], JSON.stringify([1 - i * 0.01, i * 0.01, 0])],
    );
  }
}

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.materials WHERE tenant_id = $1`, [TENANT]);
  if (runId) await pool.query(`DELETE FROM zenithjoy.mashup_runs WHERE id = $1`, [runId]);
  if (templateId) await pool.query(`DELETE FROM zenithjoy.mashup_templates WHERE id = $1`, [templateId]);
  await pool.end();
});

describe('generateCandidates 候选 200+ 缩略图拼贴 [BEHAVIOR]', () => {
  it('targetCount=200 → generatedCount 如实反映实际生成数（≤200），每条候选含 thumbnailUrl', async () => {
    await seed();
    const result = await generateCandidates({ tenantId: TENANT, runId, targetCount: 200 });

    // 如实数量（决策 3ed368c3）：generatedCount 存在且 = candidates.length ≤ 200
    expect(typeof (result as { generatedCount?: number }).generatedCount).toBe('number');
    expect((result as { generatedCount: number }).generatedCount).toBe(result.candidates.length);
    expect(result.candidates.length).toBeLessThanOrEqual(200);
    expect(result.candidates.length).toBeGreaterThan(0);

    // 每条候选带缩略图拼贴 URL（抽帧自 video-frame-extract）
    for (const c of result.candidates) {
      expect(typeof (c as { thumbnailUrl?: string }).thumbnailUrl).toBe('string');
      expect((c as { thumbnailUrl: string }).thumbnailUrl.length).toBeGreaterThan(0);
    }

    // 真库校验：候选确实落 mashup_candidates（5 分钟时间窗防历史冒充）
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM zenithjoy.mashup_candidates
        WHERE run_id = $1 AND created_at > NOW() - interval '5 minutes'`,
      [runId],
    );
    expect(rows[0].n).toBe(result.candidates.length);
  });
});
