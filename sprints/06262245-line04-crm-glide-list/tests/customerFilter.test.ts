/**
 * customerFilter [BEHAVIOR] — Line04 CRM 客户列表页纯前端过滤算法（逻辑断言·环境无关）。
 *
 * 这是 TDD Red 红证据：generator 须在 apps/dashboard/src/pages/crm/customerFilter.ts 落
 * `export function filterCustomers(rows, { search, intents, identities })` 纯函数，
 * 并把同款测试落到 apps/dashboard/src/pages/crm/__tests__/customerFilter.test.ts（DoD BEHAVIOR oracle）。
 *
 * 语义（合同 Golden Path Step 2/3）：
 *  - search：trim+lowercase 子串，匹配 name 或 wechat_id（大小写不敏感）；空串=不过滤
 *  - intents：A1-A5 集合，命中 row.status；空数组=不过滤
 *  - identities：customer/blacklist 集合，命中 row.identity（缺省 customer）；空数组=不过滤
 *  - 三者 AND 叠加；计数 = filterCustomers(...).length
 */
import { describe, it, expect } from 'vitest';
// 红证据：generator 实现前此模块不存在 → import 失败 → 全部 FAIL
import { filterCustomers } from '../../../apps/dashboard/src/pages/crm/customerFilter';

type Row = {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: 'A1' | 'A2' | 'A3' | 'A4' | 'A5';
  identity?: 'customer' | 'blacklist' | 'internal' | null;
};

const ROWS: Row[] = [
  { name: '张三', contact: '张三', wechat_id: 'WX_001', status: 'A1', identity: 'customer' },
  { name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A4', identity: 'blacklist' },
  { name: '王五Lee', contact: '王五Lee', wechat_id: null, status: 'A4', identity: 'customer' },
];

describe('filterCustomers [BEHAVIOR]', () => {
  it('搜索：name 或 wechat_id 子串、大小写不敏感；空串返回全部', () => {
    expect(filterCustomers(ROWS, { search: '张三' })).toHaveLength(1);
    // 大小写不敏感命中 wechat_id（数据存大写 WX_001，搜小写 wx_001 仍中）
    expect(filterCustomers(ROWS, { search: 'wx_001' })).toHaveLength(1);
    // 命中 name 子串（大小写不敏感）
    expect(filterCustomers(ROWS, { search: 'lee' })).toHaveLength(1);
    expect(filterCustomers(ROWS, { search: '   ' })).toHaveLength(3);
    expect(filterCustomers(ROWS, {})).toHaveLength(3);
    expect(filterCustomers(ROWS, { search: '查无此人' })).toHaveLength(0);
  });

  it('意向：A1-A5 集合命中 status；空集合返回全部', () => {
    expect(filterCustomers(ROWS, { intents: ['A4'] })).toHaveLength(2);
    expect(filterCustomers(ROWS, { intents: ['A1'] }).map((r) => r.name)).toEqual(['张三']);
    expect(filterCustomers(ROWS, { intents: [] })).toHaveLength(3);
    expect(filterCustomers(ROWS, { intents: ['A2'] })).toHaveLength(0);
  });

  it('身份：customer/blacklist 集合 + 与意向/搜索 AND 叠加', () => {
    expect(filterCustomers(ROWS, { identities: ['blacklist'] })).toHaveLength(1);
    expect(filterCustomers(ROWS, { identities: ['customer'] })).toHaveLength(2);
    expect(filterCustomers(ROWS, { identities: [] })).toHaveLength(3);
    // AND：意向 A4 ∩ 身份 customer → 仅 王五Lee
    expect(filterCustomers(ROWS, { intents: ['A4'], identities: ['customer'] }).map((r) => r.name)).toEqual(['王五Lee']);
    // AND：意向 A4 ∩ 身份 blacklist ∩ 搜索 李 → 仅 李四
    expect(filterCustomers(ROWS, { intents: ['A4'], identities: ['blacklist'], search: '李' }).map((r) => r.name)).toEqual(['李四']);
    // 三筛全空 = 全量（计数 = 真数据条数）
    expect(filterCustomers(ROWS, { search: '', intents: [], identities: [] })).toHaveLength(3);
  });
});
