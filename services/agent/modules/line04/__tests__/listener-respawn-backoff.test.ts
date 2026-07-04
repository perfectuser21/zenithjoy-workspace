// modules/line04/__tests__/listener-respawn-backoff.test.ts
//
// Task 13a — 监听 watchdog：spawn 级 error 也要重拉（不能只 exit 分支重拉）。
//
// 缺口（会议室实锤链路之一）：child.on('error') 只置 _listenerAlive=false 打日志，不重拉 →
// spawn 级失败（可执行文件缺失/权限）监听永久死。
// 修复：抽出 scheduleListenerRespawn 供 exit 与 error 共用，带连续失败退避 30→60→120→上限 300s，
// 子进程存活超 10 分钟后退避计数器重置。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _listenerKillFuncs, startWechatListener, _resetListenerBackoff } from '../handlers/wechat-rpa';

interface MockChild {
  handlers: Record<string, (...args: unknown[]) => void>;
  fire: (event: string, ...args: unknown[]) => void;
}

describe('startWechatListener — watchdog 重拉 + 退避（error 分支不再永久死）', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;
  let children: MockChild[];

  beforeEach(() => {
    vi.useFakeTimers();
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};
    _resetListenerBackoff();

    children = [];
    _listenerKillFuncs.spawnFn = vi.fn(() => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb;
        }),
      };
      children.push({ handlers, fire: (e, ...a) => handlers[e]?.(...a) });
      return child as unknown as ReturnType<typeof _listenerKillFuncs.spawnFn>;
    }) as unknown as typeof _listenerKillFuncs.spawnFn;
  });

  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
    vi.useRealTimers();
  });

  function spawnCalls(): number {
    return (_listenerKillFuncs.spawnFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  }

  it('spawn 触发 error → 30s 后重新 spawn（不再永久死）', () => {
    startWechatListener('http://localhost:3000', 'test-agent');
    expect(spawnCalls()).toBe(1);

    children[0].fire('error', new Error('spawn ENOENT'));

    vi.advanceTimersByTime(29_999);
    expect(spawnCalls()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(2);
  });

  it('连续 error → 退避间隔 30→60→120→300 递增到上限', () => {
    startWechatListener('http://localhost:3000', 'test-agent');
    expect(spawnCalls()).toBe(1);

    // 第 1 次失败 → 30s
    children[0].fire('error', new Error('e1'));
    vi.advanceTimersByTime(30_000);
    expect(spawnCalls()).toBe(2);

    // 第 2 次失败 → 60s
    children[1].fire('error', new Error('e2'));
    vi.advanceTimersByTime(59_999);
    expect(spawnCalls()).toBe(2);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(3);

    // 第 3 次失败 → 120s
    children[2].fire('error', new Error('e3'));
    vi.advanceTimersByTime(119_999);
    expect(spawnCalls()).toBe(3);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(4);

    // 第 4 次失败 → 300s（上限）
    children[3].fire('error', new Error('e4'));
    vi.advanceTimersByTime(299_999);
    expect(spawnCalls()).toBe(4);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(5);

    // 第 5 次失败 → 仍 300s（不再增长）
    children[4].fire('error', new Error('e5'));
    vi.advanceTimersByTime(299_999);
    expect(spawnCalls()).toBe(5);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(6);
  });

  it('exit 与 error 走同一调度（exit 现有行为不回归，仍 30s 重拉）', () => {
    startWechatListener('http://localhost:3000', 'test-agent');
    expect(spawnCalls()).toBe(1);

    children[0].fire('exit', 1);
    vi.advanceTimersByTime(29_999);
    expect(spawnCalls()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(2);
  });

  it('同一 child 先 error 再 exit → 只调度一次重拉（防重入）', () => {
    startWechatListener('http://localhost:3000', 'test-agent');
    expect(spawnCalls()).toBe(1);

    // 一个 child 崩溃时常同时触发 error 和 exit（先 error 后 exit）。无防重入会排两次重拉。
    children[0].fire('error', new Error('boom'));
    children[0].fire('exit', 1);

    // 推进足够长（覆盖两档退避 30s + 60s），若重复调度会多 spawn 一次。
    vi.advanceTimersByTime(300_000);
    expect(spawnCalls()).toBe(2); // 只多拉起一次，不是两次
  });

  it('子进程存活超 10 分钟后退避计数器重置（下次失败回到 30s）', () => {
    startWechatListener('http://localhost:3000', 'test-agent');

    // 先一次失败把退避推到第 2 档（60s）
    children[0].fire('error', new Error('e1'));
    vi.advanceTimersByTime(30_000);
    expect(spawnCalls()).toBe(2);

    // child2 存活 11 分钟（无失败），再失败 → 计数器应已重置 → 回到 30s 而非 60s
    vi.advanceTimersByTime(11 * 60_000);
    children[1].fire('error', new Error('e2-after-healthy'));
    vi.advanceTimersByTime(29_999);
    expect(spawnCalls()).toBe(2);
    vi.advanceTimersByTime(1);
    expect(spawnCalls()).toBe(3);
  });
});
