/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callOpenRouter } from '../../llm/openrouter';

/**
 * generateChatDraft 去飞书 + 自动直发（第一刀）行为测试。
 *
 * J1 mode:auto + 个人未标黑 → status:'sent' 带 reply（自动直发）
 * J2 mode:review（监控态）→ status:'monitor' 不含 reply
 * J3 mode:auto AI 失败 → status:'ai_failed' reply undefined（绝不发占位）
 * J4 群消息 is_group=true → status:'skipped' skip_reason:'group'
 * J5 CRM 标黑 → status:'skipped' skip_reason:'blacklisted'
 *
 * mock：pool（可控 query）+ openrouter；去飞书后 chat 路径不再调 axios/飞书。
 */

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../db/connection', () => ({
  default: { query: mockQuery },
}));

vi.mock('../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

describe('generateChatDraft 去飞书自动直发 [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
  });

  it('J1: mode:auto + 个人未标黑 → {ok:true, status:sent, reply}', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.reply).toBe('好的，已收到');
  });

  it('J2: mode:review（监控态）→ status:monitor，不含 reply，不烧 LLM', async () => {
    const llm = vi.mocked(callOpenRouter).mockResolvedValue({ content: 'X' } as any);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'review',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('monitor');
    expect(result.reply).toBeUndefined();
    expect(llm).not.toHaveBeenCalled();
  });

  it('J3: mode:auto AI 失败 → status:ai_failed，reply undefined（不发占位）', async () => {
    vi.mocked(callOpenRouter).mockRejectedValue(new Error('toapi timeout'));
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('ai_failed');
    expect(result.reply).toBeUndefined();
  });

  it('J4: 群消息 is_group=true → status:skipped skip_reason:group，不烧 LLM', async () => {
    const llm = vi.mocked(callOpenRouter).mockResolvedValue({ content: 'X' } as any);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '某群',
      wechat_id: 'wxid_group',
      content: '群聊消息',
      mode: 'auto',
      is_group: true,
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('skipped');
    expect(result.skip_reason).toBe('group');
    expect(result.reply).toBeUndefined();
    expect(llm).not.toHaveBeenCalled();
  });

  it('J5: CRM 标黑 → status:skipped skip_reason:blacklisted，不烧 LLM', async () => {
    // isContactBlacklisted 的 crm_customers 查询（带 cs_wechat_id 精确过滤）命中 → 标黑
    // 修后：crm_customers 检查必须有 csWechatId，用 agent_id 解出 csWechatId='cs-test-bl'
    mockQuery.mockImplementation((sql: string) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('license_machines') && s.includes('service_agents')) {
        return Promise.resolve({ rows: [{ wechat_id: 'cs-test-bl' }], rowCount: 1 });
      }
      if (s.includes('wechat_cs_account_config')) {
        return Promise.resolve({ rows: [{ blacklist: [] }], rowCount: 1 });
      }
      if (s.includes('crm_customers') && s.includes('identity')) {
        return Promise.resolve({ rows: [{ x: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const llm = vi.mocked(callOpenRouter).mockResolvedValue({ content: 'X' } as any);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '黑名单的人',
      wechat_id: 'wxid_bl',
      content: '你好',
      mode: 'auto',
      tenant_id: 'tenant-a',
      agent_id: 'agent-env-bl-test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('skipped');
    expect(result.skip_reason).toBe('blacklisted');
    expect(result.reply).toBeUndefined();
    expect(llm).not.toHaveBeenCalled();
  });

  it('J6: identity=internal（内部人员）→ status:skipped，不回自己人（2026-07-01 打架修复）', async () => {
    // 真机：运营把同事标 internal，但回复网关只认 blacklist、不认 internal → 照回。
    // 修法：isContactBlacklisted 的 crm_customers 查询按 identity IN ('blacklist','internal')。
    // 修后：crm_customers 检查必须有 csWechatId，用 agent_id 解出后才能命中该行。
    mockQuery.mockImplementation((sql: string) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('license_machines') && s.includes('service_agents')) {
        return Promise.resolve({ rows: [{ wechat_id: 'cs-test-internal' }], rowCount: 1 });
      }
      if (s.includes('wechat_cs_account_config')) {
        return Promise.resolve({ rows: [{ blacklist: [] }], rowCount: 1 });
      }
      if (s.includes('crm_customers') && s.includes('internal')) {
        return Promise.resolve({ rows: [{ x: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const llm = vi.mocked(callOpenRouter).mockResolvedValue({ content: 'X' } as any);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '内部同事',
      wechat_id: 'wxid_internal',
      content: '在吗',
      mode: 'auto',
      tenant_id: 'tenant-a',
      agent_id: 'agent-env-internal-test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('skipped');
    expect(result.reply).toBeUndefined();
    expect(llm).not.toHaveBeenCalled();
  });

  it('J8: sent 路径把 out 行以 status:draft 落库，并把 INSERT 的 id 作为 message_id 返回（送达回执台账地基）', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue({ content: 'AI 草稿回复' } as any);

    // out 行 INSERT ... RETURNING id → 回 id=42；其余 query 走默认空。
    mockQuery.mockImplementation((sql: string, params?: any[]) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('INSERT INTO zenithjoy.wechat_messages') && params?.[2] === 'out') {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.status).toBe('sent');
    expect(result.message_id).toBe(42);

    // out 行 INSERT 的第 6 个参数（status）必须是 'draft'
    const outInsert = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('INSERT INTO zenithjoy.wechat_messages') &&
        Array.isArray(c[1]) &&
        c[1][2] === 'out',
    );
    expect(outInsert).toBeTruthy();
    expect(outInsert![1][5]).toBe('draft');
  });

  it('J7: 不同 CS 账号黑名单完全隔离 — cs-A 标黑的联系人，cs-B 账号调用必须放行（防跨账号污染）', async () => {
    // 复现 staging 测试问题：xian-pc 某账号把"默忆"标了 internal，
    // rog 账号调用 draft-generate 时也被误拦截，出现"一会儿黑名单一会儿 auto-send"。
    //
    // 修前（旧码）：crm_customers 查询 WHERE tenant_id + contact，无 cs_wechat_id 过滤
    //   → 找到 cs-A 的行 → 返回 true → status:'skipped'（错误！cs-B 没配黑名单）
    // 修后（新码）：crm_customers 查询带 AND cs_wechat_id=? 精确到 cs-B
    //   → cs-B 无该行 → 返回 false → status:'sent'（正确放行）
    const llm = vi.mocked(callOpenRouter).mockResolvedValue({ content: 'cs-B 回复' } as any);

    mockQuery.mockImplementation((sql: string) => {
      const s = typeof sql === 'string' ? sql : '';
      // resolveCsWechatIdByAgentId: license_machines JOIN service_agents → cs-wechat-b
      if (s.includes('license_machines') && s.includes('service_agents')) {
        return Promise.resolve({ rows: [{ wechat_id: 'cs-wechat-b' }], rowCount: 1 });
      }
      // wechat_cs_account_config: cs-B 的 per-cs 黑名单数组为空
      if (s.includes('wechat_cs_account_config')) {
        return Promise.resolve({ rows: [{ blacklist: [] }], rowCount: 1 });
      }
      // crm_customers 黑名单检查：
      //   旧码：WHERE tenant_id + contact，无 cs_wechat_id → 命中 cs-A 的 internal 行
      //   新码：WHERE tenant_id + cs_wechat_id + contact → cs-B 无此行，返回空
      if (s.includes('crm_customers') && s.includes('identity')) {
        const hasCsWechatIdFilter = s.includes('cs_wechat_id');
        return hasCsWechatIdFilter
          ? Promise.resolve({ rows: [], rowCount: 0 })       // 新码：cs-B 无黑名单 → 放行
          : Promise.resolve({ rows: [{ x: 1 }], rowCount: 1 }); // 旧码：误命中 cs-A 的数据
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '默忆',
      wechat_id: 'wxid_moyi',
      content: '你好',
      mode: 'auto',
      tenant_id: 'tenant-shared',
      agent_id: 'agent-env-rog', // cs-B（rog 账号），未把默忆列黑名单
    } as any);

    // 修前：status:'skipped'（cs-A 的黑名单污染了 cs-B）
    // 修后：status:'sent'（cs-B 独立判断，放行）
    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.reply).toBe('cs-B 回复');
    expect(llm).toHaveBeenCalled();
  });
});
