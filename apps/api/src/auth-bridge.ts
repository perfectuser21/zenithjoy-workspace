/**
 * auth-bridge — Better-auth user → tenant_members 桥接（PR-2）
 *
 * 职责：注册成功后根据 license_key 把用户写入 tenant_members 关联到对应 tenant。
 *
 * 设计决策：
 *  - 复用 tenant_members.feishu_user_id 列存 better-auth user.id（UUID 字符串）
 *    避免新增 migration / 影响 PR #234 现有飞书登录通道。该列在概念上是
 *    "成员标识"——飞书 ID 或 better-auth user.id 都是字符串，业务无歧义。
 *  - 无 license_key / license 无效 → 不报错、不阻塞注册（用户依然成功创建，
 *    后续访问 /api/works 会得到 403 NO_TENANT，前端引导购买）。
 *  - DB 异常 → 不抛（注册主流程不被基础设施故障拖垮，记 console.error 日志）。
 */
import pool from './db/connection';

export interface BridgeArgs {
  /** Better-auth 创建的 user.id（UUID 字符串，写入 tenant_members.feishu_user_id 列） */
  userId: string;
  /** 注册请求 body 中的 license_key（可选） */
  licenseKey: string | undefined | null;
  /** 角色（默认 member） */
  role?: 'owner' | 'admin' | 'member';
}

export type BridgeReason =
  | 'NO_LICENSE_KEY'
  | 'LICENSE_NOT_FOUND'
  | 'LICENSE_INACTIVE'
  | 'LICENSE_NO_TENANT'
  | 'DB_ERROR';

export interface BridgeResult {
  linked: boolean;
  tenantId?: string;
  reason?: BridgeReason;
}

/**
 * 把刚注册的 better-auth user 关联到 tenant_members。
 *
 * 流程：
 *   1. 校验 license_key 非空
 *   2. SELECT licenses WHERE license_key=? → 拿 tenant_id + status
 *   3. 校验 status='active' 且 tenant_id 非空
 *   4. INSERT tenant_members (tenant_id, feishu_user_id=userId, role)
 *      ON CONFLICT DO NOTHING（idempotent）
 *
 * 任何异常都被吞掉（注册流程不应被阻塞），只在日志中记录。
 */
export async function bridgeNewUserToTenant(args: BridgeArgs): Promise<BridgeResult> {
  const { userId, licenseKey, role = 'member' } = args;

  const trimmedKey = typeof licenseKey === 'string' ? licenseKey.trim() : '';
  if (!trimmedKey) {
    return { linked: false, reason: 'NO_LICENSE_KEY' };
  }

  try {
    const { rows } = await pool.query<{ tenant_id: string | null; status: string }>(
      `SELECT tenant_id, status
         FROM zenithjoy.licenses
        WHERE license_key = $1
        LIMIT 1`,
      [trimmedKey]
    );

    if (rows.length === 0) {
      return { linked: false, reason: 'LICENSE_NOT_FOUND' };
    }

    const lic = rows[0];
    if (lic.status !== 'active') {
      return { linked: false, reason: 'LICENSE_INACTIVE' };
    }
    if (!lic.tenant_id) {
      return { linked: false, reason: 'LICENSE_NO_TENANT' };
    }

    await pool.query(
      `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING`,
      [lic.tenant_id, userId, role]
    );

    return { linked: true, tenantId: lic.tenant_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[auth-bridge] bridgeNewUserToTenant DB error:', msg);
    return { linked: false, reason: 'DB_ERROR' };
  }
}
