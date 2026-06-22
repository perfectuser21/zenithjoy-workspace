import { describe, it, expect } from 'vitest';
import { computeSubAccountLimit, SUB_ACCOUNT_LIMITS } from './sub-account-quota';

describe('computeSubAccountLimit', () => {
  it('按 license tier 映射子账号上限', () => {
    expect(computeSubAccountLimit('free')).toBe(0);
    expect(computeSubAccountLimit('basic')).toBe(3);
    expect(computeSubAccountLimit('matrix')).toBe(5);
    expect(computeSubAccountLimit('studio')).toBe(10);
    expect(computeSubAccountLimit('enterprise')).toBe(30);
  });

  it('未知 / 空 tier 按最保守 0 处理', () => {
    expect(computeSubAccountLimit('unknown')).toBe(0);
    expect(computeSubAccountLimit(null)).toBe(0);
    expect(computeSubAccountLimit(undefined)).toBe(0);
    expect(computeSubAccountLimit('')).toBe(0);
  });

  it('映射表与导出常量一致', () => {
    expect(SUB_ACCOUNT_LIMITS.matrix).toBe(5);
    expect(Object.keys(SUB_ACCOUNT_LIMITS)).toContain('enterprise');
  });
});
