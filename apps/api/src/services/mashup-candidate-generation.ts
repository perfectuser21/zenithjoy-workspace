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

/** 候选生成期的渲染态恒为 'pending'（懒渲染，此刻绝不真实渲染）。 */
export type CandidateRenderStatus = 'pending';

/**
 * 缩略图构造依赖（可注入）。默认不生成（返回 null）——真实抽帧需 storage + ffmpeg，
 * 由 HTTP 路由层注入 buildThumbnail（见 routes/mashup.ts），单测/冻结测试不注入时
 * thumbnailUrl 恒为 null（合同：抽帧失败/无素材 → null，真实缩略图由 L3 E2E 覆盖）。
 */
export interface GenerateCandidatesDeps {
  buildThumbnail?: (materialIds: string[], tenantId: string) => Promise<string | null>;
}

export interface CandidateResult {
  id: string;
  score: number;
  slotFill: Record<string, string | undefined>;
  thumbnailUrl: string | null;
  renderStatus: CandidateRenderStatus;
}

export interface GenerateCandidatesResult {
  runId: string;
  generatedCount: number;
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

export async function generateCandidates(
  input: GenerateCandidatesInput,
  deps: GenerateCandidatesDeps = {},
): Promise<GenerateCandidatesResult> {
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

  // 缩略图缓存：同一素材集合的候选共享抽帧结果，避免对同一素材重复抽帧。
  const thumbnailCache = new Map<string, string | null>();
  async function thumbnailFor(fills: Record<string, string>): Promise<string | null> {
    if (!deps.buildThumbnail) return null;
    const materialIds = Object.values(fills);
    if (materialIds.length === 0) return null;
    const cacheKey = [...materialIds].sort().join('|');
    if (thumbnailCache.has(cacheKey)) return thumbnailCache.get(cacheKey) ?? null;
    let url: string | null = null;
    try {
      url = await deps.buildThumbnail(materialIds, input.tenantId);
    } catch {
      url = null; // 抽帧失败 → null（合同：不阻断，前端占位）
    }
    thumbnailCache.set(cacheKey, url);
    return url;
  }

  const results: CandidateResult[] = [];
  for (const beam of accepted) {
    // 懒渲染：生成期此刻绝不真实渲染，render_status 恒 'pending'（列默认也是 pending）。
    const thumbnailUrl = await thumbnailFor(beam.fills);
    const { rows } = await pool.query(
      `INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature, render_status, thumbnail_url)
       VALUES ($1, $2, $3::jsonb, $4, $5, 'pending', $6)
       ON CONFLICT (run_id, signature) DO NOTHING
       RETURNING id`,
      [run.id, input.tenantId, JSON.stringify(beam.fills), beam.score, signatureOf(beam.fills), thumbnailUrl],
    );
    const id = rows[0]?.id;
    if (id) {
      results.push({ id, score: beam.score, slotFill: beam.fills, thumbnailUrl, renderStatus: 'pending' });
    }
  }

  return { runId: run.id, generatedCount: results.length, candidates: results };
}
