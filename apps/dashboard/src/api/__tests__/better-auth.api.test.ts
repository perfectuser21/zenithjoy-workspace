/**
 * better-auth.api 客户端契约测试 — PR-3 Dashboard 邮箱+密码登录
 *
 * 完整 BEHAVIOR 在 SignIn / SignUp / ForgotPassword 页面测试中（用 fetch mock）。
 * 此处只验证 5 个 client 函数的导出契约。
 */
import { describe, it, expect } from 'vitest';
import {
  signUpEmail,
  signInEmail,
  signOut,
  getSession,
  requestPasswordReset,
} from '../better-auth.api';

describe('api/better-auth 契约', () => {
  it('导出 signUpEmail 函数', () => {
    expect(typeof signUpEmail).toBe('function');
  });

  it('导出 signInEmail 函数', () => {
    expect(typeof signInEmail).toBe('function');
  });

  it('导出 signOut 函数', () => {
    expect(typeof signOut).toBe('function');
  });

  it('导出 getSession 函数', () => {
    expect(typeof getSession).toBe('function');
  });

  it('导出 requestPasswordReset 函数', () => {
    expect(typeof requestPasswordReset).toBe('function');
  });
});
