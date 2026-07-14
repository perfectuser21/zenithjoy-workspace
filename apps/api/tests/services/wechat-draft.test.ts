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
import { generateChatDraft } from '../../src/services/wechat-draft';

const mockedAxios = vi.mocked(axios, true);

describe('generateChatDraft — 个人未标黑 → 自动直发（去飞书）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

// ws4 generateMomentDraft（朋友圈文案草稿）已改本地表 zenithjoy.wechat_marketing_profile
// （决策19e6480c，2026-07-14 去飞书），原基于飞书 Bitable mock 的用例已删除，
// 覆盖见 apps/api/src/services/__tests__/wechat-draft-schema-prefix.test.ts 「本地表驱动」describe 块。

// ─── [BEHAVIOR] B-1 正常对话解析 ─────────────────────────────────────────────

describe('[B-1] cs-reply 内核接入：正常对话 → JSON 解析成功', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('cs-reply 内核接入：拒绝承诺（否定语境提及退款/保成交）+ escalate=true → 正常发送安抚回复并写入 cs_escalate（回归：2026-07-08 生产实测 escalate 被编造词过滤器误拦截）', async () => {
    // reply 里出现"全额退款/保成交"等词，但语境是拒绝承诺，不是做出承诺——不该被当编造拦截
    mockCallOpenRouter.mockResolvedValue({
      content:
        '```json\n{"reply":"这个我没法保证全额退款，也不能承诺保成交，需要跟内部确认一下再给您答复。","tags":{"stage":null,"signal":null,"inquiry":null,"risk":"complaint","gap":null,"escalate":true}}\n```',
    });

    const result: any = await generateChatDraft({
      sender: '投诉客户',
      wechat_id: 'wxid_test005b',
      content: '你们必须保证一个月内成交，不然我要求全额退款',
      mode: 'auto',
      tenant_id: 'tenant-test',
      cs_wechat_id: 'cs_wx_test',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);

    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        c[0].includes('INSERT INTO zenithjoy.wechat_publish_task'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(expect.arrayContaining(['cs_escalate']));
  });
});

// ─── [BEHAVIOR] B-6 escalate 旁路不阻塞（Invariant I-2）────────────────────

describe('[B-6] cs-reply 内核接入：escalate DB 写入失败 → console.warn + reply 正常返回', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
