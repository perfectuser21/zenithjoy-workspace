/**
 * types.ts 契约测试 — 用代表性对象固定三口井/三层记忆的数据形状，
 * 防止后续改动悄悄破坏跨模块共享的类型契约。
 */
import { describe, it, expect } from 'vitest';
import type {
  Persona,
  BusinessKB,
  ContactFact,
  ContactMemory,
  ChatMessage,
  AssembledContext,
  FactCategory,
} from '../types';

describe('wechat 引擎共享类型契约', () => {
  it('Persona：自称/禁用词/few-shot 字段齐全', () => {
    const p: Persona = {
      self_name: '小齐',
      address_style: '叫名字，不用"亲"',
      tone: '随和直接',
      sentence_style: '短句口语',
      use_emoji: '偶尔',
      banned_phrases: ['亲', '有什么可以帮您'],
      few_shot: [{ customer: '在吗', me: '在的~ 说' }],
    };
    expect(p.self_name).toBe('小齐');
    expect(p.banned_phrases).toContain('有什么可以帮您');
    expect(p.few_shot[0].me).toBe('在的~ 说');
  });

  it('BusinessKB：企业/产品/A1-A5人群/Q&A 四块齐全', () => {
    const kb: BusinessKB = {
      company: { name: 'ZenithJoy', what_we_do: '私域获客', value_prop: '闭环', contact: 'wx' },
      products: [{ name: '基础版', selling_points: '获客+接待', price: '3980/月' }],
      audience_segments: [{ code: 'A1', label: '高意向', desc: '预算有限反复比价' }],
      qa_docs: [{ q: '怎么收费', a: '按月付' }],
    };
    expect(kb.company.name).toBe('ZenithJoy');
    expect(kb.audience_segments[0].code).toBe('A1');
    expect(kb.products[0].price).toBe('3980/月');
  });

  it('ContactMemory：facts 用合法 FactCategory 枚举', () => {
    const cats: FactCategory[] = ['称呼', '身份', '偏好', '承诺', '禁忌', '其他'];
    const fact: ContactFact = { category: '禁忌', content: '对花生过敏' };
    const mem: ContactMemory = { summary: '聊过套餐', facts: [fact] };
    expect(cats).toContain(fact.category);
    expect(mem.facts).toHaveLength(1);
    expect(mem.facts[0].content).toBe('对花生过敏');
  });

  it('ChatMessage.direction 只能 in/out；AssembledContext 拆 system/user 两段', () => {
    const msg: ChatMessage = {
      direction: 'in',
      content: '你好',
      created_at: new Date(0).toISOString(),
    };
    const ctx: AssembledContext = { system: '人设+企业信息', user: '记忆+最新消息' };
    expect(['in', 'out']).toContain(msg.direction);
    expect(ctx.system).toContain('人设');
    expect(ctx.user).toContain('记忆');
  });
});
