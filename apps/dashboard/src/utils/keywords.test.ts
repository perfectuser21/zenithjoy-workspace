import { describe, it, expect } from 'vitest';
import { buildRecommendedKeywords } from './keywords';

describe('buildRecommendedKeywords', () => {
  it('city+industry 组合生成推荐词', () => {
    const result = buildRecommendedKeywords({
      company_name: '西安烤鱼馆',
      city: '西安',
      industry: '餐饮',
      products: ['秘制烤鱼'],
      key_advantages: ['20年老配方'],
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(new Set(result).size).toBe(result.length);
    expect(result).toContain('西安餐饮');
  });

  it('公司信息全空时返回空数组', () => {
    const result = buildRecommendedKeywords({
      company_name: '',
      city: '',
      industry: '',
      products: [],
      key_advantages: [],
    });
    expect(result).toEqual([]);
  });

  it('结果最多 5 个', () => {
    const result = buildRecommendedKeywords({
      company_name: '测试',
      city: '北京',
      industry: '科技',
      products: ['产品A', '产品B', '产品C'],
      key_advantages: ['优势1'],
    });
    expect(result.length).toBeLessThanOrEqual(5);
  });
});
