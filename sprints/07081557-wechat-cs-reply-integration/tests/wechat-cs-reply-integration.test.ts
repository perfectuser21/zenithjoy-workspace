/**
 * wechat-cs-reply 判断内核接入 — Contract 测试骨架
 * sprint: 07081557-wechat-cs-reply-integration
 * task_id: e74341f4-3c8a-4cce-80c2-4c52afaedb85
 *
 * 本文件为合同测试骨架（skeleton）。
 * 实现时应将这些 it() 迁移或合并到：
 *   apps/api/tests/services/wechat-draft.test.ts
 *
 * 覆盖 [BEHAVIOR] B-1 ~ B-9（详见 contract-dod.md）。
 *
 * Mock 策略（与现有 wechat-draft.test.ts 对齐）：
 *   - pg pool: vi.hoisted mockQuery
 *   - callOpenRouter: vi.hoisted mockCallOpenRouter
 *   - axios: 保留 mock 断言飞书不被调用
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Hoisted Mocks ──────────────────────────────────────────────────────────

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../apps/api/src/db/connection', () => ({
  default: {
    query: mockQuery,
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

const { mockCallOpenRouter } = vi.hoisted(() => ({
  mockCallOpenRouter: vi.fn(),
}));

vi.mock('../../apps/api/src/llm/openrouter', () => ({
  callOpenRouter: mockCallOpenRouter,
}));

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

// ─── 导入被测模块 ─────────────────────────────────────────────────────────────
// NOTE: 路径在 monorepo 根下运行时为相对路径；CI 中请确认 vitest config 的 root。
import { generateChatDraft, _resetFeishuTokenCache } from '../../apps/api/src/services/wechat-draft';

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
    // 首次返回：纯文本，无 JSON
    // 第二次返回：仍无 JSON（最坏情况，触发正则兜底）
    mockCallOpenRouter
      .mockResolvedValueOnce({ content: '您好，我是客服，很高兴为您服务。' })
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
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    errSpy.mockClear();
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

// ─── [BEHAVIOR] B-7 群消息不回（Invariant I-6，回归）────────────────────────
// 注：B-7 复用原有 wechat-draft.test.ts 中的 "群消息 is_group=true → status:skipped" it()。
// 此处仅作占位说明，不重复定义；实现时确认原有 it() 继续通过即可。
//
// describe('[B-7] 群消息不回（Invariant I-6，回归）', () => {
//   it('复用原有 群消息 is_group=true → status:skipped', () => {
//     // 原有场景保持通过即满足 B-7
//   });
// });

// ─── [BEHAVIOR] B-6 escalate 旁路不阻塞（Invariant I-2）────────────────────

describe('[B-6] cs-reply 内核接入：escalate DB 写入失败 → console.warn + reply 正常返回', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuTokenCache();
    mockQuery.mockReset();
    process.env.NODE_ENV = 'test';
    mockCallOpenRouter.mockReset();
    warnSpy.mockClear();
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
