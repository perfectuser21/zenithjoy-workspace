/**
 * Step1 文案动态分段模板生成（真 Postgres 落库 — 禁 mock 边：代码 ↔ mashup_templates）。
 *
 * 覆盖：from-script 返回动态 slots 并落库 mashup_templates / AI 不可用降级 degraded fallback。
 * AI 不可用分支用「不设 TOAPIS_API_KEY」触发（PRD Step1：超时/鉴权/欠费/5xx/网络统一降级），
 * happy path（source=ai）由 hk-vps L3 E2E 真 key 覆盖（见 ## 未覆盖真实链路清单）。
 *
 * TDD Red：generateTemplateFromScript 尚未实现 → import 失败，全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { generateTemplateFromScript } from '../../../apps/api/src/services/mashup-slot-assignment';

const PGURL = process.env.E2E_DATABASE_URL ?? process.env.DB_URL ?? 'postgresql://postgres@localhost:5432/cecelia';
const TENANT = 'seg-tenant-' + Math.random().toString(16).slice(2, 8);
const SCRIPT = '开场三秒抛出用户痛点，中段展示产品核心卖点与真实使用效果对比，结尾强行动号召引导立即下单购买';
let client: Client;
const created: string[] = [];
let savedKey: string | undefined;

beforeAll(async () => {
  client = new Client({ connectionString: PGURL });
  await client.connect();
  savedKey = process.env.TOAPIS_API_KEY;
  delete process.env.TOAPIS_API_KEY; // 强制 AI 不可用 → 降级分支
});

afterAll(async () => {
  if (savedKey !== undefined) process.env.TOAPIS_API_KEY = savedKey;
  if (created.length) {
    await client.query(`DELETE FROM zenithjoy.mashup_templates WHERE id = ANY($1::uuid[])`, [created]);
  }
  await client.end();
});

describe('Step1 文案动态分段', () => {
  it('AI 不可用降级 degraded fallback（返回固定模板，非阻断）', async () => {
    const r = await generateTemplateFromScript({ tenantId: TENANT, script: SCRIPT });
    created.push(r.templateId);
    expect(r.degraded).toBe(true);
    expect(r.source).toBe('fallback');
    expect(Array.isArray(r.slots)).toBe(true);
    expect(r.slots.length).toBeGreaterThanOrEqual(1);
  });

  it('from-script 返回动态 slots 并落库 mashup_templates（每段带 suggestedCount）', async () => {
    const r = await generateTemplateFromScript({ tenantId: TENANT, script: SCRIPT });
    created.push(r.templateId);
    expect(typeof r.templateId).toBe('string');
    for (const s of r.slots) {
      expect(typeof s.key).toBe('string');
      expect(typeof s.suggestedCount).toBe('number');
      expect(['matched', 'fallback']).toContain(s.tagMapping);
    }
    const row = await client.query(
      `SELECT tenant_id FROM zenithjoy.mashup_templates WHERE id = $1`,
      [r.templateId],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].tenant_id).toBe(TENANT); // 租户隔离：落到本租户
  });
});
