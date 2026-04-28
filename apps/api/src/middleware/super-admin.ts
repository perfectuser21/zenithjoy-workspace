/**
 * super-admin 鉴权中间件 — Sprint A Day 3
 *
 * 双路径设计（向后兼容现有 license-smoke.sh 使用 internalAuth 的场景）：
 *
 *  1. 用户身份路径：客户端携带 X-Feishu-User-Id 头
 *     - 头部值在 ADMIN_FEISHU_OPENIDS 白名单 → next()，挂 req.feishuUserId
 *     - 头部值不在白名单 → 403 FORBIDDEN
 *
 *  2. 内部服务路径：缺 X-Feishu-User-Id 时 fallback 到 internalAuth 模式
 *     - Authorization: Bearer 或 X-Internal-Token 与 ZENITHJOY_INTERNAL_TOKEN 匹配 → next()
 *     - env 未设置（dev 兼容）→ next()
 *     - env 已设置但 token 不匹配/缺失 → 401 UNAUTHORIZED
 */
import type { Request, Response, NextFunction } from 'express';

function parseAdminIds(): string[] {
  const raw = process.env.ADMIN_FEISHU_OPENIDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function extractInternalToken(req: Request): string {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const internalHeader = req.headers['x-internal-token'];
  if (typeof internalHeader === 'string') {
    return internalHeader.trim();
  }
  return '';
}

export function superAdminGuard(req: Request, res: Response, next: NextFunction): void {
  const headerVal = req.headers['x-feishu-user-id'];
  const feishuId = typeof headerVal === 'string' ? headerVal.trim() : '';

  // 路径 1：用户身份
  if (feishuId) {
    const adminIds = parseAdminIds();
    if (adminIds.includes(feishuId)) {
      req.feishuUserId = feishuId;
      next();
      return;
    }
    res.status(403).json({
      success: false,
      data: null,
      error: {
        code: 'FORBIDDEN',
        message: '需要 super-admin 权限',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 路径 2：内部服务 fallback（向后兼容 license-smoke.sh）
  const tok = extractInternalToken(req);
  const expected = process.env.ZENITHJOY_INTERNAL_TOKEN;
  if (!expected) {
    // dev 兼容：env 未设置时放行
    next();
    return;
  }
  if (tok && tok === expected) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    data: null,
    error: {
      code: 'UNAUTHORIZED',
      message: '需要 super-admin 用户登录或合法 internal token',
    },
    timestamp: new Date().toISOString(),
  });
}
