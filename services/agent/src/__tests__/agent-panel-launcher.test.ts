import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import path from 'node:path';
import {
  launchAgentPanelHost, resolveAgentPanelHostExePath, __resetForTest,
} from '../agent-panel-launcher';

// xian-rog真机验证实测复现：真实zenithjoy-agent.exe核心进程从未拉起过
// apps/agent-panel-host（作战窗WPF壳），刀1所有验证全靠schtasks手动拉起WebView2窗口——
// 客户真实装机后永远看不到作战窗自动上线，PrepPRD Golden Path Step1"首次装机仪式"
// 在生产环境根本不成立。修复：ws连上中台('open')那一刻拉起 ZenithJoyAgentPanel.exe。
describe('agent-panel-launcher（核心进程拉起作战窗WPF壳）', () => {
  beforeEach(() => { __resetForTest(); });

  it('resolveAgentPanelHostExePath 拼出 <execDir>/agent-panel-host/ZenithJoyAgentPanel.exe', () => {
    expect(resolveAgentPanelHostExePath('C:\\install')).toBe(
      path.join('C:\\install', 'agent-panel-host', 'ZenithJoyAgentPanel.exe'),
    );
  });

  it('win32 且 exe 存在 → 以 detached+unref 方式拉起', () => {
    const child = { unref: vi.fn(), pid: 1234 };
    const spawnFn = vi.fn(() => child as any);
    const exists = vi.fn(() => true);

    const ok = launchAgentPanelHost({
      platform: 'win32', execDir: 'C:\\install', exists, spawnFn,
    });

    expect(ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const call = spawnFn.mock.calls[0] as unknown as [string, string[], { detached: boolean }];
    expect(call[0]).toContain('ZenithJoyAgentPanel.exe');
    expect(call[2].detached).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it('非 win32 平台 → 不拉起', () => {
    const spawnFn = vi.fn();
    const ok = launchAgentPanelHost({
      platform: 'darwin', execDir: '/x', exists: () => true, spawnFn,
    });
    expect(ok).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('exe 不存在（旧装机包/未打包作战窗）→ 不拉起，不抛异常', () => {
    const spawnFn = vi.fn();
    const ok = launchAgentPanelHost({
      platform: 'win32', execDir: 'C:\\install', exists: () => false, spawnFn,
    });
    expect(ok).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('同一进程生命周期内重复调用（ws断线重连）只拉起一次', () => {
    const spawnFn = vi.fn(() => ({ unref: vi.fn(), pid: 1 } as any));
    const exists = () => true;
    launchAgentPanelHost({
      platform: 'win32', execDir: 'C:\\install', exists, spawnFn,
    });
    launchAgentPanelHost({
      platform: 'win32', execDir: 'C:\\install', exists, spawnFn,
    });
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
