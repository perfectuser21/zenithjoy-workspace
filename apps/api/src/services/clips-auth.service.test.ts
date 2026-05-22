import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('buildFeishuOAuthUrl', () => {
  beforeEach(() => {
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.API_PUBLIC_URL = 'https://example.com';
  });
  afterEach(() => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.API_PUBLIC_URL;
  });

  it('包含 app_id、redirect_uri、scope=bitable:app、state', async () => {
    const { buildFeishuOAuthUrl } = await import('./clips-auth.service');
    const url = buildFeishuOAuthUrl('user123');
    expect(url).toContain('app_id=test_app_id');
    expect(url).toContain('bitable');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('state=');
  });

  it('env 未配置时抛出错误', async () => {
    delete process.env.FEISHU_APP_ID;
    const { buildFeishuOAuthUrl } = await import('./clips-auth.service');
    expect(() => buildFeishuOAuthUrl('user123')).toThrow();
  });
});

describe('parseFeishuTokenResponse', () => {
  it('正确提取 token 字段', async () => {
    const { parseFeishuTokenResponse } = await import('./clips-auth.service');
    const raw = {
      access_token: 'tok123',
      refresh_token: 'ref456',
      open_id: 'ou_abc',
      expires_in: 43200,
      name: '张三',
    };
    const result = parseFeishuTokenResponse(raw);
    expect(result.userToken).toBe('tok123');
    expect(result.refreshToken).toBe('ref456');
    expect(result.userId).toBe('ou_abc');
    expect(result.userName).toBe('张三');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('validateNotionToken', () => {
  it('token 有效时返回 true', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Partial<Response> as Response);
    const { validateNotionToken } = await import('./clips-auth.service');
    const result = await validateNotionToken('ntn_validtoken');
    expect(result).toBe(true);
  });

  it('token 无效时返回 false', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false } as Partial<Response> as Response);
    const { validateNotionToken } = await import('./clips-auth.service');
    const result = await validateNotionToken('ntn_badtoken');
    expect(result).toBe(false);
  });
});

describe('parseFeishuState', () => {
  it('有效 state 返回 userId 和 timestamp', async () => {
    const { parseFeishuState, buildFeishuOAuthUrl } = await import('./clips-auth.service');
    // Build a real state then parse it
    process.env.FEISHU_APP_ID = 'app1';
    process.env.API_PUBLIC_URL = 'https://example.com';
    const url = buildFeishuOAuthUrl('user42');
    const state = new URL(url).searchParams.get('state') || '';
    const result = parseFeishuState(state);
    expect(result?.userId).toBe('user42');
    expect(result?.timestamp).toBeGreaterThan(0);
  });

  it('过期 state 返回 null', async () => {
    const { parseFeishuState } = await import('./clips-auth.service');
    // timestamp 11 minutes ago = expired
    const oldTs = Date.now() - 11 * 60 * 1000;
    const fakeState = `abc123def456abcd:${oldTs}:user99`;
    expect(parseFeishuState(fakeState)).toBeNull();
  });

  it('格式错误 state 返回 null', async () => {
    const { parseFeishuState } = await import('./clips-auth.service');
    expect(parseFeishuState('notvalid')).toBeNull();
  });
});
