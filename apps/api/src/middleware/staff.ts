/**
 * staff 鉴权中间件
 *
 * 检查 X-User-Email 头是否在 STAFF_EMAILS 白名单中。
 * STAFF_EMAILS 未配置时一律 403（不同于 superAdminGuard 的 dev 放行）。
 */
import type { Request, Response, NextFunction } from 'express';

function parseStaffEmails(): string[] {
  const raw = process.env.STAFF_EMAILS ?? '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function staffGuard(req: Request, res: Response, next: NextFunction): void {
  const emailHeader = req.headers['x-user-email'];
  const userEmail = typeof emailHeader === 'string' ? emailHeader.trim().toLowerCase() : '';

  const staffEmails = parseStaffEmails();

  if (!userEmail || !staffEmails.includes(userEmail)) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: '需要员工账号权限' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}
