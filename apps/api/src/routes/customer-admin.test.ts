import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// SQL-aware mock：按 SQL 文本分支返回，避免依赖 query 调用顺序（脆）。
const { mockQuery, setHandler } = vi.hoisted(() => {
  let handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number } = () => ({
    rows: [],
    rowCount: 0,
  });
  const mockQuery = vi.fn((sql: string, params: unknown[] = []) =>
    Promise.resolve(handler(sql, params))
  );
  return { mockQuery, setHandler: (h: typeof handler) => (handler = h) };
});

vi.mock('../db/connection', () => ({ default: { query: mockQuery } }));

vi.mock('../middleware/super-admin', () => ({
  superAdminGuard: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-feishu-user-id'] === 'not-an-admin') {
      res
        .status(403)
        .json({ success: false, data: null, error: { code: 'FORBIDDEN', message: '需要 super-admin' } });
      return;
    }
    next();
  },
}));

import { customerAdminRouter } from './customer-admin';

const app = express();
app.use(express.json());
app.use('/api/tenant', customerAdminRouter);

const TID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  setHandler(() => ({ rows: [], rowCount: 0 }));
});

describe('superAdminGuard', () => {
  it('非超管 X-Feishu-User-Id: not-an-admin → 403', async () => {
    const res = await request(app).get(`/api/tenant/${TID}/accounts`).set('X-Feishu-User-Id', 'not-an-admin');
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/tenant/:id 改公司名', () => {
  it('空名 → 400 INVALID_NAME', async () => {
    const res = await request(app).put(`/api/tenant/${TID}`).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_NAME');
  });

  it('改名成功 → 200 且 data.name == 入参', async () => {
    setHandler((sql) => {
      if (/UPDATE zenithjoy\.tenants/.test(sql)) return { rows: [{ id: TID, name: '晨悦传媒' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).put(`/api/tenant/${TID}`).send({ name: '晨悦传媒' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('晨悦传媒');
    expect(res.body.data.tenant_id).toBe(TID);
  });

  it('租户不存在 → 404 TENANT_NOT_FOUND', async () => {
    setHandler(() => ({ rows: [], rowCount: 0 }));
    const res = await request(app).put(`/api/tenant/${TID}`).send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });
});

describe('POST /api/tenant/:id/accounts 建子账号', () => {
  it('非法 role → 400 INVALID_ROLE，不写库', async () => {
    const res = await request(app)
      .post(`/api/tenant/${TID}/accounts`)
      .send({ email: 'x@t.test', display_name: 'x', role: 'boss' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROLE');
    // 角色校验在任何 DB 写之前
    const insertCalls = mockQuery.mock.calls.filter((c) => /INSERT INTO zenithjoy\.tenant_sub_accounts/.test(String(c[0])));
    expect(insertCalls.length).toBe(0);
  });

  it('配额满 → 409 SUBACCOUNT_QUOTA_EXCEEDED 且 message 含「配额」与「/」', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenants WHERE id/.test(sql)) return { rows: [{ id: TID }], rowCount: 1 };
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'basic', max_machines: 1 }], rowCount: 1 };
      if (/count\(\*\)::int AS used/.test(sql)) return { rows: [{ used: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/accounts`)
      .send({ email: 'over@t.test', display_name: 'o', role: 'operator' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBACCOUNT_QUOTA_EXCEEDED');
    expect(res.body.error.message).toMatch(/配额/);
    expect(res.body.error.message).toMatch(/\//);
  });

  it('正常建号 → 201 且 data.role 回显', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenants WHERE id/.test(sql)) return { rows: [{ id: TID }], rowCount: 1 };
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'matrix', max_machines: 5 }], rowCount: 1 };
      if (/count\(\*\)::int AS used/.test(sql)) return { rows: [{ used: 0 }], rowCount: 1 };
      if (/INSERT INTO zenithjoy\.tenant_sub_accounts/.test(sql))
        return { rows: [{ id: 'acc-1', email: 'svc@t.test', display_name: '客服', role: 'service_agent' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/accounts`)
      .send({ email: 'svc@t.test', display_name: '客服', role: 'service_agent' });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('service_agent');
    expect(res.body.data.account_id).toBe('acc-1');
  });
});

describe('GET /api/tenant/:id/accounts schema 纯度', () => {
  it('顶层 keys 恰为 [data,quota,success,total]，data 项用 account_id 不泄漏 id', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'matrix', max_machines: 5 }], rowCount: 1 };
      if (/FROM zenithjoy\.tenant_sub_accounts/.test(sql))
        return {
          rows: [{ account_id: 'acc-1', email: 'a@t.test', display_name: 'a', role: 'operator', created_at: '2026-06-22T00:00:00Z' }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).get(`/api/tenant/${TID}/accounts`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'quota', 'success', 'total']);
    expect(res.body).not.toHaveProperty('users');
    expect(res.body).not.toHaveProperty('id');
    expect(res.body.data[0]).toHaveProperty('account_id');
    expect(res.body.data[0]).not.toHaveProperty('id');
    expect(res.body.quota).toHaveProperty('limit');
    expect(res.body.quota).toHaveProperty('used');
  });
});

describe('getTenantLicense 只认 status=active 的 license（review 跟进）', () => {
  it('license 查询 SQL 必须含 status = \'active\' 过滤', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'matrix', max_machines: 5 }], rowCount: 1 };
      if (/FROM zenithjoy\.tenant_sub_accounts/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    await request(app).get(`/api/tenant/${TID}/accounts`);
    const licCall = mockQuery.mock.calls.find((c) => /FROM zenithjoy\.licenses/.test(String(c[0])));
    expect(licCall).toBeDefined();
    expect(String(licCall![0])).toMatch(/status\s*=\s*'active'/);
  });

  it('只有 expired/suspended license（active 过滤后查不到）→ quota.limit=0', async () => {
    // 模拟 DB：active 过滤后查不到有效 license（expired/suspended 被排除）→ rows 空
    setHandler((sql) => {
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM zenithjoy\.tenant_sub_accounts/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).get(`/api/tenant/${TID}/accounts`);
    expect(res.status).toBe(200);
    expect(res.body.quota.limit).toBe(0);
  });

  it('只有 expired/suspended license → 建子账号被配额拒（SUBACCOUNT_QUOTA_EXCEEDED）', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenants WHERE id/.test(sql)) return { rows: [{ id: TID }], rowCount: 1 };
      // active 过滤后查不到 license → 无有效配额
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [], rowCount: 0 };
      if (/count\(\*\)::int AS used/.test(sql)) return { rows: [{ used: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/accounts`)
      .send({ email: 'x@t.test', display_name: 'x', role: 'operator' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBACCOUNT_QUOTA_EXCEEDED');
  });
});

describe('POST /api/tenant/:id/service-agents/:aid/bind-device 绑定', () => {
  it('账号非 service_agent → 400 INVALID_BIND_ROLE', async () => {
    setHandler((sql) => {
      if (/SELECT role FROM zenithjoy\.tenant_sub_accounts/.test(sql)) return { rows: [{ role: 'operator' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/acc-1/bind-device`)
      .send({ machine_id: 'pc-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BIND_ROLE');
  });

  it('客服已绑 → 409 ALREADY_BOUND', async () => {
    setHandler((sql) => {
      if (/SELECT role FROM zenithjoy\.tenant_sub_accounts/.test(sql)) return { rows: [{ role: 'service_agent' }], rowCount: 1 };
      if (/WHERE account_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/acc-1/bind-device`)
      .send({ machine_id: 'pc-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_BOUND');
  });

  it('机器配额满 → 409 MACHINE_QUOTA_EXCEEDED', async () => {
    setHandler((sql) => {
      if (/SELECT role FROM zenithjoy\.tenant_sub_accounts/.test(sql)) return { rows: [{ role: 'service_agent' }], rowCount: 1 };
      if (/WHERE account_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/WHERE machine_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'basic', max_machines: 1 }], rowCount: 1 };
      if (/count\(\*\)::int AS cnt FROM zenithjoy\.license_machines WHERE license_id = \$1$/.test(sql.trim()))
        return { rows: [{ cnt: 1 }], rowCount: 1 };
      if (/WHERE license_id = \$1 AND machine_id = \$2/.test(sql)) return { rows: [{ cnt: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/acc-1/bind-device`)
      .send({ machine_id: 'pc-new' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MACHINE_QUOTA_EXCEEDED');
  });
});

describe('GET /api/tenant/:id/service-agents schema 纯度', () => {
  it('顶层 keys 恰为 [data,success,total]，data 项用 binding_id 不泄漏 id', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.service_agents sa/.test(sql))
        return {
          rows: [
            {
              binding_id: 'b-1',
              account_id: 'acc-1',
              account_email: 'svc@t.test',
              machine_id: 'pc-1',
              hostname: 'PC-A',
              last_seen: null,
              bound_at: '2026-06-22T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).get(`/api/tenant/${TID}/service-agents`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'total']);
    expect(res.body.data[0]).toHaveProperty('binding_id');
    expect(res.body.data[0]).not.toHaveProperty('id');
    expect(res.body.data[0]).toHaveProperty('online');
  });
});
