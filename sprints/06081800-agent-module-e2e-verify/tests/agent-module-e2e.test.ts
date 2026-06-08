// sprints/06081800-agent-module-e2e-verify/tests/agent-module-e2e.test.ts
//
// TDD Red — preflight MOCK_WECHAT_VERSION 跨平台支持。
// 当前 preflight.ts 的 checkWechatVersion() 在非 Windows 时直接返回 {ok:true, skipped:true}，
// 完全忽略 MOCK_WECHAT_VERSION env，导致以下两个 it() 失败：
//   - 测试1: MOCK=4.2.0.0 → 期望 ok:false，实际 ok:true（非 Windows 跳过，忽略 MOCK）
//   - 测试2: MOCK=4.1.8.0 → 期望 found=='4.1.8.0'（MOCK 路径实际执行），实际 found==undefined（skipped）
// Generator 需要在 checkWechatVersion() 中：
//   1. 读取 process.env.MOCK_WECHAT_VERSION
//   2. 若设置了，跳过 platform 检测直接用 mock 版本走版本比较逻辑
//   这样让测试在任何 OS 均可验证 Windows 版本检测路径

import { describe, it, expect, afterEach } from 'vitest';
import { checkWechatVersion } from '../../../services/agent/modules/line04/preflight';

describe('preflight MOCK_WECHAT_VERSION 环境变量覆盖（跨平台，任何 OS 均可测）', () => {
  afterEach(() => {
    delete process.env.MOCK_WECHAT_VERSION;
  });

  it('MOCK_WECHAT_VERSION=4.2.0.0 → ok:false，fixGuide 含 WeChatWin_4.1.8.exe COS URL', () => {
    process.env.MOCK_WECHAT_VERSION = '4.2.0.0';
    const result = checkWechatVersion();
    expect(result.ok).toBe(false);
    expect(result.fixGuide).toBeDefined();
    expect(result.fixGuide).toContain('WeChatWin_4.1.8.exe');
  });

  it('MOCK_WECHAT_VERSION=4.1.8.0 → ok:true，found=="4.1.8.0"（MOCK 路径实际执行，非 skip 路径）', () => {
    process.env.MOCK_WECHAT_VERSION = '4.1.8.0';
    const result = checkWechatVersion();
    expect(result.ok).toBe(true);
    // MOCK 路径执行时 found 字段应含版本号；若走 skip 路径则 found 为 undefined → 测试失败
    expect(result.found).toBe('4.1.8.0');
  });
});
