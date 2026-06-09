// modules/line04/__tests__/preflight.test.ts
//
// line04 模块 preflight — TDD commit-1（红）。
// 覆盖：微信版本比较纯函数 / 注册表解析 / 非 Windows 不崩溃 / fixGuide 含 COS URL。

import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import https from 'node:https';
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
  downloadFile,
  installWeChat,
  installPywinauto,
  autoRepair,
  _repairFuncs,
} from '../preflight';
// checkWechatRunning 使用 node:child_process execSync，用 vi.mock 提升 mock（ESM 限制）
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
    spawnSync: vi.fn(actual.spawnSync),  // Task 3 新增
  };
});
import { execSync } from 'node:child_process';
import * as childProcessModule from 'node:child_process';

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
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const result = getModulePython('/moduleDir');
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(result).toBe('python');
  });
});

describe('checkWechatRunning — 微信进程检测（软检测）', () => {
  afterEach(() => vi.mocked(execSync).mockReset());

  it('非 Windows 跳过，返回 ok:true skipped:true', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('tasklist 输出含 WeChat.exe → ok:true 无 fixGuide', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockReturnValue(
      'WeChat.exe   1234 Console   1   12,345 K\r\n' as any
    );
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toBeUndefined();
  });

  it('WeChat.exe 无匹配，WeChatAppEx.exe 有匹配 → ok:true 无 fixGuide（4.1.8 实际常驻进程）', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      if (String(cmd).includes('WeChatAppEx.exe')) {
        return 'WeChatAppEx.exe   16948 Console   1   167,140 K\r\n' as any;
      }
      return 'INFO: 没有运行的任务匹配指定标准。\r\n' as any;
    });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toBeUndefined();
  });

  it('WeChat.exe 和 WeChatAppEx.exe 均无匹配 → ok:true + fixGuide 含"请打开微信"', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockReturnValue(
      'INFO: 没有运行的任务匹配指定标准。\r\n' as any
    );
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toContain('请打开微信');
  });

  it('execSync 抛出 → ok:true + fixGuide', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockImplementation(() => { throw new Error('cmd fail'); });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toContain('请打开微信');
  });
});

describe('installWeChat — 下载并静默安装微信 4.1.8', () => {
  afterEach(() => vi.restoreAllMocks());

  it('spawn 参数含 /S 静默标志', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url: any, cb: any) => {
      const fakeRes = {
        pipe: vi.fn(),
        on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); return fakeRes; },
      } as any;
      setImmediate(() => cb(fakeRes));
      return { on: vi.fn() } as any;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {}; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installWeChat(os.tmpdir());

    const firstCall = spawnSyncMock.mock.calls[0];
    expect(String(firstCall[0])).toContain('WeChatWin_4.1.8.exe');
    expect(firstCall[1]).toContain('/S');
  });

  it('安装后 taskkill WeChat.exe', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url: any, cb: any) => {
      const fakeRes = {
        pipe: vi.fn(),
        on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); return fakeRes; },
      } as any;
      setImmediate(() => cb(fakeRes));
      return { on: vi.fn() } as any;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {}; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installWeChat(os.tmpdir());

    const allArgs = spawnSyncMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' ').toLowerCase());
    expect(allArgs.some((a) => a.includes('taskkill') && a.includes('wechat.exe'))).toBe(true);
  });
});

describe('installPywinauto — get-pip + pip install 清华源', () => {
  afterEach(() => vi.restoreAllMocks());

  it('先运行 get-pip.py 再 pip install pywinauto', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url: any, cb: any) => {
      const fakeRes = {
        pipe: vi.fn(),
        on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); return fakeRes; },
      } as any;
      setImmediate(() => cb(fakeRes));
      return { on: vi.fn() } as any;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {}; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installPywinauto('python.exe', os.tmpdir());

    const allArgs = spawnSyncMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' '));
    expect(allArgs.some((a) => a.includes('get-pip.py'))).toBe(true);
    expect(allArgs.some((a) => a.includes('pywinauto'))).toBe(true);
  });

  it('pip install 使用清华镜像源', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url: any, cb: any) => {
      const fakeRes = {
        pipe: vi.fn(),
        on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); return fakeRes; },
      } as any;
      setImmediate(() => cb(fakeRes));
      return { on: vi.fn() } as any;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {}; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installPywinauto('python.exe', os.tmpdir());

    const pipCall = spawnSyncMock.mock.calls.find((c) => (c[1] ?? []).includes('pywinauto'));
    expect((pipCall?.[1] ?? []).join(' ')).toContain('tuna.tsinghua.edu.cn');
  });
});

describe('autoRepair — 按需调用安装函数', () => {
  afterEach(() => vi.restoreAllMocks());

  it('wechat 失败时只调用 installWeChat', async () => {
    // CJS 模式下通过 _repairFuncs 对象 spy，确保能被拦截
    const wMock = vi.spyOn(_repairFuncs, 'installWeChat').mockResolvedValue(undefined);
    const pMock = vi.spyOn(_repairFuncs, 'installPywinauto').mockResolvedValue(undefined);

    await autoRepair({ wechatFailed: true, pywinautoFailed: false }, 'python.exe', os.tmpdir());

    expect(wMock).toHaveBeenCalledOnce();
    expect(pMock).not.toHaveBeenCalled();
  });

  it('pywinauto 失败时只调用 installPywinauto', async () => {
    const wMock = vi.spyOn(_repairFuncs, 'installWeChat').mockResolvedValue(undefined);
    const pMock = vi.spyOn(_repairFuncs, 'installPywinauto').mockResolvedValue(undefined);

    await autoRepair({ wechatFailed: false, pywinautoFailed: true }, 'python.exe', os.tmpdir());

    expect(wMock).not.toHaveBeenCalled();
    expect(pMock).toHaveBeenCalledOnce();
  });

  it('两者都失败时都调用', async () => {
    const wMock = vi.spyOn(_repairFuncs, 'installWeChat').mockResolvedValue(undefined);
    const pMock = vi.spyOn(_repairFuncs, 'installPywinauto').mockResolvedValue(undefined);

    await autoRepair({ wechatFailed: true, pywinautoFailed: true }, 'python.exe', os.tmpdir());

    expect(wMock).toHaveBeenCalledOnce();
    expect(pMock).toHaveBeenCalledOnce();
  });
});

describe('runPreflight — 非 Windows 不触发 autoRepair', () => {
  afterEach(() => vi.restoreAllMocks());

  it('非 Windows 平台 autoRepair 不被调用', async () => {
    if (process.platform === 'win32') return;
    // 非 Windows 下 autoRepair 分支根本不走，直接断言结果 ok:true 即可
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(true);
  });
});

// ── 回归测试：preflight 所有检测必须 blocking（无软放行）──
// 根因：曾存在 "version-only warning → ok:true" bypass，导致微信版本 > 4.1.8
// 时 autoRepair 失败后模块仍激活，listen_chat.py 用 pywinauto 操作高版本微信崩溃。
describe('runPreflight — wechat_version 失败必须 blocking（ok:false）', () => {
  const origMock = process.env.MOCK_WECHAT_VERSION;

  afterEach(() => {
    if (origMock === undefined) delete process.env.MOCK_WECHAT_VERSION;
    else process.env.MOCK_WECHAT_VERSION = origMock;
    vi.restoreAllMocks();
  });

  it('MOCK_WECHAT_VERSION=4.1.10.0 时 runPreflight 返回 ok:false（不得 ok:true 软放行）', async () => {
    if (process.platform === 'win32') return; // Windows 上 autoRepair 会真尝试修复，用另一 case
    process.env.MOCK_WECHAT_VERSION = '4.1.10.0';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(false);
    expect(result.checks.wechat_version).toBe(false);
    expect(result.fixGuide).toContain('4.1.10.0');
  });

  it('MOCK_WECHAT_VERSION=5.0.0.0 時 runPreflight 返回 ok:false', async () => {
    if (process.platform === 'win32') return;
    process.env.MOCK_WECHAT_VERSION = '5.0.0.0';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(false);
    expect(result.checks.wechat_version).toBe(false);
  });

  it('MOCK_WECHAT_VERSION=4.1.8.107 时 runPreflight 返回 ok:true（支持版本不阻塞）', async () => {
    if (process.platform === 'win32') return;
    process.env.MOCK_WECHAT_VERSION = '4.1.8.107';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(true);
    expect(result.checks.wechat_version).toBe(true);
  });
});
