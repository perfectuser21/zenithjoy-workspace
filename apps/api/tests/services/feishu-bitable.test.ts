import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock axios 防止真实网络请求
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from 'axios';
import { pushAccountsToBitable, COMPETITOR_BITABLE } from '../../src/services/feishu-bitable';

const mockedAxios = vi.mocked(axios, true);

const makeAccount = (overrides = {}) => ({
  creatorName: '测试创作者',
  douyinId: 'test123',
  followers: 12000,
  bio: '私域变现训练营',
  profileUrl: 'https://www.douyin.com/user/u1',
  round: 1,
  keyword: '一人公司',
  topic: '一人公司',
  passedSecondary: true,
  executedAt: '2026-04-27T10:00:00.000Z',
  ...overrides,
});

describe('pushAccountsToBitable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
  });

  it('空数组直接返回，不发请求', async () => {
    const result = await pushAccountsToBitable([]);
    expect(result.successCount).toBe(0);
    expect(result.url).toBe(COMPETITOR_BITABLE.url);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('正常写入：获取 token 后调用 batch_create', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock-token' } })
      .mockResolvedValueOnce({ data: { code: 0 } });

    const result = await pushAccountsToBitable([makeAccount()]);

    expect(result.successCount).toBe(1);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);

    // 第一次调用是获取 token
    expect((mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('tenant_access_token');

    // 第二次调用是写入记录
    const batchCall = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(batchCall[0]).toContain('batch_create');
    const records = batchCall[1].records;
    expect(records).toHaveLength(1);
    expect(records[0].fields['创作者名称']).toBe('测试创作者');
    expect(records[0].fields['粉丝数']).toBe(12000);
    expect(records[0].fields['通过二筛']).toBe(true);
  });

  it('飞书返回非 0 code 时抛出错误', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock-token' } })
      .mockResolvedValueOnce({ data: { code: 99991, msg: '写入失败' } });

    await expect(pushAccountsToBitable([makeAccount()])).rejects.toThrow('飞书写入失败');
  });

  it('未配置凭据时抛出错误', async () => {
    delete process.env.FEISHU_APP_ID;
    await expect(pushAccountsToBitable([makeAccount()])).rejects.toThrow('未配置');
  });

  it('bio 超长时截断到 500 字符', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'token' } })
      .mockResolvedValueOnce({ data: { code: 0 } });

    const longBio = 'x'.repeat(600);
    await pushAccountsToBitable([makeAccount({ bio: longBio })]);

    const records = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls[1][1].records;
    expect(records[0].fields['简介'].length).toBe(500);
  });
});
