import { describe, expect, it, vi } from 'vitest';
import { importCompanySource, type SourceRows } from './company-source-import';
import { createWorkspaceAdapter } from './customer-workspace-adapters';

const rows = (): SourceRows => ({
  products: [{ id: 'notion-p', fields: { 名称: [{ plain_text: '服务' }], 产品标识: 'p', 介绍: '新版', 价格说明: '面议', 交付内容: '交付' } }],
  audiences: [{ id: 'feishu-a', fields: { 名称: [{ text: '客户' }], 画像标识: 'a', 需求: '效率', 客户特征: '团队', 排除条件: '' } }],
  keywords: [{ id: 'row-k', fields: { 名称: '新词', 启用: true, 优先级: 3, 时间范围: '', 排序方式: '' } }],
});

describe('公司资料同步', () => {
  it('统一两端字段，更新下游派生资料并保留设备和规则', () => {
    const profile = {
      wiki: { markdown: '公司手册', products: [{ id: 'p', fields: { 保留列: true } }] },
      runtime_config: { platform_accounts: ['existing'], video_judgment: { instructions: '资格规则' }, comment_scoring: { threshold: 0.8 } },
    };
    const next = importCompanySource(profile, rows());
    expect(next.products).toEqual(['服务']);
    expect(next.wiki.products[0]).toMatchObject({ id: 'p', fields: { 保留列: true, 产品说明: '新版' } });
    expect(next.runtime_config).toMatchObject({
      platform_accounts: ['existing'], product_ids: ['p'],
      video_judgment: { instructions: '资格规则', products: next.wiki.products, audiences: next.wiki.audiences },
      comment_scoring: { threshold: 0.8, audiences: next.wiki.audiences },
      search_strategy: { keywords: [{ word: '新词', enabled: true, fields: { 优先级: '3' } }] },
    });
    expect(profile.wiki.products[0].fields).toEqual({ 保留列: true });
  });

  it('同名关键词可按不同记录标识保留各自条件', () => {
    const input = rows();
    input.keywords.push({ id: 'row-k-other', fields: { ...input.keywords[0].fields, 时间范围: 14, 优先级: 5 } });
    const result = importCompanySource({}, input).runtime_config.search_strategy.keywords;
    expect(result).toMatchObject([
      { id: 'row-k', word: '新词', fields: { 时间窗口天数: '' } },
      { id: 'row-k-other', word: '新词', fields: { 时间窗口天数: '14', 优先级: '5' } },
    ]);
  });

  it('拒绝缺列和重复标识，避免误删现役资料', () => {
    const input = rows();
    input.products.push(input.products[0]);
    expect(() => importCompanySource({}, input)).toThrow('重复标识');
    const incomplete = rows();
    delete incomplete.audiences[0].fields.排除条件;
    expect(() => importCompanySource({}, incomplete)).toThrow('缺少列');
  });

  it('补齐飞书列出的空单元格，兼容未设置复选框', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      const isFields = String(url).includes('/fields?');
      const items = isFields ? [{ field_name: '名称' }, { field_name: '启用' }] : [{ record_id: 'row', fields: { 名称: '试验' } }];
      return Response.json({ code: 0, data: { items, has_more: false } });
    });
    expect(await createWorkspaceAdapter('feishu', 'fake', fetcher).readRows('app', 'tbl'))
      .toEqual([{ id: 'row', fields: { 名称: '试验', 启用: undefined } }]);
  });

  it('拒绝读取属于另一 Notion 工作台的表', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ parent: { page_id: 'other' } }));
    await expect(createWorkspaceAdapter('notion', 'fake', fetcher).readRows('expected', 'table')).rejects.toThrow('不属于');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
