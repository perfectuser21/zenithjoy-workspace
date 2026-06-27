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
import { EventEmitter } from 'node:events';

import {
  handleQrBindDouyinBurner,
  getBurnerSessionPath,
  resolveBurnerScript,
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

  it('handler 走 spawn 外部 .cjs（绕过 pkg+playwright 崩溃），不再 binary 内 loadChromium', () => {
    const handlerSrc = fs.readFileSync(HANDLER_PATH, 'utf8');
    // 必须 spawn 外部进程
    expect(handlerSrc).toMatch(/spawn/);
    expect(handlerSrc).toMatch(/qr-bind-douyin-burner\.cjs/);
    // 不得再走会崩的 binary 内 playwright 加载
    expect(handlerSrc).not.toMatch(/loadChromium|loadDefaultLauncher/);
  });

  it('resolveBurnerScript 指向 publishers/qr-bind-douyin-burner.cjs', () => {
    const scriptPath = resolveBurnerScript();
    expect(scriptPath).toMatch(/[\\/]publishers[\\/]qr-bind-douyin-burner\.cjs$/);
  });

  it('publishers/qr-bind-douyin-burner.cjs 文件真实存在', () => {
    const scriptPath = resolveBurnerScript();
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});

// spawn 路径单测：注入 fake spawn，断言 nodeExe + 脚本 + argv 构造正确
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

describe('qr-bind-douyin-burner — spawn 路径（生产）[BEHAVIOR]', () => {
  function makeFakeProc(stdoutLine: string) {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from(stdoutLine + '\n'));
      proc.emit('close', 0);
    }, 0);
    return proc;
  }

  it('未注入 launcher 时 spawn .cjs，argv = [脚本, accountLabel, sessionDir, userDataDirRoot, timeout]，返回末行 JSON', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(
      makeFakeProc(
        JSON.stringify({
          ok: true,
          sessionPath: '/tmp/s/douyin/burner/装修小号1.json',
          cookie_local_path: '/tmp/s/douyin/burner/装修小号1.json',
          qr_login: 'success',
          account_nickname: '装修小号1',
        }),
      ) as unknown as ReturnType<typeof spawn>,
    );

    const result = await handleQrBindDouyinBurner(
      { account_label: '装修小号1' },
      { sessionDir: '/tmp/s', userDataDirRoot: '/tmp/u' },
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [nodeExe, argv] = spawnMock.mock.calls[0];
    expect(nodeExe).toBeTruthy();
    expect(argv[0]).toMatch(/qr-bind-douyin-burner\.cjs$/);
    expect(argv[1]).toBe('装修小号1');
    expect(argv[2]).toBe('/tmp/s');
    expect(argv[3]).toBe('/tmp/u');
    expect(Number(argv[4])).toBeGreaterThanOrEqual(600000);

    expect(result).toMatchObject({ ok: true, qr_login: 'success' });
    expect(result.cookie_local_path).toMatch(/[\\/]burner[\\/]装修小号1\.json$/);
  });

  it('.cjs 输出非 JSON 末行 → handler 返回 ok=false failed', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(
      makeFakeProc('some non-json garbage') as unknown as ReturnType<typeof spawn>,
    );

    const result = await handleQrBindDouyinBurner(
      { account_label: 'x' },
      { sessionDir: '/tmp/s' },
    );
    expect(result.ok).toBe(false);
    expect(result.qr_login).toBe('failed');
  });
});
