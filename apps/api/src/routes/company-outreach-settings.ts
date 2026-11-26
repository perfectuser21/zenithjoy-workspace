import type { Request, Response, Router } from 'express';
import pool from '../db/connection';
import { ipKeyFn, simpleRateLimit } from '../middleware/simple-rate-limit';
import { tenantContext } from '../middleware/tenant-context';
import { companyRecord } from './company-profile-validation';

const columns = `s.daily_cap, to_char(s.start_local, 'HH24:MI') AS start_local,
  to_char(s.end_local, 'HH24:MI') AS end_local, s.paused, s.revision, s.updated_at`;
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const fields = ['daily_cap', 'start_local', 'end_local', 'paused', 'expected_revision'];
function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ success: false, error: { message } });
}
function allowed(req: Request) {
  return req.tenantId && ['owner', 'admin'].includes(req.tenantRole ?? '');
}

export function registerCompanyOutreachSettings(router: Router) {
  const limit = simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn });
  router.get('/outreach-settings', limit, tenantContext, async (req, res) => {
    if (!allowed(req)) return fail(res, 403, '仅公司负责人或管理员可查看触达设置');
    try {
      const result = await pool.query(`SELECT ${columns}
        FROM zenithjoy.tenant_company_profiles p LEFT JOIN zenithjoy.company_outreach_settings s
        ON s.tenant_id=p.tenant_id AND s.company_id=p.company_id WHERE p.tenant_id=$1`, [req.tenantId]);
      if (!result.rows.length) return fail(res, 404, '当前租户尚未关联公司');
      return res.json({ success: true, data: result.rows[0].revision == null ? null : result.rows[0] });
    } catch {
      return fail(res, 500, '触达设置读取失败');
    }
  });
  router.put('/outreach-settings', limit, tenantContext, async (req, res) => {
    if (!allowed(req)) return fail(res, 403, '仅公司负责人或管理员可保存触达设置');
    const body = companyRecord(req.body);
    const { daily_cap: cap, start_local: start, end_local: end, paused, expected_revision: revision } = body;
    if (Object.keys(body).some(key => !fields.includes(key))
      || typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1 || cap > 1000
      || typeof start !== 'string' || !time.test(start) || typeof end !== 'string' || !time.test(end)
      || typeof paused !== 'boolean'
      || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0 || revision >= 2147483647) {
      return fail(res, 400, '请填写 1–1000 的整数上限、有效的起止时间和配置版本');
    }
    try {
      const result = await pool.query(`WITH saved AS (
        INSERT INTO zenithjoy.company_outreach_settings AS s
          (tenant_id, company_id, daily_cap, start_local, end_local, paused, revision, updated_by)
        SELECT p.tenant_id, p.company_id, $2, $3, $4, $5, $6::integer+1, $7
        FROM zenithjoy.tenant_company_profiles p WHERE p.tenant_id=$1
          AND ($6=0 OR EXISTS (SELECT 1 FROM zenithjoy.company_outreach_settings WHERE tenant_id=$1))
        ON CONFLICT (tenant_id) DO UPDATE SET
          daily_cap=EXCLUDED.daily_cap, start_local=EXCLUDED.start_local, end_local=EXCLUDED.end_local,
          paused=EXCLUDED.paused, revision=EXCLUDED.revision, updated_by=EXCLUDED.updated_by, updated_at=now()
        WHERE s.revision=$6 AND s.company_id=EXCLUDED.company_id
        RETURNING *
      ) SELECT ${columns} FROM saved s`, [req.tenantId, cap, start, end, paused, revision, req.feishuUserId ?? '']);
      if (result.rows.length) return res.json({ success: true, data: result.rows[0] });
      const exists = await pool.query('SELECT EXISTS (SELECT 1 FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1) AS company_exists', [req.tenantId]);
      return exists.rows[0]?.company_exists
        ? fail(res, 409, '配置已更新，请重新读取后再保存')
        : fail(res, 404, '当前租户尚未关联公司');
    } catch {
      return fail(res, 500, '触达设置保存失败');
    }
  });
}
