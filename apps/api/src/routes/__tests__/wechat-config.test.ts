/**
 * wechat-config 路由单测（无 DB / 无网络）。
 * mock cs-config-store + openrouter，校验路由行为：zod 校验、调 store、suggest-audience 解析。
 * 集成往返见 tests/integration/p4-wechat-cs-config/wechat-config.integration.test.ts。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGetPersona, mockSavePersona, mockGetBusinessKB, mockSaveBusinessKB } = vi.hoisted(() => ({
  mockGetPersona: vi.fn(),
  mockSavePersona: vi.fn(),
  mockGetBusinessKB: vi.fn(),
  mockSaveBusinessKB: vi.fn(),
}));

vi.mock('../../services/wechat/cs-config-store', () => ({
  getPersona: mockGetPersona,
  savePersona: mockSavePersona,
  getBusinessKB: mockGetBusinessKB,
  saveBusinessKB: mockSaveBusinessKB,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ZENITHJOY_INTERNAL_TOKEN; // 无 env → superAdminGuard dev 放行
  delete process.env.ADMIN_FEISHU_OPENIDS;
});

describe('wechat-config 路由（mock store）', () => {
  it('GET /persona → 返回 store 的人设', async () => {
    mockGetPersona.mockResolvedValue(VALID_PERSONA);
    const res = await request(app).get('/api/wechat/persona');
    expect(res.status).toBe(200);
    expect(res.body.self_name).toBe('小齐');
    expect(mockGetPersona).toHaveBeenCalledTimes(1);
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
