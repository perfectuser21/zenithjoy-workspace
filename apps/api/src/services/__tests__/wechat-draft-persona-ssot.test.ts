/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callOpenRouter } from '../../llm/openrouter';

/**
 * persona 单一 SSOT 行为测试（消除「话术知识库」全局 ↔「客服机」每客服两份重复）。
 *
 * 背景（用户原话「两个地方是抢的，有很多重复内容」）：
 *   persona 的「话术风格」（语气/称呼/句式/emoji/禁用词/few_shot）此前被每客服配置
 *   （wechat_cs_account_config.persona，由一键配置写死 address_style:'亲切' 等死值）
 *   盖掉了全局「话术知识库」（wechat_cs_config）里用户精心配的人设 → 两边对不上。
 *
 * 收敛后契约（本测试守护）：
 *   - persona 的 style 字段唯一真相来源 = 全局 getPersona()（话术知识库）。
 *   - 每客服配置只保留 self_name（人设名）作为 per-operator 覆盖位。
 *   - 因此送进 LLM 的 system prompt：style 用【全局】，self_name 用【该客服自己的】。
 *
 * mock 对齐 wechat-draft.ts 真实依赖（同 wechat-draft-auto-reply.test.ts 风格）。
 */

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: { code: 0 } }), get: vi.fn() },
}));

// 每客服配置：带白名单命中 + 自动开关 ON；persona 里塞 style 死值（模拟一键配置历史写法），
// 只有 self_name 是真正的 per-operator 值（小苏）。
vi.mock('../wechat/cs-account-config-store', () => ({
  getCSConfigByAgentId: vi.fn().mockResolvedValue({
    wechat_id: 'wxid_cs_a',
    persona: {
      self_name: '小苏',
      address_style: 'CS_称呼死值',
      tone: 'CS_语气死值',
      sentence_style: 'CS_句式死值',
      use_emoji: 'CS_emoji死值',
      banned_phrases: ['CS禁用词'],
      few_shot: [{ customer: 'cs问', me: 'cs答' }],
    },
    auto_agent_enabled: true,
    business_hours_start: '00:00',
    business_hours_end: '24:00',
    key_contact_wechat: '',
    whitelist: ['于瑾'],
    daily_limit: 0,
  }),
  resolveCsWechatIdByAgentId: vi.fn().mockResolvedValue('wxid_cs_a'),
}));

// 全局 persona（话术知识库 = SSOT）：style 全用「全局」可识别值，self_name 用「全局默认名」。
vi.mock('../wechat/cs-config-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getPersona: vi.fn().mockResolvedValue({
      self_name: '全局默认名',
      address_style: '全局_称呼',
      tone: '全局_语气SSOT',
      sentence_style: '全局_句式',
      use_emoji: '全局_emoji',
      banned_phrases: ['全局禁用词'],
      few_shot: [{ customer: '全局问', me: '全局答' }],
    }),
    getBusinessKB: vi.fn().mockResolvedValue({
      company: { name: 'X', what_we_do: '', value_prop: '', contact: '' },
      products: [],
      audience_segments: [],
      qa_docs: [],
    }),
  };
});

const mockedLlm = vi.mocked(callOpenRouter);

describe('generateChatDraft — persona 单一 SSOT [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLlm.mockResolvedValue({ content: '好的' } as any);
  });

  it('回复 system prompt 的 style 用【全局话术库】，self_name 用【该客服自己的】', async () => {
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
      agent_id: 'agent-x',
    } as any);

    expect(result.ok).toBe(true);
    expect(mockedLlm).toHaveBeenCalledTimes(1);
    const system = String((mockedLlm.mock.calls[0][0] as any).system);

    // style 字段：必须来自全局 SSOT（话术知识库）
    expect(system).toContain('全局_语气SSOT');
    expect(system).toContain('全局禁用词');
    // 绝不再使用每客服那份 style 死值（这正是「两边对不上」的根）
    expect(system).not.toContain('CS_语气死值');
    expect(system).not.toContain('CS禁用词');

    // self_name：保留 per-operator 覆盖（该客服自己的人设名），不被全局默认名盖掉
    expect(system).toContain('小苏');
    expect(system).not.toContain('全局默认名');
  });
});
