import { describe, it, expect } from 'vitest';
import { buildCustomerRoster, normalizeStatus } from './customer-roster';

describe('buildCustomerRoster — 名册合并 + 租户隔离 [BEHAVIOR]', () => {
  it('合并 messages ∪ manual ∪ whitelist，按 contact 去重', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [
        { contact: '张三', wechat_id: 'wx_001', last_contact_at: '2026-06-24T08:00:00.000Z' },
        { contact: '李四', last_contact_at: '2026-06-23T08:00:00.000Z' },
      ],
      manualCustomers: [{ contact: '周八', name: '周八', status: 'A2' }],
      whitelist: ['张三'],
    });
    const contacts = roster.map((r) => r.contact).sort();
    expect(contacts).toEqual(['周八', '张三', '李四']);
  });

  it('managed 实时由 whitelist 决定（命中 true / 未命中 false）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [{ contact: '张三' }, { contact: '李四' }],
      whitelist: ['张三'],
    });
    expect(roster.find((r) => r.contact === '张三')?.managed).toBe(true);
    expect(roster.find((r) => r.contact === '李四')?.managed).toBe(false);
  });

  it('whitelist 成员即便没聊过 / 没手动加也入册（managed=true）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [],
      manualCustomers: [],
      whitelist: ['新接管的人'],
    });
    const row = roster.find((r) => r.contact === '新接管的人');
    expect(row).toBeDefined();
    expect(row?.managed).toBe(true);
    expect(row?.last_contact_at).toBeNull();
  });

  it('manual 行覆盖 message 行的 name / status，message 提供 last_contact_at', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [{ contact: '张三', last_contact_at: '2026-06-24T08:00:00.000Z' }],
      manualCustomers: [{ contact: '张三', name: '张三老板', status: 'A3' }],
    });
    const row = roster.find((r) => r.contact === '张三');
    expect(row?.name).toBe('张三老板');
    expect(row?.status).toBe('A3');
    expect(row?.last_contact_at).toBe('2026-06-24T08:00:00.000Z');
  });

  it('status 非法值规范到 A1；输出行绝不含 tenant_id', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      manualCustomers: [{ contact: '王五', status: 'A9' }],
    });
    const row = roster.find((r) => r.contact === '王五');
    expect(row?.status).toBe('A1');
    expect(Object.prototype.hasOwnProperty.call(row, 'tenant_id')).toBe(false);
  });

  it('normalizeStatus：A1-A5 原样，其它落 A1', () => {
    expect(normalizeStatus('A3')).toBe('A3');
    expect(normalizeStatus('A9')).toBe('A1');
    expect(normalizeStatus(undefined)).toBe('A1');
    expect(normalizeStatus(123)).toBe('A1');
  });
});
