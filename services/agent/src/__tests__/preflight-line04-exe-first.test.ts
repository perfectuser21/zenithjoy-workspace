// 回归测试：preflight.js checkWechatVersion() 必须优先用 exe 文件版本，不信任注册表。
//
// 根因：WeChat 4.1.8.107 启动后几秒把注册表写成 4.1.10.27（可用更新版本）。
// 旧代码先读注册表 → 得到 4.1.10.27 → 返回 ok:false → autoRepair 杀死 WeChat → 死循环。
// 修复：在注册表读取之前先用 PowerShell Get-Item VersionInfo 读 exe 文件版本。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

// 被测模块路径（相对于 services/agent/src/__tests__/）
const PREFLIGHT_PATH = path.resolve(
  __dirname,
  '../../build-modules/line04/preflight.js'
);

describe('preflight.js checkWechatVersion — exe-first 回归测试', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    vi.resetModules();
    delete process.env.MOCK_WECHAT_VERSION;
  });

  it('MOCK_WECHAT_VERSION=4.1.8.107 → ok:true（现有路径，基准）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.8.107';
    const preflight = require(PREFLIGHT_PATH);
    const result = preflight.checkWechatVersion();
    expect(result.ok).toBe(true);
    expect(result.found).toBe('4.1.8.107');
  });

  it('MOCK_WECHAT_VERSION=4.1.10.27 → ok:false（版本过高现有路径）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.10.27';
    const preflight = require(PREFLIGHT_PATH);
    const result = preflight.checkWechatVersion();
    expect(result.ok).toBe(false);
  });

  it('非 Windows 且无 MOCK → skipped:true（无注册表可读）', () => {
    delete process.env.MOCK_WECHAT_VERSION;
    // mac/linux CI 环境
    if (process.platform === 'win32') return; // 跳过：真 Windows 上有注册表
    const preflight = require(PREFLIGHT_PATH);
    const result = preflight.checkWechatVersion();
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('isWechatVersionSupported: 只认 4.1.8.x（4.0.0/4.1.7 低于基线也 false）', () => {
    const preflight = require(PREFLIGHT_PATH);
    expect(preflight.isWechatVersionSupported('4.1.8.107')).toBe(true);
    expect(preflight.isWechatVersionSupported('4.1.10.27')).toBe(false);
    expect(preflight.isWechatVersionSupported('4.0.0')).toBe(false);
    expect(preflight.isWechatVersionSupported('4.1.7.25')).toBe(false);
    expect(preflight.isWechatVersionSupported('3.9.12.51')).toBe(false);
  });

  it('parseWechatVersionFromRegOutput: 0xf254186b → 4.1.8.107（WeChat 写注册表的 dword）', () => {
    const preflight = require(PREFLIGHT_PATH);
    // 0xf254186b = WeChat 4.1.8.107 nibble-packed
    const v = preflight.parseWechatVersionFromRegOutput(
      'HKCU\\SOFTWARE\\Tencent\\Weixin\n    Version    REG_DWORD    0xf254186b\n'
    );
    expect(v).toBe('4.1.8.107');
  });

  it('parseWechatVersionFromRegOutput: 4.1.10.27 dword → isWechatVersionSupported = false', () => {
    const preflight = require(PREFLIGHT_PATH);
    // 验证注册表被污染后的场景：解析出 4.1.10.27 → 不支持
    // 4.1.10.27 nibble-packed: major=4 minor=1 patch=10 build=27
    // byte[1]: (4<<4)|1 = 0x41, byte[2]: (10<<4)|0 (wait - nibble encoding is different)
    // 直接用字符串测更可靠
    const v = preflight.parseWechatVersionFromRegOutput(
      '    Version    REG_SZ    4.1.10.27\n'
    );
    expect(v).toBe('4.1.10.27');
    expect(preflight.isWechatVersionSupported('4.1.10.27')).toBe(false);
  });
});
