// services/agent/src/__tests__/tray-icon-platform.test.ts
//
// 回归：Windows 托盘 logo 错（用户长期看到的「错 logo」真因）。
// 根因：tray.ts 在所有平台都把 build/tray-icon.png(PNG) 喂给 systray2；
//   但 systray2 文档明确「.png on macOS/Linux, .ico on Windows」——
//   Windows 托盘二进制不认 PNG → 托盘 logo 渲染失败（空白/默认）。
//   exe 应用图标是对的（另一条路径），错的只有托盘这条独立路径。
// 修法：按平台选图标——win32 用 build/icon.ico（已验证的蓝 logo 多分辨率 ICO），
//   darwin/linux 用 build/tray-icon.png。抽成纯函数 trayIconCandidates 便于单测。

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { trayIconCandidates } from '../tray';

describe('trayIconCandidates — 按平台选托盘图标格式', () => {
  const dirname = '/app/dist';
  const cwd = '/app';
  const execDir = '/install';

  it('win32 用 .ico（systray2 Windows 二进制只认 ICO，喂 PNG 渲染失败）', () => {
    const candidates = trayIconCandidates('win32', dirname, cwd, execDir);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.endsWith('.ico')).toBe(true);
    }
    // 复用已验证的应用图标 build/icon.ico（蓝 logo），不再用裁切的 wordmark png
    expect(candidates.some((c) => c.endsWith(path.join('build', 'icon.ico')))).toBe(true);
  });

  it('darwin 用 .png（macOS 托盘要 PNG）', () => {
    const candidates = trayIconCandidates('darwin', dirname, cwd, execDir);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.endsWith('.png')).toBe(true);
    }
  });

  it('linux 用 .png', () => {
    const candidates = trayIconCandidates('linux', dirname, cwd, execDir);
    for (const c of candidates) {
      expect(c.endsWith('.png')).toBe(true);
    }
  });

  it('候选路径覆盖 snapshot/cwd/exe 三处（pkg 虚拟 FS + 真实 FS 兼容）', () => {
    const candidates = trayIconCandidates('win32', dirname, cwd, execDir);
    expect(candidates.length).toBe(3);
    // 三处都指向 build/<图标>；candidate[0] 是 snapshot（dirname/../build），cwd/exe 不含 ..
    for (const c of candidates) {
      expect(c.endsWith(path.join('build', 'icon.ico'))).toBe(true);
    }
    expect(candidates[1]).toBe(path.join(cwd, 'build', 'icon.ico'));
    expect(candidates[2]).toBe(path.join(execDir, 'build', 'icon.ico'));
  });
});
