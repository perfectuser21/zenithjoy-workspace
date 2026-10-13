import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../db/connection', () => ({ default: { query } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContextOptional: (req: Request, _res: Response, next: NextFunction) => {
    req.tenantId = req.header('X-Test-Tenant'); next();
  },
}));
import { line02Router } from './line02';
const app = express(); app.use('/api/line02', line02Router);
beforeEach(() => query.mockResolvedValue({ rows: [{ account_label: '示例主号', role: 'main', health: 'ok' }] }));
describe('原Line02账号状态合同的永久回归', () => {
  it('有租户返回200和accounts数组，保持success及原响应形状', async () => {
    const response = await request(app).get('/api/line02/account-status').set('X-Test-Tenant', 'tenant-a');
    expect(response.status).toBe(200); expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.accounts)).toBe(true); expect(Object.keys(response.body.data)).toEqual(['accounts']);
    expect(query.mock.calls.at(-1)?.[1]).toEqual(['tenant-a']);
  });
  it('禁用的status/main_account不出现在data顶层', async () => {
    const response = await request(app).get('/api/line02/account-status').set('X-Test-Tenant', 'tenant-a');
    expect(response.status).toBe(200); expect(response.body.data.status).toBeUndefined(); expect(response.body.data.main_account).toBeUndefined();
  });
  it('账号条目真实映射label/role/health，覆盖原空数组未触发的断言', async () => {
    const response = await request(app).get('/api/line02/account-status').set('X-Test-Tenant', 'tenant-a');
    expect(response.body.data.accounts).toEqual([{ label: '示例主号', role: 'main', health: 'ok' }]);
  });
  it('无租户维持原账号状态读面空数组合同', async () => {
    const response = await request(app).get('/api/line02/account-status');
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ accounts: [] });
  });
});
