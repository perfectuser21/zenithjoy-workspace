import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/connection', () => ({ default: db }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: Request, _res: Response, next: NextFunction) => {
    req.tenantId = 'tenant-1';
    req.tenantRole = req.header('x-role');
    next();
  },
}));
import { registerCompanyOutreachSettings } from './company-outreach-settings';

const router = express.Router();
registerCompanyOutreachSettings(router);
const app = express().use(express.json(), router);
const settings = { daily_cap: 80, start_local: '09:00', end_local: '18:00', paused: false, revision: 1 };

beforeEach(() => { db.query.mockReset(); });

it('只允许公司管理员保存，并拒绝无效时间与租户覆盖', async () => {
  const put = (role: string, body: object) => request(app).put('/outreach-settings').set('x-role', role).send(body);
  expect((await put('member', settings)).status).toBe(403);
  expect((await put('owner', { ...settings, expected_revision: 0, end_local: '24:01' })).status).toBe(400);
  expect((await put('owner', { ...settings, expected_revision: 0, tenant_id: 'tenant-2' })).status).toBe(400);
  expect(db.query).not.toHaveBeenCalled();
});

it('保存返回新版本，陈旧版本发生冲突', async () => {
  db.query.mockResolvedValueOnce({ rows: [settings] }).mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ company_exists: true }] });
  const { revision: _revision, ...fields } = settings;
  const save = () => request(app).put('/outreach-settings').set('x-role', 'admin').send({ ...fields, expected_revision: 0 });
  const result = await save();
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject(settings);
  expect(db.query.mock.calls[0][1].slice(0, 6)).toEqual(['tenant-1', 80, '09:00', '18:00', false, 0]);
  expect((await save()).status).toBe(409);
});
