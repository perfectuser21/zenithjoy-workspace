// modules/line04/__tests__/wechat-rpa-desktop-lease-log.test.ts
//
// 回归测试 — startWechatListener() 必须把 stderr 内容（含 desktop-lease-broker 的
// [desktop_lease] 诊断日志）落盘，不能只 console.warn。
//
// 背景：PR#1096 把 appendListenChatLog 加进了 services/agent/src/handlers/wechat-rpa.ts
// （@deprecated，Core 不再直接 import），真实客户机运行的是这份独立维护的模块文件，
// 之前完全没有落盘逻辑——这条测试防止未来再次"改对了逻辑但改错了文件"。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _listenerKillFuncs, startWechatListener, appendListenChatLog } from '../handlers/wechat-rpa';

describe('appendListenChatLog（模块内自包含实现）[BEHAVIOR]', () => {
  let tmpDir: string;
  let origAppData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-module-log-test-'));
    origAppData = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
  });

  afterEach(() => {
    if (origAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = origAppData;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入 chunk 后日志文件包含该内容', () => {
    appendListenChatLog('[desktop_lease] acquire granted lease_id=test-001\n');

    const logFile = path.join(tmpDir, 'zenithjoy-agent', 'logs', 'listen-chat.log');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain(
      '[desktop_lease] acquire granted lease_id=test-001',
    );
  });

  it('超过轮转阈值 → 旧内容进 .old，新内容进新文件', () => {
    const logDir = path.join(tmpDir, 'zenithjoy-agent', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    fs.writeFileSync(logFile, 'OLD_CONTENT_MARKER'.repeat(10));

    appendListenChatLog('NEW_LINE_AFTER_ROTATE\n', { maxBytes: 50 });

    const oldFile = path.join(logDir, 'listen-chat.log.old');
    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.readFileSync(oldFile, 'utf-8')).toContain('OLD_CONTENT_MARKER');
    const newContent = fs.readFileSync(logFile, 'utf-8');
    expect(newContent).toContain('NEW_LINE_AFTER_ROTATE');
    expect(newContent).not.toContain('OLD_CONTENT_MARKER');
  });

  it('写入失败（mock fs.appendFileSync 抛异常）不向上抛出', () => {
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    expect(() => appendListenChatLog('irrelevant\n')).not.toThrow();
    spy.mockRestore();
  });
});

describe('startWechatListener — stderr 必须调用 appendListenChatLog（真实部署路径接线）[ARTIFACT 防回归]', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;
  let tmpDir: string;
  let origAppData: string | undefined;

  beforeEach(() => {
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-module-log-test2-'));
    origAppData = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
  });

  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
    if (origAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = origAppData;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stderr data 事件触发时，内容被落盘到 listen-chat.log', () => {
    let capturedHandler: ((d: Buffer) => void) | undefined;

    _listenerKillFuncs.spawnFn = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event: string, handler: (d: Buffer) => void) => {
          if (event === 'data') capturedHandler = handler;
        }),
      },
      on: vi.fn(),
    })) as unknown as typeof _listenerKillFuncs.spawnFn;

    startWechatListener('http://localhost:3000', 'test-agent');

    expect(capturedHandler).toBeDefined();
    capturedHandler!(Buffer.from('[desktop_lease] acquire granted lease_id=abc\n'));

    const logFile = path.join(tmpDir, 'zenithjoy-agent', 'logs', 'listen-chat.log');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain('[desktop_lease] acquire granted lease_id=abc');
  });
});
