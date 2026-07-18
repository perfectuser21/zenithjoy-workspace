/**
 * simple-rate-limit — voice-outreach 路由限流（基于 express-rate-limit）。
 *
 * 背景：CodeQL js/missing-rate-limiting 要求碰鉴权+DB 的路由必须限流，且只识别
 * 它建模过的知名限流库（express-rate-limit 是首选，见 CodeQL 官方 query help）——
 * 手写的进程内限流函数即便逻辑正确也不会被识别为合法 mitigation，改用该库直接
 * 满足静态分析 + 拿到更成熟的实现（标准 RateLimit-* 响应头等）。
 *
 * 按 tenant_id 隔离计数（而非默认按 IP），因为调用方是我们自己的中台/客户端，
 * 同一租户的不同请求可能经不同出口 IP，按 tenant 限流才是真实的业务边界。
 */
import { rateLimit } from 'express-rate-limit';
import type { Request } from 'express';

/** 按 tenant_id 限流（body / query 均取，配合 tenantContext 中间件之后使用）。 */
export function tenantKeyFn(req: Request): string {
  return req.tenantId || (req.body && req.body.tenant_id) || (req.query && req.query.tenant_id) || 'anonymous';
}

export function simpleRateLimit(opts: { windowMs: number; max: number; keyFn?: (req: Request) => string }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    keyGenerator: opts.keyFn ?? tenantKeyFn,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `请求过于频繁，请稍后重试（限 ${opts.max} 次/${opts.windowMs / 1000}秒）`,
        },
      });
    },
  });
}
