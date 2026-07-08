/**
 * resolveTenantId — 公共工具函数，供路由 import 并允许测试 vi.mock 拦截。
 * 优先取 req.tenantId（租户 session），回落按 cs_wechat_id 查 service_agents。
 */
import type { Request } from 'express';
import { pool } from '../db/pool';

export async function resolveTenantId(req: Request, csWechatId: string): Promise<string | null> {
  if (req.tenantId) return req.tenantId;
  const r = await pool.query(
    `SELECT tenant_id FROM zenithjoy.service_agents WHERE wechat_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [csWechatId],
  );
  const direct = (r.rows?.[0]?.tenant_id as string | undefined) ?? null;
  if (direct) return direct;
  const m = /^cs-([0-9a-fA-F]{6,})$/.exec((csWechatId ?? '').trim());
  if (m) {
    const lm = await pool.query(
      `SELECT l.tenant_id
         FROM zenithjoy.license_machines lm
         JOIN zenithjoy.licenses l ON l.id = lm.license_id
        WHERE lm.machine_id LIKE $1 || '%'
        ORDER BY lm.last_seen DESC LIMIT 1`,
      [m[1].toLowerCase()],
    );
    return (lm.rows?.[0]?.tenant_id as string | undefined) ?? null;
  }
  return null;
}
