/**
 * 飞书登录态识别中间件 — Sprint A Day 3
 *
 * 职责：从请求头 X-Feishu-User-Id 读取当前用户飞书 open_id，挂到 req.feishuUserId。
 * 缺失头部时返回 401（视为未登录）。
 *
 * 安全提示（v1.2 限制）：当前不验证 token 真伪 — Dashboard 转发用户态由 nginx 把控。
 * 后续 Sprint（多租户隔离）会接入真实 token 校验。
 */
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    feishuUserId?: string;
  }
}

export function feishuUser(req: Request, res: Response, next: NextFunction): void {
  const headerVal = req.headers['x-feishu-user-id'];
  const id = typeof headerVal === 'string' ? headerVal.trim() : '';
  if (!id) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
        message: '缺少 X-Feishu-User-Id 头，未登录',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  req.feishuUserId = id;
  next();
}
