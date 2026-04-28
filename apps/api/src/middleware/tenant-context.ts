/**
 * tenant-context 中间件 — 解析飞书登录用户到 tenant_id
 *
 * 替代 Sprint B 的 feishuUser 中间件作为业务表多租户隔离的入口。
 *
 * 解析链：
 *   X-Feishu-User-Id 头
 *     → tenant_members.feishu_user_id 查 tenant_id
 *     → 设 req.tenantId / req.feishuUserId / req.tenantRole
 *
 * 错误码：
 *   401 UNAUTHORIZED   — 缺 X-Feishu-User-Id 头
 *   403 NO_TENANT      — 用户未关联到任何 tenant（未购买 license）
 */
import type { Request, Response, NextFunction } from 'express';
import pool from '../db/connection';

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

export async function tenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const headerVal = req.headers['x-feishu-user-id'];
  const feishuId = typeof headerVal === 'string' ? headerVal.trim() : '';

  if (!feishuId) {
    res.status(401).json({
      success: false,
      data: null,
      error: { code: 'UNAUTHORIZED', message: '缺少 X-Feishu-User-Id 头，未登录' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // super-admin + 显式 X-Bypass-Tenant: true 时跳过 tenant 关联检查（仅 super-admin 用此走 admin 视角）
  const bypassHeader = req.headers['x-bypass-tenant'];
  const wantBypass =
    typeof bypassHeader === 'string' && bypassHeader.trim().toLowerCase() === 'true';
  if (wantBypass) {
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
      [feishuId]
    );

    if (rows.length === 0) {
      res.status(403).json({
        success: false,
        data: null,
        error: {
          code: 'NO_TENANT',
          message: '当前飞书用户未关联到任何 tenant（请先购买 license 或联系管理员加入团队）',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.feishuUserId = feishuId;
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
