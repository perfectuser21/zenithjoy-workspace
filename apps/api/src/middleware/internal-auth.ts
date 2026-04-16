/**
 * 内部 API 鉴权中间件（Bearer token）
 *
 * 用于保护 topics / pacing-config / pipelines-worker 等只供本机
 * Python workers & creator-api 调用的端点。
 *
 * 规则：
 *  - token 来源：env ZENITHJOY_INTERNAL_TOKEN
 *  - 请求头：Authorization: Bearer <token>  或  X-Internal-Token: <token>
 *  - env 未设置：打印 warn 并放行（dev 友好，兼容本地开发）
 *  - env 设置但请求 token 不匹配：返回 401 UNAUTHORIZED
 *  - env 设置但请求无 token：返回 401 UNAUTHORIZED
 *
 * 由 /tmp/pipeline-migration-plan/02-api-contract.md § 鉴权 定义。
 */

import { Request, Response, NextFunction } from 'express';

let warnedAboutMissingToken = false;

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  const internalHeader = req.headers['x-internal-token'];
  if (typeof internalHeader === 'string' && internalHeader.trim()) {
    return internalHeader.trim();
  }
  return null;
}

export function internalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.ZENITHJOY_INTERNAL_TOKEN;

  if (!expected) {
    if (!warnedAboutMissingToken) {
      console.warn(
        '[internal-auth] ZENITHJOY_INTERNAL_TOKEN 未设置 — 内部端点将放行所有请求（dev 模式）。生产环境必须设置。'
      );
      warnedAboutMissingToken = true;
    }
    next();
    return;
  }

  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
        message:
          '缺少鉴权信息。请在请求头加 Authorization: Bearer <token> 或 X-Internal-Token: <token>',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (provided !== expected) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token 无效',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}

// 测试辅助：重置 warn flag（仅 test 用）
export function __resetInternalAuthWarnFlag(): void {
  warnedAboutMissingToken = false;
}
