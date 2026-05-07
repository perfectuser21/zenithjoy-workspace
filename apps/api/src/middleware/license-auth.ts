/**
 * License Auth 中间件 — Walking Skeleton #1
 *
 * 用途：保护 Agent 调用的端点（heartbeat / folder/bind / publish/* / receipt）。
 *
 * 取 license key 来源（优先级从高到低）：
 *   1. Authorization: Bearer <license_key>
 *   2. X-License-Key: <license_key>
 *   3. body.license（仅 heartbeat 端点用，因为首次握手没有上下文）
 *
 * 校验通过：把 license 信息挂到 req.license。
 * 校验失败：401 INVALID_LICENSE / 403 EXPIRED|REVOKED|SUSPENDED|NO_TENANT。
 */

import { Request, Response, NextFunction } from 'express';
import {
  validateLicense,
  LicenseRowMin,
} from '../services/walking-skeleton.service';

declare module 'express-serve-static-core' {
  interface Request {
    license?: LicenseRowMin;
  }
}

function extractLicenseKey(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const v = authHeader.slice('Bearer '.length).trim();
    if (v) return v;
  }
  const headerKey = req.headers['x-license-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  // body.license 兜底（仅 heartbeat 用）
  const body = (req.body ?? {}) as { license?: unknown };
  if (typeof body.license === 'string' && body.license.trim()) {
    return body.license.trim();
  }
  return null;
}

export async function licenseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const key = extractLicenseKey(req);
  if (!key) {
    res.status(401).json({
      ok: false,
      code: 'INVALID_LICENSE',
      message: '缺少 license。请加 Authorization: Bearer <license_key>',
    });
    return;
  }

  try {
    const result = await validateLicense(key);
    if (!result.ok) {
      const httpStatus =
        result.code === 'INVALID_LICENSE'
          ? 401
          : 403;
      res.status(httpStatus).json({
        ok: false,
        code: result.code,
        message: result.message,
      });
      return;
    }
    req.license = result.license;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: msg,
    });
  }
}
