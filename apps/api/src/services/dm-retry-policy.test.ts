/**
 * 失败线索的重投策略 —— 把闲置产能换成真实送达。
 *
 * 0821 真机数据：
 *   单次成功率 32%（2.1.35，6 成 13 败）
 *   **失败是随机的**：试过多次的 13 条线索里，6 条是"先失败、后成功"——
 *   同一个人换一次尝试就成了，不是这条线索发不出去。
 *   产能过剩：3 个小号 × 30 条/天 = 90 次配额，今天只用了 30 次，
 *   而当天新增可触达线索只有 15 条。
 *
 * 但旧去重把这条路堵死了：
 *   SELECT 1 FROM dm_assignments WHERE tenant_id AND lead_id AND account_label
 * **没有状态过滤、没有时间窗**——某个号派过一次（哪怕失败）就永远不能再试它。
 * 3 个小号 = 一条线索一辈子最多 3 次尝试。
 *
 * 按 32% 单次成功率算：3 次累计 69%，6 次累计 90%。
 * 这一刀不碰 RPA、不发版、不动手机，纯服务端把浪费的产能用起来。
 */
import { describe, it, expect } from 'vitest';
import { shouldAssignLead, DmRetryPolicy } from './dm-retry-policy';

const base = {
  sentByThisAccount: false,
  hasActiveAssignment: false,
  failedAttempts: 0,
  minutesSinceLastFailure: null as number | null,
};

describe('dm-retry-policy', () => {
  it('干净的新线索直接派', () => {
    expect(shouldAssignLead(base).assign).toBe(true);
  });

  it('这个号已经成功发过 → 绝不重发（别骚扰同一个人两次）', () => {
    const r = shouldAssignLead({ ...base, sentByThisAccount: true });
    expect(r.assign).toBe(false);
    expect(r.reason).toBe('already_sent');
  });

  it('已有在跑的派单 → 不重复排队', () => {
    const r = shouldAssignLead({ ...base, hasActiveAssignment: true });
    expect(r.assign).toBe(false);
    expect(r.reason).toBe('already_queued');
  });

  it('只失败过、且过了冷却 → **允许重投**（这是本刀的核心）', () => {
    const r = shouldAssignLead({
      ...base, failedAttempts: 2,
      minutesSinceLastFailure: DmRetryPolicy.COOLDOWN_MINUTES + 1,
    });
    expect(r.assign).toBe(true);
  });

  it('刚失败还没过冷却 → 等一等，别贴着重试', () => {
    const r = shouldAssignLead({
      ...base, failedAttempts: 1,
      minutesSinceLastFailure: DmRetryPolicy.COOLDOWN_MINUTES - 1,
    });
    expect(r.assign).toBe(false);
    expect(r.reason).toBe('cooling');
  });

  it('失败次数到顶 → 停手，别把配额烧在一条没希望的线索上', () => {
    const r = shouldAssignLead({
      ...base, failedAttempts: DmRetryPolicy.MAX_FAILED_ATTEMPTS,
      minutesSinceLastFailure: 999,
    });
    expect(r.assign).toBe(false);
    expect(r.reason).toBe('max_attempts');
  });

  it('上限必须够用又不能无限——按 32% 单次成功率，6 次累计约 90%', () => {
    expect(DmRetryPolicy.MAX_FAILED_ATTEMPTS).toBeGreaterThanOrEqual(4);
    expect(DmRetryPolicy.MAX_FAILED_ATTEMPTS).toBeLessThanOrEqual(8);
    const cumulative = 1 - Math.pow(1 - 0.32, DmRetryPolicy.MAX_FAILED_ATTEMPTS);
    expect(cumulative).toBeGreaterThan(0.85);
  });

  it('已成功优先于其它一切判定——即使失败次数到顶也走 already_sent', () => {
    const r = shouldAssignLead({
      ...base, sentByThisAccount: true,
      failedAttempts: 99, minutesSinceLastFailure: 0,
    });
    expect(r.reason).toBe('already_sent');
  });
});
