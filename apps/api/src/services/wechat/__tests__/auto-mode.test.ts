/**
 * auto-mode.test.ts — 无审批自动回复「模式裁决 + 拟人延迟」单测（Line 04）
 *
 * 对应 Golden Path Step 2/3：名单内+营业时间内+自动代理ON → auto；OFF → review(监控)；
 * 名单外 → pending_human；营业时间外 → out_of_hours（记 pending 待上班，不发）。
 * 拟人延迟：名单内自动回随机等待 1~5 秒（NFR）。
 *
 * 纯函数，环境无关 → 逻辑断言，CI 绿 = 真 done。
 */
import { describe, it, expect } from 'vitest';
import { decideReplyMode, humanDelayMs } from '../auto-mode';

describe('decideReplyMode [BEHAVIOR] 模式裁决树', () => {
  it('自动代理 OFF（默认监控态）→ review（出草稿等审，不发）', () => {
    expect(decideReplyMode({ enabled: false, inWhitelist: true, inBusinessHours: true })).toBe('review');
    // OFF 时即便名单外/非营业时间，统一退回监控态语义（不自动发）
    expect(decideReplyMode({ enabled: false, inWhitelist: false, inBusinessHours: false })).toBe('review');
  });

  it('ON + 名单外 → pending_human（不生成不发，记待人工接管）', () => {
    expect(decideReplyMode({ enabled: true, inWhitelist: false, inBusinessHours: true })).toBe('pending_human');
  });

  it('ON + 名单内 + 营业时间外 → out_of_hours（不自动回，记 pending 待上班）', () => {
    expect(decideReplyMode({ enabled: true, inWhitelist: true, inBusinessHours: false })).toBe('out_of_hours');
  });

  it('ON + 名单内 + 营业时间内 → auto（无审批自动回）', () => {
    expect(decideReplyMode({ enabled: true, inWhitelist: true, inBusinessHours: true })).toBe('auto');
  });
});

describe('humanDelayMs [BEHAVIOR] 拟人延迟 1~5 秒', () => {
  it('返回值恒在 [1000, 5000] ms 闭区间内（采样 500 次）', () => {
    for (let i = 0; i < 500; i++) {
      const d = humanDelayMs();
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(5000);
    }
  });

  it('不是常量（500 次采样至少出现 2 个不同值，确属随机）', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(humanDelayMs());
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});
