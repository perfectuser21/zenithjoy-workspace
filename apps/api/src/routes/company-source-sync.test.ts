import { expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/connection', () => ({ default: db }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: Request, _res: Response, next: NextFunction) => {
    req.tenantId = 'tenant-1';
    req.tenantRole = req.header('x-role');
    next();
  },
}));
import { registerCompanySourceSync } from './company-source-sync';

const app = express(), router = express.Router();
registerCompanySourceSync(router, row => row);
app.use(express.json(), router);

it('成员无法读取工作台或写企业配置', async () => {
  expect((await request(app).get('/source-sync').set('x-role', 'member')).status).toBe(403);
  expect((await request(app).post('/source-sync/apply').set('x-role', 'member').send({ draft_id: 'forged' })).status).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});

it('仅返回认证租户的三表来源，不返回服务凭据引用', async () => {
  db.query.mockImplementation(async (sql: string, ids: string[]) => {
    if (sql.includes('tenant_company_profiles')) {
      expect(ids).toEqual(['tenant-1']);
      return { rows: [{ company_id: 'company-1', tenant_id: 'tenant-1' }] };
    }
    expect(ids).toEqual(['company-1', 'tenant-1']);
    if (sql.includes('customer_workspaces')) return { rows: [{
      platform: 'feishu', parent_id: 'base', state: {
        credential_ref: 'PRIVATE_CREDENTIAL_REF',
        resources: { products: { id: 'tblA' }, audiences: { id: 'tblB' }, keywords: { id: 'tblC' } },
      },
    }] };
    return { rows: [] };
  });
  const result = await request(app).get('/source-sync').set('x-role', 'admin');
  expect(result.status).toBe(200);
  expect(result.body.data.sources).toEqual([{ platform: 'feishu', parent: 'base' }]);
  expect(JSON.stringify(result.body)).not.toContain('PRIVATE_CREDENTIAL_REF');
});
