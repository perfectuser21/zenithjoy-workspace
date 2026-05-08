/**
 * Path 4 Sprint 1 ws3 — wechat-draft.ts service 单元测试（RED）。
 *
 * 测试 generateChatDraft：
 *   1) 名单内客户消息 → 飞书互动记录 +1 + DB wechat_publish_task +1（status=pending_review, approval_source NULL）
 *   2) 名单外 sender → 返回 ok:false reason 'not_in_whitelist'，飞书表行数不变（mock 计数器）
 *   3) OPENROUTER_FORCE_5XX=1 + NODE_ENV=test → 飞书表写"AI 生成失败"占位，状态仍 pending_review
 *
 * Mock 策略：
 *   - pg pool: vi.hoisted mockQuery，stub SELECT 名单 / INSERT publish_task
 *   - axios: stub 飞书 token + search + records.create
 *   - llm/openrouter: stub callOpenRouter 默认成功；--force-5xx 测试单独 reject
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../src/db/connection', () => ({
  default: {
    query: mockQuery,
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

const { mockCallOpenRouter } = vi.hoisted(() => ({
  mockCallOpenRouter: vi.fn(),
}));

vi.mock('../../src/llm/openrouter', () => ({
  callOpenRouter: mockCallOpenRouter,
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from 'axios';
import { generateChatDraft, _resetFeishuTokenCache } from '../../src/services/wechat-draft';

const mockedAxios = vi.mocked(axios, true);

describe('ws3 generateChatDraft — 名单内客户消息生成草稿', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
    delete process.env.FEISHU_PROFILE_TABLE_ID;
    delete process.env.OPENROUTER_FORCE_5XX;
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockResolvedValue({
      content: '收到，您好。',
      model: 'deepseek/deepseek-chat',
      prompt_tokens: 10,
      completion_tokens: 6,
      cost: 0.000003,
    });
  });

  it('名单内客户 → 飞书互动记录 records.create + DB wechat_publish_task INSERT，status=pending_review approval_source NULL', async () => {
    // axios 调用顺序：
    //   1) 飞书 tenant_access_token
    //   2) 飞书"客户档案"表 search → 命中（has_more:false, items:[1 行]）
    //   3) 飞书"互动记录"表 search 历史（最近 N 条对话）→ items:[]
    //   4) 飞书"互动记录" records.create → 成功
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [{ record_id: 'rec_customer_a', fields: { 客户名: '客户A', 微信号: 'test_a' } }],
          },
        },
      })
      .mockResolvedValueOnce({ data: { code: 0, data: { items: [] } } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { record: { record_id: 'rec_interaction_1' } } },
      });

    // DB INSERT wechat_publish_task → 成功
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await generateChatDraft({
      sender: '客户A',
      wechat_id: 'test_a',
      content: '在吗',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('pending_review');
    expect(typeof result.task_id).toBe('string');
    expect(result.task_id).toMatch(/^[0-9a-f-]{36}$/i);

    // DB INSERT 调用时含 approval_source NULL（A 路线护栏起点）
    const dbCalls = mockQuery.mock.calls;
    const insertCall = dbCalls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO wechat_publish_task'),
    );
    expect(insertCall).toBeTruthy();
    const sql = insertCall![0] as string;
    const params = insertCall![1] as unknown[];
    expect(sql).toMatch(/INSERT INTO wechat_publish_task/);
    // 第 1-N 个参数应包含 type='chat'，approval_status='pending_review'
    expect(params).toEqual(expect.arrayContaining(['chat']));
    expect(params).toEqual(expect.arrayContaining(['pending_review']));
    // approval_source 必须 NULL（不允许 system 自批）
    expect(params).toEqual(expect.arrayContaining([null]));

    // 飞书 records.create 至少调用 1 次（互动记录表）
    const createCall = mockedAxios.post.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/records') && !c[0].includes('search'),
    );
    expect(createCall).toBeTruthy();
  });
});

describe('ws3 generateChatDraft — 名单外 sender 拒绝', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
    delete process.env.FEISHU_PROFILE_TABLE_ID;
    delete process.env.OPENROUTER_FORCE_5XX;
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('名单外 sender → 返回 {ok:false, reason:"not_in_whitelist"}，不写飞书互动表，不调 LLM', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      // 客户档案 search → 名单外 → items 空
      .mockResolvedValueOnce({ data: { code: 0, data: { items: [] } } });

    const result = await generateChatDraft({
      sender: '陌生人',
      wechat_id: 'unknown_x',
      content: '嗨',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_in_whitelist');

    // 不调 OpenRouter
    expect(mockCallOpenRouter).not.toHaveBeenCalled();

    // 不调 records.create（只有 token + search 两次）
    const createCalls = mockedAxios.post.mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/records$/.test(c[0]),
    );
    expect(createCalls.length).toBe(0);
  });
});

describe('ws3 generateChatDraft — OpenRouter 5xx fallback 占位', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_CUSTOMER_TABLE_ID = 'tbl_customer';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
    delete process.env.FEISHU_PROFILE_TABLE_ID;
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockRejectedValue(new Error('OpenRouter call failed: simulated 5xx'));
  });

  it('OPENROUTER_FORCE_5XX 抛错时 → 飞书 records.create payload 含 "AI 生成失败"，status 仍 pending_review', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [{ record_id: 'rec_customer_a', fields: { 客户名: '客户A', 微信号: 'test_a' } }],
          },
        },
      })
      .mockResolvedValueOnce({ data: { code: 0, data: { items: [] } } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { record: { record_id: 'rec_interaction_2' } } },
      });

    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await generateChatDraft({
      sender: '客户A',
      wechat_id: 'test_a',
      content: '测试故障',
    });

    // 失败也算"草稿生成"（人审决定要不要重试），状态仍 pending_review
    expect(result.ok).toBe(true);
    expect(result.status).toBe('pending_review');

    // 飞书 records.create 调用 payload 含"AI 生成失败"
    const createCall = mockedAxios.post.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/records$/.test(c[0]),
    );
    expect(createCall).toBeTruthy();
    const payload = JSON.stringify(createCall![1]);
    expect(payload).toMatch(/AI 生成失败/);

    // DB INSERT 时 content_draft 也含"AI 生成失败"
    const dbCalls = mockQuery.mock.calls;
    const insertCall = dbCalls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO wechat_publish_task'),
    );
    expect(insertCall).toBeTruthy();
    const params = insertCall![1] as unknown[];
    const hasFailMarker = params.some(
      (p) => typeof p === 'string' && p.includes('AI 生成失败'),
    );
    expect(hasFailMarker).toBe(true);
  });
});
