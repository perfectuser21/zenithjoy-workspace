/**
 * TDD Red — Line02 公司信息 Tab 布局 + 推荐关键词
 *
 * 本文件故意在 Generator 实现前失败：
 * - buildRecommendedKeywords 函数尚未创建（import 失败）
 * - CompanyProfilePage Tab 布局尚未实现（role=tab 元素不存在）
 */
import { describe, it, expect } from 'vitest';

// ─── 测试 1: buildRecommendedKeywords 纯函数（导入不存在 → Red）───
// Generator 需在 apps/dashboard/src/utils/keywords.ts（或同模块）导出此函数
let buildRecommendedKeywords: (profile: {
  company_name: string;
  city: string;
  industry: string;
  products: string[];
  key_advantages: string[];
}) => string[];

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../../apps/dashboard/src/utils/keywords');
  buildRecommendedKeywords = mod.buildRecommendedKeywords;
} catch {
  buildRecommendedKeywords = () => {
    throw new Error('buildRecommendedKeywords not implemented');
  };
}

describe('buildRecommendedKeywords [BEHAVIOR]', () => {
  it('组合 city+industry、products、city+product 生成推荐词，去重后最多 5 个', () => {
    const result = buildRecommendedKeywords({
      company_name: '西安烤鱼馆',
      city: '西安',
      industry: '餐饮',
      products: ['秘制烤鱼'],
      key_advantages: ['20年老配方'],
    });
    // 期望至少包含 "西安餐饮" 或 "餐饮" 或 "秘制烤鱼" 相关词
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(5);
    // 去重：无重复
    expect(new Set(result).size).toBe(result.length);
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

  it('products 重复时，结果去重', () => {
    const result = buildRecommendedKeywords({
      company_name: '测试',
      city: '上海',
      industry: '餐饮',
      products: ['烤鱼', '烤鱼'],
      key_advantages: [],
    });
    expect(new Set(result).size).toBe(result.length);
  });

  it('超过 5 个候选词时只返回前 5', () => {
    const result = buildRecommendedKeywords({
      company_name: '豪华餐饮',
      city: '北京',
      industry: '餐饮',
      products: ['菜A', '菜B', '菜C', '菜D', '菜E', '菜F'],
      key_advantages: ['特色一', '特色二'],
    });
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ─── 测试 2: CompanyProfilePage 渲染 Tab 布局（当前平铺 section，无 role=tab → Red）───
describe('CompanyProfilePage Tab 布局 [BEHAVIOR]', () => {
  it('CompanyProfilePage.tsx 源码含 3 个 Tab 标识', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx', 'utf8');
    const tabs = ['基础信息', '产品与价值', '目标客群'];
    const missing = tabs.filter((t) => !src.includes(t));
    if (missing.length > 0) {
      throw new Error(`CompanyProfilePage 缺少 Tab 文字: ${missing.join(', ')}`);
    }
  });

  it('CompanyProfilePage.tsx 含 onBlur 自动保存调用', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx', 'utf8');
    // 期望有 onBlur 属性或 handleBlur 函数
    expect(src.includes('onBlur') || src.includes('handleBlur')).toBe(true);
  });

  it('Playwright spec 已去除 company-profile API stub', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'apps/dashboard/e2e/line02-company-profile-collect.spec.ts',
      'utf8',
    );
    // EP-3 错误路径测试中的条件性 PUT 拦截（含 method() 检查）允许保留
    // 禁止的是无条件全局 stub（无 method() 检查），通常在 beforeEach 中
    const parts = src.split("page.route('**/api/company-profile'");
    for (let i = 1; i < parts.length; i++) {
      const after = parts[i].slice(0, 400);
      if (!after.includes('route.request().method()')) {
        throw new Error('Playwright spec 仍含无条件 company-profile stub（缺 method() 检查），需删除旧全局 mock');
      }
    }
  });
});
