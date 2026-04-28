/**
 * Better-auth 配置单元测试 — 验证 auth 实例导出 + 关键能力开关
 *
 * 完整 BEHAVIOR 在 .github/workflows/scripts/smoke/auth-smoke.sh（真实链路）
 */
import { describe, it, expect } from 'vitest';
import { auth } from '../src/auth';

describe('better-auth 配置契约', () => {
  it('导出 auth 实例', () => {
    expect(auth).toBeDefined();
  });

  it('auth 含 handler（HTTP 处理函数）', () => {
    expect(typeof auth.handler).toBe('function');
  });

  it('auth.api 含 signUpEmail / signInEmail / getSession 方法', () => {
    expect(typeof auth.api.signUpEmail).toBe('function');
    expect(typeof auth.api.signInEmail).toBe('function');
    expect(typeof auth.api.getSession).toBe('function');
  });

  it('auth.api 含 forgetPassword / resetPassword 方法（忘记密码流程）', () => {
    expect(typeof auth.api.requestPasswordReset).toBe('function');
    expect(typeof auth.api.resetPassword).toBe('function');
  });

  it('auth.api 含 sendVerificationEmail / verifyEmail 方法（邮件验证）', () => {
    expect(typeof auth.api.sendVerificationEmail).toBe('function');
    expect(typeof auth.api.verifyEmail).toBe('function');
  });
});
