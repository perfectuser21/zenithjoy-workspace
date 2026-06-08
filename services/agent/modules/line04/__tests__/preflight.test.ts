// modules/line04/__tests__/preflight.test.ts
//
// line04 模块 preflight — TDD commit-1（红）。
// 覆盖：微信版本比较纯函数 / 注册表解析 / 非 Windows 不崩溃 / fixGuide 含 COS URL。

import { describe, it, expect } from 'vitest';
import os from 'node:os';
import {
  isWechatVersionSupported,
  parseVersionParts,
  parseWechatVersionFromRegOutput,
  wechatFixGuide,
  pywinautoFixGuide,
  memoryFixGuide,
  WECHAT_DOWNLOAD_URL,
  runPreflight,
} from '../preflight';

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
