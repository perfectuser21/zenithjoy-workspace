/**
 * 批量混剪加厚 · Step1 文案驱动动态分段（GP line05/batch_mashup）合同测试（TDD Red）。
 *
 * 禁 mock 边：code ↔ zenithjoy.mashup_templates（本 Step 新增 INSERT 写路径）——
 * 这里用**真 Postgres**（真 pool，不 vi.mock db/connection），只把外部付费边界
 * TOAPIS/Gemini 通过 deps.callAi 注入替身（外层无关依赖，允许替身；真调一次由
 * real-toapis-segment.mjs 覆盖）。
 *
 * 现在必红：apps/api/src/services/mashup-script-segment.ts 尚不存在。
 */
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../../apps/api/src/db/connection';
import { AI_TAG_VOCAB } from '../../../apps/api/src/services/ai-tags';
import {
  segmentScriptToTemplate,
  TEMPLATE_NAME_MAX,
  type AiSegment,
} from '../../../apps/api/src/services/mashup-script-segment';

const TENANT = `tnt-seg-${Math.floor(Math.random() * 1e6)}`;

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.mashup_templates WHERE tenant_id = $1`, [TENANT]);
  await pool.end();
});

const fakeAi = (segs: AiSegment[]) => async () => segs;

describe('segmentScriptToTemplate [BEHAVIOR]', () => {
  it('文案解析出动态分段并落成新 mashup_templates 行，角色标签命中 ai_tags 枚举', async () => {
    const script = '开场先抛一个悬念钩子，然后展示产品特写细节，最后给出行动号召让用户下单。';
    const result = await segmentScriptToTemplate(
      { tenantId: TENANT, script },
      {
        callAi: fakeAi([
          { roleLabel: '开场钩子', aiTag: '开场', suggestedCount: 2 },
          { roleLabel: '产品展示', aiTag: '产品特写', suggestedCount: 3 },
          { roleLabel: '行动号召', aiTag: '行动号召', suggestedCount: 1 },
        ]),
      },
    );

    expect(result.degraded).toBe(false);
    expect(result.segments.length).toBe(3);
    // 命中枚举的段 fallbackMapped=false 且 aiTag ∈ 单一来源枚举
    const hook = result.segments[0];
    expect(hook.fallbackMapped).toBe(false);
    expect(AI_TAG_VOCAB).toContain(hook.aiTag);

    // 真库校验：新模板行确实落库（不看返回值自证，查真表）
    const { rows } = await pool.query(
      `SELECT id, name FROM zenithjoy.mashup_templates WHERE id = $1 AND tenant_id = $2`,
      [result.templateId, TENANT],
    );
    expect(rows.length).toBe(1);
  });

  it('AI 返回未知角色标签时标「兜底映射」fallbackMapped=true，不阻断', async () => {
    const result = await segmentScriptToTemplate(
      { tenantId: TENANT, script: '一段无法归类的实验性文案' },
      { callAi: fakeAi([{ roleLabel: '玄学氛围段', aiTag: '玄学氛围段', suggestedCount: 1 }]) },
    );
    expect(result.degraded).toBe(false);
    expect(result.segments[0].fallbackMapped).toBe(true);
  });

  it('AI 服务不可用（超时/5xx/鉴权/欠费/网络）统一静默降级固定模板，非阻断', async () => {
    const result = await segmentScriptToTemplate(
      { tenantId: TENANT, script: '任意文案' },
      {
        callAi: async () => {
          throw new Error('gemini_timeout');
        },
      },
    );
    // 非阻断：不抛异常，返回 degraded 固定模板，且仍落一行模板
    expect(result.degraded).toBe(true);
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query(
      `SELECT id FROM zenithjoy.mashup_templates WHERE id = $1 AND tenant_id = $2`,
      [result.templateId, TENANT],
    );
    expect(rows.length).toBe(1);
  });

  it('INV-3 付费调用去重：同一文案重复提交只真调一次 AI（已处理前置检查）', async () => {
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return [{ roleLabel: '开场钩子', aiTag: '开场', suggestedCount: 1 }] as AiSegment[];
    };
    const script = `幂等文案-${Math.random()}`;
    await segmentScriptToTemplate({ tenantId: TENANT, script }, { callAi: counting });
    await segmentScriptToTemplate({ tenantId: TENANT, script }, { callAi: counting });
    expect(calls).toBe(1);
  });

  it('INV-5 字段长度截断：超长文案派生的模板 name 截断到列约束内', async () => {
    const longScript = '钩'.repeat(500);
    const result = await segmentScriptToTemplate(
      { tenantId: TENANT, script: longScript },
      { callAi: fakeAi([{ roleLabel: '开场钩子', aiTag: '开场', suggestedCount: 1 }]) },
    );
    const { rows } = await pool.query(
      `SELECT name FROM zenithjoy.mashup_templates WHERE id = $1`,
      [result.templateId],
    );
    expect(rows[0].name.length).toBeLessThanOrEqual(TEMPLATE_NAME_MAX);
  });

  it('空文案 → 抛 INVALID_BODY（error path）', async () => {
    await expect(
      segmentScriptToTemplate({ tenantId: TENANT, script: '' }, { callAi: fakeAi([]) }),
    ).rejects.toThrow(/INVALID_BODY|script/i);
  });
});
