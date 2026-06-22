/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { callOpenRouter } from '../../llm/openrouter';
import { getAutoAgentConfig } from '../wechat/cs-config-store';

/**
 * C1 接线集成测试 — 证明「决策层真正接进生产路径」（PR #817 致命 bug 修复）。
 *
 * 旧 bug：generateChatDraft(mode:'auto') 无条件跳过白名单 + 完全无视 auto_agent_enabled /
 * 营业时间 / daily_limit → 陌生人也被自动回，与契约真值表完全相反。
 *
 * 本测试断言运行时真行为（不是 auto_reply.py 纸面纯函数）：
 *   W1 auto_agent_enabled=false → 监控态：仍写草稿(pending_review)，但【不返回 reply】（listen 不发）
 *   W2 名单外（enabled=true）→ 【不调 LLM、不返回 reply】，返回 not_in_whitelist（上层记 pending_human）
 *   W3 名单内 + ON + 营业时间内 + 未超额 → 返回 reply（真发）
 *   W4 营业时间外（名单内+ON）→ 不返回 reply（skip_offhours）
 *   W5 超 daily_limit（名单内+ON+营业时间内）→ 不返回 reply（pending_human）
 *
 * mock 与既有 wechat-draft-auto-reply.test.ts 对齐：pool / openrouter / axios / cs-config-store。
 */

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

// auto_agent 配置走 cs-config-store.getAutoAgentConfig —— mock 它直接喂真值表入参
vi.mock('../wechat/cs-config-store', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getAutoAgentConfig: vi.fn(),
  };
});

const mockedPost = vi.mocked(axios.post);
const mockedConfig = vi.mocked(getAutoAgentConfig);

/** customers 数组决定名单内/外（空 = 名单外）。 */
function setupFeishuMock(customers: any[]) {
  mockedPost.mockReset();
  mockedPost.mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes('/auth/v3/tenant_access_token/internal')) {
      return Promise.resolve({
        data: { code: 0, tenant_access_token: 'mock_token', expire: 7200 },
      }) as any;
    }
    if (u.includes('/records/search')) {
      const searchCalls = mockedPost.mock.calls.filter((c) =>
        String(c[0]).includes('/records/search'),
      ).length;
      if (searchCalls <= 1) {
        return Promise.resolve({ data: { code: 0, data: { items: customers } } }) as any;
      }
      return Promise.resolve({ data: { code: 0, data: { items: [] } } }) as any;
    }
    if (u.includes('/records')) {
      return Promise.resolve({
        data: { code: 0, data: { record: { record_id: 'rec_mock_123' } } },
      }) as any;
    }
    return Promise.resolve({ data: { code: 0 } }) as any;
  });
}

const CFG_BASE = {
  auto_agent_enabled: true,
  business_hours_start: '00:00',
  business_hours_end: '24:00',
  key_contact_wechat: '',
  daily_limit: 0,
};

describe('generateChatDraft mode:auto 决策层接线 [C1 BEHAVIOR]', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../wechat-draft');
    mod._resetFeishuTokenCache?.();
    process.env.FEISHU_APP_ID = 'mock_app_id';
    process.env.FEISHU_APP_SECRET = 'mock_app_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
  });

  it('W1: auto_agent_enabled=false → 监控态：不返回 reply（草稿仍写 pending_review）', async () => {
    setupFeishuMock([{ record_id: 'c1', fields: { 客户名: '于瑾' } }]);
    mockedConfig.mockResolvedValue({ ...CFG_BASE, auto_agent_enabled: false } as any);
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('pending_review');
    expect(result.reply).toBeUndefined(); // 监控态绝不返回 reply
  });

  it('W2: 名单外 + ON → 不调 LLM、不返回 reply、not_in_whitelist', async () => {
    setupFeishuMock([]); // 空名单 = 名单外
    mockedConfig.mockResolvedValue(CFG_BASE as any);
    const llm = vi.mocked(callOpenRouter).mockResolvedValue({ content: 'X' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '陌生人',
      wechat_id: 'wxid_unknown',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_in_whitelist');
    expect(result.reply).toBeUndefined();
    expect(llm).not.toHaveBeenCalled(); // 名单外绝不烧 LLM
  });

  it('W3: 名单内 + ON + 营业时间内 + 未超额 → 返回 reply（真发）', async () => {
    setupFeishuMock([{ record_id: 'c1', fields: { 客户名: '于瑾' } }]);
    mockedConfig.mockResolvedValue(CFG_BASE as any);
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.reply).toBe('好的，已收到');
  });

  it('W4: 营业时间外（名单内+ON）→ 不返回 reply（skip_offhours）', async () => {
    setupFeishuMock([{ record_id: 'c1', fields: { 客户名: '于瑾' } }]);
    // 营业时间 09:00–10:00，注入「现在」固定在 23:30 → 时间窗外
    mockedConfig.mockResolvedValue({
      ...CFG_BASE,
      business_hours_start: '09:00',
      business_hours_end: '10:00',
    } as any);
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
      now_minutes: 23 * 60 + 30, // 测试注入「现在=23:30」，避开真实时钟漂移
    } as any);

    expect(result.ok).toBe(true);
    expect(result.reply).toBeUndefined();
  });

  it('W5: 超 daily_limit（名单内+ON+营业时间内）→ 不返回 reply（pending_human）', async () => {
    setupFeishuMock([{ record_id: 'c1', fields: { 客户名: '于瑾' } }]);
    mockedConfig.mockResolvedValue({ ...CFG_BASE, daily_limit: 2 } as any);
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
      daily_count: 2, // 已达上限
    } as any);

    expect(result.ok).toBe(true);
    expect(result.reply).toBeUndefined();
  });
});
