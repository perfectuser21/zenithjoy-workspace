import { describe, it, expect } from 'vitest';
import { runPreflight } from '../preflight-runner';
import {
  isWechatVersionSupported,
  parseWechatVersionFromRegOutput,
  checkMemory,
} from '../line04-preflight';

describe('runPreflight 路由', () => {
  it('line01-publish 返回 ok:true（stub）', async () => {
    const r = await runPreflight('line01-publish');
    expect(r.ok).toBe(true);
  });

  it('line02-lead-gen / line05-video stub 返回 ok:true', async () => {
    expect((await runPreflight('line02-lead-gen')).ok).toBe(true);
    expect((await runPreflight('line05-video')).ok).toBe(true);
  });

  it('未知 lineId 返回 ok:false 且有中文 reason', async () => {
    const r = await runPreflight('line99-nope');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('line04 在非 Windows 环境不崩溃并返回结构化结果', async () => {
    const r = await runPreflight('line04-wechat-cs');
    expect(r).toHaveProperty('checks');
    expect(typeof r.ok).toBe('boolean');
    // 非 Windows 微信版本检测应跳过（视为通过）
    if (process.platform !== 'win32') {
      expect(r.checks.wechat_version).toBe(true);
    }
    // 内存检测在任何平台都要工作
    expect(typeof r.checks.memory).toBe('boolean');
  });
});

describe('微信版本比较（纯函数，>= 4.1.8 一律支持；6-21 放开上界，仅卡 < 4.1.8 下界）', () => {
  it('4.1.8.107 = 基线 → 支持', () => {
    expect(isWechatVersionSupported('4.1.8.107')).toBe(true);
  });
  it('4.1.8 → 支持', () => {
    expect(isWechatVersionSupported('4.1.8')).toBe(true);
  });
  it('【必须是 4.1.8 不是小】4.1.7.25 低于基线 → 不支持', () => {
    expect(isWechatVersionSupported('4.1.7.25')).toBe(false);
  });
  it('【必须是 4.1.8 不是小】4.0.5 / 4.1.0 低于基线 → 不支持', () => {
    expect(isWechatVersionSupported('4.0.5')).toBe(false);
    expect(isWechatVersionSupported('4.1.0')).toBe(false);
  });
  it('4.1.9 → 支持（6-21 放开上界，Qt UIA 可用）', () => {
    expect(isWechatVersionSupported('4.1.9')).toBe(true);
  });
  it('4.1.10 → 支持（死闸误判的核心版本，现放行）', () => {
    expect(isWechatVersionSupported('4.1.10.27')).toBe(true);
  });
  it('4.2.0 → 支持（>= 4.1.8 一律放行）', () => {
    expect(isWechatVersionSupported('4.2.0')).toBe(true);
  });
  it('3.9.12.19 旧版 3.x → 不支持（无 mmui::MainWindow）', () => {
    expect(isWechatVersionSupported('3.9.12.19')).toBe(false);
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

describe('内存检测', () => {
  it('返回结构化结果（ok 为 boolean）', () => {
    const r = checkMemory();
    expect(typeof r.ok).toBe('boolean');
  });
});
