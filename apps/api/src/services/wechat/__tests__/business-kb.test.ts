/**
 * business-kb.ts 纯函数单测（无需 DB）。
 * 覆盖：loadBusinessKB 缺文件回退、retrieveRelevantKB 打分/topK/命中0、renderKBBlock。
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  loadBusinessKB,
  retrieveRelevantKB,
  renderKBBlock,
  EMPTY_KB,
} from '../business-kb';
import type { BusinessKB } from '../types';

const ENV_KEY = 'WECHAT_BUSINESS_KB_PATH';

const KB: BusinessKB = {
  company: {
    name: 'ZenithJoy 私域增长',
    what_we_do: '帮中小商家做私域获客和内容代运营',
    value_prop: '抖音获客 + 微信成交闭环',
    contact: '微信 zenithjoy-cs',
  },
  products: [
    {
      name: '私域陪跑基础版',
      selling_points: '1 个抖音号获客 + 微信自动接待 + 每周内容排期',
      price: '3980/月',
    },
    {
      name: '私域陪跑进阶版',
      selling_points: '多号矩阵 + 评论区挖客 + AI 客服全天接待 + 数据周报',
      price: '8800/月',
    },
  ],
  audience_segments: [
    { code: 'A1', label: '高意向价格敏感', desc: '反复比价' },
  ],
  qa_docs: [
    { q: '你们怎么收费', a: '按月付，基础版 3980/月，进阶版 8800/月' },
    { q: '有没有成功案例', a: '餐饮、美业、教培都有跑通的案例' },
    { q: '多久能看到效果', a: '一般第一个月跑通链路，第二个月稳定出量' },
  ],
};

describe('loadBusinessKB', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('文件缺失时回退到空壳（company 空字段 + 空数组）', () => {
    process.env[ENV_KEY] = '/tmp/__definitely_missing_kb__.json';
    const kb = loadBusinessKB();
    expect(kb.company.name).toBe('');
    expect(kb.company.what_we_do).toBe('');
    expect(kb.products).toEqual([]);
    expect(kb.qa_docs).toEqual([]);
    expect(kb.audience_segments).toEqual([]);
  });

  it('回退空壳不污染导出的 EMPTY_KB 常量', () => {
    process.env[ENV_KEY] = '/tmp/__definitely_missing_kb__.json';
    const kb = loadBusinessKB();
    expect(kb).not.toBe(EMPTY_KB);
    expect(kb).toEqual(EMPTY_KB);
  });

  it('损坏 JSON 回退空壳', () => {
    process.env[ENV_KEY] = __filename;
    const kb = loadBusinessKB();
    expect(kb.company.name).toBe('');
    expect(kb.products).toEqual([]);
  });

  it('默认路径能读到完整结构', () => {
    const kb = loadBusinessKB();
    expect(typeof kb.company.name).toBe('string');
    expect(Array.isArray(kb.products)).toBe(true);
    expect(Array.isArray(kb.qa_docs)).toBe(true);
  });
});

describe('retrieveRelevantKB', () => {
  it('命中相关 Q&A，分数 > 0', () => {
    const hits = retrieveRelevantKB('你们怎么收费啊', KB);
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top.score).toBeGreaterThan(0);
    // 收费问题最相关的应是收费 Q&A
    expect(top.text).toContain('收费');
    expect(top.text).toMatch(/^Q: .* \/ A: /);
  });

  it('命中产品，text 渲染为「产品 …：卖点 … 价格 …」', () => {
    const hits = retrieveRelevantKB('私域陪跑基础版多少钱', KB);
    const productHit = hits.find((h) => h.kind === 'product');
    expect(productHit).toBeTruthy();
    expect(productHit!.text).toContain('产品 私域陪跑基础版');
    expect(productHit!.text).toContain('卖点');
    expect(productHit!.text).toContain('价格 3980/月');
  });

  it('按分降序排列', () => {
    const hits = retrieveRelevantKB('私域陪跑基础版怎么收费', KB);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it('遵守 topK 上限', () => {
    const hits = retrieveRelevantKB('私域陪跑收费案例效果', KB, 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('完全不相关消息命中 0 返回空数组', () => {
    const hits = retrieveRelevantKB('今天天气真不错呀', KB);
    expect(hits).toEqual([]);
  });

  it('空消息 / 空 KB 返回空数组', () => {
    expect(retrieveRelevantKB('', KB)).toEqual([]);
    expect(retrieveRelevantKB('收费', EMPTY_KB)).toEqual([]);
  });
});

describe('renderKBBlock', () => {
  it('始终输出企业基本信息（含公司名 + 联系方式）', () => {
    const block = renderKBBlock(KB, []);
    expect(block).toContain('ZenithJoy 私域增长');
    expect(block).toContain('微信 zenithjoy-cs');
    expect(block).toContain('帮中小商家做私域获客和内容代运营');
  });

  it('附上命中的参考资料', () => {
    const hits = retrieveRelevantKB('你们怎么收费', KB);
    const block = renderKBBlock(KB, hits);
    expect(block).toContain('可参考资料');
    expect(block).toContain('收费');
  });

  it('包含「没有依据就说去确认，别编」的硬规则', () => {
    const block = renderKBBlock(KB, []);
    expect(block).toMatch(/确认/);
    expect(block).toMatch(/别编|不要编/);
  });

  it('空 KB 也能渲染不崩', () => {
    const block = renderKBBlock(EMPTY_KB, []);
    expect(typeof block).toBe('string');
    expect(block).toContain('企业基本信息');
  });
});
