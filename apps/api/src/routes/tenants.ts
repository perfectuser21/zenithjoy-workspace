import { Router } from 'express';
import { randomUUID } from 'crypto';
import pool from '../db/connection';

export const tenantsRouter = Router();

tenantsRouter.post('/', async (req, res, next) => {
  try {
    const { name, plan = 'free' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const licenseKey = `ZJ-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const { rows } = await pool.query(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan)
       VALUES ($1, $2, $3)
       RETURNING id, name, license_key, plan, created_at`,
      [name, licenseKey, plan]
    );
    return res.status(201).json({ tenant: rows[0] });
  } catch (err) { next(err); }
});

tenantsRouter.get('/:id/feishu', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT feishu_app_id, feishu_app_secret, feishu_bitable, feishu_table_crm, feishu_table_log
       FROM zenithjoy.tenants WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'tenant not found' });
    return res.json({ feishu: rows[0] });
  } catch (err) { next(err); }
});

tenantsRouter.put('/:id/feishu', async (req, res, next) => {
  try {
    const { feishu_app_id, feishu_app_secret, feishu_bitable, feishu_table_crm, feishu_table_log } = req.body;
    const { rows } = await pool.query(
      `UPDATE zenithjoy.tenants
       SET feishu_app_id = $2, feishu_app_secret = $3, feishu_bitable = $4,
           feishu_table_crm = $5, feishu_table_log = $6, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [req.params.id, feishu_app_id, feishu_app_secret, feishu_bitable, feishu_table_crm, feishu_table_log]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'tenant not found' });
    return res.json({ ok: true });
  } catch (err) { next(err); }
});
