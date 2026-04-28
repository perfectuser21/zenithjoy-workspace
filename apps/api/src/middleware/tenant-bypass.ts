/**
 * tenant-bypass 中间件 — Sprint B Day 4-5
 *
 * 当 super-admin 显式设 X-Bypass-Tenant: true 时，挂 req.bypassTenant = true
 * 业务层（service）依据该标志决定是否跳过 owner_id 过滤。
 *
 * 安全：仅 ADMIN_FEISHU_OPENIDS 中的飞书 ID 可成功设置（普通用户携带头部无效）。
 */
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    bypassTenant?: boolean;
  }
}

function parseAdminIds(): string[] {
  const raw = process.env.ADMIN_FEISHU_OPENIDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function tenantBypass(req: Request, _res: Response, next: NextFunction): void {
  const headerVal = req.headers['x-feishu-user-id'];
  const id = typeof headerVal === 'string' ? headerVal.trim() : '';
  const bypassHeader = req.headers['x-bypass-tenant'];
  const wantBypass =
    typeof bypassHeader === 'string' && bypassHeader.trim().toLowerCase() === 'true';

  if (wantBypass && id) {
    const adminIds = parseAdminIds();
    if (adminIds.includes(id)) {
      req.bypassTenant = true;
    }
  }
  next();
}
