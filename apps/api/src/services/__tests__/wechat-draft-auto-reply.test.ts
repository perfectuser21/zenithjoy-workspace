/* eslint-disable @typescript-eslint/no-explicit-any -- 动态 import + 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TDD RED 阶段 — `generateChatDraft({mode:'auto'})` 暴露 reply 字段集成测试（4 case，J1-J4）。
 *
 * 【放置路径】Generator commit-1 必须把本文件原样写到
 *   apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts
 *
 * 【RED 证据】当前 wechat-draft.ts（PRD §背景实证）只返回
 *   {ok, status:'pending_review', task_id, draft_id} —— 无 mode 参数、无 reply 字段。
 *   - J1 期望 reply='好的，已收到' → 实际 undefined → FAIL
 *   - J2 期望 reply===undefined（OK） → 实际 undefined → PASS
 *   - J3 期望 AI 失败时 reply===undefined → 实际 undefined → PASS
 *   - J4 期望 not_in_whitelist → 复用现实现已支持 → PASS
 *   ⇒ commit-1 阶段 4 case 中至少 J1 RED；commit-2 实现后 4 case 全 GREEN。
 *
 * 【mock 规范】不调真实网络（CI 无飞书/OpenRouter 凭据）：
 *   - mock '../feishu-bitable-multitenant' 或对应 axios 调用
 *   - mock '../llm/openrouter' 的 callOpenRouter
 *   - mock '../db/connection' 的 pool.query INSERT
 */

vi.mock('../../db/connection', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

vi.mock('axios', () => {
  const post = vi.fn();
  return {
    default: { post, get: vi.fn() },
    post,
    get: vi.fn(),
  };
});

const FAIL_PLACEHOLDER = 'AI 生成失败（请人审决定是否重试）';

/** 设置飞书 mock — customers 数组决定名单内/外（空数组 = not_in_whitelist）。 */
function setupFeishuMock(customers: any[], interactionHistory: any[] = []) {
  const axiosMod = require('axios');
  const post = axiosMod.post || axiosMod.default.post;
  post.mockReset();
  post.mockImplementation((url: string, body: any) => {
    if (url.includes('/auth/v3/tenant_access_token/internal')) {
      return Promise.resolve({ data: { code: 0, tenant_access_token: 'mock_token', expire: 7200 } });
    }
    if (url.includes('/records/search')) {
      // 第一次 search 是 customers（客户档案）；body.filter 含 '客户名' 即客户档案 / 互动记录
      // 简化：连续调用顺序 — 第 1 次 customers，第 2 次 interaction，第 3 次 profile（可空）
      const callIdx = post.mock.calls.length - 1;
      if (callIdx === 1) return Promise.resolve({ data: { code: 0, data: { items: customers } } });
      if (callIdx === 2) return Promise.resolve({ data: { code: 0, data: { items: interactionHistory } } });
      return Promise.resolve({ data: { code: 0, data: { items: [] } } });
    }
    if (url.includes('/records') && !url.includes('search')) {
      return Promise.resolve({
        data: { code: 0, data: { record: { record_id: 'rec_mock_123' } } },
      });
    }
    return Promise.resolve({ data: { code: 0 } });
  });
}

describe('generateChatDraft mode:auto [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 确保飞书 table id 环境变量已配置（generateChatDraft 内部读 env）
    process.env.FEISHU_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_APP_ID = 'mock_app_id';
    process.env.FEISHU_APP_SECRET = 'mock_app_secret';
    process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
  });

  it('J1: mode:auto 成功 → 返回 {ok:true, reply:<openrouter content>}', async () => {
    setupFeishuMock([{ record_id: 'cust1', fields: { 客户名: '于瑾' } }], []);
    const { callOpenRouter } = await import('../../llm/openrouter');
    (callOpenRouter as any).mockResolvedValue({ content: '好的，已收到' });

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto' as any,
    } as any);

    expect(result.ok).toBe(true);
    expect(result.reply).toBe('好的，已收到');
    expect(result.reply).not.toBe(FAIL_PLACEHOLDER);
  });

  it('J2: mode:review（默认）→ 返回值不含 reply 字段（undefined）', async () => {
    setupFeishuMock([{ record_id: 'cust1', fields: { 客户名: '于瑾' } }], []);
    const { callOpenRouter } = await import('../../llm/openrouter');
    (callOpenRouter as any).mockResolvedValue({ content: '好的，已收到' });

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
    const { callOpenRouter } = await import('../../llm/openrouter');
    (callOpenRouter as any).mockRejectedValue(new Error('OpenRouter timeout'));

    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto' as any,
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
      mode: 'auto' as any,
    } as any);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_in_whitelist');
    expect(result.reply).toBeUndefined();
  });
});
