import { describe, it, expect } from 'vitest';

// TDD Red — 以下模块/导出在实现前不存在，import 即失败（真红证据）。
// Generator 实现后转绿；这些是单元级护栏，evaluator 的 oracle 是 contract-dod.md 的 [BEHAVIOR] manual:bash。

// 子账号配额映射（合同决策：free=0/basic=3/matrix=5/studio=10/enterprise=30）
// @ts-expect-error 实现前不存在
import { computeSubAccountLimit } from '../../../apps/api/src/lib/sub-account-quota';
// 角色合法性 + 绑定守卫
// @ts-expect-error 实现前不存在
import { isValidRole, assertBindable } from '../../../apps/api/src/lib/customer-admin-rules';

describe('客户管理后台 [BEHAVIOR]', () => {
  it('子账号配额随 license tier 映射', () => {
    expect(computeSubAccountLimit('free')).toBe(0);
    expect(computeSubAccountLimit('basic')).toBe(3);
    expect(computeSubAccountLimit('matrix')).toBe(5);
    expect(computeSubAccountLimit('studio')).toBe(10);
    expect(computeSubAccountLimit('enterprise')).toBe(30);
  });

  it('role 仅接受 admin|operator|service_agent', () => {
    expect(isValidRole('service_agent')).toBe(true);
    expect(isValidRole('operator')).toBe(true);
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('boss')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });

  it('只有 service_agent 角色可绑 PC，非该角色抛错', () => {
    expect(() => assertBindable({ role: 'service_agent' })).not.toThrow();
    expect(() => assertBindable({ role: 'operator' })).toThrow(/service_agent|INVALID_BIND_ROLE/);
  });
});
