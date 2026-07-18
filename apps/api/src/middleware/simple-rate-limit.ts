/**
 * simple-rate-limit — 进程内滑动窗口限流（无外部依赖，单实例够用，GP-A skeleton 阶段）。
 *
 * 背景：CodeQL 对碰鉴权+DB 的路由强制要求限流保护（missing-rate-limiting）。
 * 仓库目前没有任何限流中间件/依赖（express-rate-limit 未装），新增专用第三方包
 * 对一个 thin skeleton 功能过重——自实现一个够用的 Map 版滑动窗口即可。
 *
 * 限制：进程内内存，多实例部署时各实例独立计数（非全局精确限流）。
 * 后续加厚到 medium/thick 阶段如需跨实例精确限流，再评估换 Redis 版。
 */
import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export function simpleRateLimit(opts: {
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
}) {
  const { windowMs, max, keyFn } = opts;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }

    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: `请求过于频繁，请稍后重试（限 ${max} 次/${windowMs / 1000}秒）` },
      });
    }

    bucket.hits.push(now);
    next();
  };
}

/** 按 tenant_id 限流（body / query 均取，配合 tenantContext 中间件之后使用）。 */
export function tenantKeyFn(req: Request): string {
  return req.tenantId || (req.body && req.body.tenant_id) || (req.query && req.query.tenant_id) || 'anonymous';
}
