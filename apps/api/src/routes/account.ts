/**
 * /api/account — 已登录客户自查端点
 *
 * Walking Skeleton #1 license loop 修复：客户注册后 Dashboard 看不到自己的
 * free license_key（注册响应不返；admin/license/me 只走 X-Feishu-User-Id 通道）。
 * 本路由用 better-auth session 鉴权，返回 user + 当前 license（裁剪到 4 字段）。
 *
 * 端点：
 *   GET /api/account/me
 *     200 → { user: {id,email,name}, license: {license_key,tier,max_machines,expires_at} | null }
 *     401 → { error: { message: '未登录' } }
 *
 * 设计：
 *   - 鉴权用 better-auth getSession（cookie），与 dashboard 现有登录态一致
 *   - SQL 用 customer_id = user.id 反查 zenithjoy.licenses（auth-bridge 注册时把
 *     user.id 写到 customer_id 列）
 *   - 没找到 license → 返 license: null（注册流程未跑完时不报 404，避免 UI 误导）
 *   - 暴露字段裁剪：customer_id / status / id 等内部字段不外露
 */

import { Router, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';

export const accountRouter = Router();

interface LicenseRowSlice {
  license_key: string;
  tier: string;
  max_machines: number;
  expires_at: string;
}

accountRouter.get('/me', async (req: Request, res: Response) => {
  // 1. 解析 better-auth session
  let userId = '';
  let email: string | null = null;
  let name: string | null = null;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (user && typeof user.id === 'string' && user.id.length > 0) {
      userId = user.id;
      email = typeof user.email === 'string' ? user.email : null;
      name = typeof user.name === 'string' ? user.name : null;
    }
  } catch (err) {
    // session 解析失败按未登录处理（与 tenant-context 一致）
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn('[account/me] better-auth session 解析失败:', msg);
  }

  if (!userId) {
    return res.status(401).json({
      error: { message: '未登录' },
    });
  }

  // 2. 查 license（裁剪到 4 个字段）
  // 安全：SQL 参数化绑定 — customer_id = $1 + 第二参数 [userId]，pg 驱动负责转义，
  // userId 不直接拼接进 SQL 字符串，无 SQL injection 风险。
  try {
    const { rows } = await pool.query<LicenseRowSlice>(
      `SELECT license_key, tier, max_machines, expires_at
         FROM zenithjoy.licenses
        WHERE customer_id = $1   -- $1 = userId，参数化绑定
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]  // ← 参数数组，pg 驱动安全注入到 $1 占位符
    );
    const license = rows[0] ?? null;

    return res.status(200).json({
      user: { id: userId, email, name },
      license: license
        ? {
            license_key: license.license_key,
            tier: license.tier,
            max_machines: license.max_machines,
            expires_at: license.expires_at,
          }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      error: { code: 'FETCH_FAILED', message: msg },
    });
  }
});

export default accountRouter;
