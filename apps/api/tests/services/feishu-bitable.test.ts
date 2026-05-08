import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock axios 防止真实网络请求
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from 'axios';
import {
  pushAccountsToBitable,
  COMPETITOR_BITABLE,
  getPath4BitableSchema,
  createPath4Bitables,
} from '../../src/services/feishu-bitable';

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

// ─── Path 4 ws2 — 4 张 Bitable 表 ────────────────────────────────────────────

describe('Path 4 ws2 getPath4BitableSchema()', () => {
  it('返回 4 张表（客户档案/营销画像/内容排期/互动记录）', () => {
    const schema = getPath4BitableSchema();
    expect(Object.keys(schema).sort()).toEqual(
      ['互动记录', '内容排期', '客户档案', '营销画像'].sort(),
    );
  });

  it('客户档案 5 字段（客户名/微信号/行业/备注/加入日期）', () => {
    const schema = getPath4BitableSchema();
    const fields = schema['客户档案'].fields.map((f) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining(['客户名', '微信号', '行业', '备注', '加入日期']),
    );
    expect(fields.length).toBe(5);
  });

  it('营销画像 3 字段（行业/受众/钩子文案）', () => {
    const schema = getPath4BitableSchema();
    const fields = schema['营销画像'].fields.map((f) => f.name);
    expect(fields).toEqual(expect.arrayContaining(['行业', '受众', '钩子文案']));
    expect(fields.length).toBe(3);
  });

  it('内容排期 5 字段（草稿 ID/生成时间/文案/排期时间/状态）', () => {
    const schema = getPath4BitableSchema();
    const fields = schema['内容排期'].fields.map((f) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining(['草稿 ID', '生成时间', '文案', '排期时间', '状态']),
    );
    expect(fields.length).toBe(5);
  });

  it('互动记录 6 字段（客户名/客户原话/AI 草稿/生成时间/状态/真发时间）', () => {
    const schema = getPath4BitableSchema();
    const fields = schema['互动记录'].fields.map((f) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining([
        '客户名',
        '客户原话',
        'AI 草稿',
        '生成时间',
        '状态',
        '真发时间',
      ]),
    );
    expect(fields.length).toBe(6);
  });
});

describe('Path 4 ws2 createPath4Bitables({appId, appToken})', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
  });

  it('调飞书 OpenAPI 创建 4 张表，返回 4 条 {name, app_token, table_id}', async () => {
    // 1 次 token + 4 次 app_table_create
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock-token' } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_customer_001' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_profile_001' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_schedule_001' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_interaction_001' } } });

    const result = await createPath4Bitables({
      appId: 'app_test',
      appToken: 'tok_test_abc',
    });

    // 至少 4 + 1 = 5 次 axios.post（含 token）
    expect((mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
      5,
    );
    expect(result.tables).toHaveLength(4);
    const names = result.tables.map((t) => t.name).sort();
    expect(names).toEqual(['互动记录', '内容排期', '客户档案', '营销画像'].sort());
    for (const t of result.tables) {
      expect(t.app_token).toBe('tok_test_abc');
      expect(typeof t.table_id).toBe('string');
      expect(t.table_id.length).toBeGreaterThan(0);
    }

    // 校验调用了 app_table_create endpoint 4 次
    const createCalls = (mockedAxios.post as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/tables'),
    );
    expect(createCalls.length).toBeGreaterThanOrEqual(4);
  });

  it('飞书返回非 0 code 时抛错', async () => {
    (mockedAxios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'mock-token' } })
      .mockResolvedValueOnce({ data: { code: 1254005, msg: 'app_token invalid' } });

    await expect(
      createPath4Bitables({ appId: 'app_test', appToken: 'bad_token' }),
    ).rejects.toThrow(/飞书|建表失败|1254005|app_token/);
  });
});
