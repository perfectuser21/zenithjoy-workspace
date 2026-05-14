/**
 * WS3 — feishu-bitable-multitenant.ts: provisionBitable + fetchLeadConfig
 *
 * commit-1 RED；commit-2 GREEN。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../../apps/api/src/db/connection', () => ({
  default: { query: mockQuery, end: vi.fn(), connect: vi.fn() },
}));

const mockPost = vi.fn();
const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { post: mockPost, get: mockGet },
}));

vi.mock('../../../../apps/api/src/services/feishu-token', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock_token_xxx'),
}));

const importMt = async () =>
  await import('../../../../apps/api/src/services/feishu-bitable-multitenant');

describe('Workstream 3 — feishu-bitable-multitenant [BEHAVIOR]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPost.mockReset();
    mockGet.mockReset();
  });

  it('provisionBitable 调 1 次 createBitable + 4 次 createTable + 写回 5 个 ID', async () => {
    const mod: any = await importMt();

    // 顺序：createBitable → 4 次 createTable（含 WS2 新增的微信发布审批表）
    mockPost
      .mockResolvedValueOnce({
        data: { code: 0, data: { app: { app_token: 'bascn_app_xxx' } } },
      })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_lead_profile' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_target_videos' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_leads' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_wechat_approval' } } });

    mockQuery.mockResolvedValue({ rows: [] });

    const result = await mod.provisionBitable('tenant-xyz');

    expect(result.app_token).toBe('bascn_app_xxx');
    expect(result.table_id_lead_profile).toBe('tbl_lead_profile');
    expect(result.table_id_target_videos).toBe('tbl_target_videos');
    expect(result.table_id_leads).toBe('tbl_leads');
    expect(result.table_id_wechat_approval).toBe('tbl_wechat_approval');

    // 飞书 API 调用次数：1 createBitable + 4 createTable = 5
    expect(mockPost).toHaveBeenCalledTimes(5);

    // 应有 UPDATE/INSERT 进 tenant_feishu_bindings
    const upsertCalls = mockQuery.mock.calls.filter((c) =>
      /tenant_feishu_bindings/i.test(String(c[0]))
    );
    expect(upsertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('provisionBitable 已绑定时直接返回缓存 ID（幂等）', async () => {
    const mod: any = await importMt();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          app_token: 'cached_app',
          table_id_lead_profile: 'cached_t1',
          table_id_target_videos: 'cached_t2',
          table_id_leads: 'cached_t3',
          table_id_wechat_approval: 'cached_t4',
        },
      ],
    });

    const result = await mod.provisionBitable('tenant-already-bound');
    expect(result.app_token).toBe('cached_app');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('createTable 字段定义：获客画像表含 行业/关键词/钩子文案 3 字段', async () => {
    const mod: any = await importMt();
    mockPost
      .mockResolvedValueOnce({ data: { code: 0, data: { app: { app_token: 'a' } } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 't1' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 't2' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 't3' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 't4' } } });
    mockQuery.mockResolvedValue({ rows: [] });

    await mod.provisionBitable('t1');
    const profileCall = mockPost.mock.calls.find(
      (c) => /\/tables/.test(String(c[0])) && JSON.stringify(c[1]).includes('获客画像')
    );
    expect(profileCall, '应有创建获客画像表的 API 调用').toBeDefined();
    const body = JSON.stringify(profileCall![1]);
    ['行业', '关键词', '钩子文案'].forEach((f) => {
      expect(body, `获客画像表应含字段 ${f}`).toContain(f);
    });
  });

  it('fetchLeadConfig 返回 {profile, target_videos[]} 结构', async () => {
    const mod: any = await importMt();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          app_token: 'app1',
          table_id_lead_profile: 't_profile',
          table_id_target_videos: 't_video',
        },
      ],
    });

    mockGet
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                fields: {
                  行业: '装修',
                  关键词: '小户型',
                  钩子文案: '送装修方案 PDF',
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [{ fields: { '视频 URL': 'https://v.douyin.com/test/', 备注: 'smoke' } }],
          },
        },
      });

    const config = await mod.fetchLeadConfig('tenant-xyz');
    expect(config.profile.industry).toBe('装修');
    expect(config.profile.keyword).toBe('小户型');
    expect(config.profile.hook).toContain('送装修方案');
    expect(Array.isArray(config.target_videos)).toBe(true);
    expect(config.target_videos.length).toBeGreaterThanOrEqual(1);
    expect(config.target_videos[0].url).toMatch(/^https:\/\//);
  });

  it('fetchLeadConfig 当 tenant 未绑飞书抛 FEISHU_NOT_BOUND', async () => {
    const mod: any = await importMt();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(mod.fetchLeadConfig('not-bound-tenant')).rejects.toThrow(/FEISHU_NOT_BOUND/);
  });
});
