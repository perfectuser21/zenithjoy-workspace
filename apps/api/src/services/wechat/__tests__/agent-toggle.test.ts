/**
 * agent-toggle.test.ts — 自动代理开关跳变「上线/下线播报」裁决单测（Line 04）
 *
 * 对应 Golden Path Step 1（OFF→ON 发上线通知）+ Step 5（ON→OFF 发下线通知）
 * + 边界「关键人未配置 → 跳过播报、记日志、不阻塞开关切换」。
 *
 * 纯函数，环境无关 → 逻辑断言，CI 绿 = 真 done。
 * 真机「关键人微信真收到」属接缝断言，见 windows_wechat E2E（logic-done-pending）。
 *
 * 约定：resolveToggleBroadcast(prevEnabled, nextEnabled, keyContactWechat)
 */
import { describe, it, expect } from 'vitest';
import { resolveToggleBroadcast } from '../agent-toggle';

describe('resolveToggleBroadcast [BEHAVIOR] 开关跳变播报', () => {
  it('OFF→ON + 已配关键人 → action=online，message 含「上线」', () => {
    const r = resolveToggleBroadcast(false, true, 'boss_wxid');
    expect(r.action).toBe('online');
    expect(r.target).toBe('boss_wxid');
    expect(r.message).toContain('上线');
    expect(r.message).toContain('🟢');
  });

  it('ON→OFF + 已配关键人 → action=offline，message 含「下线」', () => {
    const r = resolveToggleBroadcast(true, false, 'boss_wxid');
    expect(r.action).toBe('offline');
    expect(r.target).toBe('boss_wxid');
    expect(r.message).toContain('下线');
    expect(r.message).toContain('🔴');
  });

  it('开关未跳变（ON→ON / OFF→OFF）→ action=none，不播报', () => {
    expect(resolveToggleBroadcast(true, true, 'boss_wxid').action).toBe('none');
    expect(resolveToggleBroadcast(false, false, 'boss_wxid').action).toBe('none');
  });

  it('跳变但关键人未配置（空串/缺失）→ action=skip + reason，不阻塞开关', () => {
    const empty = resolveToggleBroadcast(false, true, '');
    expect(empty.action).toBe('skip');
    expect(empty.reason).toBe('key_contact_not_configured');
    const missing = resolveToggleBroadcast(true, false, undefined as unknown as string);
    expect(missing.action).toBe('skip');
    expect(missing.reason).toBe('key_contact_not_configured');
  });
});
