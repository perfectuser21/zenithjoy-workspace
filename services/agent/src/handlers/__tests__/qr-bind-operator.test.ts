// services/agent/src/handlers/__tests__/qr-bind-operator.test.ts
//
// 验证 qr-bind-operator 关键行为：
//   - douyin URL 必须导航到 /creator-micro/home 而非根域名
//   - 导航后等 3s SPA JS 完成重定向再开始轮询
//   - 使用 Session Cookie 检测（不用 URL，避免 SPA 中间路由误判）
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

describe('handleQrBindOperator — SPA 3s 等待 + Session Cookie 检测', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-op-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMockBrowser(fakeStorageState: unknown) {
    const mockPage = {
      url: () => 'https://creator.douyin.com/creator-micro/login',
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
      contexts: () => [context],
    };
    return { browser, context, mockPage };
  }

  it('Session Cookie 未出现时不误判已登录（Chrome 不提前关闭）', async () => {
    const { browser } = makeMockBrowser({ cookies: [], origins: [] });
    const chromiumLauncher = {
      launch: vi.fn(async () => browser),
      connectOverCDP: vi.fn(async () => { throw new Error('no CDP'); }),
    };

    let checkCount = 0;
    const customIsSessionReady = vi.fn((_state: unknown, _platform: string) => {
      checkCount++;
      // 前两次返回 false（等待扫码），第三次返回 true（扫码成功）
      return checkCount >= 3;
    });

    const resultPromise = handleQrBindOperator(
      { platform: 'douyin' },
      {
        chromiumLauncher,
        isSessionReady: customIsSessionReady,
        sessionBaseDir: tmpDir,
        pollIntervalMs: 100,
        timeoutMs: 30000,
      },
    );

    // 跑过 3s 初始等待
    await vi.advanceTimersByTimeAsync(3000);
    // 跑过 3 次轮询（第 3 次 isSessionReady 返回 true）
    await vi.advanceTimersByTimeAsync(300);
    const res = await resultPromise;

    expect(res.ok).toBe(true);
    expect(customIsSessionReady).toHaveBeenCalledTimes(3);
  });

  it('3s 初始等待期间 isSessionReady 不被调用', async () => {
    const { browser } = makeMockBrowser({ cookies: [], origins: [] });
    const chromiumLauncher = {
      launch: vi.fn(async () => browser),
      connectOverCDP: vi.fn(async () => { throw new Error('no CDP'); }),
    };

    const customIsSessionReady = vi.fn(() => false);

    // timeoutMs=50 — 3s wait 完成后只允许 50ms 轮询，很快超时
    const resultPromise = handleQrBindOperator(
      { platform: 'douyin' },
      {
        chromiumLauncher,
        isSessionReady: customIsSessionReady,
        sessionBaseDir: tmpDir,
        pollIntervalMs: 100,
        timeoutMs: 50,
      },
    );

    // 推进 2.9s — 3s 初始等待还没结束，isSessionReady 不应被调用
    await vi.advanceTimersByTimeAsync(2900);
    expect(customIsSessionReady).not.toHaveBeenCalled();

    // 继续推进超过 3s wait + 50ms timeout
    await vi.advanceTimersByTimeAsync(300);
    const res = await resultPromise;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/超时/);
  });

  it('扫码成功后写 storageState 到 sessionPath', async () => {
    const fakeStorage = {
      cookies: [{ name: 'sessionid_ss', value: 'abc123', domain: '.douyin.com' }],
      origins: [],
    };
    const { browser } = makeMockBrowser(fakeStorage);
    const chromiumLauncher = {
      launch: vi.fn(async () => browser),
      connectOverCDP: vi.fn(async () => { throw new Error('no CDP'); }),
    };

    const resultPromise = handleQrBindOperator(
      { platform: 'douyin', account_label: 'test_account' },
      {
        chromiumLauncher,
        isSessionReady: (_state: unknown, _platform: string) => true,
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
    expect(written.cookies[0].name).toBe('sessionid_ss');
  });

  it('CDP 失败时降级到 launch — Chrome 正常打开', async () => {
    const { browser } = makeMockBrowser({ cookies: [], origins: [] });
    const chromiumLauncher = {
      launch: vi.fn(async () => browser),
      connectOverCDP: vi.fn(async () => { throw new Error('Connection refused'); }),
    };

    const resultPromise = handleQrBindOperator(
      { platform: 'douyin' },
      {
        chromiumLauncher,
        isSessionReady: () => false,
        sessionBaseDir: tmpDir,
        pollIntervalMs: 100,
        timeoutMs: 50,
      },
    );

    await vi.advanceTimersByTimeAsync(4000);
    await resultPromise;

    expect(chromiumLauncher.connectOverCDP).toHaveBeenCalledWith('http://localhost:19222');
    expect(chromiumLauncher.launch).toHaveBeenCalledTimes(1);
  });
});
