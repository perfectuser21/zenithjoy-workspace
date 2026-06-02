/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { callOpenRouter } from '../../llm/openrouter';

/**
 * `generateChatDraft({mode:'auto'})` 暴露 reply 字段集成测试（4 case，J1-J4）。
 *
 * J1 mode:auto 成功 → reply=<openrouter content>
 * J2 mode:review（默认）→ 不含 reply
 * J3 mode:auto AI 失败 → reply undefined（listener 跳过不发占位）
 * J4 名单外 → not_in_whitelist
 *
 * mock（与 wechat-draft.ts 真实依赖对齐）：
 *   - `import pool from '../db/connection'`（默认导入）→ mock 必须给 default
 *   - 飞书 token / search / create 全走 `axios.post` → mock 单个 axios.post，用 vi.mocked 取
 *   - 模块级 token 缓存用 _resetFeishuTokenCache() 每个 it 清干净
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

const FAIL_PLACEHOLDER = 'AI 生成失败（请人审决定是否重试）';
const mockedPost = vi.mocked(axios.post);

/** customers 数组决定名单内/外（空数组 = not_in_whitelist）。 */
function setupFeishuMock(customers: any[], interactionHistory: any[] = []) {
  mockedPost.mockReset();
  mockedPost.mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes('/auth/v3/tenant_access_token/internal')) {
      return Promise.resolve({
        data: { code: 0, tenant_access_token: 'mock_token', expire: 7200 },
      }) as any;
    }
    if (u.includes('/records/search')) {
      // 第 1 次 search = 客户档案，第 2 次 = 互动记录历史，其余空
      const searchCalls = mockedPost.mock.calls.filter((c) =>
        String(c[0]).includes('/records/search'),
      ).length;
      if (searchCalls <= 1) {
        return Promise.resolve({ data: { code: 0, data: { items: customers } } }) as any;
      }
      if (searchCalls === 2) {
        return Promise.resolve({
          data: { code: 0, data: { items: interactionHistory } },
        }) as any;
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

describe('generateChatDraft mode:auto [BEHAVIOR]', () => {
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

  it('J1: mode:auto 成功 → 返回 {ok:true, reply:<openrouter content>}', async () => {
    setupFeishuMock([{ record_id: 'cust1', fields: { 客户名: '于瑾' } }], []);
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
    expect(result.reply).not.toBe(FAIL_PLACEHOLDER);
  });

  it('J2: mode:review（默认）→ 返回值不含 reply 字段（undefined）', async () => {
    setupFeishuMock([{ record_id: 'cust1', fields: { 客户名: '于瑾' } }], []);
    vi.mocked(callOpenRouter).mockResolvedValue({ content: '好的，已收到' } as any);

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('pending_review');
    expect(result.reply).toBeUndefined();
  });

  it('J3: mode:auto AI 失败 → reply 为 undefined（listener 端检测后跳过，不发占位文案）', async () => {
    setupFeishuMock([{ record_id: 'cust1', fields: { 客户名: '于瑾' } }], []);
    vi.mocked(callOpenRouter).mockRejectedValue(new Error('OpenRouter timeout'));

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.reply).toBeUndefined();
  });

  it('J4: sender 不在飞书"客户档案"名单 → {ok:false, reason:"not_in_whitelist"}', async () => {
    setupFeishuMock([], []); // 空 customers 数组

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
  });
});
