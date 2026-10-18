import { describe, expect, it } from 'vitest';
import { companyWorkspaceRows } from '../customer-workspace-source-rows';
const profile = { company_id: 'company-a', tenant_id: 'tenant-a', config_version: 3, wiki: { products: [{ id: 'product-a', name: '课程', fields: { 产品说明: '课程说明', 收费模式: '咨询报价' }, token: 'secret' }] }, runtime_config: { search_strategy: { keywords: [{ id: 'keyword-a', word: 'AI', enabled: false, fields: { 优先级: '5', 时间窗口天数: '7' } }] }, token: 'secret' } };
describe('公司资料初次投递白名单', () => {
  it('保留原记录ID、停用词和来源版本，排除秘密与原始内部对象', () => {
    const rows = companyWorkspaceRows(profile, profile);
    expect(rows).toHaveLength(2); expect(rows[1].source_id).toBe('keyword-a');
    expect(rows[1].values.启用).toBe(false); expect(rows[0].values.来源版本).toBe(3);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });
  it('异公司、异租户或无版本一律不投递', () => {
    for (const bad of [{ ...profile, company_id: 'other' }, { ...profile, tenant_id: 'other' }, { ...profile, config_version: undefined }]) expect(() => companyWorkspaceRows(bad, profile)).toThrow();
  });
  it('相同词的不同原记录保留；重复原记录ID不猜不去重', () => {
    const p = structuredClone(profile); p.runtime_config.search_strategy.keywords.push({ ...p.runtime_config.search_strategy.keywords[0], id: 'keyword-b' });
    expect(companyWorkspaceRows(p, p)).toHaveLength(3);
    p.runtime_config.search_strategy.keywords[1].id = 'keyword-a'; expect(() => companyWorkspaceRows(p, p)).toThrow('duplicate');
  });
});
