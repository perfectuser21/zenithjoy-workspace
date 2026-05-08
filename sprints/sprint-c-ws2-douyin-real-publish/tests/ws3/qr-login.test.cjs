const { describe, it, expect, vi } = require('vitest');

describe('Workstream 3 — qr-login 共享模块 [BEHAVIOR]', () => {
  it('未登录时 throw NEED_QR + attach 截屏路径', async () => {
    const { requireLogin } = require('../../../../services/agent/publishers/douyin-publisher/lib/qr-login.cjs');
    const fakePage = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: () => 'https://www.douyin.com/login',
      screenshot: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    let err;
    try {
      await requireLogin(fakePage, { timeoutMs: 100, qrScreenshotPath: '/tmp/qr.png' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.message || err.code).toMatch(/NEED_QR|QR|need.*qr/i);
    expect(err.qrScreenshotPath || err.screenshotPath).toBe('/tmp/qr.png');
  });

  it('已登录直接 return 不抛错', async () => {
    const { requireLogin } = require('../../../../services/agent/publishers/douyin-publisher/lib/qr-login.cjs');
    const fakePage = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: () => 'https://creator.douyin.com/creator-micro/home',
      $: vi.fn().mockResolvedValue({ getAttribute: () => 'logged-in-marker' }),
      waitForSelector: vi.fn().mockResolvedValue({}),
    };
    await expect(requireLogin(fakePage, { timeoutMs: 100 })).resolves.not.toThrow();
  });
});
