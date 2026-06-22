/**
 * wechat-auto-agent.test.ts — 自动代理配置端点路由单测（无 DB / 无网络）（Line 04）
 *
 * 对应 Golden Path Step 1（管理员保存开关 + 关键人 + 营业时间）。
 * 端点挂在已有 wechatConfigRouter（/api/wechat），与 persona/business-kb 同鉴权约定。
 *
 * Response Schema（推导来源：api_registry 不可达 → 复用同 router 既有端点 wechat-config.ts 约定）：
 *   - GET  /api/wechat/auto-agent → 200 {auto_agent_enabled, business_hours_start, business_hours_end, key_contact_wechat}
 *   - PUT  /api/wechat/auto-agent → 校验通过 200 {success:true}；校验失败 400 {error:'INVALID_BODY', message, issues}
 *
 * 纯路由 + zod 校验，环境无关 → 逻辑断言，CI 绿 = 真 done。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockGetPersona,
  mockSavePersona,
  mockGetBusinessKB,
  mockSaveBusinessKB,
  mockGetAutoAgentConfig,
  mockSaveAutoAgentConfig,
} = vi.hoisted(() => ({
  mockGetPersona: vi.fn(),
  mockSavePersona: vi.fn(),
  mockGetBusinessKB: vi.fn(),
  mockSaveBusinessKB: vi.fn(),
  mockGetAutoAgentConfig: vi.fn(),
  mockSaveAutoAgentConfig: vi.fn(),
}));

vi.mock('../../services/wechat/cs-config-store', () => ({
  getPersona: mockGetPersona,
  savePersona: mockSavePersona,
  getBusinessKB: mockGetBusinessKB,
  saveBusinessKB: mockSaveBusinessKB,
  getAutoAgentConfig: mockGetAutoAgentConfig,
  saveAutoAgentConfig: mockSaveAutoAgentConfig,
}));

vi.mock('../../llm/openrouter', () => ({ callOpenRouter: vi.fn() }));

import { wechatConfigRouter } from '../wechat-config';

const app = express();
app.use(express.json());
app.use('/api/wechat', wechatConfigRouter);

const DEFAULT_CFG = {
  auto_agent_enabled: false,
  business_hours_start: '06:00',
  business_hours_end: '24:00',
  key_contact_wechat: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  delete process.env.ADMIN_FEISHU_OPENIDS;
});

describe('GET /api/wechat/auto-agent [BEHAVIOR]', () => {
  it('返回 store 配置，含 4 个字段', async () => {
    mockGetAutoAgentConfig.mockResolvedValue(DEFAULT_CFG);
    const res = await request(app).get('/api/wechat/auto-agent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_CFG);
    expect(res.body).toHaveProperty('auto_agent_enabled');
    expect(res.body).toHaveProperty('business_hours_start');
    expect(res.body).toHaveProperty('business_hours_end');
    expect(res.body).toHaveProperty('key_contact_wechat');
  });
});

describe('PUT /api/wechat/auto-agent [BEHAVIOR]', () => {
  it('合法 body → 200 {success:true} 且调用 saveAutoAgentConfig', async () => {
    mockSaveAutoAgentConfig.mockResolvedValue(undefined);
    const body = {
      auto_agent_enabled: true,
      business_hours_start: '06:00',
      business_hours_end: '24:00',
      key_contact_wechat: 'boss_wxid',
    };
    const res = await request(app).put('/api/wechat/auto-agent').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSaveAutoAgentConfig).toHaveBeenCalledWith(body);
  });

  it('营业时间格式非法（非 HH:MM）→ 400 INVALID_BODY + issues', async () => {
    const res = await request(app)
      .put('/api/wechat/auto-agent')
      .send({ auto_agent_enabled: true, business_hours_start: '6点', business_hours_end: '24:00', key_contact_wechat: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(mockSaveAutoAgentConfig).not.toHaveBeenCalled();
  });

  it('auto_agent_enabled 类型错误（非 boolean）→ 400 INVALID_BODY', async () => {
    const res = await request(app)
      .put('/api/wechat/auto-agent')
      .send({ auto_agent_enabled: 'yes', business_hours_start: '06:00', business_hours_end: '24:00', key_contact_wechat: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });
});
