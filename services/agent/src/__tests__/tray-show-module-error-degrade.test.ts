// services/agent/src/__tests__/tray-show-module-error-degrade.test.ts
//
// Review 跟进（PR #815）— 补真验 showModuleError 的「降级红点」分支。
//
// 原 sprint 合约测试只做静态 grep（断言源码里有 'node-notifier'/没有 'powershell'），
// 没真跑过 showModuleError。本测试真调用该函数，覆盖 node-notifier 不可用时的降级路径：
//   1. 注入一个必失败的 _notifierHook.notify（等价 node-notifier 缺失/原生通知调用失败）
//   2. 断言：写入了 lastModuleError（经重建路径渲染 🔴 红点）
//   3. 断言：触发了 _trayRebuildHook.invoke（让红点菜单项可见）
//   4. 断言：没有 spawn 任何子进程（尤其没 spawn powershell）—— 去黑窗硬保证
//
// 关键：CJS 下 vi.mock 拦不到源码内的 require('node-notifier')，故源码把通知发送抽成可注入的
// _notifierHook，测试注入 throw 实现来确定性触发降级分支。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 用 mock 模块替换 node:child_process，所有子进程入口换成可断言的 spy。
// （ESM 下不能直接 vi.spyOn(namespace) —— 见 vitest ESM 限制；必须整体 mock 模块。）
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  spawnSync: vi.fn(),
  execSync: vi.fn(),
}));

import * as child_process from 'node:child_process';
import * as trayModule from '../tray';

const {
  showModuleError,
  _resetTrayStateForTest,
  _setHandlersForTest,
  _trayRebuildHook,
  _notifierHook,
} = trayModule;

const makeHandlers = () => ({
  version: '2.0.1',
  agentId: 'test-agent',
  onRestart: vi.fn(),
  onQuit: vi.fn(),
});

describe('showModuleError — node-notifier 不可用时的降级红点路径', () => {
  let originalInvoke: typeof _trayRebuildHook.invoke;
  let originalNotify: typeof _notifierHook.notify;
  // 所有子进程入口（已被 vi.mock 换成 spy），断言降级路径绝不 spawn 任何外部进程（尤其 powershell）
  const cp = child_process as unknown as Record<string, ReturnType<typeof vi.fn>>;
  let notifySpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetTrayStateForTest();
    vi.clearAllMocks();
    // 替换重建 hook，避免真实 systray2 启动；同时可断言它被调用
    originalInvoke = _trayRebuildHook.invoke;
    _trayRebuildHook.invoke = vi.fn();

    // 注入「必失败」的原生通知 —— 等价 node-notifier 不可用，确定性命中降级分支
    originalNotify = _notifierHook.notify;
    notifySpy = vi.fn(() => {
      throw new Error('node-notifier 不可用（测试模拟）');
    });
    _notifierHook.notify = notifySpy as typeof _notifierHook.notify;

    // 静音降级路径的 console.warn（兜底日志），保持测试输出干净
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    _trayRebuildHook.invoke = originalInvoke;
    _notifierHook.notify = originalNotify;
    vi.restoreAllMocks();
    _resetTrayStateForTest();
  });

  const expectNoSubprocess = () => {
    expect(cp.spawn).not.toHaveBeenCalled();
    expect(cp.exec).not.toHaveBeenCalled();
    expect(cp.execFile).not.toHaveBeenCalled();
    expect(cp.spawnSync).not.toHaveBeenCalled();
    expect(cp.execSync).not.toHaveBeenCalled();
  };

  it('node-notifier 抛错时：记录 lastModuleError + 触发重建红点 + 绝不 spawn 子进程', () => {
    const handlers = makeHandlers();
    _setHandlersForTest(handlers);

    expect(() => showModuleError('私域AI客服', '缺少 Python 运行时')).not.toThrow();

    // 0. 先尝试了原生通知（首选路径），失败后才降级
    expect(notifySpy).toHaveBeenCalledOnce();

    // 1. 降级态被记录（startTray 会据此渲染 🔴 红点菜单项）
    expect(trayModule._getLastModuleErrorForTest()).toBe(
      '「私域AI客服」无法启用：缺少 Python 运行时',
    );

    // 2. 沿用既有重建路径让红点可见，传入正确 handlers
    expect(_trayRebuildHook.invoke).toHaveBeenCalledOnce();
    expect(_trayRebuildHook.invoke).toHaveBeenCalledWith(handlers);

    // 3. 没有 spawn 任何子进程（尤其没 powershell 黑窗）
    expectNoSubprocess();
  });

  it('headless（handlers 为 null）时降级仍不崩溃、不重建、不 spawn', () => {
    // 不设置 handlers —— 模拟容器/headless

    expect(() => showModuleError('智能发布', 'systray2 不可用')).not.toThrow();

    // lastModuleError 仍被记录，将来 startTray 时仍可渲染红点
    expect(trayModule._getLastModuleErrorForTest()).toBe('「智能发布」无法启用：systray2 不可用');
    // handlers 为 null → 不触发重建
    expect(_trayRebuildHook.invoke).not.toHaveBeenCalled();
    // 任何子进程入口都未被触碰
    expectNoSubprocess();
  });
});
