/**
 * 员工服务端会话签发 —— 走 better-auth 自己的会话存储与 token 语义
 *
 * 判定点 J-D 选的是「解析 better-auth session」而不是自签 JWT：自签等于在
 * tenant-context.ts 既有的 better-auth 解析先例之外再造一套认证，两套并存迟早分叉。
 * 因此这里不发明 token 格式——用 internalAdapter.createSession 落真 session 行，
 * cookie 值按 better-auth 的签名口径拼（token.HMAC(token, secret)），
 * 于是 knowledgeAuthGuard 里的 auth.api.getSession() 能原样校验它。
 *
 * user.id 直接取飞书 open_id：tenant_members.feishu_user_id 这一列本来就存"成员标识"
 * （飞书 ID 或 better-auth user.id 都是字符串，见 src/auth-bridge.ts 的决策），
 * 让两者相等就不必再维护一张 open_id ↔ user.id 映射，少一处会不同步的地方。
 *
 * user.email 用合成地址而非飞书真实邮箱：真实邮箱可能已被同一个人的客户账号占用，
 * 而 better-auth 的 user.email 是唯一约束，撞上就会让员工登录整个失败。
 */
import type { Response } from 'express';
import { makeSignature } from 'better-auth/crypto';
import { auth } from './auth';

/** 与 better-auth 默认 sessionToken maxAge 对齐：7 天 */
export const STAFF_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface StaffSessionSubject {
  openId: string;
  name: string;
  email: string;
}

function syntheticEmail(openId: string): string {
  return `${openId}@feishu-staff.local`;
}

async function ensureUser(subject: StaffSessionSubject): Promise<string> {
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserById(subject.openId);
  if (existing) return existing.id;

  try {
    const created = await ctx.internalAdapter.createUser({
      id: subject.openId,
      name: subject.name || subject.openId,
      email: syntheticEmail(subject.openId),
      emailVerified: true,
    });
    return created.id;
  } catch (err) {
    // 并发登录时两个请求可能同时建同一个 user，后到的那个撞唯一约束——再查一次即可
    const retry = await ctx.internalAdapter.findUserById(subject.openId);
    if (retry) return retry.id;
    throw err;
  }
}

/**
 * 签发会话并写 Set-Cookie。三个属性（HttpOnly / Secure / SameSite=Lax）显式拼，
 * 不依赖 better-auth 的 useSecureCookies 全局开关——那个开关一改会连带影响客户侧
 * 邮箱密码登录的 cookie 行为，属于本 sprint 不该碰的范围。
 */
export async function issueStaffSession(res: Response, subject: StaffSessionSubject): Promise<void> {
  const ctx = await auth.$context;
  const userId = await ensureUser(subject);
  const session = await ctx.internalAdapter.createSession(userId, false);
  if (!session?.token) throw new Error('STAFF_SESSION_CREATE_FAILED: better-auth 未返回 session token');

  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  const cookieName = ctx.authCookies.sessionToken.name;
  const attrs = [
    `${cookieName}=${signed}`,
    'Path=/',
    `Max-Age=${STAFF_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
  res.append('Set-Cookie', attrs);
}
