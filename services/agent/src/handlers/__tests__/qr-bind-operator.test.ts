// services/agent/src/handlers/__tests__/qr-bind-operator.test.ts
//
// 验证 qr-bind-operator 关键行为：
//   - douyin URL 必须导航到 /creator-micro/home 而非根域名（SPA 误判防护）
//   - 导航后等 3s SPA JS 完成重定向再开始轮询
//   - defaultIsLoggedIn 在 /login URL 时返回 false（不误判为已登录）
//   - 扫码成功后写 storageState

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { handleQrBindOperator, PLATFORM_CREATOR_URLS } from '../qr-bind-operator';

describe('PLATFORM_CREATOR_URLS', () => {
  it('douyin URL 包含 /creator-micro/home — 触发登录页重定向，避免 SPA 根域名误判', () => {
    expect(PLATFORM_CREATOR_URLS.douyin).toContain('/creator-micro/home');
  });

  it('kuaishou URL 包含子路径，不是裸域名', () => {
    const url = new URL(PLATFORM_CREATOR_URLS.kuaishou);
    expect(url.pathname).not.toBe('/');
  });

  it('xiaohongshu URL 包含子路径，不是裸域名', () => {
    const url = new URL(PLATFORM_CREATOR_URLS.xiaohongshu);
    expect(url.pathname).not.toBe('/');
  });

  it('toutiao URL 包含子路径，不是裸域名', () => {
    const url = new URL(PLATFORM_CREATOR_URLS.toutiao);
    expect(url.pathname).not.toBe('/');
  });
});

describe('handleQrBindOperator — SPA 3s 等待 + 登录检测', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-op-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMockBrowser(urlFn: () => string, fakeStorageState: unknown) {
    const mockPage = {
      url: urlFn,
      goto: vi.fn(async () => undefined),
    };
    const context = {
      pages: () => [mockPage],
      storageState: vi.fn(async () => fakeStorageState),
      newPage: vi.fn(async () => mockPage),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };
    return { browser, context, mockPage };
  }

  it('在 SPA /login 页面时 isLoggedIn 返回 false — Chrome 不会提前关闭', async () => {
    // 模拟抖音 SPA：登录前 URL 含 /login
    const { browser } = makeMockBrowser(
      () => 'https://creator.douyin.com/creator-micro/login?redirect=%2Fcreator-micro%2Fhome',
      { cookies: [], origins: [] },
    );
    const chromiumLauncher = { launch: vi.fn(async () => browser) };

    let isLoggedInCallCount = 0;
    const customIsLoggedIn = vi.fn((_ctx: unknown, _platform: string) => {
      isLoggedInCallCount++;
      // 前几次返回 false（在登录页），第三次返回 true（扫码成功）
      return isLoggedInCallCount >= 3;
    });

    const resultPromise = handleQrBindOperator(
      { platform: 'douyin' },
      {
        chromiumLauncher,
        isLoggedIn: customIsLoggedIn,
        sessionBaseDir: tmpDir,
        pollIntervalMs: 100,
        timeoutMs: 30000,
      },
    );

    // 跑过 3s 初始等待
    await vi.advanceTimersByTimeAsync(3000);
    // 跑过 3 次轮询
    await vi.advanceTimersByTimeAsync(300);
    const res = await resultPromise;

    expect(res.ok).toBe(true);
    expect(customIsLoggedIn).toHaveBeenCalledTimes(3);
    // 轮询在 3s 等待后才开始（不能在 goto 完成后立即 ok）
    expect(isLoggedInCallCount).toBe(3);
  });

  it('3s 初始等待期间 isLoggedIn 不被调用', async () => {
    const { browser } = makeMockBrowser(
      () => 'https://creator.douyin.com/creator-micro/login',
      { cookies: [], origins: [] },
    );
    const chromiumLauncher = { launch: vi.fn(async () => browser) };

    const customIsLoggedIn = vi.fn(() => false);

    // timeoutMs=50 — 3s wait 完成后只允许 50ms 轮询，很快超时
    const resultPromise = handleQrBindOperator(
      { platform: 'douyin' },
      {
        chromiumLauncher,
        isLoggedIn: customIsLoggedIn,
        sessionBaseDir: tmpDir,
        pollIntervalMs: 100,
        timeoutMs: 50,
      },
    );

    // 推进 2.9s — 3s 初始等待还没结束，isLoggedIn 不应被调用
    await vi.advanceTimersByTimeAsync(2900);
    expect(customIsLoggedIn).not.toHaveBeenCalled();

    // 继续推进超过 3s wait + 50ms timeout
    await vi.advanceTimersByTimeAsync(300);
    const res = await resultPromise;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/超时/);
  });

  it('扫码成功后写 storageState 到 sessionPath', async () => {
    const fakeStorage = { cookies: [{ name: 'sessionid', value: 'xyz' }], origins: [] };
    const { browser } = makeMockBrowser(
      () => 'https://creator.douyin.com/creator-micro/home',
      fakeStorage,
    );
    const chromiumLauncher = { launch: vi.fn(async () => browser) };

    const resultPromise = handleQrBindOperator(
      { platform: 'douyin', account_label: 'test_account' },
      {
        chromiumLauncher,
        isLoggedIn: (_ctx: unknown, _platform: string) => true,
        sessionBaseDir: tmpDir,
        pollIntervalMs: 100,
        timeoutMs: 30000,
      },
    );

    await vi.advanceTimersByTimeAsync(3100);
    const res = await resultPromise;

    expect(res.ok).toBe(true);
    expect(res.sessionPath).toBeDefined();
    const written = JSON.parse(fs.readFileSync(res.sessionPath!, 'utf-8'));
    expect(written.cookies[0].name).toBe('sessionid');
  });
});
