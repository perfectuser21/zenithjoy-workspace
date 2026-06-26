// services/agent/src/shared/__tests__/playwright-launcher.test.ts
//
// Sprint cp-06261900 — Playwright 共享底座单测（TDD commit-1 红）
//
// 根治：qr-bind-douyin-burner / douyin-dm-outreach / keyword-search-douyin 三个 handler
// 各自在 handler 内 import('playwright')（完整包，pkg 没打进 → 打包真机报「playwright 未安装」）。
// 包里打进的是 playwright-core（见 package.json pkg.assets）。
//
// 本测试钉死共享 launcher loadChromium() 的行为：
//   - 优先动态 import playwright-core（包里有的那个），失败回退 playwright
//   - 注入 options.chromiumLoader 供单测（不打真实包）
//   - 都加载失败 → 抛清晰错误（含「playwright-core」字样，便于真机定位）
//   - 源码必须用动态 import（new Function('m','return import(m)')）而非顶层 require，
//     否则 pkg 二进制内 require('playwright') 在 Node 18+ 触发 VFS 崩溃。

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadChromium } from '../playwright-launcher';

const LAUNCHER_PATH = path.resolve(__dirname, '../playwright-launcher.ts');

describe('playwright-launcher — loadChromium [BEHAVIOR]', () => {
  it('优先加载 playwright-core（注入 loader 返回带 chromium 的模块）', async () => {
    const fakeChromium = { launch: vi.fn(), connectOverCDP: vi.fn(), launchPersistentContext: vi.fn() };
    const loaded: string[] = [];
    const fakeLoader = vi.fn(async (m: string) => {
      loaded.push(m);
      if (m === 'playwright-core') return { chromium: fakeChromium };
      throw new Error('should not reach playwright');
    });

    const chromium = await loadChromium({ chromiumLoader: fakeLoader });

    expect(chromium).toBe(fakeChromium);
    // 先试 playwright-core，命中即返回，绝不再碰完整 playwright
    expect(loaded[0]).toBe('playwright-core');
    expect(loaded).not.toContain('playwright');
  });

  it('playwright-core 不可用时回退完整 playwright', async () => {
    const fakeChromium = { launch: vi.fn() };
    const fakeLoader = vi.fn(async (m: string) => {
      if (m === 'playwright-core') throw new Error('core not found');
      if (m === 'playwright') return { chromium: fakeChromium };
      throw new Error('unknown module ' + m);
    });

    const chromium = await loadChromium({ chromiumLoader: fakeLoader });
    expect(chromium).toBe(fakeChromium);
    expect(fakeLoader).toHaveBeenCalledWith('playwright-core');
    expect(fakeLoader).toHaveBeenCalledWith('playwright');
  });

  it('两者都加载失败 → 抛含 playwright-core 的清晰错误', async () => {
    const fakeLoader = vi.fn(async () => {
      throw new Error('not installed');
    });
    await expect(loadChromium({ chromiumLoader: fakeLoader })).rejects.toThrow(/playwright-core/);
  });

  it('注入的 chromiumLauncher 直接透传（供 handler 测试复用）', async () => {
    const injected = { launch: vi.fn(), connectOverCDP: vi.fn() };
    const chromium = await loadChromium({ chromiumLauncher: injected as any });
    expect(chromium).toBe(injected);
  });

  it('源码用动态 import 而非顶层 require(playwright)（防 pkg VFS 崩溃）', () => {
    const src = fs.readFileSync(LAUNCHER_PATH, 'utf8');
    // 不得有顶层静态 import / require 完整 playwright 包
    expect(src).not.toMatch(/^\s*import\s+.*from\s+['"]playwright['"]/m);
    expect(src).not.toMatch(/require\(\s*['"]playwright['"]\s*\)/);
    // 必须走动态 import 包装（绕过 pkg 的 require 截获）
    expect(src).toMatch(/return import\(/);
  });
});
