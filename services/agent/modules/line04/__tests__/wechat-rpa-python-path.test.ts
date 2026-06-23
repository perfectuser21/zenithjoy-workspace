// modules/line04/__tests__/wechat-rpa-python-path.test.ts
//
// 回归测试 — getPythonExeForTest 必须能从 ZENITHJOY_CORE_DIR 读到 python-embedded
//
// 背景：2026-06-09 发现 line04 模块目录无 python-embedded，getPythonExe() 回退到
// 'python3'（Windows 上不存在），listen_chat.py 从未 spawn，Dashboard 永远显示"未找到微信"。
// 修法：getPythonExeForTest 新增第二查找路径 process.env.ZENITHJOY_CORE_DIR/python-embedded/python.exe

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { SpawnSyncReturns } from 'node:child_process';
import { getPythonExeForTest, buildListenerSpawnArgs, _listenerKillFuncs } from '../handlers/wechat-rpa';

describe('getPythonExeForTest — ZENITHJOY_CORE_DIR 回退路径', () => {
  let tmpDir: string;
  let origCoreDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-python-test-'));
    origCoreDir = process.env.ZENITHJOY_CORE_DIR;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origCoreDir === undefined) {
      delete process.env.ZENITHJOY_CORE_DIR;
    } else {
      process.env.ZENITHJOY_CORE_DIR = origCoreDir;
    }
  });

  it('模块目录有 python-embedded 时优先用模块自带 python', () => {
    const moduleDir = path.join(tmpDir, 'module');
    fs.mkdirSync(path.join(moduleDir, 'python-embedded'), { recursive: true });
    const pyExe = path.join(moduleDir, 'python-embedded', 'python.exe');
    fs.writeFileSync(pyExe, '');
    expect(getPythonExeForTest(moduleDir)).toBe(pyExe);
  });

  it('模块目录无 python-embedded，ZENITHJOY_CORE_DIR 有时用 core 的 python', () => {
    const moduleDir = path.join(tmpDir, 'module');
    fs.mkdirSync(moduleDir, { recursive: true });

    const coreDir = path.join(tmpDir, 'core');
    fs.mkdirSync(path.join(coreDir, 'python-embedded'), { recursive: true });
    const corePyExe = path.join(coreDir, 'python-embedded', 'python.exe');
    fs.writeFileSync(corePyExe, '');

    process.env.ZENITHJOY_CORE_DIR = coreDir;
    expect(getPythonExeForTest(moduleDir)).toBe(corePyExe);
  });

  it('两者都没有时，Windows 回退 python（不是 python3）', () => {
    const moduleDir = path.join(tmpDir, 'module');
    fs.mkdirSync(moduleDir, { recursive: true });
    delete process.env.ZENITHJOY_CORE_DIR;

    const result = getPythonExeForTest(moduleDir);
    if (process.platform === 'win32') {
      expect(result).toBe('python');
    } else {
      expect(result).toBe('python3');
    }
  });

  it('ZENITHJOY_CORE_DIR 设了但目录里也没有 python-embedded 时回退 python', () => {
    const moduleDir = path.join(tmpDir, 'module');
    fs.mkdirSync(moduleDir, { recursive: true });

    const emptyCore = path.join(tmpDir, 'empty-core');
    fs.mkdirSync(emptyCore, { recursive: true });
    process.env.ZENITHJOY_CORE_DIR = emptyCore;

    const result = getPythonExeForTest(moduleDir);
    if (process.platform === 'win32') {
      expect(result).toBe('python');
    } else {
      expect(result).toBe('python3');
    }
  });
});

// ── 回归测试：buildListenerSpawnArgs 必须把 agentId 传给 --agent-id（否则 Dashboard 显示"未知客户端"）──
describe('buildListenerSpawnArgs — agentId 传参回归', () => {
  it('传入 agentId 时，返回参数含 --agent-id <agentId>', () => {
    const args = buildListenerSpawnArgs('listen_chat.py', 'http://localhost:3000', 'xian-rog-agent');
    expect(args).toContain('--agent-id');
    const idx = args.indexOf('--agent-id');
    expect(args[idx + 1]).toBe('xian-rog-agent');
  });

  it('不传 agentId 时，返回参数不含 --agent-id', () => {
    const args = buildListenerSpawnArgs('listen_chat.py', 'http://localhost:3000');
    expect(args).not.toContain('--agent-id');
  });

  // ── 回归：machineId 必须传给 --machine-id（listen_chat 按它拉每客服配置，决策 143f5d00）──
  it('传入 machineId 时，返回参数含 --machine-id <machineId>', () => {
    const args = buildListenerSpawnArgs('listen_chat.py', 'http://localhost:3000', 'a-id', 'machine-xian-rog');
    const idx = args.indexOf('--machine-id');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('machine-xian-rog');
  });

  it('不传 machineId 时，返回参数不含 --machine-id（回落旧 env 真发判定）', () => {
    const args = buildListenerSpawnArgs('listen_chat.py', 'http://localhost:3000', 'a-id');
    expect(args).not.toContain('--machine-id');
  });

  it('agentId 为空字符串时，返回参数不含 --agent-id', () => {
    const args = buildListenerSpawnArgs('listen_chat.py', 'http://localhost:3000', '');
    expect(args).not.toContain('--agent-id');
  });

  it('始终包含 --middleware-url 和 --timeout', () => {
    const args = buildListenerSpawnArgs('listen_chat.py', 'http://api.example.com');
    expect(args).toContain('--middleware-url');
    expect(args).toContain('http://api.example.com');
    expect(args).toContain('--timeout');
  });
});

// ── 回归测试：startWechatListener 必须在 spawn 前查杀已有 listen_chat.py 进程 ──
// 背景：xian-pc 每次新装/重启 agent 未清理旧 listen_chat.py，同一机器出现多条心跳条目，
//       Dashboard 显示多个客户端。修法：启动前用 wmic 查出所有 listen_chat.py PID 并 taskkill。
describe('killExistingListeners — 查杀旧监听进程', () => {
  let origSpawnSync: typeof _listenerKillFuncs.spawnSyncFn;
  let origPlatform: string;

  beforeEach(() => {
    origSpawnSync = _listenerKillFuncs.spawnSyncFn;
    origPlatform = _listenerKillFuncs.platform;
    // 强制 win32，确保函数体不被 platform guard 提前 return（测试在 macOS 上跑）
    _listenerKillFuncs.platform = 'win32';
  });

  afterEach(() => {
    _listenerKillFuncs.spawnSyncFn = origSpawnSync;
    _listenerKillFuncs.platform = origPlatform;
  });

  it('wmic 返回一个 listen_chat.py PID 时，taskkill /F /PID <pid> 被调用', () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];

    _listenerKillFuncs.spawnSyncFn = (cmd: string, args: string[]) => {
      calls.push({ cmd: String(cmd), args: args.map(String) });
      if (String(cmd) === 'wmic') {
        return {
          stdout: 'ProcessId=9408\n\n',
          stderr: '',
          status: 0,
          pid: 0,
          output: [],
          signal: null,
          error: undefined,
        } as unknown as SpawnSyncReturns<string>;
      }
      return { stdout: '', stderr: '', status: 0, pid: 0, output: [], signal: null, error: undefined } as unknown as SpawnSyncReturns<string>;
    };

    _listenerKillFuncs.killExistingListeners();

    const taskkillCall = calls.find(c => c.cmd === 'taskkill');
    expect(taskkillCall).toBeDefined();
    expect(taskkillCall!.args).toContain('/PID');
    expect(taskkillCall!.args).toContain('9408');
  });

  it('wmic 返回多个 PID 时，每个都被 taskkill', () => {
    const killedPids: string[] = [];

    _listenerKillFuncs.spawnSyncFn = (cmd: string, args: string[]) => {
      if (String(cmd) === 'wmic') {
        return {
          stdout: 'ProcessId=1111\n\nProcessId=2222\n\n',
          stderr: '',
          status: 0,
          pid: 0,
          output: [],
          signal: null,
          error: undefined,
        } as unknown as SpawnSyncReturns<string>;
      }
      if (String(cmd) === 'taskkill') {
        const pidIdx = args.indexOf('/PID');
        if (pidIdx >= 0) killedPids.push(args[pidIdx + 1]);
      }
      return { stdout: '', stderr: '', status: 0, pid: 0, output: [], signal: null, error: undefined } as unknown as SpawnSyncReturns<string>;
    };

    _listenerKillFuncs.killExistingListeners();

    expect(killedPids).toContain('1111');
    expect(killedPids).toContain('2222');
  });

  it('wmic 返回空（无 listen_chat.py 进程时）不调用 taskkill', () => {
    const calls: string[] = [];

    _listenerKillFuncs.spawnSyncFn = (cmd: string) => {
      calls.push(String(cmd));
      return { stdout: '\n\n', stderr: '', status: 0, pid: 0, output: [], signal: null, error: undefined } as unknown as SpawnSyncReturns<string>;
    };

    _listenerKillFuncs.killExistingListeners();

    expect(calls).not.toContain('taskkill');
  });

  it('wmic 失败（status!=0）时不崩溃也不调用 taskkill', () => {
    const calls: string[] = [];

    _listenerKillFuncs.spawnSyncFn = (cmd: string) => {
      calls.push(String(cmd));
      return { stdout: '', stderr: 'error', status: 1, pid: 0, output: [], signal: null, error: undefined } as unknown as SpawnSyncReturns<string>;
    };

    expect(() => _listenerKillFuncs.killExistingListeners()).not.toThrow();
    expect(calls).not.toContain('taskkill');
  });
});
