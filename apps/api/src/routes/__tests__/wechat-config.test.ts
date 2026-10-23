/**
 * wechat-config 路由单测（无 DB / 无网络）。
 * mock cs-config-store + openrouter，校验路由行为：zod 校验、调 store、suggest-audience 解析。
 * 集成往返见 tests/integration/p4-wechat-cs-config/wechat-config.integration.test.ts。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockGetPersona, mockSavePersona, mockGetBusinessKB, mockSaveBusinessKB, mockGetAutoAgent, mockSaveAutoAgent, mockBroadcast } = vi.hoisted(() => ({
  mockGetPersona: vi.fn(),
  mockSavePersona: vi.fn(),
  mockGetBusinessKB: vi.fn(),
  mockSaveBusinessKB: vi.fn(),
  mockGetAutoAgent: vi.fn(),
  mockSaveAutoAgent: vi.fn(),
  mockBroadcast: vi.fn(),
}));

vi.mock('../../services/wechat/cs-config-store', () => ({
  getPersona: mockGetPersona,
  savePersona: mockSavePersona,
  getBusinessKB: mockGetBusinessKB,
  saveBusinessKB: mockSaveBusinessKB,
  getAutoAgentConfig: mockGetAutoAgent,
  saveAutoAgentConfig: mockSaveAutoAgent,
}));

vi.mock('../../services/wechat/cs-outbound', () => ({ enqueueKeyContactBroadcast: mockBroadcast }));

const { mockCallOpenRouter } = vi.hoisted(() => ({ mockCallOpenRouter: vi.fn() }));
vi.mock('../../llm/openrouter', () => ({ callOpenRouter: mockCallOpenRouter }));

import { wechatConfigRouter } from '../wechat-config';

const app = express();
app.use(express.json());
app.use('/api/wechat', wechatConfigRouter);

const VALID_PERSONA = {
  self_name: '小齐',
  address_style: '叫名字',
  tone: '随和',
  sentence_style: '短句',
  use_emoji: '偶尔',
  banned_phrases: ['亲'],
  few_shot: [{ customer: '在吗', me: '在的' }],
};

const ENV_KEYS = ['ZENITHJOY_INTERNAL_TOKEN', 'ADMIN_FEISHU_OPENIDS'] as const;
let previousEnv: Record<string, string | undefined>;
beforeEach(() => {
  previousEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  vi.clearAllMocks();
  delete process.env.ZENITHJOY_INTERNAL_TOKEN; // 无 env → superAdminGuard dev 放行
  delete process.env.ADMIN_FEISHU_OPENIDS;
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe('wechat-config 路由（mock store）', () => {
  it('PUT /cs/auto-agent 保留原UUID-like标识的合法输入', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'local-contract-token';
    mockGetAutoAgent.mockResolvedValue({ auto_agent_enabled: false, key_contact_wechat: '' });
    mockSaveAutoAgent.mockResolvedValue(undefined);
    mockBroadcast.mockResolvedValue({ action: 'skip' });
    const agentId = '11111111-1111-1111-1111-111111111111';
    const res = await request(app).put('/api/wechat/cs/auto-agent')
      .set('Authorization', 'Bearer local-contract-token').send({ daily_limit: 3, agent_id: agentId });
    expect(res.status).toBe(200);
    expect(mockSaveAutoAgent).toHaveBeenCalledWith({ daily_limit: 3 });
    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ agentId }));
  });

  it('PUT /cs/auto-agent 继续拒绝畸形UUID和未知配置键且不写入', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'local-contract-token';
    for (const body of [{ agent_id: 'not-a-uuid' }, { agent_id: '11111111-1111-1111-1111-111111111111', unknown_key: true }]) {
      const res = await request(app).put('/api/wechat/cs/auto-agent')
        .set('Authorization', 'Bearer local-contract-token').send(body);
      expect(res.status).toBe(400);
    }
    expect(mockSaveAutoAgent).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('GET /persona → 返回 store 的人设', async () => {
    mockGetPersona.mockResolvedValue(VALID_PERSONA);
    const res = await request(app).get('/api/wechat/persona');
    expect(res.status).toBe(200);
    expect(res.body.self_name).toBe('小齐');
    expect(mockGetPersona).toHaveBeenCalledTimes(1);
  });

  it('回归：设了 ZENITHJOY_INTERNAL_TOKEN 且不带任何鉴权头，GET /persona 仍 200（不挂 superAdminGuard，dashboard better-auth 场景能加载）', async () => {
    // 旧版挂了 superAdminGuard：token 已设 + 请求无 X-Feishu-User-Id/无 token → 会 401，
    // 导致运营在中台"加载失败/存不进/AI帮填失败"。本断言确保不再被该 guard 拦。
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'set-but-not-sent-by-browser';
    mockGetPersona.mockResolvedValue(VALID_PERSONA);
    const res = await request(app).get('/api/wechat/persona');
    expect(res.status).toBe(200);
    expect(res.body.self_name).toBe('小齐');
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('PUT /persona 合法 → 调 savePersona', async () => {
    mockSavePersona.mockResolvedValue(undefined);
    const res = await request(app).put('/api/wechat/persona').send(VALID_PERSONA);
    expect(res.status).toBe(200);
    expect(mockSavePersona).toHaveBeenCalledTimes(1);
    expect(mockSavePersona.mock.calls[0][0].self_name).toBe('小齐');
  });

  it('PUT /persona 非法 body → 400，不调 savePersona', async () => {
    const res = await request(app).put('/api/wechat/persona').send({ self_name: 123 });
    expect(res.status).toBe(400);
    expect(mockSavePersona).not.toHaveBeenCalled();
  });

  it('POST /business-kb/suggest-audience 缺 industry → 400', async () => {
    const res = await request(app).post('/api/wechat/business-kb/suggest-audience').send({});
    expect(res.status).toBe(400);
    expect(mockCallOpenRouter).not.toHaveBeenCalled();
  });

  it('POST /business-kb/suggest-audience 合法 + 模型返回 A1-A5 JSON → 返回 segments', async () => {
    mockCallOpenRouter.mockResolvedValue({
      content: JSON.stringify({
        audience_segments: [
          { code: 'A1', label: '高意向', desc: '预算有限' },
          { code: 'A2', label: '观望', desc: '了解中' },
        ],
      }),
      model: 'deepseek/deepseek-chat',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const res = await request(app)
      .post('/api/wechat/business-kb/suggest-audience')
      .send({ industry: '餐饮' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.audience_segments)).toBe(true);
    expect(res.body.audience_segments[0].code).toBe('A1');
  });
});
