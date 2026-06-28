/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callOpenRouter } from '../../llm/openrouter';

/**
 * IA 重设计刀1：AI 回复读【每号完整 persona + 每号 business_kb】行为测试。
 *
 * 背景（反转 PR#940 的折中）：用户拍板「每个客服号要不同名字+语气+话术，知识库也每号独立」。
 * 之前 PR#940 把 style 收敛到全局话术库（getPersona）、每号只留 self_name；本刀反转：
 *   - 带 agent_id 解到该号配置(csConfig) → persona（完整 style + self_name）+ business_kb 全部读【这个号自己的】。
 *   - csConfig 缺失（无 agent_id / 未配）→ 回落全局 getPersona()/getBusinessKB()（向后兼容）。
 *   - csConfig 命中但个别字段空 → 该字段回落全局（不退化）。
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

// 每号配置 mock：可被各 it 覆写（默认每号完整人设 + 每号知识库）。
const csConfigMock = vi.fn();
vi.mock('../wechat/cs-account-config-store', () => ({
  getCSConfigByAgentId: (...a: unknown[]) => csConfigMock(...a),
  resolveCsWechatIdByAgentId: vi.fn().mockResolvedValue('wxid_cs_a'),
}));

// 全局话术库（仅作回落兜底）：style 全用「全局」可识别值。
vi.mock('../wechat/cs-config-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getPersona: vi.fn().mockResolvedValue({
      self_name: '全局默认名',
      address_style: '全局_称呼',
      tone: '全局_语气',
      sentence_style: '全局_句式',
      use_emoji: '全局_emoji',
      banned_phrases: ['全局禁用词'],
      few_shot: [{ customer: '全局问', me: '全局答' }],
    }),
    getBusinessKB: vi.fn().mockResolvedValue({
      company: { name: '全局公司', what_we_do: '', value_prop: '', contact: '' },
      products: [],
      audience_segments: [],
      qa_docs: [],
    }),
  };
});

const mockedLlm = vi.mocked(callOpenRouter);

const fullCsConfig = {
  wechat_id: 'wxid_cs_a',
  persona: {
    self_name: '小苏',
    address_style: 'CS_称呼',
    tone: 'CS_语气',
    sentence_style: 'CS_句式',
    use_emoji: 'CS_emoji',
    banned_phrases: ['CS禁用词'],
    few_shot: [{ customer: 'cs问', me: 'cs答' }],
  },
  business_kb: {
    company: { name: 'CS号知识库公司', what_we_do: 'CS做什么', value_prop: 'CS价值', contact: 'wx-cs' },
    products: [],
    audience_segments: [],
    qa_docs: [],
  },
  auto_agent_enabled: true,
  business_hours_start: '00:00',
  business_hours_end: '24:00',
  key_contact_wechat: '',
  whitelist: ['于瑾'],
  daily_limit: 0,
};

describe('generateChatDraft — 每号完整 persona + 每号 business_kb [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLlm.mockResolvedValue({ content: '好的' } as any);
  });

  it('csConfig 命中 → system prompt 的 style/self_name/知识库全部用【该号自己的】，不用全局', async () => {
    csConfigMock.mockResolvedValue(fullCsConfig);
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

    // 完整 persona 用每号自己的（style 不再来自全局）
    expect(system).toContain('小苏');
    expect(system).toContain('CS_语气');
    expect(system).toContain('CS禁用词');
    expect(system).not.toContain('全局_语气');
    expect(system).not.toContain('全局禁用词');
    expect(system).not.toContain('全局默认名');

    // 每号 business_kb 用每号自己的（公司信息进 system）
    expect(system).toContain('CS号知识库公司');
    expect(system).not.toContain('全局公司');
  });

  it('csConfig 缺失（未带 agent_id）→ 不读每号配置，走全局回落（向后兼容）', async () => {
    csConfigMock.mockResolvedValue(null);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'review',
    } as any);

    // 未带 agent_id → 根本不去解析每号配置（走全局回落路径）。
    expect(csConfigMock).not.toHaveBeenCalled();
    // review 模式 + 飞书名单外（mock axios 无 items）→ 既有契约拒绝；关键是未读每号、未抛错。
    expect(result.ok).toBe(false);
  });

  it('csConfig 命中但 business_kb 为空 → 知识库回落全局（不退化），人设仍用每号', async () => {
    csConfigMock.mockResolvedValue({
      ...fullCsConfig,
      business_kb: {
        company: { name: '', what_we_do: '', value_prop: '', contact: '' },
        products: [],
        audience_segments: [],
        qa_docs: [],
      },
    });
    const mod = await import('../wechat-draft');
    await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '你好',
      mode: 'auto',
      agent_id: 'agent-x',
    } as any);

    const system = String((mockedLlm.mock.calls[0][0] as any).system);
    expect(system).toContain('全局公司'); // 每号知识库空 → 用全局兜底
    expect(system).toContain('小苏'); // 人设仍用每号
  });
});
