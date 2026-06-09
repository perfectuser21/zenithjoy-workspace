// modules/line04/__tests__/preflight.test.ts
//
// line04 模块 preflight — TDD commit-1（红）。
// 覆盖：微信版本比较纯函数 / 注册表解析 / 非 Windows 不崩溃 / fixGuide 含 COS URL。

import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import {
  isWechatVersionSupported,
  parseVersionParts,
  parseWechatVersionFromRegOutput,
  wechatFixGuide,
  pywinautoFixGuide,
  memoryFixGuide,
  WECHAT_DOWNLOAD_URL,
  runPreflight,
  getModulePython,
  checkWechatRunning,
} from '../preflight';

// checkWechatRunning 使用 node:child_process execSync，用 vi.mock 提升 mock（ESM 限制）
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
  };
});
import { execSync } from 'node:child_process';

describe('微信版本比较（纯函数，<= 4.1.8.x 为支持）', () => {
  it('4.1.8.107 等于上限 → 支持', () => {
    expect(isWechatVersionSupported('4.1.8.107')).toBe(true);
  });
  it('4.1.8 → 支持', () => {
    expect(isWechatVersionSupported('4.1.8')).toBe(true);
  });
  it('4.1.7.25 低于上限 → 支持', () => {
    expect(isWechatVersionSupported('4.1.7.25')).toBe(true);
  });
  it('4.1.9 → 不支持', () => {
    expect(isWechatVersionSupported('4.1.9')).toBe(false);
  });
  it('4.1.10 → 不支持（砍掉 UIA 控件树）', () => {
    expect(isWechatVersionSupported('4.1.10.0')).toBe(false);
  });
  it('4.2.0 → 不支持', () => {
    expect(isWechatVersionSupported('4.2.0')).toBe(false);
  });
  it('3.9.12.19 旧版 → 支持', () => {
    expect(isWechatVersionSupported('3.9.12.19')).toBe(true);
  });
  it('parseVersionParts 缺失段按 0 处理', () => {
    expect(parseVersionParts('4.1')).toEqual([4, 1]);
    expect(parseVersionParts('4.x.8')).toEqual([4, 0, 8]);
  });
});

describe('注册表输出解析（mock reg query stdout）', () => {
  it('解析 REG_SZ 字符串版本', () => {
    const out =
      '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Tencent\\WeChat\r\n    Version    REG_SZ    4.1.8.107\r\n';
    expect(parseWechatVersionFromRegOutput(out)).toBe('4.1.8.107');
  });
  it('解析 REG_DWORD 编码版本（4.1.8.107 = 0x6401086b）', () => {
    const out = '    Version    REG_DWORD    0x6401086b';
    expect(parseWechatVersionFromRegOutput(out)).toBe('4.1.8.107');
  });
  it('无 Version 字段返回 null', () => {
    expect(parseWechatVersionFromRegOutput('一些无关输出')).toBeNull();
  });
});

describe('fixGuide 中文修复指引', () => {
  it('微信版本 fixGuide 含 COS 旧版下载地址 + 版本号', () => {
    const guide = wechatFixGuide('4.1.10');
    expect(guide).toContain('4.1.10');
    expect(guide).toContain('4.1.8');
    expect(guide).toContain(WECHAT_DOWNLOAD_URL);
    expect(WECHAT_DOWNLOAD_URL).toContain('cos.accelerate.myqcloud.com');
    expect(WECHAT_DOWNLOAD_URL).toContain('WeChatWin_4.1.8.exe');
  });
  it('pywinauto fixGuide 含错误信息 + 联系技术支持', () => {
    const guide = pywinautoFixGuide('No module named pywinauto');
    expect(guide).toContain('pywinauto');
    expect(guide).toContain('No module named pywinauto');
    expect(guide).toContain('技术支持');
  });
  it('内存 fixGuide 含 4GB + 关闭其他程序', () => {
    const guide = memoryFixGuide();
    expect(guide).toContain('4GB');
    expect(guide).toContain('关闭其他程序');
  });
});

describe('runPreflight 跨平台行为', () => {
  it('返回结构化结果（checks + ok 为 boolean）', async () => {
    const r = await runPreflight(os.tmpdir());
    expect(r).toHaveProperty('checks');
    expect(typeof r.ok).toBe('boolean');
  });

  it('非 Windows 平台不崩溃且返回 ok:true', async () => {
    if (process.platform === 'win32') return; // 仅在非 Windows 断言
    const r = await runPreflight(os.tmpdir());
    expect(r.ok).toBe(true);
    expect(r.checks.wechat_version).toBe(true);
    expect(r.checks.pywinauto).toBe(true);
    expect(r.checks.memory).toBe(true);
    expect(r.fixGuide).toBeUndefined();
  });
});

describe('getModulePython — ZENITHJOY_CORE_DIR 回退', () => {
  afterEach(() => {
    delete process.env.ZENITHJOY_CORE_DIR;
    vi.restoreAllMocks();
  });

  it('module 自带 python-embedded 优先', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('python-embedded') && String(p).includes('moduleDir')
    );
    const result = getModulePython('/moduleDir');
    expect(result).toContain('moduleDir');
    expect(result).toContain('python.exe');
  });

  it('module 无 embedded 时回退到 ZENITHJOY_CORE_DIR', () => {
    process.env.ZENITHJOY_CORE_DIR = '/coreDir';
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('coreDir') && String(p).includes('python-embedded')
    );
    const result = getModulePython('/moduleDir');
    expect(result).toContain('coreDir');
    expect(result).toContain('python.exe');
  });

  it('两者都没有时 win32 回退到 "python"', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const result = getModulePython('/moduleDir');
    Object.defineProperty(process, 'platform', origPlatform!);
    expect(result).toBe('python');
  });
});

describe('checkWechatRunning — 微信进程检测（软检测）', () => {
  afterEach(() => vi.mocked(execSync).mockRestore());

  it('非 Windows 跳过，返回 ok:true skipped:true', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', origPlatform!);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('tasklist 输出含 WeChat.exe → ok:true 无 fixGuide', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockReturnValue(
      'WeChat.exe   1234 Console   1   12,345 K\r\n' as any
    );
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', origPlatform!);
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toBeUndefined();
  });

  it('tasklist 无 WeChat.exe → ok:true + fixGuide 含"请打开微信"', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockReturnValue(
      'INFO: 没有运行的任务匹配指定标准。\r\n' as any
    );
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', origPlatform!);
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toContain('请打开微信');
  });

  it('execSync 抛出 → ok:true + fixGuide', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockImplementation(() => { throw new Error('cmd fail'); });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', origPlatform!);
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toContain('请打开微信');
  });
});
