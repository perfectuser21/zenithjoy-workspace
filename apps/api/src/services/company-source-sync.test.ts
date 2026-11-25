import { expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../db/connection', () => ({ default: { query } }));
import { getSources, readCompanySource } from './company-source-sync';

it('缺任一资料表则不暴露为可用来源', async () => {
  query.mockResolvedValueOnce({ rows: [{ platform: 'feishu', parent_id: 'base', state: { resources: { products: { id: 'table-products' } } } }] });
  expect(await getSources({ company_id: 'company', tenant_id: 'tenant' })).toEqual([]);
});

it('已登记为另一家公司的页面不读取资料', async () => {
  query.mockResolvedValueOnce({ rowCount: 1 });
  await expect(readCompanySource({ company_id: 'company', tenant_id: 'tenant' }, {
    platform: 'notion', parent: 'workspace', ids: ['products', 'audiences', 'keywords'], reference: undefined,
  })).rejects.toMatchObject({ status: 409 });
});
