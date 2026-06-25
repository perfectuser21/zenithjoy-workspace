/**
 * auth-bridge — Better-auth user → tenant_members 桥接
 *
 * PR-2 行为：注册带有效 license_key → 加入对应 tenant（role='owner'，Gap4 修复：注册自己
 *   租户的人即主人，须能配自己客服机；旧 'member' 过不了 cs/setup 的 owner/admin 闸）
 * PR-B 行为（2026-04-29 主理人决策"注册即试用"）：
 *   注册不带 / 带无效 license_key → 自动创建：
 *     1. free license（tier='free', max_machines=0, customer_id=userId, 10 年有效）
 *     2. free tenant（plan='free', license_key 同上, name='Personal-{email}'）
 *     3. tenant_members(role='owner') 把用户绑到该 tenant
 *   全程事务包裹，失败 ROLLBACK，注册主流程不被阻塞。
 *
 * 设计决策：
 *  - 复用 tenant_members.feishu_user_id 列存 better-auth user.id（UUID 字符串）
 *    避免新增 migration / 影响 PR #234 现有飞书登录通道。该列在概念上是
 *    "成员标识"——飞书 ID 或 better-auth user.id 都是字符串，业务无歧义。
 *  - free tier max_machines=0 → Agent 注册会得 QUOTA_EXCEEDED（PR #226 已实现），
 *    free 用户云端可用、本地 Agent 不可用，符合产品决策。
 *  - DB 异常 → 不抛（注册主流程不被基础设施故障拖垮，记 console.error 日志）。
 */
import pool from './db/connection';
import {
  generateLicenseKey,
  TIER_QUOTA,
  FREE_TIER_DURATION_DAYS,
} from './services/license.service';

export interface BridgeArgs {
  /** Better-auth 创建的 user.id（UUID 字符串，写入 tenant_members.feishu_user_id 列） */
  userId: string;
  /** 用户邮箱（用于 free tenant 命名 'Personal-{email}'，可选） */
  email?: string | null;
  /** 注册请求 body 中的 license_key（可选） */
  licenseKey: string | undefined | null;
  /**
   * 角色（Gap4 修复：默认 owner；free fallback 也是 owner）。
   * 带 license 注册自己租户的人就是这个租户的主人，必须给 owner——否则 cs/setup
   * （配自己客服机）要 owner/admin，member 过不了 requireCsWriteAccess/requireCsAdmin。
   * 仍保留参数：上游若显式传 admin/member（如未来邀请协作者入伙）则尊重该值。
   */
  role?: 'owner' | 'admin' | 'member';
}

export type BridgeReason =
  | 'PAID_TENANT_LINKED'
  | 'FREE_TENANT_CREATED'
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
 *   1. 有 license_key → SELECT licenses；status='active' 且 tenant_id 非空 →
 *      INSERT tenant_members(role='owner')（PR-2 paid 路径，Gap4：注册自己租户即 owner）
 *   2. 否则（缺 / 无效 / 孤儿）→ 走 free fallback 事务：
 *      BEGIN
 *      INSERT licenses (tier='free', max_machines=0, customer_id=userId,
 *                       expires_at=now()+10yr) RETURNING id, license_key
 *      INSERT tenants (name='Personal-{email}', license_key, plan='free') RETURNING id
 *      UPDATE licenses SET tenant_id=tenant.id WHERE id=license.id
 *      INSERT tenant_members (tenant_id, feishu_user_id=userId, role='owner')
 *      COMMIT
 *   3. 任何异常 → ROLLBACK + 记 console.error，返回 reason='DB_ERROR'
 */
export async function bridgeNewUserToTenant(args: BridgeArgs): Promise<BridgeResult> {
  // Gap4：默认 owner（带 license 注册自己租户的人即租户主人，须能配自己客服机）。
  const { userId, email, licenseKey, role = 'owner' } = args;

  const trimmedKey = typeof licenseKey === 'string' ? licenseKey.trim() : '';

  // ─── PR-2 paid 路径：有 license_key 且有效 → 加入对应 tenant ───
  if (trimmedKey) {
    try {
      const { rows } = await pool.query<{ tenant_id: string | null; status: string }>(
        `SELECT tenant_id, status
           FROM zenithjoy.licenses
          WHERE license_key = $1
          LIMIT 1`,
        [trimmedKey]
      );

      if (rows.length > 0) {
        const lic = rows[0];
        if (lic.status === 'active' && lic.tenant_id) {
          await pool.query(
            `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING`,
            [lic.tenant_id, userId, role]
          );

          // ─── Gap2 修复：付费注册回填 licenses.customer_id = userId ───
          // 不回填会让 install-pack/download 与 /account/me（都按 customer_id 查 license）
          // 找不到该 user 的 license → 新付费客户 503 NO_ACTIVE_LICENSE、Account 显示 license=null。
          // 与 free 路径（createFreeTenantForUser 建 license 时即写 customer_id）对齐。
          // WHERE 限定 license_key 且 customer_id 仍为空 / 已是本 user，避免抢别家已绑的 license。
          // 回填失败不翻车（member 已写成功，注册主流程不被这步阻塞）——尽力而为。
          try {
            await pool.query(
              `UPDATE zenithjoy.licenses
                  SET customer_id = $1, updated_at = now()
                WHERE license_key = $2
                  AND (customer_id IS NULL OR customer_id = $1)`,
              [userId, trimmedKey]
            );
          } catch (backfillErr) {
            const m = backfillErr instanceof Error ? backfillErr.message : 'unknown';
            console.error('[auth-bridge] paid customer_id 回填失败（不阻塞注册）:', m);
          }

          return {
            linked: true,
            tenantId: lic.tenant_id,
            reason: 'PAID_TENANT_LINKED',
          };
        }
        // license inactive / 无 tenant → fall through 到 free 创建（注册即试用）
      }
      // license_key 无匹配 → fall through 到 free 创建
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error('[auth-bridge] paid lookup DB error:', msg);
      // paid 查询失败保守不再 fallback（避免在 DB 抖动时双写脏数据）
      return { linked: false, reason: 'DB_ERROR' };
    }
  }

  // ─── PR-B free fallback：自动创建 free license + tenant + owner member ───
  return createFreeTenantForUser(userId, email);
}

/**
 * 在事务里自动给新用户建 free license + free tenant + owner member。
 * 用于注册不带 license_key / license 无效 / 孤儿 license 三种 fallback 场景。
 */
async function createFreeTenantForUser(
  userId: string,
  email?: string | null
): Promise<BridgeResult> {
  const tenantName = `Personal-${email ?? userId}`;
  const expiresAt = new Date(Date.now() + FREE_TIER_DURATION_DAYS * 86400_000);
  const maxMachines = TIER_QUOTA.free; // 0

  // 防极小概率 license_key 冲突，最多 5 次重试（同 createLicense 套路）
  for (let attempt = 0; attempt < 5; attempt++) {
    const licenseKey = generateLicenseKey('free');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1) 建 free license（tenant_id 暂留 NULL，下面回填）
      let licInsert;
      try {
        licInsert = await client.query<{ id: string; license_key: string }>(
          `INSERT INTO zenithjoy.licenses
             (license_key, tier, max_machines, customer_id, expires_at, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           RETURNING id, license_key`,
          [licenseKey, 'free', maxMachines, userId, expiresAt.toISOString()]
        );
      } catch (err: unknown) {
        // unique_violation = 23505（license_key 撞车）→ ROLLBACK 重试
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        ) {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
          continue;
        }
        throw err;
      }
      const licenseId = licInsert.rows[0].id;

      // 2) 建 free tenant
      const tenantInsert = await client.query<{ id: string }>(
        `INSERT INTO zenithjoy.tenants (name, license_key, plan)
         VALUES ($1, $2, 'free')
         RETURNING id`,
        [tenantName, licenseKey]
      );
      const tenantId = tenantInsert.rows[0].id;

      // 3) 回填 license.tenant_id
      await client.query(
        `UPDATE zenithjoy.licenses SET tenant_id = $1, updated_at = now() WHERE id = $2`,
        [tenantId, licenseId]
      );

      // 4) 建 owner member（role 走参数，方便测试断言 + 未来 RBAC 扩展）
      await client.query(
        `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING`,
        [tenantId, userId, 'owner']
      );

      await client.query('COMMIT');
      return {
        linked: true,
        tenantId,
        reason: 'FREE_TENANT_CREATED',
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error('[auth-bridge] free fallback DB error:', msg);
      return { linked: false, reason: 'DB_ERROR' };
    } finally {
      client.release();
    }
  }
  console.error(
    '[auth-bridge] free fallback license_key 5 次冲突仍失败，userId=',
    userId
  );
  return { linked: false, reason: 'DB_ERROR' };
}
