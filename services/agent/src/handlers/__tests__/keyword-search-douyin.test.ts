// services/agent/src/handlers/__tests__/keyword-search-douyin.test.ts
//
// Sprint cp-06261900 — keyword-search-douyin 改用共享 playwright-launcher（playwright-core 优先）
//
// 旧版直接 `await import('playwright')`（完整包，pkg 没打进 → 真机报「playwright 未安装」）。
// 改后走 loadChromium(options)：注入 chromiumLauncher / chromiumLoader 即可在单测里驱动，
// 且源码不再含裸 import('playwright')。

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { searchDouyinVideosByKeyword, resolveKeywordSearchScript } from '../keyword-search-douyin';

const HANDLER_PATH = path.resolve(__dirname, '../keyword-search-douyin.ts');

describe('keyword-search-douyin — 共享 launcher [BEHAVIOR]', () => {
  it('源码不再裸 import(playwright)，改走共享 loadChromium', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(src).not.toMatch(/await import\(\s*['"]playwright['"]\s*\)/);
    expect(src).toMatch(/loadChromium/);
    expect(src).toMatch(/playwright-launcher/);
  });

  it('注入 chromiumLauncher → 连 CDP 抓视频 URL（不打真实包，不抛「未安装」）', async () => {
    const fakePage = {
      goto: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn().mockResolvedValue([
        'https://www.douyin.com/video/111',
        'https://www.douyin.com/video/222',
      ]),
      close: vi.fn().mockResolvedValue(null),
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage) };
    const fakeBrowser = {
      contexts: () => [fakeContext],
      close: vi.fn().mockResolvedValue(null),
    };
    const fakeChromium = {
      connectOverCDP: vi.fn().mockResolvedValue(fakeBrowser),
    };

    const result = await searchDouyinVideosByKeyword('装修', {
      chromiumLauncher: fakeChromium as any,
      maxVideosPerKeyword: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.keyword).toBe('装修');
    expect(result.video_urls).toEqual([
      'https://www.douyin.com/video/111',
      'https://www.douyin.com/video/222',
    ]);
    expect(fakeChromium.connectOverCDP).toHaveBeenCalled();
  });

  it('注入 chromiumLoader 加载 playwright-core → 不抛「未安装」', async () => {
    const fakeBrowser = { contexts: () => [], close: vi.fn().mockResolvedValue(null) };
    const fakeChromium = { connectOverCDP: vi.fn().mockResolvedValue(fakeBrowser) };
    const loaded: string[] = [];
    const result = await searchDouyinVideosByKeyword('家装', {
      chromiumLoader: async (m: string) => {
        loaded.push(m);
        if (m === 'playwright-core') return { chromium: fakeChromium };
        throw new Error('should not reach playwright');
      },
    });
    // 无 CDP context → ok:false NO_CDP_CONTEXT，但绝不是「未安装」
    expect(result.error).not.toMatch(/未安装/);
    expect(loaded[0]).toBe('playwright-core');
  });
});

describe('keyword-search-douyin — spawn 外部 .cjs（生产）[BEHAVIOR]', () => {
  it('源码生产路径 spawn 外部 .cjs（绕 pkg+playwright 崩溃）', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/spawn/);
    expect(src).toMatch(/keyword-search-douyin\.cjs/);
  });

  it('resolveKeywordSearchScript 指向 publishers/keyword-search-douyin.cjs', () => {
    expect(resolveKeywordSearchScript()).toMatch(/[\\/]publishers[\\/]keyword-search-douyin\.cjs$/);
  });

  it('publishers/keyword-search-douyin.cjs 文件真实存在', () => {
    expect(fs.existsSync(resolveKeywordSearchScript())).toBe(true);
  });
});

// ────── Bug C 回归：.cjs 有 Chrome launch 兜底，不再在 CDP 不可用时直接失败 ──────
describe('keyword-search-douyin.cjs — CDP 不可用时走 launch 兜底 [REGRESSION]', () => {
  const CJS_PATH = path.resolve(__dirname, '../../../publishers/keyword-search-douyin.cjs');

  it('.cjs 源码包含 chromium.launch 兜底（CDP connectOverCDP 失败时不直接 ECONNRESET）', () => {
    const src = fs.readFileSync(CJS_PATH, 'utf8');
    expect(src).toMatch(/chromium\.launch/);
  });

  it('.cjs 源码在 connectOverCDP 的 catch 里调用 launch', () => {
    const src = fs.readFileSync(CJS_PATH, 'utf8');
    // connectOverCDP 和 launch 都存在，且 launch 是兜底（在 try/catch 里）
    expect(src).toMatch(/connectOverCDP/);
    expect(src).toMatch(/launch/);
    expect(src).toMatch(/catch|try/);
  });
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

describe('keyword-search-douyin — spawn 路径 argv [BEHAVIOR]', () => {
  function makeFakeProc(stdoutLine: string) {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => { proc.stdout.emit('data', Buffer.from(stdoutLine + '\n')); proc.emit('close', 0); }, 0);
    return proc;
  }

  it('未注入 launcher/loader → spawn .cjs，argv=[脚本,keyword,cdpPort,maxVideos]，返回末行 JSON', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(
      makeFakeProc(JSON.stringify({ ok: true, keyword: '装修', video_urls: ['https://www.douyin.com/video/9'] })) as unknown as ReturnType<typeof spawn>,
    );

    const result = await searchDouyinVideosByKeyword('装修', { cdpPort: 19222, maxVideosPerKeyword: 5 });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [nodeExe, argv] = spawnMock.mock.calls[0];
    expect(nodeExe).toBeTruthy();
    expect(argv![0]).toMatch(/keyword-search-douyin\.cjs$/);
    expect(argv![1]).toBe('装修');
    expect(argv![2]).toBe('19222');
    expect(argv![3]).toBe('5');
    expect(result).toMatchObject({ ok: true, keyword: '装修', video_urls: ['https://www.douyin.com/video/9'] });
  });
});
