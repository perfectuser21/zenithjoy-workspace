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

// axios 必须在模块顶层 mock：被测模块是 ESM import，事后 vi.spyOn(require('axios'))
// 挂不上去，会真的打网络（实测会看到 401，测试变成"碰巧走了降级路径"的假绿）。
const axiosPost = vi.fn();
vi.mock('axios', () => ({ default: { post: axiosPost }, post: axiosPost }));

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

/**
 * 文案原文落库（口播刀前置，GP line05/batch_mashup#step4，决策 f10195d7）
 *
 * 真实事故：客户写了 200 字带货文案，却发现"片子里一个字都没有"。根因是
 * generateTemplateFromScript 把文案发给 AI 分段后只落 slots，**文案原文直接丢掉**，
 * 系统里再也找不到——于是渲染时想拿它做 TTS 配音，无从取起。
 *
 * 光存整段原文还不够：声画对齐要的是"这一句话配这一个镜头"，所以 AI 必须
 * 逐段返回它切出来的文案片段（slot.text），一并落库。
 */
describe('generateTemplateFromScript — 文案原文必须留底 [BEHAVIOR]', () => {
  const SCRIPT = '厨房蟑螂反复出没？这瓶喷雾一喷就见效，角落缝隙全覆盖。点击下方链接下单。';

  function mockAiSegments(segments: unknown) {
    axiosPost.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify(segments) } }] },
    });
  }

  beforeEach(() => {
    query.mockReset();
    axiosPost.mockReset();
    process.env.TOAPIS_API_KEY = 'test-key';
  });

  it('文案原文与逐段文案片段都要写进 mashup_templates', async () => {
    mockAiSegments([
      { key: 'hook', match_tags: ['开场'], suggestedCount: 1, required: true, text: '厨房蟑螂反复出没？' },
      { key: 'product', match_tags: ['产品特写'], suggestedCount: 1, required: true, text: '这瓶喷雾一喷就见效，角落缝隙全覆盖。' },
      { key: 'cta', match_tags: ['行动号召'], suggestedCount: 1, required: true, text: '点击下方链接下单。' },
    ]);
    query.mockResolvedValue({ rows: [{ id: 'tmpl-new' }] });

    const { generateTemplateFromScript } = await import('../mashup-slot-assignment');
    await generateTemplateFromScript({ tenantId: 'tenant-a', script: SCRIPT });

    const insert = query.mock.calls.find((c: unknown[]) => /INSERT INTO zenithjoy\.mashup_templates/i.test(String(c[0])));
    expect(insert, 'INSERT 语句应存在').toBeTruthy();
    const sql = String(insert![0]);
    const params = insert![1] as unknown[];

    // 没有这两列，配音和声画对齐就没有数据来源
    expect(sql).toMatch(/script_text/);
    expect(sql).toMatch(/script_segments/);
    expect(params, '文案原文必须原样入参').toContain(SCRIPT);

    const segParam = params.find((p) => typeof p === 'string' && p.includes('一喷就见效'));
    expect(segParam, '逐段文案片段必须落库（声画对齐靠它）').toBeTruthy();
  });

  it('AI 没给 text 时不炸，片段落空但原文仍留底', async () => {
    mockAiSegments([{ key: 'hook', match_tags: ['开场'], suggestedCount: 1, required: true }]);
    query.mockResolvedValue({ rows: [{ id: 'tmpl-new' }] });

    const { generateTemplateFromScript } = await import('../mashup-slot-assignment');
    const r = await generateTemplateFromScript({ tenantId: 'tenant-a', script: SCRIPT });

    expect(r.templateId).toBe('tmpl-new');
    const insert = query.mock.calls.find((c: unknown[]) => /INSERT INTO zenithjoy\.mashup_templates/i.test(String(c[0])));
    expect((insert![1] as unknown[])).toContain(SCRIPT);
  });

  it('AI 降级走固定模板时，文案原文照样要留底', async () => {
    delete process.env.TOAPIS_API_KEY; // 无 key → 降级
    query.mockResolvedValue({ rows: [{ id: 'tmpl-fb' }] });

    const { generateTemplateFromScript } = await import('../mashup-slot-assignment');
    const r = await generateTemplateFromScript({ tenantId: 'tenant-a', script: SCRIPT });

    expect(r.degraded).toBe(true);
    const insert = query.mock.calls.find((c: unknown[]) => /INSERT INTO zenithjoy\.mashup_templates/i.test(String(c[0])));
    expect((insert![1] as unknown[]), '降级也不能把客户文案弄丢').toContain(SCRIPT);
  });
});
