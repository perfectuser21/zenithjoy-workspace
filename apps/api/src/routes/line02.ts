import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContextOptional } from '../middleware/tenant-context';

export const line02Router = Router();

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data, timestamp: new Date().toISOString() });
}

line02Router.get('/account-status', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return ok(res, { accounts: [] });
  }
  try {
    const r = await pool.query(
      `SELECT account_label, role, health FROM zenithjoy.line02_account_sessions WHERE tenant_id = $1 ORDER BY role`,
      [tenantId]
    );
    const accounts = r.rows.map((row: { account_label: string; role: string; health: string }) => ({
      label: row.account_label,
      role: row.role,
      health: row.health,
    }));
    return ok(res, { accounts });
  } catch {
    return ok(res, { accounts: [] });
  }
});
