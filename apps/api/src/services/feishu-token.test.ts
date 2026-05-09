import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
