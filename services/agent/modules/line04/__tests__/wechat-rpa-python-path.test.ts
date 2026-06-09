// modules/line04/__tests__/wechat-rpa-python-path.test.ts
//
// 回归测试 — getPythonExeForTest 必须能从 ZENITHJOY_CORE_DIR 读到 python-embedded
//
// 背景：2026-06-09 发现 line04 模块目录无 python-embedded，getPythonExe() 回退到
// 'python3'（Windows 上不存在），listen_chat.py 从未 spawn，Dashboard 永远显示"未找到微信"。
// 修法：getPythonExeForTest 新增第二查找路径 process.env.ZENITHJOY_CORE_DIR/python-embedded/python.exe

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getPythonExeForTest } from '../handlers/wechat-rpa';

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
