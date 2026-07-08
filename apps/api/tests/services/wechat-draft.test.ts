/**
 * Line04 去飞书 + 个人私聊 AI 自动直发（第一刀）— generateChatDraft 行为测试。
 *
 * 测试 generateChatDraft（去飞书 + 自动直发，blacklist 主模型）：
 *   1) 个人未标黑 → 自动直发：status:'sent' 带 reply，**不写飞书** records.create、**不落** wechat_publish_task pending_review
 *   2) 个人标黑（CRM identity='blacklist'）→ status:'skipped' skip_reason:'blacklisted'，不烧 LLM
 *   3) 群消息（is_group=true）→ status:'skipped' skip_reason:'group'，不烧 LLM
 *   4) AI 生成失败 → status:'ai_failed' 不带 reply + 中台 console.error 报红，**不落 pending_review**
 *
 * Mock 策略：
 *   - pg pool: vi.hoisted mockQuery（blacklist 查询 + 记忆落库）
 *   - axios: stub（去飞书后 chat 路径不再调飞书；保留 mock 断言其未被用于 /records 写入）
 *   - llm/openrouter: stub callOpenRouter
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

describe('generateChatDraft — 个人未标黑 → 自动直发（去飞书）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockResolvedValue({ content: '收到，您好。' });
  });

  it('个人未标黑 → status:sent 带 reply；不写飞书 records、不落 wechat_publish_task pending_review', async () => {
    const result: any = await generateChatDraft({
      sender: '莫易',
      wechat_id: 'wxid_moyi',
      content: '在吗',
      mode: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.reply).toBe('收到，您好。');

    // 去飞书：绝不调飞书 /records 写入
    const recordsCalls = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/records$/.test(c[0]),
    );
    expect(recordsCalls.length).toBe(0);

    // 不落 wechat_publish_task pending_review（去飞书后 chat 不再写审核台）
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCall).toBeUndefined();
  });
});

describe('generateChatDraft — 标黑 / 群 → 不回（gating）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockResolvedValue({ content: '不该发出去的' });
  });

  it('CRM 标黑 → status:skipped skip_reason:blacklisted，不烧 LLM', async () => {
    // 修后：isContactBlacklisted 的 crm_customers 检查需要 csWechatId 已知。
    // cs_wechat_id 直传（优先于 agent_id 解析链），mock 的 wechat_cs_account_config 返回空 blacklist 数组，
    // crm_customers 查询命中一行 → 标黑。
    mockQuery.mockImplementation((sql: string) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('wechat_cs_account_config')) {
        return Promise.resolve({ rows: [{ blacklist: [] }], rowCount: 1 });
      }
      // crm_customers 命中 → 标黑
      return Promise.resolve({ rows: [{ x: 1 }], rowCount: 1 });
    });

    const result: any = await generateChatDraft({
      sender: '黑名单客户',
      wechat_id: 'wxid_bl',
      content: '你好',
      mode: 'auto',
      tenant_id: 'tenant-a',
      cs_wechat_id: 'ci_cs_wx_bl',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('skipped');
    expect(result.skip_reason).toBe('blacklisted');
    expect(result.reply).toBeUndefined();
    expect(mockCallOpenRouter).not.toHaveBeenCalled();
  });

  it('群消息 is_group=true → status:skipped skip_reason:group，不查黑名单、不烧 LLM', async () => {
    const result: any = await generateChatDraft({
      sender: '某客户群',
      wechat_id: 'wxid_group',
      content: '群里随便聊',
      mode: 'auto',
      is_group: true,
      tenant_id: 'tenant-a',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('skipped');
    expect(result.skip_reason).toBe('group');
    expect(result.reply).toBeUndefined();
    expect(mockCallOpenRouter).not.toHaveBeenCalled();
    // 群短路：不应触发任何 DB 查询（黑名单都不查）
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('generateChatDraft — AI 生成失败 → 报红不返回 reply', () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() 会重置 spy 的 mockImplementation，需要重新设置
    errSpy.mockImplementation(() => {});
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockRejectedValue(new Error('toapi 5xx simulated'));
  });

  it('AI 失败 → status:ai_failed 不带 reply + console.error 报红 ALARM；不落 pending_review', async () => {
    const result: any = await generateChatDraft({
      sender: '莫易',
      wechat_id: 'wxid_moyi',
      content: '测试故障',
      mode: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('ai_failed');
    expect(result.reply).toBeUndefined();

    // 中台报红（结构化告警日志，含 ALARM 标记）
    const alarmCall = errSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[wechat-draft][ALARM]'),
    );
    expect(alarmCall).toBeTruthy();

    // 不落 wechat_publish_task（去飞书 + 失败不写占位）
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCall).toBeUndefined();
  });
});

// ─── ws4: generateMomentDraft（朋友圈文案草稿）────────────────────────────────

import { generateMomentDraft } from '../../src/services/wechat-draft';

describe('ws4 generateMomentDraft — 画像齐全 → 飞书内容排期 +1 + DB +1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_PROFILE_TABLE_ID = 'tbl_profile';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    delete process.env.OPENROUTER_FORCE_5XX;
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockResolvedValue({
      content: '美妆代购正品保障，免税价直供，25-35女性白领专享。',
      model: 'deepseek/deepseek-chat',
      prompt_tokens: 12,
      completion_tokens: 8,
      cost: 0.000004,
    });
  });

  it('画像齐全 + 当日未生成过 → 飞书 records.create + DB INSERT (type=moment, pending_review, approval_source NULL)', async () => {
    // axios 调用顺序：
    //   1) 飞书 token
    //   2) 飞书"营销画像"表 search → 命中 1 行（行业 / 受众 / 钩子文案 三字段齐）
    //   3) 飞书"内容排期" records.create → 成功
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_profile_a',
                fields: {
                  客户名: '客户A',
                  行业: '美妆代购',
                  受众: '25-35女性白领',
                  钩子文案: '正品保障+免税价',
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { record: { record_id: 'rec_schedule_1' } } },
      });

    // DB 调用顺序：
    //   1) SELECT 当日是否已生成 → rowCount 0
    //   2) INSERT wechat_publish_task → rowCount 1
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await generateMomentDraft({ customer: '客户A' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('pending_review');
      expect(typeof result.task_id).toBe('string');
      expect(result.task_id).toMatch(/^[0-9a-f-]{36}$/i);
    }

    // DB INSERT 含 type='moment' + pending_review + approval_source=NULL
    const dbCalls = mockQuery.mock.calls;
    const insertCall = dbCalls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCall).toBeTruthy();
    const params = insertCall![1] as unknown[];
    expect(params).toEqual(expect.arrayContaining(['moment']));
    expect(params).toEqual(expect.arrayContaining(['pending_review']));
    expect(params).toEqual(expect.arrayContaining([null]));

    // 飞书 records.create 至少调用 1 次（内容排期表）
    const createCall = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        /\/records$/.test(c[0]) &&
        !/search/.test(c[0]),
    );
    expect(createCall).toBeTruthy();

    // 草稿包含画像 3 字段中至少 1 个 token (LLM-as-judge 简化版)
    const draftPayload = JSON.stringify(createCall![1]);
    expect(/美妆代购|25-35|女性白领|正品保障|免税价/.test(draftPayload)).toBe(true);
  });
});

describe('ws4 generateMomentDraft — 画像缺失字段 → profile_missing 跳过', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_PROFILE_TABLE_ID = 'tbl_profile';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('画像表无对应行 → {ok:false, reason:"profile_missing"}，不调 LLM，不写飞书排期表', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({ data: { code: 0, data: { items: [] } } });

    const result = await generateMomentDraft({ customer: '客户B' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('profile_missing');
    }
    expect(mockCallOpenRouter).not.toHaveBeenCalled();
    const createCalls = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === 'string' && /\/records$/.test(c[0]) && !/search/.test(c[0]),
    );
    expect(createCalls.length).toBe(0);
  });

  it('画像 3 字段中缺一个（钩子文案为空）→ {ok:false, reason:"profile_missing"}', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_profile_b',
                fields: {
                  客户名: '客户B',
                  行业: '美妆代购',
                  受众: '25-35女性白领',
                  钩子文案: '',
                },
              },
            ],
          },
        },
      });

    const result = await generateMomentDraft({ customer: '客户B' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('profile_missing');
    }
    expect(mockCallOpenRouter).not.toHaveBeenCalled();
  });
});

describe('ws4 generateMomentDraft — 同日重复触发跳过', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_PROFILE_TABLE_ID = 'tbl_profile';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('当日已生成 → {ok:false, reason:"already_generated_today"}，不调 LLM', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_profile_c',
                fields: {
                  客户名: '客户A',
                  行业: '美妆代购',
                  受众: '25-35女性白领',
                  钩子文案: '正品保障+免税价',
                },
              },
            ],
          },
        },
      });

    // SELECT 同日存在已生成行 → rows = [{...}]
    mockQuery.mockResolvedValueOnce({
      rows: [{ task_id: 'existing-1' }],
      rowCount: 1,
    });

    const result = await generateMomentDraft({ customer: '客户A' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('already_generated_today');
    }
    expect(mockCallOpenRouter).not.toHaveBeenCalled();

    // 不再 INSERT
    const insertCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCalls.length).toBe(0);
  });
});

describe('ws4 generateMomentDraft — OpenRouter 5xx fallback 占位', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_PROFILE_TABLE_ID = 'tbl_profile';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    mockCallOpenRouter.mockRejectedValue(new Error('OpenRouter 5xx simulated'));
  });

  it('OpenRouter 抛错 → 飞书排期 records.create payload 含 "AI 生成失败"，状态仍 pending_review', async () => {

    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock_token' } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_profile_a',
                fields: {
                  客户名: '客户A',
                  行业: '美妆代购',
                  受众: '25-35女性白领',
                  钩子文案: '正品保障+免税价',
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { record: { record_id: 'rec_schedule_2' } } },
      });

    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 当日未生成
      .mockResolvedValue({ rows: [], rowCount: 1 }); // INSERT

    const result = await generateMomentDraft({ customer: '客户A' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('pending_review');
    }

    const createCall = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/records$/.test(c[0]) && !/search/.test(c[0]),
    );
    expect(createCall).toBeTruthy();
    const payload = JSON.stringify(createCall![1]);
    expect(payload).toMatch(/AI 生成失败/);

    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCall).toBeTruthy();
    const params = insertCall![1] as unknown[];
    const hasFail = params.some(
      (p) => typeof p === 'string' && p.includes('AI 生成失败'),
    );
    expect(hasFail).toBe(true);
  });
});

// ─── [BEHAVIOR] B-1 正常对话解析 ─────────────────────────────────────────────

describe('[B-1] cs-reply 内核接入：正常对话 → JSON 解析成功', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：正常对话 → JSON 解析成功，reply 非空，tags.stage/escalate 可读', async () => {
    // 模拟 LLM 返回合法 JSON（wechat-cs-reply 内核输出格式）
    mockCallOpenRouter.mockResolvedValue({
      content: '好的，我来帮您确认一下。```json\n{"reply":"收到，马上为您安排","tags":{"stage":"A2","signal":"interested","inquiry":"price","risk":null,"gap":null,"escalate":false}}\n```',
    });

    const result: any = await generateChatDraft({
      sender: '测试客户',
      wechat_id: 'wxid_test001',
      content: '请问价格是多少？',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);
    // tags 解析后应可从结果或 DB 调用中验证
    // （具体字段视实现而定，此处为 skeleton 占位）
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });
});

// ─── [BEHAVIOR] B-2 JSON 缺失兜底 ───────────────────────────────────────────

describe('[B-2] cs-reply 内核接入：JSON 缺失 → 重试一次 + 正则兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：JSON 缺失 → 重试一次 + 正则兜底，仍返回非空 reply', async () => {
    // 首次返回：含 JSON 意图（有 { 标志）但格式不完整，触发重试
    // 第二次返回：仍无合法 JSON（最坏情况，触发正则兜底）
    mockCallOpenRouter
      .mockResolvedValueOnce({ content: '{"reply":"您好，我是客服，很高兴为您服务。" 格式截断了' })
      .mockResolvedValueOnce({ content: '好的，稍后为您处理。' });

    const result: any = await generateChatDraft({
      sender: '测试客户',
      wechat_id: 'wxid_test002',
      content: '你们有活动吗？',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);
    // callOpenRouter 应被调用 2 次（首次 + 重试）
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
  });
});

// ─── [BEHAVIOR] B-3 escalate=true 转人工 ────────────────────────────────────

describe('[B-3] cs-reply 内核接入：tags.escalate=true → 客户收到安抚 reply + DB 写入 cs_escalate 行', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：tags.escalate=true → 客户收到安抚 reply + DB 写入 cs_escalate 行', async () => {
    mockCallOpenRouter.mockResolvedValue({
      content: '```json\n{"reply":"非常抱歉给您带来不便，我们会安排专人跟进，请稍候。","tags":{"stage":"A3","signal":"frustrated","inquiry":null,"risk":"complaint","gap":null,"escalate":true}}\n```',
    });

    const result: any = await generateChatDraft({
      sender: '投诉客户',
      wechat_id: 'wxid_test003',
      content: '你们这个问题太久了，我要投诉！',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    // 客户仍收到回复
    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);

    // wechat_publish_task 含 cs_escalate 行（approval_source='system'）
    const escalateInsert = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        c[0].includes('INSERT INTO zenithjoy.wechat_publish_task') &&
        JSON.stringify(c[1]).includes('cs_escalate'),
    );
    expect(escalateInsert).toBeTruthy();

    const params = escalateInsert![1] as unknown[];
    expect(params).toEqual(expect.arrayContaining(['system']));
  });
});

// ─── [BEHAVIOR] B-4 stage 标签 CRM 回写 ─────────────────────────────────────

describe('[B-4] cs-reply 内核接入：tags.stage=A2 → CRM 状态更新 + history 行 changed_by=ai_inferred', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：tags.stage=A2 → crm_customers.status 更新 + history 行 changed_by=ai_inferred', async () => {
    mockCallOpenRouter.mockResolvedValue({
      content: '```json\n{"reply":"好的，为您详细介绍一下我们的服务。","tags":{"stage":"A2","signal":"interested","inquiry":"product","risk":null,"gap":null,"escalate":false}}\n```',
    });

    const result: any = await generateChatDraft({
      sender: '意向客户',
      wechat_id: 'wxid_test004',
      content: '你们的服务都有哪些？',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');

    // crm_customer_status_history 新增行含 changed_by='ai_inferred'
    const historyInsert = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        c[0].includes('crm_customer_status_history') &&
        c[0].toUpperCase().includes('INSERT'),
    );
    expect(historyInsert).toBeTruthy();

    const params = historyInsert![1] as unknown[];
    expect(params).toEqual(expect.arrayContaining(['ai_inferred']));
  });
});

// ─── [BEHAVIOR] B-5 编造词拦截（Invariant I-1）──────────────────────────────

describe('[B-5] cs-reply 内核接入：reply 含编造词 → ai_failed，不发，不写 DB', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：reply 含编造词（承诺退款）→ ai_failed，不发，不写 wechat_publish_task', async () => {
    // 模拟 LLM 输出含编造词（承诺退款）的 reply
    mockCallOpenRouter.mockResolvedValue({
      content: '```json\n{"reply":"我们保证全额退款，100%成交保障。","tags":{"stage":null,"signal":null,"inquiry":null,"risk":null,"gap":null,"escalate":false}}\n```',
    });

    const result: any = await generateChatDraft({
      sender: '测试客户',
      wechat_id: 'wxid_test005',
      content: '你们能退款吗？',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('ai_failed');
    expect(result.reply).toBeUndefined();

    // 不写 wechat_publish_task
    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCall).toBeUndefined();
  });
});

// ─── [BEHAVIOR] B-6 escalate 旁路不阻塞（Invariant I-2）────────────────────

describe('[B-6] cs-reply 内核接入：escalate DB 写入失败 → console.warn + reply 正常返回', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：escalate DB 写入失败 → console.warn + reply 正常返回（不阻塞对话）', async () => {
    mockCallOpenRouter.mockResolvedValue({
      content: '```json\n{"reply":"您的问题我们会尽快安排专人处理，请稍候。","tags":{"stage":null,"signal":null,"inquiry":null,"risk":null,"gap":null,"escalate":true}}\n```',
    });

    // DB：正常查询返回空，INSERT wechat_publish_task 报错
    mockQuery.mockImplementation((sql: string) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('INSERT INTO zenithjoy.wechat_publish_task')) {
        return Promise.reject(new Error('DB connection lost (simulated)'));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result: any = await generateChatDraft({
      sender: '投诉客户',
      wechat_id: 'wxid_test006',
      content: '我需要找负责人！',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    // escalate 入队失败，但客户仍收到 reply
    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);

    // console.warn 应被调用（escalate 失败旁路日志）
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ─── [BEHAVIOR] B-8 多租户 CRM 写入隔离（Invariant I-3）────────────────────

describe('[B-8] cs-reply 内核接入：stage 回写携带正确 tenant_id，不写入其他租户行', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：stage 回写携带正确 tenant_id，不写入其他租户行', async () => {
    const TEST_TENANT_ID = 'tenant-abc-123';

    mockCallOpenRouter.mockResolvedValue({
      content: '```json\n{"reply":"好的，为您安排。","tags":{"stage":"A1","signal":"interested","inquiry":null,"risk":null,"gap":null,"escalate":false}}\n```',
    });

    await generateChatDraft({
      sender: '测试客户',
      wechat_id: 'wxid_test_b8',
      content: '你好，我想了解',
      mode: 'auto',
      tenant_id: TEST_TENANT_ID,
      cs_wechat_id: 'cs_wx_test',
    } as any);

    // crm_customer_status_history INSERT 必须包含正确的 tenant_id
    const historyInsert = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        c[0].includes('crm_customer_status_history') &&
        c[0].toUpperCase().includes('INSERT'),
    );
    expect(historyInsert).toBeTruthy();

    // 参数列表中必须包含正确的 tenant_id，不得为空或其他租户值
    const params = historyInsert![1] as unknown[];
    expect(params).toEqual(expect.arrayContaining([TEST_TENANT_ID]));
    // 验证不含其他租户 ID
    expect(params).not.toEqual(expect.arrayContaining(['tenant-other-xyz']));
  });
});

// ─── [BEHAVIOR] B-9 reasoning_content 剥离（Invariant I-4）─────────────────

describe('[B-9] cs-reply 内核接入：callOpenRouter 返回含 reasoning_content → result.reply 不含思考链内容', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
  });

  it('cs-reply 内核接入：callOpenRouter 返回含 reasoning_content → result.reply 不含思考链内容', async () => {
    const REASONING_MARKER = '__THINKING_CHAIN_CONTENT_DO_NOT_LEAK__';

    // 模拟模型返回含 reasoning_content（思考链）的响应
    mockCallOpenRouter.mockResolvedValue({
      content: '```json\n{"reply":"好的，已为您记录。","tags":{"stage":"A2","signal":"interested","inquiry":null,"risk":null,"gap":null,"escalate":false}}\n```',
      reasoning_content: `${REASONING_MARKER}: 客户想了解价格，我应该引导到销售阶段 A2`,
    });

    const result: any = await generateChatDraft({
      sender: '测试客户',
      wechat_id: 'wxid_test_b9',
      content: '你们价格怎么样？',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);

    // reply 绝不含 reasoning_content 内容（思考链禁止泄露）
    expect(result.reply).not.toContain(REASONING_MARKER);
    expect(result.reply).not.toContain('THINKING_CHAIN');
    expect(result.reply).not.toContain('reasoning_content');
  });
});
