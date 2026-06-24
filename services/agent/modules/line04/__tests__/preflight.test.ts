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
  checkWechatVersion,
  checkWechatRunning,
  checkVerifySilent,
  interpretVerifySilent,
  checkVerifyDelivery,
  interpretVerifyDelivery,
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

describe('微信版本比较（纯函数，>= 4.1.8 一律支持；6-21 放开上界，仅卡 < 4.1.8 下界）', () => {
  it('4.1.8.107 = 基线 → 支持', () => {
    expect(isWechatVersionSupported('4.1.8.107')).toBe(true);
  });
  it('4.1.8 → 支持', () => {
    expect(isWechatVersionSupported('4.1.8')).toBe(true);
  });
  it('【必须是 4.1.8 不是小】4.1.7.25 低于基线 4.1.8 → 不支持', () => {
    expect(isWechatVersionSupported('4.1.7.25')).toBe(false);
  });
  it('4.1.9 → 支持（6-21 放开上界，Qt UIA 可用）', () => {
    expect(isWechatVersionSupported('4.1.9')).toBe(true);
  });
  it('4.1.10 → 支持（死闸误判的核心版本，现放行）', () => {
    expect(isWechatVersionSupported('4.1.10.0')).toBe(true);
  });
  it('4.2.0 → 支持（>= 4.1.8 一律放行）', () => {
    expect(isWechatVersionSupported('4.2.0')).toBe(true);
  });
  it('3.9.12.19 旧版 3.x → 不支持（无 mmui::MainWindow，RPA 不可用）', () => {
    expect(isWechatVersionSupported('3.9.12.19')).toBe(false);
  });
  it('3.0.0.0 更老版本 → 不支持', () => {
    expect(isWechatVersionSupported('3.0.0.0')).toBe(false);
  });
  it('【必须是 4.1.8 不是小】4.0.0 低于基线 4.1.8 → 不支持', () => {
    expect(isWechatVersionSupported('4.0.0')).toBe(false);
  });
  it('4.1.0 / 4.0.5.20 低于基线 → 不支持', () => {
    expect(isWechatVersionSupported('4.1.0')).toBe(false);
    expect(isWechatVersionSupported('4.0.5.20')).toBe(false);
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
  it('解析 REG_DWORD 编码版本（4.1.8.107 = 0x6401086b，3.x 偏移编码）', () => {
    const out = '    Version    REG_DWORD    0x6401086b';
    expect(parseWechatVersionFromRegOutput(out)).toBe('4.1.8.107');
  });
  it('解析 Weixin 4.x nibble 编码 DWORD（0xf254186b → 4.1.8.107，regression: xian-rog 真实注册表值）', () => {
    // xian-rog 实测：HKCU\SOFTWARE\Tencent\Weixin Version = REG_DWORD 0xf254186b
    // 旧公式 major = 0xf2 - 0x60 = 146 → "146.84.24.107" → isSupported=false → 触发卸装循环
    // 新公式 nibble-packed: major=(num>>16)&0xF=4, minor=(num>>12)&0xF=1, patch=(num>>8)&0xF=8, build=0x6b=107
    const out = 'HKEY_CURRENT_USER\\SOFTWARE\\Tencent\\Weixin\r\n    Version    REG_DWORD    0xf254186b\r\n';
    expect(parseWechatVersionFromRegOutput(out)).toBe('4.1.8.107');
  });
  it('无 Version 字段返回 null', () => {
    expect(parseWechatVersionFromRegOutput('一些无关输出')).toBeNull();
  });
});

describe('checkWechatVersion — 4.x Weixin 目录回退检测（regression: 曾漏检导致反复卸装）', () => {
  afterEach(() => {
    delete process.env.MOCK_WECHAT_VERSION;
    vi.restoreAllMocks();
    vi.mocked(execSync).mockReset();
  });

  it('MOCK_WECHAT_VERSION=4.1.8.107 → ok:true（环境变量 mock 路径仍正常）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.8.107';
    const r = checkWechatVersion();
    expect(r.ok).toBe(true);
    expect(r.found).toBe('4.1.8.107');
  });

  it('reg query HKCU\\SOFTWARE\\Tencent\\Weixin 返回 4.1.8.107 → ok:true（4.x 注册表路径）', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('Tencent\\\\Weixin') || c.includes('Tencent\\Weixin')) {
        return 'HKEY_CURRENT_USER\\SOFTWARE\\Tencent\\Weixin\r\n    Version    REG_SZ    4.1.8.107\r\n' as any;
      }
      throw new Error('not found');
    });
    const r = checkWechatVersion();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.found).toBe('4.1.8.107');
  });

  it('注册表全失败 + C:\\Program Files\\Tencent\\Weixin\\4.1.8.107\\ 目录存在 → ok:true（4.x 目录回退）', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).toLowerCase().includes('program files\\tencent\\weixin')
    );
    vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
      if (String(p).toLowerCase().includes('program files\\tencent\\weixin')) {
        return [{ name: '4.1.8.107', isDirectory: () => true }] as any;
      }
      return [] as any;
    });
    const r = checkWechatVersion();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.found).toBe('4.1.8.107');
  });
});

describe('installWeChat — WeixinUpdate.exe 版本子目录锁定（regression: v1.0.23 路径写死在根目录）', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockDownload() {
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
  }

  it('WeixinUpdate.exe 在版本子目录（如 4.1.8.107\\WeixinUpdate.exe）也能被重命名 .disabled', async () => {
    mockDownload();
    vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    // 根目录无 WeixinUpdate.exe，但版本子目录有
    const subPath = 'C:\\Program Files\\Tencent\\Weixin\\4.1.8.107\\WeixinUpdate.exe';
    // 路径分隔符在 macOS（path.join 用 /）与 Windows（\\）不同，统一 normalize
    const norm = (s: string) => String(s).replace(/\\/g, '/').toLowerCase();
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      norm(p) === norm(subPath) ||
      norm(p) === 'c:/program files/tencent/weixin'
    );
    vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
      if (norm(p).includes('program files/tencent/weixin') && !norm(p).includes('4.1.8.107')) {
        return [{ name: '4.1.8.107', isDirectory: () => true }] as any;
      }
      return [] as any;
    });
    const renameSyncMock = vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);

    await installWeChat(os.tmpdir());

    const lockCall = renameSyncMock.mock.calls.find(([src]) => {
      const s = norm(src);
      return s.includes('weixinupdate.exe') && !s.endsWith('.disabled');
    });
    expect(lockCall).toBeDefined();
    expect(norm(lockCall![1])).toBe(norm(lockCall![0]) + '.disabled');
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

// ── 回归测试：installWeChat 必须用 PowerShell RunAs（普通用户直接运行安装器 = WinError 740）──
// 根因：spawnSync(installer, ['/S']) 在普通用户身份下报 OSError: [WinError 740]，
//   且错误提示"以管理员身份运行 start.bat"又破坏 UIA（UIA 要求普通用户身份）。
// 修法：改用 spawnSync('powershell', ['...',  'Start-Process ... -Verb RunAs -Wait'])，
//   只有安装器本身提权，agent 进程保持普通用户，UIA 正常激活。
describe('installWeChat — 必须用 PowerShell RunAs 提权（regression: 直接 spawnSync 安装器 = WinError 740）', () => {
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  function mockDownload() {
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
  }

  it('安装器通过 PowerShell Start-Process -Verb RunAs 调用（不直接 spawnSync 安装器）', async () => {
    mockDownload();
    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installWeChat(os.tmpdir());

    // 不应直接用 spawnSync 调用 WeChatWin_4.1.8.exe（需要 admin 权限 → WinError 740）
    const directInstall = spawnSyncMock.mock.calls.find(
      (c) => String(c[0]).includes('WeChatWin_4.1.8.exe'),
    );
    expect(directInstall).toBeUndefined();

    // 应通过 PowerShell Start-Process -Verb RunAs 调用（UAC 弹窗，agent 本身不提权）
    const psCall = spawnSyncMock.mock.calls.find(
      (c) =>
        String(c[0]).toLowerCase().includes('powershell') &&
        JSON.stringify(c[1]).includes('RunAs') &&
        JSON.stringify(c[1]).includes('WeChatWin_4.1.8.exe'),
    );
    expect(psCall).toBeDefined();
  });
});

describe('installWeChat — 下载并静默安装微信 4.1.8', () => {
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it('安装器通过 PowerShell Start-Process -Verb RunAs 调用（含 /S 静默参数）', async () => {
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

    const psCall = spawnSyncMock.mock.calls.find(
      (c) =>
        String(c[0]).toLowerCase().includes('powershell') &&
        JSON.stringify(c[1]).includes('WeChatWin_4.1.8.exe') &&
        JSON.stringify(c[1]).includes('RunAs'),
    );
    expect(psCall).toBeDefined();
    expect(JSON.stringify(psCall![1])).toContain('/S');
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

  // 回归测试：taskkill 必须在安装包运行前执行（防止进程占用导致降级静默失败）
  it('taskkill WeChat.exe + WeChatAppEx.exe 在安装包之前执行', async () => {
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

    const calls = spawnSyncMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' ').toLowerCase());

    const installerIdx = calls.findIndex((a) => a.includes('wechatwin_4.1.8.exe'));
    const killWeChatIdx = calls.findIndex((a) => a.includes('taskkill') && a.includes('wechat.exe') && !a.includes('wechatappex'));
    const killAppExIdx = calls.findIndex((a) => a.includes('taskkill') && a.includes('wechatappex.exe'));

    // 两个 kill 都必须存在
    expect(killWeChatIdx).toBeGreaterThanOrEqual(0);
    expect(killAppExIdx).toBeGreaterThanOrEqual(0);

    // 安装包必须存在
    expect(installerIdx).toBeGreaterThanOrEqual(0);

    // kill 必须在安装包之前
    expect(killWeChatIdx).toBeLessThan(installerIdx);
    expect(killAppExIdx).toBeLessThan(installerIdx);
  });

  // ── 卸载旧版本回归测试（版本不对先卸载再安装，防止多版本并存）──────────────────

  function mockDownload() {
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
  }

  it('检测到 WeChat 3.x 卸载程序 → 先卸载再装 4.1.8', async () => {
    mockDownload();
    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    // 模拟 3.x 卸载程序存在
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).toLowerCase().includes('wechat\\uninstall') ? true : false
    );

    await installWeChat(os.tmpdir());

    const calls = spawnSyncMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' ').toLowerCase());
    const uninstIdx = calls.findIndex((a) => a.includes('wechat') && a.includes('uninstall') && a.includes('/s'));
    const installerIdx = calls.findIndex((a) => a.includes('wechatwin_4.1.8.exe'));
    expect(uninstIdx).toBeGreaterThanOrEqual(0);        // 卸载程序被调用
    expect(uninstIdx).toBeLessThan(installerIdx);       // 卸载在安装之前
  });

  it('检测到 Weixin 4.x 卸载程序 → 先卸载再装 4.1.8', async () => {
    mockDownload();
    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    // 模拟 4.x 卸载程序存在
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).toLowerCase().includes('weixin\\uninstall') ? true : false
    );

    await installWeChat(os.tmpdir());

    const calls = spawnSyncMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' ').toLowerCase());
    const uninstIdx = calls.findIndex((a) => a.includes('weixin') && a.includes('uninstall') && a.includes('/s'));
    const installerIdx = calls.findIndex((a) => a.includes('wechatwin_4.1.8.exe'));
    expect(uninstIdx).toBeGreaterThanOrEqual(0);
    expect(uninstIdx).toBeLessThan(installerIdx);
  });

  it('Weixin.exe + WeixinUpdate.exe 也在 taskkill 列表里', async () => {
    mockDownload();
    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await installWeChat(os.tmpdir());

    const killed = spawnSyncMock.mock.calls
      .filter((c) => String(c[0]).toLowerCase().includes('taskkill'))
      .flatMap((c) => (c[1] ?? []).map(String).map((s) => s.toLowerCase()));
    expect(killed.some((s) => s.includes('weixin.exe'))).toBe(true);
    expect(killed.some((s) => s.includes('weixinupdate.exe'))).toBe(true);
  });

  it('卸载程序不存在时跳过，正常装 4.1.8', async () => {
    mockDownload();
    const spawnSyncMock = vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);   // 无卸载程序

    await installWeChat(os.tmpdir());

    const calls = spawnSyncMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' ').toLowerCase());
    // 不能有任何 Uninstall 调用
    expect(calls.some((a) => a.includes('uninstall'))).toBe(false);
    // 主安装包正常跑
    expect(calls.some((a) => a.includes('wechatwin_4.1.8.exe'))).toBe(true);
  });

  // ── 安装后锁更新（防 WeixinUpdate.exe 自动升级 4.1.8 → ≥4.1.9，造成反复卸载重装循环）──

  it('安装 4.1.8 后立即将 WeixinUpdate.exe 重命名 .disabled，防自动升级循环', async () => {
    mockDownload();
    vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    // 模拟安装完成后 WeixinUpdate.exe 存在于 Weixin 根目录（findWeixinUpdateExe 先检查根目录是否存在）
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).toLowerCase().includes('weixinupdate.exe') ||
      String(p).toLowerCase() === 'c:\\program files\\tencent\\weixin'
    );
    const renameSyncMock = vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);

    await installWeChat(os.tmpdir());

    // renameSync 必须被调用，把 WeixinUpdate.exe 改名为 WeixinUpdate.exe.disabled
    const lockCall = renameSyncMock.mock.calls.find(([src]) =>
      String(src).toLowerCase().includes('weixinupdate.exe') &&
      !String(src).toLowerCase().endsWith('.disabled')
    );
    expect(lockCall).toBeDefined();
    const [src, dst] = lockCall!;
    expect(String(dst).toLowerCase()).toBe(String(src).toLowerCase() + '.disabled');
  });

  it('WeixinUpdate.exe 不存在时跳过重命名（不抛错）', async () => {
    mockDownload();
    vi.spyOn(childProcessModule, 'spawnSync').mockReturnValue({ status: 0 } as any);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);  // 无任何卸载程序也无 WeixinUpdate
    const renameSyncMock = vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);

    await expect(installWeChat(os.tmpdir())).resolves.not.toThrow();
    // WeixinUpdate.exe 不存在时，renameSync 不应被调用
    const lockCall = renameSyncMock.mock.calls.find(([src]) =>
      String(src).toLowerCase().includes('weixinupdate.exe')
    );
    expect(lockCall).toBeUndefined();
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

// ── 回归测试：>= 4.1.8 一律放行（6-21 放开上界，死闸不再误判 4.1.10+）──
// 根因（旧死闸）：曾"只认 4.1.8.x，>=4.1.9 一律 fail"，导致新机（微信 4.1.10+）
// preflight 第一关 wechat_version 就 fail → module-manager 不激活 line04 → listen_chat 永不跑。
// 6-21 真机验证 Qt51514QWindowIcon 窗口 UIA 照样能发，故放开上界：>= 4.1.8 一律 ok:true。
// 仅 < 4.1.8 仍 blocking（这部分由下界用例守卫，见 4.1.7 mock 路径）。
describe('runPreflight — >= 4.1.8 放行 / < 4.1.8 仍 blocking', () => {
  const origMock = process.env.MOCK_WECHAT_VERSION;

  afterEach(() => {
    if (origMock === undefined) delete process.env.MOCK_WECHAT_VERSION;
    else process.env.MOCK_WECHAT_VERSION = origMock;
    vi.restoreAllMocks();
  });

  it('MOCK_WECHAT_VERSION=4.1.10.0 时 runPreflight 返回 ok:true（死闸误判版本现放行）', async () => {
    if (process.platform === 'win32') return;
    process.env.MOCK_WECHAT_VERSION = '4.1.10.0';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(true);
    expect(result.checks.wechat_version).toBe(true);
    expect(result.reason).toContain('4.1.10.0');
  });

  it('MOCK_WECHAT_VERSION=5.0.0.0 時 runPreflight 返回 ok:true（>= 4.1.8 一律放行）', async () => {
    if (process.platform === 'win32') return;
    process.env.MOCK_WECHAT_VERSION = '5.0.0.0';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(true);
    expect(result.checks.wechat_version).toBe(true);
  });

  it('MOCK_WECHAT_VERSION=4.1.7.25 时 runPreflight 返回 ok:false（< 4.1.8 下界仍阻断）', async () => {
    if (process.platform === 'win32') return;
    process.env.MOCK_WECHAT_VERSION = '4.1.7.25';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(false);
    expect(result.checks.wechat_version).toBe(false);
    expect(result.fixGuide).toContain('4.1.7.25');
  });

  it('MOCK_WECHAT_VERSION=4.1.8.107 时 runPreflight 返回 ok:true（基线版本不阻塞）', async () => {
    if (process.platform === 'win32') return;
    process.env.MOCK_WECHAT_VERSION = '4.1.8.107';
    const result = await runPreflight(os.tmpdir());
    expect(result.ok).toBe(true);
    expect(result.checks.wechat_version).toBe(true);
  });
});

// ── 回归测试：exe 文件版本优先于注册表 ─────────────────────────────────────
// 根因：WeChat 4.1.8.107 启动后几秒内会把
//   HKCU\SOFTWARE\Tencent\Weixin Version 自动改写为可用更新版本（4.1.10.27）。
// preflight 若先读注册表会误判版本 > 4.1.8 → autoRepair 杀掉微信 → 反复卸装死循环。
// 修法：在注册表读取之前先用 PowerShell Get-Item 读取 Weixin.exe 的 FileVersion，
//   exe 文件版本不受 WeChat 自动更新检测器修改，始终反映实际安装版本。
describe('checkWechatVersion — exe 文件版本优先于注册表（regression: 4.1.8.107 安装后注册表被改写为 4.1.10.27 误判）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(execSync).mockReset();
  });

  it('Weixin.exe FileVersion=4.1.8.107 时直接 ok:true，注册表不被读取（即使注册表记录 4.1.10.27）', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    let registryCalled = false;
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('Get-Item') && c.includes('Weixin.exe')) {
        return '4.1.8.107\r\n' as any;
      }
      if (c.includes('reg query')) {
        registryCalled = true;
        return 'HKEY_CURRENT_USER\\SOFTWARE\\Tencent\\Weixin\r\n    Version    REG_SZ    4.1.10.27\r\n' as any;
      }
      throw new Error('unexpected cmd: ' + c);
    });
    const r = checkWechatVersion();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.found).toBe('4.1.8.107');
    expect(registryCalled).toBe(false);
  });

  it('Weixin.exe PowerShell 出错时回退到注册表（保留兼容）', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('Get-Item')) throw new Error('file not found');
      if (c.includes('Tencent\\Weixin') || c.includes('Tencent\\\\Weixin')) {
        return 'HKEY_CURRENT_USER\\SOFTWARE\\Tencent\\Weixin\r\n    Version    REG_SZ    4.1.8.107\r\n' as any;
      }
      throw new Error('not found');
    });
    const r = checkWechatVersion();
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.found).toBe('4.1.8.107');
  });
});

// ── --verify-silent 只读静默自检接缝（哨兵 P0）──────────────────────────────
// 真机静默行为 proven-to-fire 在 xian-rog；这里测「解析 listen_chat 输出」纯逻辑 +
// checkVerifySilent 的 MOCK/skip 分支（环境无关，CI 验得了）。

describe('interpretVerifySilent — 解析 listen_chat --verify-silent --no-send 输出（纯函数）', () => {
  it('exit 0 + silent:true → ok（SILENT）', () => {
    const r = interpretVerifySilent(0, '日志行\n{"ok":true,"silent":true,"worst_left":-1400}');
    expect(r.ok).toBe(true);
    expect(r.found).toBe('SILENT');
  });
  it('exit 1 + silent:false → 红（NOT SILENT，真接缝失败）', () => {
    const r = interpretVerifySilent(1, '{"ok":true,"silent":false,"worst_left":12,"intrude":7}');
    expect(r.ok).toBe(false);
    expect(r.fixGuide).toMatch(/NOT SILENT|未持续屏外/);
  });
  it('exit 1 + error NO_WINDOW（微信未登录）→ skip 不误判红', () => {
    const r = interpretVerifySilent(1, '{"ok":false,"error":"NO_WINDOW（微信未登录 / 不在当前 session）"}');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
  it('exit 1 + error 必须在 Windows → skip', () => {
    const r = interpretVerifySilent(1, '{"ok":false,"error":"verify-silent 必须在 Windows 真机 session 1 运行"}');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
  it('无法解析输出（空/乱码）→ skip 不误判红', () => {
    const r = interpretVerifySilent(1, 'garbage no json');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
});

describe('checkVerifySilent — MOCK / 非 Windows 分支', () => {
  afterEach(() => {
    delete process.env.MOCK_VERIFY_SILENT;
  });
  it('MOCK_VERIFY_SILENT=silent → ok', () => {
    process.env.MOCK_VERIFY_SILENT = 'silent';
    expect(checkVerifySilent().ok).toBe(true);
  });
  it('MOCK_VERIFY_SILENT=not_silent → 红', () => {
    process.env.MOCK_VERIFY_SILENT = 'not_silent';
    const r = checkVerifySilent();
    expect(r.ok).toBe(false);
    expect(r.fixGuide).toBeTruthy();
  });
  it('MOCK_VERIFY_SILENT=skip → skipped', () => {
    process.env.MOCK_VERIFY_SILENT = 'skip';
    const r = checkVerifySilent();
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
  it('非 Windows 且无 MOCK → skip（不真 spawn）', () => {
    if (process.platform === 'win32') return;
    const r = checkVerifySilent();
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
});

describe('runPreflight 透出微信版本 + 静默状态到 reason（薄上报，零改中台）', () => {
  const origPlatform = process.platform;
  afterEach(() => {
    delete process.env.MOCK_WECHAT_VERSION;
    delete process.env.MOCK_VERIFY_SILENT;
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
  it('reason 含检测到的微信版本号（看板可见）', async () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.8.107';
    process.env.MOCK_VERIFY_SILENT = 'silent';
    const r = await runPreflight(os.tmpdir());
    expect(r.reason).toMatch(/4\.1\.8\.107/);
  });
  it('MOCK_VERIFY_SILENT=not_silent → 整体 ok:false + checks.verify_silent:false', async () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.8.107';
    process.env.MOCK_VERIFY_SILENT = 'not_silent';
    const r = await runPreflight(os.tmpdir());
    expect(r.checks.verify_silent).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe('interpretVerifyDelivery — 带发送自检解析（真送达 + 焦点归还，纯函数）', () => {
  it('sent:true + restored:true → ok（DELIVERED + 焦点归还）', () => {
    const out = JSON.stringify({ ok: true, sent: true, silent: true, restored: true, target: '文件传输助手' });
    const r = interpretVerifyDelivery(0, out);
    expect(r.ok).toBe(true);
    expect(r.found).toBe('DELIVERED');
  });

  it('sent:false → 红（NOT DELIVERED，真送达失败）', () => {
    const out = JSON.stringify({ ok: true, sent: false, silent: true, restored: true, target: '文件传输助手' });
    const r = interpretVerifyDelivery(1, out);
    expect(r.ok).toBe(false);
    expect(r.found).toBe('NOT_DELIVERED');
    expect(r.fixGuide).toBeTruthy();
  });

  it('sent:true + restored:false → 红（送达了但焦点没还回）', () => {
    const out = JSON.stringify({ ok: true, sent: true, silent: false, restored: false, target: '文件传输助手' });
    const r = interpretVerifyDelivery(1, out);
    expect(r.ok).toBe(false);
    expect(r.found).toBe('NOT_RESTORED');
    expect(r.fixGuide).toBeTruthy();
  });

  it('error 含环境未就绪关键词 → skip（不误判红）', () => {
    const out = JSON.stringify({ ok: false, error: 'NO_WINDOW（微信未登录 / 不在当前 session）' });
    const r = interpretVerifyDelivery(1, out);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('error 找不到目标会话 → skip（文件传输助手会话不在也不误红）', () => {
    const out = JSON.stringify({ ok: false, error: '找不到目标会话（target=文件传输助手）' });
    const r = interpretVerifyDelivery(1, out);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('解析不出 JSON → skip（不误判红）', () => {
    const r = interpretVerifyDelivery(1, '乱码乱码\n系统找不到路径');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
});

describe('checkVerifyDelivery — MOCK_VERIFY_DELIVERY env 注入（跨平台可测）', () => {
  afterEach(() => {
    delete process.env.MOCK_VERIFY_DELIVERY;
  });

  it('mock=delivered → ok', () => {
    process.env.MOCK_VERIFY_DELIVERY = 'delivered';
    expect(checkVerifyDelivery().ok).toBe(true);
  });

  it('mock=not_delivered → 红', () => {
    process.env.MOCK_VERIFY_DELIVERY = 'not_delivered';
    expect(checkVerifyDelivery().ok).toBe(false);
  });

  it('mock=skip → skip', () => {
    process.env.MOCK_VERIFY_DELIVERY = 'skip';
    const r = checkVerifyDelivery();
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('非 Windows 无 mock → skip（不误判红）', () => {
    const r = checkVerifyDelivery();
    if (process.platform !== 'win32') {
      expect(r.ok).toBe(true);
      expect(r.skipped).toBe(true);
    }
  });
});
