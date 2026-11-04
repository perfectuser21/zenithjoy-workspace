import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pool from '../../../src/db/connection';
import { generateChatDraft } from '../../../src/services/wechat-draft';
import { consolidate, getContactMemory } from '../../../src/services/wechat/contact-memory';
import { savePersona, saveBusinessKB } from '../../../src/services/wechat/cs-config-store';
afterAll(() => pool.end());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('shared CS memory persists across rounds, sanitizes drafts and never records generation as delivery', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'isolated-provider-fixture');
  vi.stubEnv('TOAPI_API_KEY', 'isolated-provider-fixture');
  vi.stubEnv('WECHAT_FEISHU_FACTS_SYNC', '0'); vi.stubEnv('OPENROUTER_FORCE_5XX', '');
  await savePersona({ self_name: '测试客服', address_style: '你', tone: '自然', sentence_style: '短句', use_emoji: '少量', banned_phrases: ['亲', '有什么可以帮您'], few_shot: [] });
  await saveBusinessKB({ company: { name: '测试公司', what_we_do: '定制套餐', value_prop: '按需服务', contact: '本地fixture' }, products: [{ name: '进阶套餐', selling_points: '按需配置' }], audience_segments: [], qa_docs: [] });
  const prompts: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  let reject = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    if (reject) return { ok: false, status: 503, text: async () => 'fixture provider unavailable' };
    const body = JSON.parse(String(options.body)); prompts.push(body);
    const content = body.messages.some((message: { role: string }) => message.role === 'system')
      ? '<think>内部思考不可见</think>' + JSON.stringify({ reply: '亲 可以看进阶套餐，有什么可以帮您', tags: { escalate: false } })
      : JSON.stringify({ summary: '客户对花生过敏', facts: [{ category: '禁忌', content: '对花生过敏' }] });
    return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }, model: 'fixture' }) };
  }));
  const key = `memory-${randomUUID()}`;
  const first = await generateChatDraft({ sender: '客户', wechat_id: key, content: '我对花生过敏', mode: 'auto' });
  expect(first.reply).toBeTruthy(); expect(first.reply).not.toMatch(/think|内部思考|有什么可以帮您|亲/);
  expect(first.message_id).toBeTypeOf('number');
  await consolidate(key, { force: true });
  expect((await getContactMemory(key)).facts).toEqual([{ category: '禁忌', content: '对花生过敏' }]);
  await generateChatDraft({ sender: '客户', wechat_id: key, content: '上次说的忌口还记得吗', mode: 'auto' });
  const context = JSON.stringify(prompts.at(-1));
  expect(context).toContain('测试客服'); expect(context).toContain('测试公司'); expect(context).toContain('花生');
  const rows = await pool.query('SELECT direction,status,content FROM zenithjoy.wechat_messages WHERE contact_key=$1', [key]);
  expect(rows.rows.filter(row => row.direction === 'in')).toHaveLength(2);
  expect(rows.rows.filter(row => row.direction === 'out')).toHaveLength(2);
  expect(rows.rows.filter(row => row.direction === 'out').every(row => row.status === 'draft')).toBe(true);
  reject = true;
  const failed = await generateChatDraft({ sender: '客户', wechat_id: key, content: 'provider failure fixture', mode: 'auto' });
  expect(failed.status).toBe('ai_failed'); expect(failed.reply).toBeUndefined();
  expect((await pool.query("SELECT id FROM zenithjoy.wechat_messages WHERE contact_key=$1 AND direction='out'", [key])).rows).toHaveLength(2);
});
