/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAuthorizeUrl } from './feishu-token';

// Path 2 Sprint A follow-up — OAuth redirect_uri env-driven
// Bug: 生产 .env 没设 FEISHU_REDIRECT_URI，fallback 到 localhost:5200 → 真扫码 callback 必失败
// 修复：fallback chain = FEISHU_REDIRECT_URI > ${DASHBOARD_BASE_URL}/api/feishu/oauth/callback > localhost dev

describe('feishu-token getAuthorizeUrl — env-driven redirect_uri', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FEISHU_REDIRECT_URI;
    delete process.env.DASHBOARD_BASE_URL;
    delete process.env.PUBLIC_API_BASE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('[BEHAVIOR] FEISHU_REDIRECT_URI set → 用作 redirect_uri', async () => {
    process.env.FEISHU_REDIRECT_URI = 'https://autopilot.zenjoymedia.media/api/feishu/oauth/callback';
    const url = await getAuthorizeUrl('tenant-test', 'cli_test_app');
    const u = new URL(url);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://autopilot.zenjoymedia.media/api/feishu/oauth/callback'
    );
    expect(u.searchParams.get('app_id')).toBe('cli_test_app');
    expect(u.searchParams.get('state')).toBeTruthy();
  });

  it('[BEHAVIOR] FEISHU_REDIRECT_URI 不设、DASHBOARD_BASE_URL 设 → fallback 到 ${DASHBOARD_BASE_URL}/api/feishu/oauth/callback', async () => {
    process.env.DASHBOARD_BASE_URL = 'https://dash.example.com';
    const url = await getAuthorizeUrl('tenant-test', 'cli_test_app');
    const u = new URL(url);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://dash.example.com/api/feishu/oauth/callback'
    );
  });

  it('[BEHAVIOR] FEISHU_REDIRECT_URI + DASHBOARD_BASE_URL 都不设 → fallback 到 localhost dev', async () => {
    const url = await getAuthorizeUrl('tenant-test', 'cli_test_app');
    const u = new URL(url);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5200/api/feishu/oauth/callback'
    );
  });
});

// -------------------------------------------------------------------
// [ARCH hotfix] getValidToken — fallback 自动初始化 binding 行
// -------------------------------------------------------------------
vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

describe('feishu-token getValidToken — [ARCH hotfix] 0 binding 行 fallback', () => {
  beforeEach(async () => {
    const pool = (await import('../db/connection')).default as any;
    const axios = (await import('axios')).default as any;
    pool.query.mockReset();
    axios.post.mockReset();
  });

  it('[ARCH] 没 binding 行 + tenants 表有 app_id/secret → fetch token + INSERT 新 binding 行 + 返 token', async () => {
    const pool = (await import('../db/connection')).default as any;
    const axios = (await import('axios')).default as any;

    pool.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.tenant_feishu_bindings')) {
        return Promise.resolve({ rows: [] }); // 没行
      }
      if (sql.includes('FROM zenithjoy.tenants')) {
        return Promise.resolve({
          rows: [{ feishu_app_id: 'cli_arch_test', feishu_app_secret: 'sec_arch_test' }],
        });
      }
      // INSERT
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    axios.post.mockResolvedValue({
      data: { code: 0, tenant_access_token: 't-arch-fresh-token', expire: 7200 },
    });

    const { getValidToken } = await import('./feishu-token');
    const token = await getValidToken('tenant-arch-test');
    expect(token).toBe('t-arch-fresh-token');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/v3/tenant_access_token/internal'),
      expect.objectContaining({ app_id: 'cli_arch_test', app_secret: 'sec_arch_test' }),
      expect.anything()
    );
    // 验证 INSERT 被调
    const insertCalls = pool.query.mock.calls.filter((c: any) => /INSERT INTO zenithjoy.tenant_feishu_bindings/.test(c[0]));
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('[ARCH] 没 binding 行 + tenants 表无 app_id/secret → throw FEISHU_NOT_BOUND', async () => {
    const pool = (await import('../db/connection')).default as any;

    pool.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM zenithjoy.tenant_feishu_bindings')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM zenithjoy.tenants')) {
        return Promise.resolve({
          rows: [{ feishu_app_id: null, feishu_app_secret: null }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const { getValidToken } = await import('./feishu-token');
    await expect(getValidToken('tenant-no-app')).rejects.toThrow(/FEISHU_NOT_BOUND/);
  });
});

describe('current OAuth compatibility — signed state and expiring provider token', () => {
  beforeEach(async () => {
    vi.mocked((await import('../db/connection')).default.query).mockReset();
    vi.mocked((await import('axios')).default.post).mockReset();
  });
  it('tampered state is rejected before DB or provider calls', async () => {
    const { handleCallback } = await import('./feishu-token');
    await expect(handleCallback('fixture-code', 'tampered-state')).rejects.toThrow(/INVALID_STATE/);
    expect((await import('../db/connection')).default.query).not.toHaveBeenCalled();
    expect((await import('axios')).default.post).not.toHaveBeenCalled();
  });
  it('valid signed state binds provider token to the original tenant', async () => {
    const pool = (await import('../db/connection')).default;
    const axios = (await import('axios')).default;
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ feishu_app_id: 'fixture-app', feishu_app_secret: 'fixture-secret' }] } as any);
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 0, tenant_access_token: 'fixture-token', expire: 7200 } });
    const { handleCallback } = await import('./feishu-token');
    const state = new URL(await getAuthorizeUrl('tenant-original', 'fixture-app')).searchParams.get('state')!;
    expect(await handleCallback('fixture-code', state)).toEqual({ tenant_id: 'tenant-original' });
    expect(vi.mocked(pool.query).mock.calls[1][1]).toEqual(['tenant-original', 'fixture-token', expect.any(Date)]);
  });
  it('valid cached token avoids provider calls; near expiry refresh is persisted for that tenant', async () => {
    const pool = (await import('../db/connection')).default;
    const axios = (await import('axios')).default;
    const query = vi.mocked(pool.query);
    query.mockResolvedValueOnce({ rows: [{ tenant_access_token: 'cached', expires_at: new Date(Date.now() + 3_600_000) }] } as any);
    const { getValidToken } = await import('./feishu-token');
    expect(await getValidToken('tenant-valid')).toBe('cached');
    expect(axios.post).not.toHaveBeenCalled();
    query.mockResolvedValueOnce({ rows: [{ tenant_access_token: 'old', expires_at: new Date(Date.now() + 60_000) }] } as any)
      .mockResolvedValueOnce({ rows: [{ feishu_app_id: 'app', feishu_app_secret: 'secret' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 0, tenant_access_token: 'fresh', expire: 7200 } });
    expect(await getValidToken('tenant-expiring')).toBe('fresh');
    expect(query.mock.calls.at(-1)?.[1]).toEqual(['tenant-expiring', 'fresh', expect.any(Date)]);
  });
  it('provider business failure is rejected and never writes a binding', async () => {
    const pool = (await import('../db/connection')).default;
    const axios = (await import('axios')).default;
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ feishu_app_id: 'app', feishu_app_secret: 'secret' }] } as any);
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 99991663, msg: 'app_id_invalid' } });
    const { handleCallback } = await import('./feishu-token');
    const state = new URL(await getAuthorizeUrl('tenant-error', 'app')).searchParams.get('state')!;
    await expect(handleCallback('code', state)).rejects.toThrow(/99991663/);
    expect(pool.query).toHaveBeenCalledOnce();
  });
});
