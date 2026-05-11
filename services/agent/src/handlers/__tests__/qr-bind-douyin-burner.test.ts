/**
 * WS2a — Agent burner handler: qr-bind-douyin-burner.ts (CI 实跑落点)
 *
 * Path: services/agent/src/handlers/__tests__/qr-bind-douyin-burner.test.ts
 *   __dirname depth = 4 → ../../ = services/agent/src → ../qr-bind-douyin-burner
 *
 * 今日 ssh rog 真验暴露：旧 waitForURL(/^(?!.*\/login).*$/, {timeout: 600000}) 立即匹配
 * (creator.douyin.com/ 初始页不含 /login) → handler 没真等扫码就 success → cached cookie 复用 →
 * `account_nickname: '抖音创作者中心'` (默认页标题不是真昵称)。
 *
 * 修：换成轮询 storageState cookie 直到出现抖音 session cookie (sessionid_ss / sessionid / sid_tt)
 * 才算真扫码完成。timeout 仍 10 分钟。
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  handleQrBindDouyinBurner,
  getBurnerSessionPath,
} from '../qr-bind-douyin-burner';

const HANDLER_PATH = path.resolve(__dirname, '../qr-bind-douyin-burner.ts');

describe('Workstream 2a — qr-bind-douyin-burner handler [BEHAVIOR]', () => {
  it('getBurnerSessionPath 含 /burner/ 子目录与 Path 1 main 隔离', () => {
    const p = getBurnerSessionPath('douyin', '装修小号1');
    expect(p).toMatch(/[\\/]burner[\\/]/);
    expect(p).toMatch(/装修小号1\.json$/);
  });

  it('handler 含 cookie poll 超时 >= 10 分钟（给 user 找小号手机时间）', () => {
    const handlerSrc = fs.readFileSync(HANDLER_PATH, 'utf8');
    const m = handlerSrc.match(/COOKIE_POLL_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(m, 'handler 必须含 COOKIE_POLL_TIMEOUT_MS 配置').not.toBeNull();
    expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(600000);
  });

  it('handler 真等抖音 session cookie (sessionid_ss / sessionid / sid_tt) 出现才 success', async () => {
    const cookieRef: { current: Array<{ name: string; domain: string; value: string }> } = {
      current: [],
    };
    const fakePage = {
      url: () => 'https://creator.douyin.com/',
      goto: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockResolvedValue('抖音创作者中心'),
    };
    const fakeContext = {
      newPage: vi.fn().mockResolvedValue(fakePage),
      pages: () => [fakePage],
      storageState: vi.fn(async () => ({ cookies: [...cookieRef.current], origins: [] })),
      waitForURL: vi.fn().mockResolvedValue(null), // 老的 mock 保留，handler 应该不依赖此
      close: vi.fn().mockResolvedValue(null),
    };
    const fakeLauncher = {
      launchPersistentContext: vi.fn().mockResolvedValue(fakeContext),
    };

    // 模拟 user 100ms 后扫码 → cookie 出现
    setTimeout(() => {
      cookieRef.current.push({
        name: 'sessionid_ss',
        domain: '.douyin.com',
        value: 'real-session-token-after-scan',
      });
    }, 100);

    const result = await handleQrBindDouyinBurner(
      { account_label: 'test-fresh-burner' },
      {
        chromiumLauncher: fakeLauncher as any,
        sessionDir: '/tmp/test-burner-sessions',
        userDataDirRoot: '/tmp/test-burner-userdata',
      }
    );

    expect(result).toMatchObject({
      ok: true,
      qr_login: 'success',
    });
    expect(result.cookie_local_path).toMatch(/[\\/]burner[\\/]test-fresh-burner\.json$/);
    expect(result).toHaveProperty('account_nickname');
    // storageState 真被多次轮询 (>= 1 次)
    expect(vi.mocked(fakeContext.storageState).mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('cookie 永不出现 → handler timeout (qr_login=timeout, ok=false)', async () => {
    const fakePage = {
      url: () => 'https://creator.douyin.com/',
      goto: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockResolvedValue('抖音创作者中心'),
    };
    const fakeContext = {
      newPage: vi.fn().mockResolvedValue(fakePage),
      pages: () => [fakePage],
      // storageState 永远返空 cookies — 模拟 user 没扫码
      storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
      waitForURL: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(null),
    };
    const fakeLauncher = {
      launchPersistentContext: vi.fn().mockResolvedValue(fakeContext),
    };

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const promise = handleQrBindDouyinBurner(
      { account_label: 'test-timeout-burner' },
      {
        chromiumLauncher: fakeLauncher as any,
        sessionDir: '/tmp/test-burner-sessions',
        userDataDirRoot: '/tmp/test-burner-userdata',
      }
    );
    await vi.advanceTimersByTimeAsync(601000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    expect(result.qr_login).toBe('timeout');
  }, 15000);

  it('handler 不引用 Path 1 主号 handler（物理隔离）', () => {
    const handlerSrc = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(handlerSrc).not.toMatch(/from\s+['"]\.\/qr-bind-douyin['"]/);
  });
});
