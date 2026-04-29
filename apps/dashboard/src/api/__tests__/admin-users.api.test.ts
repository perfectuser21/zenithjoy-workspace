/**
 * admin-users.api 客户端契约测试 — PR-A 超管会员管理
 *
 * 完整 BEHAVIOR 在 AdminUsersPage.test.tsx（用 fetch mock）。
 * 此处验证 client 函数的导出契约。
 */
import { describe, it, expect } from 'vitest';
import {
  listUsers,
  addUserToTenant,
  removeUserFromTenant,
  deleteUser,
} from '../admin-users.api';

describe('api/admin-users 契约', () => {
  it('导出 listUsers', () => {
    expect(typeof listUsers).toBe('function');
  });

  it('导出 addUserToTenant', () => {
    expect(typeof addUserToTenant).toBe('function');
  });

  it('导出 removeUserFromTenant', () => {
    expect(typeof removeUserFromTenant).toBe('function');
  });

  it('导出 deleteUser', () => {
    expect(typeof deleteUser).toBe('function');
  });
});
