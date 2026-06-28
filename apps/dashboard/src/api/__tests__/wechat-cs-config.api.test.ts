/**
 * wechat-cs-config.api 客户端单测：mock apiClient，验证调用了正确的端点 + 透传 body。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet, mockPut, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('../client', () => ({
  apiClient: { get: mockGet, put: mockPut, post: mockPost },
}));

import {
  getPersona,
  savePersona,
  getBusinessKB,
  saveBusinessKB,
  suggestAudience,
  listCSMachines,
  getCSAccountConfig,
  saveCSAccountConfig,
  type Persona,
  type BusinessKB,
} from '../wechat-cs-config.api';

const PERSONA: Persona = {
  self_name: '小齐',
  address_style: '叫名字',
  tone: '随和',
  sentence_style: '短句',
  use_emoji: '偶尔',
  banned_phrases: ['亲'],
  few_shot: [{ customer: '在吗', me: '在的' }],
};

const KB: BusinessKB = {
  company: { name: 'X', what_we_do: '', value_prop: '', contact: '' },
  products: [],
  audience_segments: [],
  qa_docs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: {} });
  mockPut.mockResolvedValue({ data: { success: true } });
  mockPost.mockResolvedValue({ data: { audience_segments: [] } });
});

describe('wechat-cs-config api 客户端', () => {
  it('getPersona → GET /wechat/persona', async () => {
    mockGet.mockResolvedValue({ data: PERSONA });
    const r = await getPersona();
    expect(mockGet).toHaveBeenCalledWith('/wechat/persona');
    expect(r.self_name).toBe('小齐');
  });

  it('savePersona → PUT /wechat/persona 带 body', async () => {
    const r = await savePersona(PERSONA);
    expect(mockPut).toHaveBeenCalledWith('/wechat/persona', PERSONA);
    expect(r.success).toBe(true);
  });

  it('getBusinessKB → GET /wechat/business-kb', async () => {
    mockGet.mockResolvedValue({ data: KB });
    await getBusinessKB();
    expect(mockGet).toHaveBeenCalledWith('/wechat/business-kb');
  });

  it('saveBusinessKB → PUT /wechat/business-kb 带 body', async () => {
    await saveBusinessKB(KB);
    expect(mockPut).toHaveBeenCalledWith('/wechat/business-kb', KB);
  });

  it('suggestAudience → POST /wechat/business-kb/suggest-audience 带 input', async () => {
    mockPost.mockResolvedValue({
      data: { audience_segments: [{ code: 'A1', label: 'x', desc: 'y' }] },
    });
    const r = await suggestAudience({ industry: '餐饮' });
    expect(mockPost).toHaveBeenCalledWith('/wechat/business-kb/suggest-audience', {
      industry: '餐饮',
    });
    expect(r.audience_segments[0].code).toBe('A1');
  });

  // ── IA 重设计刀1：每号配置 ──
  it('listCSMachines → GET /wechat/cs/machines 返回 machines 数组', async () => {
    mockGet.mockResolvedValue({ data: { machines: [{ machine_id: 'm1', configured: true, wechat_id: 'wxid_a' }] } });
    const r = await listCSMachines();
    expect(mockGet).toHaveBeenCalledWith('/wechat/cs/machines');
    expect(r[0].wechat_id).toBe('wxid_a');
  });

  it('getCSAccountConfig → GET /wechat/cs/config/:wechatId 返回该号 persona+business_kb', async () => {
    mockGet.mockResolvedValue({ data: { wechat_id: 'wxid_a', persona: PERSONA, business_kb: KB } });
    const r = await getCSAccountConfig('wxid_a');
    expect(mockGet).toHaveBeenCalledWith('/wechat/cs/config/wxid_a');
    expect(r?.persona.self_name).toBe('小齐');
  });

  it('getCSAccountConfig 404 → 返回 null（前端填空表）', async () => {
    mockGet.mockRejectedValue(new Error('404'));
    const r = await getCSAccountConfig('wxid_none');
    expect(r).toBeNull();
  });

  it('saveCSAccountConfig → PUT /wechat/cs/config/:wechatId 带 persona+business_kb', async () => {
    await saveCSAccountConfig('wxid_a', { persona: PERSONA, business_kb: KB });
    expect(mockPut).toHaveBeenCalledWith('/wechat/cs/config/wxid_a', { persona: PERSONA, business_kb: KB });
  });
});
