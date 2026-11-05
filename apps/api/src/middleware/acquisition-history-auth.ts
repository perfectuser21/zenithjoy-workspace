import type { Request, Response, NextFunction } from 'express';
import { workbenchAuthGuard } from './workbench-auth';

/** Retained browser history and cancellation must derive the tenant from the authenticated session. */
export function acquisitionHistoryAuth(req: Request, res: Response, next: NextFunction): void {
  void workbenchAuthGuard(req, res, () => {
    if (!req.workbenchIdentity) {
      res.status(503).json({ success: false, error: { code: 'HISTORY_UNAVAILABLE', message: '历史记录暂时不可用，请稍后重试' } });
      return;
    }
    req.tenantId = req.workbenchIdentity.orgId;
    next();
  });
}
