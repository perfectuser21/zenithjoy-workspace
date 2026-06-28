// Route: /api/company-profile — 租户公司信息 GET/PUT（Line02 公司信息页）
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContextOptional } from '../middleware/tenant-context';

export const companyProfileRouter = Router();

const EMPTY_PROFILE = {
  company_name: '',
  city: '',
  industry: '',
  description: '',
  products: [],
  key_advantages: [],
  customer_problem: '',
  customer_portrait: '',
  qa_list: [],
};

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data, timestamp: new Date().toISOString() });
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message }, timestamp: new Date().toISOString() });
}

companyProfileRouter.get('/', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return ok(res, { ...EMPTY_PROFILE });
  }
  try {
    const r = await pool.query(
      `SELECT company_name, city, industry, description, products, key_advantages, customer_problem, customer_portrait, qa_list
         FROM zenithjoy.tenant_company_profiles WHERE tenant_id = $1`,
      [tenantId]
    );
    if (r.rows.length === 0) {
      return ok(res, { ...EMPTY_PROFILE });
    }
    const row = r.rows[0] as {
      company_name: string; city: string; industry: string; description: string;
      products: string[]; key_advantages: string[]; customer_problem: string;
      customer_portrait: string; qa_list: Array<{q: string; a: string}>;
    };
    return ok(res, {
      company_name: row.company_name ?? '',
      city: row.city ?? '',
      industry: row.industry ?? '',
      description: row.description ?? '',
      products: Array.isArray(row.products) ? row.products : [],
      key_advantages: Array.isArray(row.key_advantages) ? row.key_advantages : [],
      customer_problem: row.customer_problem ?? '',
      customer_portrait: row.customer_portrait ?? '',
      qa_list: Array.isArray(row.qa_list) ? row.qa_list : [],
    });
  } catch (err) {
    return fail(res, 500, 'FETCH_FAILED', (err as Error).message);
  }
});

companyProfileRouter.put('/', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const body = req.body || {};

  if (!body.company_name || typeof body.company_name !== 'string' || body.company_name.trim() === '') {
    return fail(res, 400, 'MISSING_COMPANY_NAME', 'company_name 必填');
  }

  const {
    company_name, city = '', industry = '', description = '',
    products = [], key_advantages = [], customer_problem = '',
    customer_portrait = '', qa_list = [],
  } = body;

  if (!tenantId) {
    return ok(res, { updated: true });
  }

  try {
    await pool.query(
      `INSERT INTO zenithjoy.tenant_company_profiles
         (tenant_id, company_name, city, industry, description, products, key_advantages, customer_problem, customer_portrait, qa_list)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         city = EXCLUDED.city,
         industry = EXCLUDED.industry,
         description = EXCLUDED.description,
         products = EXCLUDED.products,
         key_advantages = EXCLUDED.key_advantages,
         customer_problem = EXCLUDED.customer_problem,
         customer_portrait = EXCLUDED.customer_portrait,
         qa_list = EXCLUDED.qa_list,
         updated_at = NOW()`,
      [tenantId, company_name, city, industry, description,
       JSON.stringify(products), JSON.stringify(key_advantages),
       customer_problem, customer_portrait, JSON.stringify(qa_list)]
    );
    return ok(res, { updated: true });
  } catch (err) {
    return fail(res, 500, 'SAVE_FAILED', (err as Error).message);
  }
});
