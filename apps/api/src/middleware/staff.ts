/**
 * staff 鉴权中间件
 *
 * 检查 X-User-Email 是否在 STAFF_EMAILS 白名单，或 X-Feishu-User-Id 是否在
 * STAFF_FEISHU_OPENIDS 白名单，任一命中即放行。open_id 兜底是因为部分飞书账号
 * 从不返回 email 字段（即使已开通 contact:user.email:readonly 权限），而 open_id
 * 是飞书 OAuth 必定返回的字段，不依赖任何额外权限审批。
 * 两个白名单都未配置/都不命中时一律 403（不同于 superAdminGuard 的 dev 放行）。
 */
import type { Request, Response, NextFunction } from 'express';

function parseStaffEmails(): string[] {
  const raw = process.env.STAFF_EMAILS ?? '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function parseStaffFeishuOpenIds(): string[] {
  const raw = process.env.STAFF_FEISHU_OPENIDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function staffGuard(req: Request, res: Response, next: NextFunction): void {
  const emailHeader = req.headers['x-user-email'];
  const userEmail = typeof emailHeader === 'string' ? emailHeader.trim().toLowerCase() : '';
  const openIdHeader = req.headers['x-feishu-user-id'];
  const userOpenId = typeof openIdHeader === 'string' ? openIdHeader.trim() : '';

  const emailOk = userEmail !== '' && parseStaffEmails().includes(userEmail);
  const openIdOk = userOpenId !== '' && parseStaffFeishuOpenIds().includes(userOpenId);

  if (!emailOk && !openIdOk) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: '需要员工账号权限' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 挂载实际通过校验的身份，供下游路由使用（例如验收结果提交的 submitted_by 留痕）。
  // 下游绝不能自行重新解析原始 X-User-Email/X-Feishu-User-Id header——那两个头未经校验，
  // 只要另一个头命中白名单就能放行，若下游各自解析会让未验证的字符串被当成可信身份写入审计记录。
  (req as Request & { staffIdentity?: string }).staffIdentity = emailOk ? userEmail : userOpenId;

  next();
}
