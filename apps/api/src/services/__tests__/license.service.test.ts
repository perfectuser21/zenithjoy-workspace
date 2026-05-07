/**
 * license.service 单元测试 — Walking Skeleton #1 license loop
 *
 * 主理人 2026-05-07 决策：free tier 配额从 0 → 1。
 * 之前 free=0 → Agent heartbeat 必撞 QUOTA_EXCEEDED → walking skeleton
 * "客户首次成功路径"在 Agent 装机这步就断了。
 * 改成 free=1，让"注册即试用 1 台 Agent"真正贯通。
 */
import { describe, it, expect } from 'vitest';
import { TIER_QUOTA } from '../license.service';

describe('TIER_QUOTA — walking-skeleton-1 license loop', () => {
  it('free tier 允许 1 台 Agent 装机（thin 阶段产品决策）', () => {
    expect(TIER_QUOTA.free).toBe(1);
  });

  it('付费 tier 配额保持不变，避免误改商业模式', () => {
    expect(TIER_QUOTA.basic).toBe(1);
    expect(TIER_QUOTA.matrix).toBe(3);
    expect(TIER_QUOTA.studio).toBe(10);
    expect(TIER_QUOTA.enterprise).toBe(30);
  });
});
