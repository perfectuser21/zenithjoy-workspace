/**
 * Better-auth 配置 — 邮箱+密码登录 + 邮件验证 + 忘记密码
 *
 * 主理人 2026-04-28 决策：
 *  - 飞书登录限于 ZenithJoy 内部主理人通道（保留）
 *  - 客户用邮箱+密码登录（跨企业通用，避免飞书 open_id per-app 限制）
 *  - 邮件验证 + 忘记密码标配
 *
 * PR-1 范围：
 *  - 装包 + 配置 + mount /api/auth/*
 *  - 邮件先 console.log（PR-4 接 SMTP）
 *  - 不与 tenant_members 桥接（PR-2 做）
 *  - 不改 Dashboard（PR-3 做）
 */
import { betterAuth } from 'better-auth';
import pool from './db/connection';

const TRUSTED_ORIGINS = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173,https://autopilot.zenjoymedia.media')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const BASE_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:5200';

const SECRET = process.env.BETTER_AUTH_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET 必须设置（≥ 32 字符）');
  }
  // dev 兜底（生产必须显式设置）
  console.warn('[better-auth] BETTER_AUTH_SECRET 未设置，使用 dev 默认（生产必改）');
}

export const auth = betterAuth({
  database: pool,
  baseURL: BASE_URL,
  secret: SECRET ?? 'dev-only-secret-change-me-in-production-please-min-32-chars',
  trustedOrigins: TRUSTED_ORIGINS,

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // PR-1：先关掉强制验证（让客户立即可登录测试）；PR-4 接 SMTP 后开
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,

    sendResetPassword: async ({ user, url }) => {
      // PR-1：邮件占位，console.log 让本地能看到链接
      // PR-4 替换为真实 SMTP
      console.log('[auth] 忘记密码邮件 →', user.email);
      console.log('[auth]   重置链接：', url);
    },

    onPasswordReset: async ({ user }) => {
      console.log('[auth] 密码已重置 →', user.email);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log('[auth] 验证邮件 →', user.email);
      console.log('[auth]   验证链接：', url);
    },
  },
});
