/**
 * 批量混剪 S3（GP f6f96e17）候选生成服务单测。
 *
 * mock 掉 embedding.ts（真模型推理留给 embedding.test.ts + smoke），这里只验证
 * 候选生成的组合/排序/J10 候选级去重/固定槽位透传逻辑，用可控的假向量driving
 * cosineSimilarity 的真实实现（不 mock cosineSimilarity 本身，用真实数学）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const embedText = vi.fn();
vi.mock('../embedding', async () => {
  const actual = await vi.importActual<typeof import('../embedding')>('../embedding');
  return { embedText: (...args: unknown[]) => embedText(...args), cosineSimilarity: actual.cosineSimilarity };
});

const RUN = {
  id: 'run-1',
  tenant_id: 'tenant-a',
  template_id: 'tmpl-1',
  status: 'completed',
};

const TEMPLATE_SLOTS = [
  { key: 'hook', required: true, match_tags: ['开场'] },
  { key: 'product', required: true, match_tags: ['产品特写'] },
  { key: 'cta', required: true, match_tags: ['行动号召'] },
];

function assignmentRow(slotKey: string, status: string, materialId: string | null = null) {
  return { slot_key: slotKey, material_id: materialId, status };
}

/** 单位向量按角度构造，方便手算余弦相似度。 */
const V = {
  hookQuery: [1, 0, 0],
  matHookGood: [1, 0, 0], // sim=1.0
  matHookOk: [0.7, 0.714, 0], // sim≈0.7（归一化后近似）
  productQuery: [0, 1, 0],
  matProductGood: [0, 1, 0], // sim=1.0
  matProductOk: [0, 0.7, 0.714],
  ctaFixedMaterial: [0, 0, 1],
};

function norm(v: number[]) {
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / len);
}

describe('generateCandidates', () => {
  beforeEach(() => {
    query.mockReset();
    embedText.mockReset();
  });

  function mockDb({
    run = RUN,
    slots = TEMPLATE_SLOTS,
    assignments,
    materials,
  }: {
    run?: unknown;
    slots?: unknown;
    assignments: ReturnType<typeof assignmentRow>[];
    materials: { id: string; ai_tags: string[]; embedding: number[] | null }[];
  }) {
    query.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_runs')) return { rows: run ? [run] : [] };
      if (sql.includes('FROM zenithjoy.mashup_templates')) return { rows: [{ id: 'tmpl-1', slots }] };
      if (sql.includes('FROM zenithjoy.mashup_slot_assignments')) return { rows: assignments };
      if (sql.includes('FROM zenithjoy.materials')) return { rows: materials };
      if (sql.includes('UPDATE zenithjoy.materials')) return { rows: [] };
      if (sql.includes('INSERT INTO zenithjoy.mashup_candidates')) return { rows: [{ id: `cand-${Math.random()}` }] };
      return { rows: [] };
    });
  }

  it('happy path：多候选生成，按 score 降序，候选内不重复用素材', async () => {
    embedText.mockImplementation(async (text: string) => {
      if (text.includes('开场')) return V.hookQuery;
      if (text.includes('产品特写')) return V.productQuery;
      return [0, 0, 0];
    });
    mockDb({
      assignments: [
        assignmentRow('hook', 'assigned', 'mat-hook-good'),
        assignmentRow('product', 'assigned', 'mat-product-good'),
        assignmentRow('cta', 'reshoot_skipped'),
      ],
      materials: [
        { id: 'mat-hook-good', ai_tags: ['开场'], embedding: norm(V.matHookGood) },
        { id: 'mat-hook-ok', ai_tags: ['开场', '弱相关'], embedding: norm(V.matHookOk) },
        { id: 'mat-product-good', ai_tags: ['产品特写'], embedding: norm(V.matProductGood) },
        { id: 'mat-product-ok', ai_tags: ['产品特写', '弱相关'], embedding: norm(V.matProductOk) },
      ],
    });

    const { generateCandidates } = await import('../mashup-candidate-generation');
    const result = await generateCandidates({ tenantId: 'tenant-a', runId: 'run-1' });

    expect(result.candidates.length).toBeGreaterThan(1);
    // 分数降序
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
    }
    // 每个候选里 hook/product 不会用同一个素材
    for (const c of result.candidates) {
      const used = [c.slotFill.hook, c.slotFill.product].filter(Boolean);
      expect(new Set(used).size).toBe(used.length);
    }
    // reshoot_skipped 的 cta 槽位在所有候选里都透传为空
    for (const c of result.candidates) {
      expect(c.slotFill.cta).toBeUndefined();
    }
    // 最高分候选应该是两个"good"素材的组合
    expect(result.candidates[0].slotFill).toMatchObject({ hook: 'mat-hook-good', product: 'mat-product-good' });
  });

  it('J10 候选级去重：素材集合完全相同的候选只保留一条', async () => {
    embedText.mockResolvedValue([1, 0, 0]);
    mockDb({
      assignments: [
        assignmentRow('hook', 'assigned', 'mat-a'),
        assignmentRow('product', 'assigned', 'mat-b'),
        assignmentRow('cta', 'assigned', 'mat-c'),
      ],
      materials: [
        { id: 'mat-a', ai_tags: ['开场'], embedding: [1, 0, 0] },
        { id: 'mat-b', ai_tags: ['产品特写'], embedding: [1, 0, 0] },
        { id: 'mat-c', ai_tags: ['行动号召'], embedding: [1, 0, 0] },
      ],
    });

    const { generateCandidates } = await import('../mashup-candidate-generation');
    const result = await generateCandidates({ tenantId: 'tenant-a', runId: 'run-1' });

    // 三个槽位各只有一个候选素材，理论组合数=1，不应该因为算法产生"重复候选"
    expect(result.candidates).toHaveLength(1);
  });

  it('targetCount 生效：候选数不超过指定上限', async () => {
    embedText.mockImplementation(async (text: string) => {
      if (text.includes('开场')) return [1, 0];
      if (text.includes('产品特写')) return [0, 1];
      return [0, 0];
    });
    const hookMats = Array.from({ length: 4 }, (_, i) => ({
      id: `mat-hook-${i}`,
      ai_tags: ['开场'],
      embedding: norm([1, 0.01 * i]),
    }));
    const productMats = Array.from({ length: 4 }, (_, i) => ({
      id: `mat-product-${i}`,
      ai_tags: ['产品特写'],
      embedding: norm([0.01 * i, 1]),
    }));
    mockDb({
      assignments: [
        assignmentRow('hook', 'assigned', 'mat-hook-0'),
        assignmentRow('product', 'assigned', 'mat-product-0'),
        assignmentRow('cta', 'unfilled'),
      ],
      materials: [...hookMats, ...productMats],
    });

    const { generateCandidates } = await import('../mashup-candidate-generation');
    const result = await generateCandidates({ tenantId: 'tenant-a', runId: 'run-1', targetCount: 3 });

    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('run 不存在：抛出明确错误', async () => {
    mockDb({ run: null, assignments: [], materials: [] });
    const { generateCandidates } = await import('../mashup-candidate-generation');
    await expect(generateCandidates({ tenantId: 'tenant-a', runId: 'missing-run' })).rejects.toThrow(/run not found/i);
  });

  it('变量槽位当前无任何候选素材：该槽位在候选里透传为空，不抛异常', async () => {
    embedText.mockResolvedValue([1, 0]);
    mockDb({
      assignments: [
        assignmentRow('hook', 'assigned', 'mat-hook-1'),
        assignmentRow('product', 'assigned', 'mat-product-1'),
        assignmentRow('cta', 'reshoot_skipped'),
      ],
      materials: [{ id: 'mat-hook-1', ai_tags: ['开场'], embedding: [1, 0] }],
    });

    const { generateCandidates } = await import('../mashup-candidate-generation');
    const result = await generateCandidates({ tenantId: 'tenant-a', runId: 'run-1' });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].slotFill.product).toBeUndefined();
  });
});
