/**
 * tenant-context 中间件 — 解析当前用户到 tenant_id（PR-2 better-auth 桥接）
 *
 * 解析顺序：
 *   1. better-auth session（cookie）→ user.id → tenant_members.feishu_user_id 反查
 *   2. 旧路径 X-Feishu-User-Id 头（向后兼容飞书登录通道）
 *   3. 都没 → 401
 *
 * 复用 tenant_members.feishu_user_id 列存"成员标识"——飞书 ID 或
 * better-auth user.id 都是字符串，业务无歧义（详见 src/auth-bridge.ts 决策）。
 *
 * 错误码：
 *   401 UNAUTHORIZED   — 缺 session 也无 X-Feishu-User-Id
 *   403 NO_TENANT      — 用户未关联到任何 tenant（未购买 license）
 */
import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';

declare module 'express-serve-static-core' {
  interface Request {
    feishuUserId?: string;
    tenantId?: string;
    tenantRole?: string;
  }
}

interface MemberRow {
  tenant_id: string;
  role: string;
}

/**
 * 尝试从 better-auth session 解析 user.id。
 * cookie 不存在或无效 → 返回 null。
 */
async function resolveAuthUserId(req: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const userId = session?.user?.id;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch (err) {
    // session 解析失败不阻塞——回落到 X-Feishu-User-Id 头
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn('[tenant-context] better-auth session 解析失败:', msg);
    return null;
  }
}

export async function tenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. 优先尝试 better-auth session
  const authUserId = await resolveAuthUserId(req);

  // 2. 旧路径 X-Feishu-User-Id 头
  const headerVal = req.headers['x-feishu-user-id'];
  const feishuId = typeof headerVal === 'string' ? headerVal.trim() : '';

  // 选定的 memberId（better-auth 优先）
  const memberId = authUserId || feishuId;

  if (!memberId) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
        message: '未登录（缺 better-auth session 或 X-Feishu-User-Id 头）',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // super-admin + 显式 X-Bypass-Tenant: true 时跳过 tenant 关联检查
  // （仅基于 X-Feishu-User-Id 头的 super-admin，与 PR #234 行为一致）
  const bypassHeader = req.headers['x-bypass-tenant'];
  const wantBypass =
    typeof bypassHeader === 'string' && bypassHeader.trim().toLowerCase() === 'true';
  if (wantBypass && feishuId) {
    const adminIds = (process.env.ADMIN_FEISHU_OPENIDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (adminIds.includes(feishuId)) {
      req.feishuUserId = feishuId;
      req.tenantId = ''; // 不会被使用（bypassTenant=true）
      req.tenantRole = 'super-admin';
      next();
      return;
    }
  }

  try {
    // 一个用户可能属于多 tenant（未来扩展），v1 默认取首个 owner，否则首个 member
    const { rows } = await pool.query<MemberRow>(
      `SELECT tenant_id, role
         FROM zenithjoy.tenant_members
        WHERE feishu_user_id = $1
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at ASC
        LIMIT 1`,
      [memberId]
    );

    if (rows.length === 0) {
      res.status(403).json({
        success: false,
        data: null,
        error: {
          code: 'NO_TENANT',
          message: '当前用户未关联到任何 tenant（请先购买 license 或联系管理员加入团队）',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.feishuUserId = memberId;
    req.tenantId = rows[0].tenant_id;
    req.tenantRole = rows[0].role;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'TENANT_LOOKUP_FAILED', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
}
