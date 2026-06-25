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

describe('buildCustomerRoster — 黑名单主模型（默认全接管 + 黑名单排除）[BEHAVIOR]', () => {
  it('blacklist 模式：扫进来的人默认 managed=true，黑名单内 managed=false', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      messages: [{ contact: '客户甲' }, { contact: '客户乙' }],
      blacklist: ['客户乙'],
    });
    expect(roster.find((r) => r.contact === '客户甲')?.managed).toBe(true); // 不在黑名单 → 接管中
    expect(roster.find((r) => r.contact === '客户乙')?.managed).toBe(false); // 黑名单 → 排除
  });

  it('blacklist 模式 + 空黑名单 → 默认全接管（新接入客服机主模型）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      messages: [{ contact: '新扫进来的人' }],
    });
    // blacklist 模式 + 空黑名单 → 默认全接管
    expect(roster.find((r) => r.contact === '新扫进来的人')?.managed).toBe(true);
  });

  it('不传 takeoverMode 时回退 whitelist 语义（向后兼容存量调用）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [{ contact: '张三' }, { contact: '李四' }],
      whitelist: ['张三'],
    });
    // 缺省 = whitelist 语义：仅 whitelist 内 managed=true
    expect(roster.find((r) => r.contact === '张三')?.managed).toBe(true);
    expect(roster.find((r) => r.contact === '李四')?.managed).toBe(false);
  });

  it('whitelist 模式：回退旧逻辑 managed = wlSet.has(contact)（小众兼容）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'whitelist',
      messages: [{ contact: '张三' }, { contact: '李四' }],
      whitelist: ['张三'],
      blacklist: ['张三'], // whitelist 模式下 blacklist 被忽略
    });
    expect(roster.find((r) => r.contact === '张三')?.managed).toBe(true);
    expect(roster.find((r) => r.contact === '李四')?.managed).toBe(false);
  });

  it('第四源 scan 行并进名册（与 message/manual 同 key 合并，带 last_message/last_seen）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      messages: [],
      manualCustomers: [],
      scanContacts: [
        { contact: '扫到的好友', last_message: '在吗', last_seen_at: '2026-06-25T08:00:00.000Z' },
      ],
    });
    const row = roster.find((r) => r.contact === '扫到的好友');
    expect(row).toBeDefined();
    expect(row?.managed).toBe(true); // 默认全接管
    expect(row?.last_message).toBe('在吗');
    expect(row?.last_contact_at).toBe('2026-06-25T08:00:00.000Z'); // scan last_seen 落到 last_contact_at
  });

  it('scan 行与 message/manual 行同 contact 合并（不重复成两行）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      messages: [{ contact: '老客户', last_contact_at: '2026-06-20T08:00:00.000Z' }],
      manualCustomers: [{ contact: '老客户', name: '老客户老板', status: 'A3' }],
      scanContacts: [{ contact: '老客户', last_message: '最近的扫描预览' }],
    });
    const rows = roster.filter((r) => r.contact === '老客户');
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('老客户老板'); // manual 覆盖
    expect(rows[0].status).toBe('A3');
    expect(rows[0].last_message).toBe('最近的扫描预览'); // scan 补 last_message
  });

  it('输出行含 source / last_message 字段，不泄 tenant_id', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      scanContacts: [{ contact: '甲', last_message: 'hi' }],
    });
    const row = roster.find((r) => r.contact === '甲');
    expect(row?.source).toBe('scan');
    expect(Object.prototype.hasOwnProperty.call(row, 'last_message')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, 'tenant_id')).toBe(false);
  });
});

describe('buildCustomerRoster — 身份三态 + 加微信时间（地基 Track C）[BEHAVIOR]', () => {
  it('身份派生：内部人员 → internal，黑名单内 → blacklist，其余接管中 → customer', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      messages: [{ contact: '客户甲' }, { contact: '客户乙' }, { contact: '徐啸' }],
      blacklist: ['客户乙'],
      internalStaff: ['徐啸', '于瑾', '苏彦卿'],
    });
    expect(roster.find((r) => r.contact === '客户甲')?.identity).toBe('customer');
    expect(roster.find((r) => r.contact === '客户乙')?.identity).toBe('blacklist');
    expect(roster.find((r) => r.contact === '徐啸')?.identity).toBe('internal');
  });

  it('内部人员排除出客户接管：identity=internal 时 managed 强制 false（即便不在黑名单）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist', // 默认全接管，但内部人员不接管
      messages: [{ contact: '于瑾' }],
      internalStaff: ['徐啸', '于瑾', '苏彦卿'],
    });
    const row = roster.find((r) => r.contact === '于瑾');
    expect(row?.identity).toBe('internal');
    expect(row?.managed).toBe(false);
  });

  it('add_friend_time 从 scan/manual 行透传到输出（无则 null）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      scanContacts: [{ contact: '新好友', add_friend_time: '2026-06-25T03:00:00.000Z' }],
      manualCustomers: [{ contact: '手动客户' }],
    });
    expect(roster.find((r) => r.contact === '新好友')?.add_friend_time).toBe('2026-06-25T03:00:00.000Z');
    expect(roster.find((r) => r.contact === '手动客户')?.add_friend_time).toBeNull();
  });

  it('不传 internalStaff 时身份只有 customer/blacklist（向后兼容）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      takeoverMode: 'blacklist',
      messages: [{ contact: '甲' }, { contact: '乙' }],
      blacklist: ['乙'],
    });
    expect(roster.find((r) => r.contact === '甲')?.identity).toBe('customer');
    expect(roster.find((r) => r.contact === '乙')?.identity).toBe('blacklist');
    expect(roster.every((r) => r.identity !== 'internal')).toBe(true);
  });
});
