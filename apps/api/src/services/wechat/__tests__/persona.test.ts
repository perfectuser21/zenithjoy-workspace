/**
 * persona.ts 纯函数单测（无需 DB）。
 * 覆盖：loadPersona 缺文件回退、env 覆盖、renderPersonaBlock 反-AI 框架 + 禁用词 + few_shot。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { loadPersona, renderPersonaBlock, DEFAULT_PERSONA } from '../persona';
import type { Persona } from '../types';

const ENV_KEY = 'WECHAT_PERSONA_PATH';

describe('loadPersona', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('文件缺失时回退到 DEFAULT_PERSONA', () => {
    process.env[ENV_KEY] = '/tmp/__definitely_missing_persona__.json';
    const p = loadPersona();
    expect(p).toEqual(DEFAULT_PERSONA);
    expect(p.self_name).toBe(DEFAULT_PERSONA.self_name);
    expect(Array.isArray(p.banned_phrases)).toBe(true);
  });

  it('不带 env 时能从默认配置路径读到合法人设（含必填字段）', () => {
    const p = loadPersona();
    expect(typeof p.self_name).toBe('string');
    expect(p.self_name.length).toBeGreaterThan(0);
    expect(Array.isArray(p.banned_phrases)).toBe(true);
    expect(p.banned_phrases.length).toBeGreaterThan(0);
    expect(Array.isArray(p.few_shot)).toBe(true);
  });

  it('env 指向损坏 JSON 时回退 DEFAULT_PERSONA', () => {
    // 指向一个一定存在但非 JSON 的文件（本测试文件自身）
    process.env[ENV_KEY] = __filename;
    const p = loadPersona();
    expect(p).toEqual(DEFAULT_PERSONA);
  });
});

describe('renderPersonaBlock', () => {
  const persona: Persona = {
    self_name: '小齐',
    address_style: "叫名字或'你'",
    tone: '随和直接',
    sentence_style: '短句口语',
    use_emoji: '偶尔用',
    banned_phrases: ['亲', '为您服务', '感谢您的咨询'],
    few_shot: [
      { customer: '在吗', me: '在的~ 说' },
      { customer: '多少钱', me: '看哪档' },
    ],
  };

  it('包含反-AI 框架：自称本人、不是客服/助理、绝不写思考过程', () => {
    const block = renderPersonaBlock(persona);
    expect(block).toContain('小齐');
    expect(block).toContain('本人');
    expect(block).toContain('不是客服');
    expect(block).toContain('助理');
    expect(block).toContain('思考过程');
    expect(block).toMatch(/客服腔|官腔/);
  });

  it('逐个列出每个禁用词', () => {
    const block = renderPersonaBlock(persona);
    for (const w of persona.banned_phrases) {
      expect(block).toContain(w);
    }
  });

  it('渲染 few_shot 示例为「客户说X→我回Y」', () => {
    const block = renderPersonaBlock(persona);
    expect(block).toContain('在吗');
    expect(block).toContain('在的~ 说');
    expect(block).toMatch(/客户说.*在吗.*我回.*在的/s);
  });

  it('few_shot/banned 为空也不崩', () => {
    const empty: Persona = {
      ...persona,
      banned_phrases: [],
      few_shot: [],
    };
    const block = renderPersonaBlock(empty);
    expect(typeof block).toBe('string');
    expect(block).toContain('本人');
  });
});
