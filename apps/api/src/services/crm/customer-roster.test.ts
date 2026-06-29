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
      takeoverMode: 'whitelist',
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
      takeoverMode: 'whitelist',
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

  it('修 D：没配接管（缺省 takeoverMode）+ 空黑名单 → 默认全接管 managed=true，绝不静默全黑', async () => {
    // 运营从没配过接管（wechat_cs_account_config 没那行 / 解析不到 takeover_mode）→ takeoverMode 缺省。
    // 旧错误默认 = whitelist 语义 → whitelist 空 → 全 managed=false（前台全显"黑名单/未接管"，于姐撞的就是这个）。
    // 新默认 = blacklist 主模型（全接管），空黑名单 → 全 managed=true。
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [{ contact: '张三' }, { contact: '李四' }],
      // 不传 takeoverMode、不传 whitelist/blacklist：未配接管的真实场景
    });
    expect(roster.find((r) => r.contact === '张三')?.managed).toBe(true);
    expect(roster.find((r) => r.contact === '李四')?.managed).toBe(true);
  });

  it('修 D：缺省 takeoverMode + 有 blacklist → 仅黑名单内排除（其余仍全接管）', async () => {
    const roster = await buildCustomerRoster({
      tenantId: 't-A',
      csWechatId: 'wx_cs_A',
      messages: [{ contact: '客户甲' }, { contact: '客户乙' }],
      blacklist: ['客户乙'], // 缺省也按 blacklist 主模型判定
    });
    expect(roster.find((r) => r.contact === '客户甲')?.managed).toBe(true);
    expect(roster.find((r) => r.contact === '客户乙')?.managed).toBe(false);
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
