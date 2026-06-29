import { describe, it, expect } from 'vitest';
// TDD Red：buildCustomerRoster 尚未实现 → import 失败 → 全红。
// Generator 实现 apps/api/src/services/crm/customer-roster.ts 导出 buildCustomerRoster 后转绿。
// @ts-expect-error 目标模块本轮新建
import { buildCustomerRoster } from '../../../apps/api/src/services/crm/customer-roster';

describe('客户名册聚合 + 租户隔离 [BEHAVIOR]', () => {
  it('名册 = cs_memory_messages distinct contact ∪ crm_customers manual，含 last_contact_at / status / managed', async () => {
    const roster = await buildCustomerRoster({ tenantId: 't-A', csWechatId: 'wx_cs_A' });
    expect(Array.isArray(roster)).toBe(true);
    const row = roster[0];
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('contact');
    expect(row).toHaveProperty('status');
    expect(row).toHaveProperty('last_contact_at');
    expect(row).toHaveProperty('managed');
  });

  it('managed 由 whitelist 实时决定：whitelist 含 contact → managed=true（显式 whitelist 模式）', async () => {
    // 修 D：whitelist 语义现为显式小众模式（缺省已改 blacklist 主模型全接管），故显式传 takeoverMode。
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'whitelist',
      whitelist: ['张三'],
    });
    const zhang = roster.find((r: { contact: string }) => r.contact === '张三');
    expect(zhang?.managed).toBe(true);
  });

  it('租户隔离：只返回入参 tenantId 的客户，绝不混入其他租户', async () => {
    const roster = await buildCustomerRoster({ tenantId: 't-A', csWechatId: 'wx_cs_A' });
    expect(roster.every((r: { tenant_id?: string }) => r.tenant_id === undefined || r.tenant_id === 't-A')).toBe(true);
  });

  it('status 非法值被规范到 A1-A5 之内（默认 A1）', async () => {
    const roster = await buildCustomerRoster({ tenantId: 't-A', csWechatId: 'wx_cs_A' });
    const valid = new Set(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(roster.every((r: { status: string }) => valid.has(r.status))).toBe(true);
  });
});
