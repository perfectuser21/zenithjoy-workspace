import type { Request, Response } from 'express';

/** Stop new work for the retired Kotlin acquisition path after its existing tenant middleware. */
export function legacyAcquisitionRetired(req: Request, res: Response): void {
  if (!req.tenantId) {
    res.status(401).json({ success: false, error: { code: 'NO_TENANT', message: '缺租户上下文（未登录或无 X-Tenant-Id）' }, timestamp: new Date().toISOString() });
    return;
  }
  res.status(410).json({ success: false, error: { code: 'LEGACY_ACQUISITION_RETIRED', message: '旧版获客已停止使用' }, timestamp: new Date().toISOString() });
}
