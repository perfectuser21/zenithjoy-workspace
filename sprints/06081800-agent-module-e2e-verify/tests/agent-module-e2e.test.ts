// sprints/06081800-agent-module-e2e-verify/tests/agent-module-e2e.test.ts
//
// TDD Red — preflight MOCK_WECHAT_VERSION 跨平台支持 + version-only warning 路径（Round 3 新增）
//
// 当前失败原因：
//   - 测试1: MOCK=4.2.0.0 → checkWechatVersion() 期望 ok:false（非 Windows 直接 skipped，MOCK env 被忽略）
//   - 测试2: MOCK=4.1.8.0 → 期望 found=='4.1.8.0'（走 skip 路径则 found==undefined）
//   - 测试3（Round 3 新增）: runPreflight MOCK=4.2.0.0 → 期望 ok:true（version-only warning）
//     当前 runPreflight 无此区分逻辑，MOCK 路径下仍走 ok:false exit 1
//
// Generator 需要：
//   1. checkWechatVersion(): 读 MOCK_WECHAT_VERSION，跳过 platform 检测直接走版本比较
//   2. runPreflight(): 识别 version-only failure（仅 wechat_version==false）→ ok:true（告警不判红）

import { describe, it, expect, afterEach } from 'vitest';
import { checkWechatVersion, runPreflight } from '../../../services/agent/modules/line04/preflight';

describe('preflight MOCK_WECHAT_VERSION 环境变量覆盖（跨平台，任何 OS 均可测）', () => {
  afterEach(() => {
    delete process.env.MOCK_WECHAT_VERSION;
  });

  it('MOCK_WECHAT_VERSION=4.2.0.0 → checkWechatVersion() ok:false，fixGuide 含 WeChatWin_4.1.8.exe COS URL', () => {
    process.env.MOCK_WECHAT_VERSION = '4.2.0.0';
    const result = checkWechatVersion();
    expect(result.ok).toBe(false);
    expect(result.fixGuide).toBeDefined();
    expect(result.fixGuide).toContain('WeChatWin_4.1.8.exe');
  });

  it('MOCK_WECHAT_VERSION=4.1.8.0 → checkWechatVersion() ok:true，found=="4.1.8.0"（MOCK 路径实际执行，非 skip）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.8.0';
    const result = checkWechatVersion();
    expect(result.ok).toBe(true);
    expect(result.found).toBe('4.1.8.0');
  });
});

describe('runPreflight version-only warning 路径（PRD 边界情况：version 类失败只告警不判红）', () => {
  afterEach(() => {
    delete process.env.MOCK_WECHAT_VERSION;
  });

  it('MOCK_WECHAT_VERSION=4.2.0.0（仅 version 失败，pywinauto+memory 非 Windows 视为通过）→ ok:true，checks.wechat_version:false，无顶层 fixGuide', async () => {
    process.env.MOCK_WECHAT_VERSION = '4.2.0.0';
    const result = await runPreflight();
    expect(result.ok).toBe(true);
    expect(result.checks.wechat_version).toBe(false);
    expect((result as Record<string, unknown>).fixGuide).toBeUndefined();
  });
});
