// modules/line04/__tests__/watchdog-restart-timer.test.ts
//
// Bug6 回归（1.0.108）：listen_chat.py 崩溃后 30s 重启定时器不得调用 .unref()，
// 否则 Node 进程在无其他任务时自动退出，崩溃后永不自愈。
//
// 修复前：setTimeout(...).unref?.() → Node 退出 → 客户机无人值守后彻底失联。
// 修复后：setTimeout(...) 不调 unref，定时器强制保持进程存活直到触发。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _listenerKillFuncs, startWechatListener } from '../handlers/wechat-rpa';

describe('Bug6 回归 — 崩溃自愈重启定时器不得 unref()', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;

  beforeEach(() => {
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};
  });

  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
    vi.useRealTimers();
  });

  it('exit 事件触发后，重启 setTimeout 不调 .unref()（不让 Node 提前退出）', () => {
    vi.useFakeTimers();

    const unrefSpy = vi.fn();
    const originalSetTimeout = global.setTimeout;
    // 拦截 setTimeout，检查返回的 timer 上有没有 .unref() 被调用
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(
      (fn: () => void, ms?: number) => {
        const timer = originalSetTimeout(fn, ms ?? 0) as ReturnType<typeof setTimeout> & {
          unref?: () => void;
        };
        timer.unref = unrefSpy; // 注入 spy
        return timer;
      },
    );

    let exitHandler: ((code: number | null) => void) | null = null;
    const childOn = vi.fn().mockImplementation((event: string, handler: unknown) => {
      if (event === 'exit') exitHandler = handler as (code: number | null) => void;
    });

    _listenerKillFuncs.spawnFn = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: childOn,
    })) as unknown as typeof _listenerKillFuncs.spawnFn;

    startWechatListener('http://mid/', 'agent-1');

    // 触发 exit 事件（模拟 listen_chat.py 崩溃）
    expect(exitHandler).not.toBeNull();
    exitHandler!(1);

    // 验证重启 setTimeout 被调用
    expect(setTimeoutSpy).toHaveBeenCalled();

    // 重启 timer 不得调 .unref()
    expect(unrefSpy).not.toHaveBeenCalled();
  });
});
