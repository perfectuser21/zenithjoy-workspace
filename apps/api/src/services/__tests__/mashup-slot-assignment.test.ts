/**
 * 批量混剪 S2（GP f6f96e17）：槽位模板分配服务单测。
 *
 * 三态对齐 proposal-v2.md J4：
 *   assigned         = 槽位已分配到匹配素材
 *   reshoot_skipped  = 必填槽位缺匹配素材，补拍服务未配置/失败，按 J4 REC 跳过（不阻断）
 *   unfilled         = 选填槽位缺匹配素材（非异常）
 *
 * 用假 pool 打桩，不连真库——纯打分/落库 SQL 结构在这一层验证，真库集成留给 smoke。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

function template(slots: unknown) {
  return { id: 'tmpl-1', tenant_id: null, name: '标准四槽位', slots };
}

const FOUR_SLOTS = [
  { key: 'hook', required: true, match_tags: ['开场', '悬念'] },
  { key: 'product', required: true, match_tags: ['产品特写'] },
  { key: 'evidence', required: false, match_tags: ['使用场景'] },
  { key: 'cta', required: true, match_tags: ['行动号召'] },
];

describe('assignSlots', () => {
  beforeEach(() => {
    query.mockReset();
    delete process.env.SEEDANCE_API_KEY;
    delete process.env.HAPPYHORSE_API_KEY;
  });

  function mockDb({ tmpl, materials, runId = 'run-1' }: { tmpl: unknown; materials: unknown[]; runId?: string }) {
    query.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.mashup_templates')) return { rows: tmpl ? [tmpl] : [] };
      if (sql.includes('FROM zenithjoy.materials')) return { rows: materials };
      if (sql.includes('INSERT INTO zenithjoy.mashup_runs')) return { rows: [{ id: runId }] };
      if (sql.includes('INSERT INTO zenithjoy.mashup_slot_assignments')) return { rows: [] };
      if (sql.includes('UPDATE zenithjoy.mashup_runs')) return { rows: [] };
      return { rows: [] };
    });
  }

  it('happy path：四槽位全部命中不同素材，run 状态 completed', async () => {
    mockDb({
      tmpl: template(FOUR_SLOTS),
      materials: [
        { id: 'mat-hook', ai_tags: ['开场', '厨房'] },
        { id: 'mat-product', ai_tags: ['产品特写', '细节'] },
        { id: 'mat-evidence', ai_tags: ['使用场景'] },
        { id: 'mat-cta', ai_tags: ['行动号召', '结尾'] },
      ],
    });
    const { assignSlots } = await import('../mashup-slot-assignment');
    const result = await assignSlots({ tenantId: 'tenant-a', templateId: 'tmpl-1', materialIds: ['mat-hook', 'mat-product', 'mat-evidence', 'mat-cta'] });

    expect(result.status).toBe('completed');
    expect(result.assignments).toHaveLength(4);
    for (const a of result.assignments) {
      expect(a.status).toBe('assigned');
    }
    const hook = result.assignments.find((a) => a.slotKey === 'hook');
    expect(hook?.materialId).toBe('mat-hook');
  });

  it('必填槽位缺匹配素材且补拍服务未配置：reshoot_skipped，run 状态 completed_partial', async () => {
    mockDb({
      tmpl: template(FOUR_SLOTS),
      materials: [
        { id: 'mat-product', ai_tags: ['产品特写'] },
        { id: 'mat-cta', ai_tags: ['行动号召'] },
      ],
    });
    const { assignSlots } = await import('../mashup-slot-assignment');
    const result = await assignSlots({ tenantId: 'tenant-a', templateId: 'tmpl-1', materialIds: ['mat-product', 'mat-cta'] });

    expect(result.status).toBe('completed_partial');
    const hook = result.assignments.find((a) => a.slotKey === 'hook');
    expect(hook?.status).toBe('reshoot_skipped');
    expect(hook?.reason).toBe('reshoot_service_not_configured');
    expect(hook?.materialId).toBeUndefined();
  });

  it('选填槽位缺匹配素材：unfilled，不影响 run 状态为 completed', async () => {
    mockDb({
      tmpl: template(FOUR_SLOTS),
      materials: [
        { id: 'mat-hook', ai_tags: ['开场'] },
        { id: 'mat-product', ai_tags: ['产品特写'] },
        { id: 'mat-cta', ai_tags: ['行动号召'] },
      ],
    });
    const { assignSlots } = await import('../mashup-slot-assignment');
    const result = await assignSlots({ tenantId: 'tenant-a', templateId: 'tmpl-1', materialIds: ['mat-hook', 'mat-product', 'mat-cta'] });

    expect(result.status).toBe('completed');
    const evidence = result.assignments.find((a) => a.slotKey === 'evidence');
    expect(evidence?.status).toBe('unfilled');
    expect(evidence?.reason).toBe('no_eligible_material');
  });

  it('同一素材不会被分配给两个槽位', async () => {
    mockDb({
      tmpl: template([
        { key: 'hook', required: true, match_tags: ['开场', '产品特写'] },
        { key: 'product', required: true, match_tags: ['产品特写'] },
      ]),
      materials: [
        { id: 'mat-both', ai_tags: ['开场', '产品特写'] },
        { id: 'mat-product-only', ai_tags: ['产品特写'] },
      ],
    });
    const { assignSlots } = await import('../mashup-slot-assignment');
    const result = await assignSlots({ tenantId: 'tenant-a', templateId: 'tmpl-1', materialIds: ['mat-both', 'mat-product-only'] });

    const used = result.assignments.map((a) => a.materialId).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it('模板不存在：抛出明确错误', async () => {
    mockDb({ tmpl: null, materials: [] });
    const { assignSlots } = await import('../mashup-slot-assignment');
    await expect(
      assignSlots({ tenantId: 'tenant-a', templateId: 'missing-tmpl', materialIds: [] }),
    ).rejects.toThrow(/template not found/i);
  });

  it('candidate pool 为空：必填槽位全部 reshoot_skipped，不抛异常', async () => {
    mockDb({ tmpl: template(FOUR_SLOTS), materials: [] });
    const { assignSlots } = await import('../mashup-slot-assignment');
    const result = await assignSlots({ tenantId: 'tenant-a', templateId: 'tmpl-1', materialIds: [] });

    expect(result.status).toBe('completed_partial');
    expect(result.assignments.filter((a) => a.status === 'reshoot_skipped')).toHaveLength(3);
    expect(result.assignments.find((a) => a.slotKey === 'evidence')?.status).toBe('unfilled');
  });
});
