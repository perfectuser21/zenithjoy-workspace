/**
 * WS2 — feishu-token.ts 服务（OAuth flow + token 自动刷新）
 *
 * commit-1 RED（服务文件未建/函数未导出）；commit-2 实现后 GREEN。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pg pool 避免实际连库
const mockQuery = vi.fn();
vi.mock('../../../../apps/api/src/db/connection', () => ({
  default: { query: mockQuery, end: vi.fn(), connect: vi.fn() },
}));

// Mock axios 拦截飞书 API 调用
const mockPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: mockPost, get: vi.fn() },
}));

// 动态 import 让 mock 生效
const importToken = async () =>
  await import('../../../../apps/api/src/services/feishu-token');

describe('Workstream 2 — feishu-token service [BEHAVIOR]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPost.mockReset();
  });

  it('getAuthorizeUrl 返回飞书 authorize URL + state 签名', async () => {
    const mod: any = await importToken();
    const url = await mod.getAuthorizeUrl('tenant-uuid-123', 'cli_app_xxx');
    expect(url).toMatch(/^https:\/\/(passport\.|open\.)?feishu\.cn\//);
    expect(url).toMatch(/authorize/);
    expect(url).toMatch(/state=/);
    // state 应是签名后的 token，不是明文 tenant_id
    expect(url).not.toContain('state=tenant-uuid-123');
  });

  it('handleCallback(code, state) 正常路径写 tenant_feishu_bindings', async () => {
    // state 必须先用 getAuthorizeUrl 生成的合法签名
    const mod: any = await importToken();
    const url: string = await mod.getAuthorizeUrl('tenant-uuid-456', 'cli_app_xxx');
    const state = new URL(url).searchParams.get('state')!;

    mockPost.mockResolvedValueOnce({
      data: {
        code: 0,
        tenant_access_token: 'fake_tenant_token_xxx',
        expire: 7200,
      },
    });
    mockQuery.mockResolvedValue({ rows: [{ feishu_app_id: 'cli_app_xxx', feishu_app_secret: 'sec' }] });

    await mod.handleCallback('code_from_feishu', state);

    // 应有 INSERT/UPSERT 进 tenant_feishu_bindings
    const insertCalls = mockQuery.mock.calls.filter((c) =>
      /tenant_feishu_bindings/i.test(String(c[0]))
    );
    expect(insertCalls.length, 'handleCallback 应写 tenant_feishu_bindings').toBeGreaterThanOrEqual(1);
  });

  it('handleCallback state 验签失败抛 INVALID_STATE', async () => {
    const mod: any = await importToken();
    await expect(mod.handleCallback('any_code', 'tampered_state_xxx')).rejects.toThrow(/INVALID_STATE|invalid state/i);
  });

  it('getValidToken：token 即将过期（< 5min）触发刷新', async () => {
    const mod: any = await importToken();
    const expiringSoon = new Date(Date.now() + 60_000); // 1min 后过期
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: 'tenant-uuid-789',
            tenant_access_token: 'old_token',
            expires_at: expiringSoon,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ feishu_app_id: 'a', feishu_app_secret: 'b' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    mockPost.mockResolvedValueOnce({
      data: { code: 0, tenant_access_token: 'new_token_xxx', expire: 7200 },
    });

    const token = await mod.getValidToken('tenant-uuid-789');
    expect(token).toBe('new_token_xxx');
    // 必须发起一次飞书 token 接口调用
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringMatching(/feishu\.cn.*tenant_access_token/),
      expect.any(Object),
      expect.anything()
    );
  });

  it('getValidToken：token 仍然有效时不刷新', async () => {
    const mod: any = await importToken();
    const validFor1Hour = new Date(Date.now() + 3600_000);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: 'tenant-uuid-still-valid',
          tenant_access_token: 'still_good_token',
          expires_at: validFor1Hour,
        },
      ],
    });

    const token = await mod.getValidToken('tenant-uuid-still-valid');
    expect(token).toBe('still_good_token');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('handleCallback 飞书 API 返回错误码抛带 code 的 Error', async () => {
    const mod: any = await importToken();
    const url: string = await mod.getAuthorizeUrl('tenant-uuid-err', 'cli_app_xxx');
    const state = new URL(url).searchParams.get('state')!;

    mockPost.mockResolvedValueOnce({ data: { code: 99991663, msg: 'app_id_invalid' } });
    mockQuery.mockResolvedValue({ rows: [{ feishu_app_id: 'a', feishu_app_secret: 'b' }] });

    await expect(mod.handleCallback('any_code', state)).rejects.toThrow(/99991663|app_id_invalid/);
  });
});
