/**
 * Admin License 路由 — v1.2 Day 1-2
 *
 * 鉴权：复用 internalAuth（ZENITHJOY_INTERNAL_TOKEN）
 *
 * 端点：
 *   POST   /admin/license       生成 license
 *   GET    /admin/license       列出 license
 *   DELETE /admin/license/:id   吊销 license
 */

import { Router, Request, Response } from 'express';
import { internalAuth } from '../middleware/internal-auth';
import {
  createLicense,
  listLicenses,
  revokeLicense,
  TIER_QUOTA,
  Tier,
} from '../services/license.service';

export const adminLicenseRouter = Router();

adminLicenseRouter.use(internalAuth);

// ---------- POST /admin/license ----------

adminLicenseRouter.post('/', async (req: Request, res: Response) => {
  const {
    tier,
    customer_name,
    customer_email,
    customer_id,
    notes,
    duration_days,
  } = req.body ?? {};

  if (!tier || !(tier in TIER_QUOTA)) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_TIER',
        message: `tier 必须是 basic/matrix/studio/enterprise 之一`,
      },
      timestamp: new Date().toISOString(),
    });
  }

  if (
    duration_days !== undefined &&
    (typeof duration_days !== 'number' || duration_days <= 0 || duration_days > 3650)
  ) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_DURATION',
        message: 'duration_days 必须是 1..3650 的正整数',
      },
      timestamp: new Date().toISOString(),
    });
  }

  if (
    customer_email !== undefined &&
    customer_email !== null &&
    typeof customer_email === 'string' &&
    customer_email.length > 0 &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)
  ) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_EMAIL',
        message: 'customer_email 格式不合法',
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const lic = await createLicense({
      tier: tier as Tier,
      customer_name,
      customer_email,
      customer_id,
      notes,
      duration_days,
    });
    return res.status(201).json({
      success: true,
      data: {
        id: lic.id,
        license_key: lic.license_key,
        tier: lic.tier,
        max_machines: lic.max_machines,
        expires_at: lic.expires_at,
        customer_name: lic.customer_name,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'CREATE_FAILED', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
});

// ---------- GET /admin/license ----------

adminLicenseRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const licenses = await listLicenses();
    return res.json({
      success: true,
      data: { items: licenses, total: licenses.length },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'LIST_FAILED', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
});

// ---------- DELETE /admin/license/:id ----------

adminLicenseRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_ID', message: 'id 必须是 UUID' },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const ok = await revokeLicense(id);
    if (!ok) {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'license 不存在或已 revoked',
        },
        timestamp: new Date().toISOString(),
      });
    }
    return res.json({
      success: true,
      data: { id, revoked: true },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'REVOKE_FAILED', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
});
