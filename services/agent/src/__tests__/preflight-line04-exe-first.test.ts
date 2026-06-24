// 回归测试：preflight.js checkWechatVersion() 优先用 exe 文件版本（更准），
// 且 >= 4.1.8 一律放行（6-21 放开上界：4.1.10+ Qt 窗口 UIA 照样能用，不再误判 fail）。
//
// 历史根因（已随上界放开而消解）：WeChat 4.1.8.107 启动后几秒把注册表写成 4.1.10.27。
// 旧死闸先读注册表 → 4.1.10.27 → ok:false → autoRepair 杀微信 → 死循环。
// 现 4.1.10 本身就放行，不再死循环；exe-first 仍保留（返回真实安装版本，诊断更准）。

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

  it('MOCK_WECHAT_VERSION=4.1.10.27 → ok:true（6-21 放开上界，死闸误判版本现放行）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.10.27';
    const preflight = require(PREFLIGHT_PATH);
    const result = preflight.checkWechatVersion();
    expect(result.ok).toBe(true);
    expect(result.found).toBe('4.1.10.27');
  });

  it('MOCK_WECHAT_VERSION=4.1.7.25 → ok:false（< 4.1.8 下界仍阻断）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.7.25';
    const preflight = require(PREFLIGHT_PATH);
    const result = preflight.checkWechatVersion();
    expect(result.ok).toBe(false);
    expect(result.found).toBe('4.1.7.25');
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

  it('isWechatVersionSupported: >= 4.1.8 放行（4.1.10+ true），< 4.1.8 仍 false', () => {
    const preflight = require(PREFLIGHT_PATH);
    expect(preflight.isWechatVersionSupported('4.1.8.107')).toBe(true);
    expect(preflight.isWechatVersionSupported('4.1.10.27')).toBe(true);
    expect(preflight.isWechatVersionSupported('5.0.0.0')).toBe(true);
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

  it('parseWechatVersionFromRegOutput: 4.1.10.27 解析正确 → isWechatVersionSupported = true', () => {
    const preflight = require(PREFLIGHT_PATH);
    // 注册表（被微信自动改写为可用更新版本）解析出 4.1.10.27 → 现放行（>= 4.1.8）
    const v = preflight.parseWechatVersionFromRegOutput(
      '    Version    REG_SZ    4.1.10.27\n'
    );
    expect(v).toBe('4.1.10.27');
    expect(preflight.isWechatVersionSupported('4.1.10.27')).toBe(true);
  });
});
