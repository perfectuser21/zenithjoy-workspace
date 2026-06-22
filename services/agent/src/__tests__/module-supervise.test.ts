// services/agent/src/__tests__/module-supervise.test.ts
//
// Sprint 06221906 — agent 自愈件 1：长驻模块（line04 listen_chat 宿主）进程保活。
//
// 客户机暴露的真实缺口：line04 模块子进程退出/崩溃后 ModuleManager 只是把它
// 从 active 里删掉，从不自动拉起 → 要人手动 schtasks/重启。本测试把"自动拉起 +
// 指数退避 + 上限告警"做进 agent，验证 supervise 行为。

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ModuleManager } from '../module-manager';

// 构造一个可控的假子进程：on/send/kill + 手动触发 exit。
function makeFakeChild(): { child: import('node:child_process').ChildProcess; emit: (code: number) => void } {
  const ee = new EventEmitter();
  const child = {
    on: (ev: string, cb: (...a: unknown[]) => void) => ee.on(ev, cb),
    send: vi.fn(),
    kill: vi.fn(),
    connected: true,
  } as unknown as import('node:child_process').ChildProcess;
  return { child, emit: (code: number) => ee.emit('exit', code) };
}

function installModule(root: string, version = '1.0.0'): void {
  const dir = path.join(root, `line04-wechat-cs-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), '');
}

describe('ModuleManager — 长驻模块保活（supervise）', () => {
  function mkRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'zj-supervise-'));
  }

  it('受监管模块子进程退出后自动重启（自动拉起，不靠外部 watchdog）', async () => {
    const root = mkRoot();
    installModule(root);

    const children = [makeFakeChild(), makeFakeChild()];
    let idx = 0;
    const forkImpl = vi.fn(() => children[idx++].child);
    const scheduled: Array<() => void> = [];
    const setTimeoutImpl = vi.fn((fn: () => void) => {
      scheduled.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl: async () => ({ ok: true }),
      superviseLines: ['line04-wechat-cs'],
      setTimeoutImpl,
    });

    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });
    expect(forkImpl).toHaveBeenCalledTimes(1);

    // 第一个子进程崩溃退出
    children[0].emit(1);
    // 应排程一次重启（退避后执行）
    expect(setTimeoutImpl).toHaveBeenCalledTimes(1);
    // 触发排程的重启回调
    scheduled[0]();
    expect(forkImpl).toHaveBeenCalledTimes(2);
  });

  it('连续崩溃时退避指数增长（base * 2^n）', async () => {
    const root = mkRoot();
    installModule(root);

    // 每个 fork 出来的子进程一注册 exit handler 就立即崩溃（模拟"起来就死"的连环崩溃），
    // 配合 setTimeoutImpl 立即执行重启 → 链式触发，观察退避序列。
    const crashOnExit = () => {
      const child = {
        on: (ev: string, cb: (...a: unknown[]) => void) => {
          if (ev === 'exit') setTimeout(() => cb(1), 0); // 异步崩溃，避开重入
        },
        send: vi.fn(),
        kill: vi.fn(),
        connected: true,
      } as unknown as import('node:child_process').ChildProcess;
      return child;
    };
    const forkImpl = vi.fn(() => crashOnExit());
    const delays: number[] = [];
    const setTimeoutImpl = vi.fn((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      if (delays.length < 4) fn(); // 触发前几次重启即可观察退避增长
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl: async () => ({ ok: true }),
      superviseLines: ['line04-wechat-cs'],
      restartBaseDelayMs: 1000,
      restartMaxDelayMs: 60_000,
      restartMaxRetries: 10,
      setTimeoutImpl,
    });

    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });
    // 等首个子进程异步崩溃事件 + 链式重启完成
    await new Promise((r) => setTimeout(r, 20));

    // 退避序列必须指数增长：1000, 2000, 4000 ...
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
  });

  it('退避不超过上限 restartMaxDelayMs', async () => {
    const root = mkRoot();
    installModule(root);

    const made: Array<{ child: import('node:child_process').ChildProcess; emit: (c: number) => void }> = [];
    const forkImpl = vi.fn(() => {
      const c = makeFakeChild();
      made.push(c);
      return c.child;
    });
    const delays: number[] = [];
    const setTimeoutImpl = vi.fn((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      if (delays.length < 8) fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl: async () => ({ ok: true }),
      superviseLines: ['line04-wechat-cs'],
      restartBaseDelayMs: 1000,
      restartMaxDelayMs: 5000,
      restartMaxRetries: 20,
      setTimeoutImpl,
    });

    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });
    made[0].emit(1);

    // 全部退避值不得超过 5000
    expect(Math.max(...delays)).toBeLessThanOrEqual(5000);
  });

  it('崩溃次数超过 restartMaxRetries → 停止重启并上报告警（onModuleAlert）', async () => {
    const root = mkRoot();
    installModule(root);

    const made: Array<{ child: import('node:child_process').ChildProcess; emit: (c: number) => void }> = [];
    const forkImpl = vi.fn(() => {
      const c = makeFakeChild();
      made.push(c);
      return c.child;
    });
    const setTimeoutImpl = vi.fn((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const onModuleAlert = vi.fn();

    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl: async () => ({ ok: true }),
      superviseLines: ['line04-wechat-cs'],
      restartBaseDelayMs: 1,
      restartMaxRetries: 3,
      setTimeoutImpl,
      onModuleAlert,
    });

    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });
    // 触发首个崩溃，setTimeoutImpl 立即执行重启 → 新 child 又会被下面循环崩溃
    made[0].emit(1);
    // 持续崩溃直到超过上限
    let guard = 0;
    while (onModuleAlert.mock.calls.length === 0 && guard < 50) {
      const last = made[made.length - 1];
      last.emit(1);
      guard++;
    }

    expect(onModuleAlert).toHaveBeenCalled();
    const alertArgs = onModuleAlert.mock.calls[0];
    expect(alertArgs[0]).toBe('line04-wechat-cs');
    // 告警后 module_status 标记 ok:false + 含 restart 上限信息
    const report = mm.getModuleStatusReport()['line04-wechat-cs'];
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/重启|restart/i);
  });

  it('非受监管模块退出不触发重启（保持原行为）', async () => {
    const root = mkRoot();
    const dir = path.join(root, 'line01-publish-1.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line01-publish', version: '1.0.0', entry: 'index.js' }),
    );
    fs.writeFileSync(path.join(dir, 'index.js'), '');

    const c = makeFakeChild();
    const forkImpl = vi.fn(() => c.child);
    const setTimeoutImpl = vi.fn();

    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl: async () => ({ ok: true }),
      superviseLines: ['line04-wechat-cs'], // line01 不在监管名单
      setTimeoutImpl,
    });

    await mm.syncModules({ 'line01-publish': { status: 'active', required_version: '1.0.0' } });
    c.emit(0);

    expect(setTimeoutImpl).not.toHaveBeenCalled();
    expect(mm.getActiveModules()).not.toContain('line01-publish');
  });

  it('升级 kill 旧 fork 不被 supervise 当成崩溃重启（intentional kill 抑制自愈）', async () => {
    const root = mkRoot();
    installModule(root, '1.0.7');

    const oldC = makeFakeChild();
    const newC = makeFakeChild();
    let idx = 0;
    const forks = [oldC.child, newC.child];
    const forkImpl = vi.fn(() => forks[idx++]);
    const downloadImpl = vi.fn(async (_l: string, version: string, _u: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(
        path.join(destDir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }),
      );
      fs.writeFileSync(path.join(destDir, 'index.js'), '');
    });
    const setTimeoutImpl = vi.fn();

    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      downloadImpl,
      preflightImpl: async () => ({ ok: true }),
      superviseLines: ['line04-wechat-cs'],
      setTimeoutImpl,
    });

    // 先激活 1.0.7
    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.7' } });
    // 升级到 1.0.8：syncModules 会 kill 旧 fork。模拟 kill 引发的 exit 事件
    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.8' } });
    oldC.emit(0); // 旧进程被 kill 后发出的 exit

    // 旧进程的 exit 不应触发额外重启排程（intentional kill）
    expect(setTimeoutImpl).not.toHaveBeenCalled();
    // 新版本已经 fork 激活
    expect(forkImpl).toHaveBeenCalledTimes(2);
  });
});
