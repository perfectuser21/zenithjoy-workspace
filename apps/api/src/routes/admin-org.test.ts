/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * admin-org 供给端点的单元测试（mock super-admin 放行 + mock 成员表，无 PG，跑在 L3）。
 * J8：本刀多组织成员行限定 admin/手动供给；这里只钉输入校验与幂等 INSERT 语义。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query: mockQuery } }));
vi.mock('../middleware/super-admin', () => ({
  superAdminGuard: (_req: any, _res: any, next: any) => next(),
}));

import { adminOrgRouter } from './admin-org';

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/org', adminOrgRouter);
  return app;
}

beforeEach(() => mockQuery.mockReset());

describe('POST /api/admin/org/grant', () => {
  it('缺 feishu_user_id → 400 VALIDATION_FAILED', async () => {
    const r = await request(buildApp()).post('/api/admin/org/grant').send({ org_id: ORG });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('org_id 非法 uuid → 400 VALIDATION_FAILED', async () => {
    const r = await request(buildApp())
      .post('/api/admin/org/grant')
      .send({ feishu_user_id: 'ou_x', org_id: 'not-a-uuid' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('目标企业不存在 → 400 ORG_NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // SELECT 1 FROM tenants → 无
    const r = await request(buildApp())
      .post('/api/admin/org/grant')
      .send({ feishu_user_id: 'ou_x', org_id: ORG });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ORG_NOT_FOUND');
  });

  it('企业存在 → 200 幂等补行（ON CONFLICT DO NOTHING）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] } as any); // tenants 存在
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // INSERT
    const r = await request(buildApp())
      .post('/api/admin/org/grant')
      .send({ feishu_user_id: 'ou_x', org_id: ORG });
    expect(r.status).toBe(200);
    expect(r.body.data.org_id).toBe(ORG);
    expect(r.body.data.feishu_user_id).toBe('ou_x');
    // 第二条 SQL 必须是 INSERT tenant_members
    const insertSql = String(mockQuery.mock.calls[1][0]);
    expect(insertSql).toContain('INSERT INTO zenithjoy.tenant_members');
  });
});
