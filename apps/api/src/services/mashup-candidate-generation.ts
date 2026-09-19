// apps/api/src/services/mashup-candidate-generation.ts
//
// 批量混剪 S3（GP f6f96e17）核心壁垒：语义检索候选生成引擎。
//
// S2 的 assignSlots 给每个槽位挑了"最佳单一素材"（贪心，标签重叠打分）。
// S3 要做的是反过来：对 S2 判定为 assigned 的槽位（有素材可选），用本地
// embedding 语义相似度重新给全体已打标签素材打分排序，取每槽位 Top-K，
// 再用 beam search 枚举出多个不同的槽位填充组合（候选），按总分排序、
// J10 候选级去重（proposal-v2.md：候选组合的素材集合过于相似就算重复）、
// 截断到 targetCount。
//
// S2 判定为 reshoot_skipped/unfilled 的槽位是"当前系统性缺素材"，不是
// "S2 恰好没挑到"，S3 不重新尝试——原样透传（该槽位在所有候选里都留空），
// 与 proposal-v2.md 表②"跳过该候选"的降级语义一致（这里是"跳过该槽位"，
// 槽位级降级不等于整条候选作废）。

import pool from '../db/connection';
import { embedText, cosineSimilarity } from './embedding';

const TOP_K_PER_SLOT = 6;
const DEFAULT_TARGET_COUNT = 50;
const HARD_MAX_TARGET_COUNT = 300; // proposal-v2.md A4：候选量上限区间 [50,300]
const DEDUPE_JACCARD_THRESHOLD = 0.8; // J10：素材集合重叠超过此阈值判定候选级重复

export interface GenerateCandidatesInput {
  tenantId: string;
  runId: string;
  targetCount?: number;
}

export interface CandidateResult {
  id: string;
  score: number;
  slotFill: Record<string, string | undefined>;
}

export interface GenerateCandidatesResult {
  runId: string;
  candidates: CandidateResult[];
}

interface SlotDef {
  key: string;
  required: boolean;
  match_tags: string[];
}

interface MaterialRow {
  id: string;
  ai_tags: string[] | null;
  embedding: number[] | null;
}

interface Beam {
  fills: Record<string, string>;
  used: Set<string>;
  score: number;
}

async function ensureEmbedding(material: MaterialRow): Promise<number[]> {
  if (material.embedding) return material.embedding;
  const text = (material.ai_tags ?? []).join(' ') || '(无标签)';
  const vec = await embedText(text);
  await pool.query(`UPDATE zenithjoy.materials SET embedding = $2::jsonb WHERE id = $1`, [
    material.id,
    JSON.stringify(vec),
  ]);
  return vec;
}

function signatureOf(fills: Record<string, string>): string {
  return Object.entries(fills)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export async function generateCandidates(input: GenerateCandidatesInput): Promise<GenerateCandidatesResult> {
  const targetCount = Math.min(input.targetCount ?? DEFAULT_TARGET_COUNT, HARD_MAX_TARGET_COUNT);

  const { rows: runRows } = await pool.query(
    `SELECT id, tenant_id, template_id, status FROM zenithjoy.mashup_runs WHERE id = $1 AND tenant_id = $2`,
    [input.runId, input.tenantId],
  );
  const run = runRows[0];
  if (!run) {
    throw new Error(`run not found: ${input.runId}`);
  }

  const { rows: tmplRows } = await pool.query(
    `SELECT slots FROM zenithjoy.mashup_templates WHERE id = $1`,
    [run.template_id],
  );
  const slots: SlotDef[] = tmplRows[0]?.slots ?? [];

  const { rows: assignmentRows } = await pool.query(
    `SELECT slot_key, material_id, status FROM zenithjoy.mashup_slot_assignments WHERE run_id = $1`,
    [run.id],
  );
  const statusBySlot = new Map<string, string>(assignmentRows.map((a: { slot_key: string; status: string }) => [a.slot_key, a.status]));
  const variableSlots = slots.filter((s) => statusBySlot.get(s.key) === 'assigned');

  const { rows: materialRows } = await pool.query(
    `SELECT id, ai_tags, embedding FROM zenithjoy.materials WHERE tenant_id = $1 AND tag_status = 'tagged'`,
    [input.tenantId],
  );
  const materials = materialRows as MaterialRow[];
  for (const m of materials) {
    m.embedding = await ensureEmbedding(m);
  }

  // 每个变量槽位：算槽位语义查询向量，对全体素材排相似度，取 Top-K。
  const topKBySlot = new Map<string, { id: string; score: number }[]>();
  for (const slot of variableSlots) {
    const queryText = slot.match_tags.join(' ');
    const queryVec = await embedText(queryText);
    const ranked = materials
      .map((m) => ({ id: m.id, score: cosineSimilarity(queryVec, m.embedding as number[]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K_PER_SLOT);
    topKBySlot.set(slot.key, ranked);
  }

  // beam search：逐槽位扩展，每步截断保留分数最高的一批，防组合爆炸。
  const beamWidth = Math.max(targetCount * 4, 40);
  let beams: Beam[] = [{ fills: {}, used: new Set(), score: 0 }];

  for (const slot of variableSlots) {
    const candidates = topKBySlot.get(slot.key) ?? [];
    if (candidates.length === 0) {
      // 当前无任何候选素材：槽位在所有候选里留空，不淘汰已有 beam（与 S2 J4
      // 槽位级降级同精神——缺素材不该把整条候选方案判死）。
      continue;
    }
    const nextBeams: Beam[] = [];
    for (const beam of beams) {
      for (const c of candidates) {
        if (beam.used.has(c.id)) continue;
        nextBeams.push({
          fills: { ...beam.fills, [slot.key]: c.id },
          used: new Set(beam.used).add(c.id),
          score: beam.score + c.score,
        });
      }
    }
    if (nextBeams.length > 0) {
      nextBeams.sort((a, b) => b.score - a.score);
      beams = nextBeams.slice(0, beamWidth);
    }
    // nextBeams 为空（例如全部素材都已被同一 beam 用掉）：保留原 beams 不变，
    // 该槽位在这些 beam 上留空，同上降级精神。
  }

  beams.sort((a, b) => b.score - a.score);

  // J10 候选级去重：素材集合 Jaccard 相似度超阈值判定为重复候选，保留分高的那条
  // （beams 已按分数降序，遍历时先出现的分数天然更高）。
  const accepted: Beam[] = [];
  for (const beam of beams) {
    const beamSet = new Set(Object.values(beam.fills));
    const isDup = accepted.some((a) => jaccard(new Set(Object.values(a.fills)), beamSet) >= DEDUPE_JACCARD_THRESHOLD);
    if (!isDup) accepted.push(beam);
    if (accepted.length >= targetCount) break;
  }

  const results: CandidateResult[] = [];
  for (const beam of accepted) {
    const { rows } = await pool.query(
      `INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (run_id, signature) DO NOTHING
       RETURNING id`,
      [run.id, input.tenantId, JSON.stringify(beam.fills), beam.score, signatureOf(beam.fills)],
    );
    const id = rows[0]?.id;
    if (id) {
      results.push({ id, score: beam.score, slotFill: beam.fills });
    }
  }

  return { runId: run.id, candidates: results };
}
