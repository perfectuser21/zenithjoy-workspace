// modules/line04/__tests__/wechat-rpa-listener-stdout.test.ts
//
// 回归测试 — startWechatListener() 必须注册 child.stdout.on('data') handler
//
// 背景：2026-06-16 发现 spawnOnce() stdio: ['ignore', 'pipe', 'pipe'] 开了 stdout pipe，
// 但父进程从未注册 stdout.on('data', ...) 消费它。64KB OS pipe buffer 积满后
// Python 进程 block 在 stdout.write()，listen_chat 冻结不回复（机子二 直接没反应根因）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _listenerKillFuncs, startWechatListener } from '../handlers/wechat-rpa';

describe('startWechatListener — stdout pipe 必须被消费（防 64KB buffer 积满冻结进程）', () => {
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
  });

  it('spawn 后必须注册 child.stdout.on("data") handler，防止 pipe buffer 满后 Python 进程冻结', () => {
    const stdoutOn = vi.fn();
    const stderrOn = vi.fn();
    const childOn = vi.fn();

    _listenerKillFuncs.spawnFn = vi.fn(() => ({
      stdout: { on: stdoutOn },
      stderr: { on: stderrOn },
      on: childOn,
    })) as unknown as typeof _listenerKillFuncs.spawnFn;

    startWechatListener('http://localhost:3000', 'test-agent');

    expect(stdoutOn).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('同时仍须注册 child.stderr.on("data") handler（回归保证，不能因修复 stdout 而删掉 stderr）', () => {
    const stdoutOn = vi.fn();
    const stderrOn = vi.fn();
    const childOn = vi.fn();

    _listenerKillFuncs.spawnFn = vi.fn(() => ({
      stdout: { on: stdoutOn },
      stderr: { on: stderrOn },
      on: childOn,
    })) as unknown as typeof _listenerKillFuncs.spawnFn;

    startWechatListener('http://localhost:3000');

    expect(stderrOn).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('stdout data 事件触发时，内容以 [listen_chat] 前缀转发到 console.log', () => {
    let capturedHandler: ((d: Buffer) => void) | undefined;

    _listenerKillFuncs.spawnFn = vi.fn(() => ({
      stdout: {
        on: vi.fn((event: string, handler: (d: Buffer) => void) => {
          if (event === 'data') capturedHandler = handler;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    })) as unknown as typeof _listenerKillFuncs.spawnFn;

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    startWechatListener('http://localhost:3000');

    expect(capturedHandler).toBeDefined();
    capturedHandler!(Buffer.from('[listen_chat] 检测到新消息\n'));
    expect(consoleSpy).toHaveBeenCalledWith('[listen_chat]', '[listen_chat] 检测到新消息');

    consoleSpy.mockRestore();
  });
});
