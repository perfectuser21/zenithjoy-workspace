import { describe, it, expect } from 'vitest';
import { isValidRole, assertBindable, VALID_SUB_ACCOUNT_ROLES } from './customer-admin-rules';

describe('isValidRole', () => {
  it('接受 admin | operator | service_agent', () => {
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('operator')).toBe(true);
    expect(isValidRole('service_agent')).toBe(true);
  });

  it('拒绝非法角色 / 空 / 非字符串', () => {
    expect(isValidRole('boss')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole(undefined)).toBe(false);
    expect(isValidRole(123)).toBe(false);
  });

  it('合法角色枚举恰好 3 个', () => {
    expect(VALID_SUB_ACCOUNT_ROLES.length).toBe(3);
  });
});

describe('assertBindable', () => {
  it('service_agent 可绑，不抛错', () => {
    expect(() => assertBindable({ role: 'service_agent' })).not.toThrow();
  });

  it('非 service_agent 抛 INVALID_BIND_ROLE', () => {
    expect(() => assertBindable({ role: 'operator' })).toThrow(/service_agent|INVALID_BIND_ROLE/);
    expect(() => assertBindable({ role: 'admin' })).toThrow(/INVALID_BIND_ROLE/);
  });

  it('抛出的错误带 code = INVALID_BIND_ROLE', () => {
    try {
      assertBindable({ role: 'operator' });
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('INVALID_BIND_ROLE');
    }
  });
});
