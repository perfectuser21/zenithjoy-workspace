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
    const res = await request(app).get(`/api/tenant/${TID}/members`).set('X-Feishu-User-Id', 'not-an-admin');
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

// ────────────────────────────────────────────────────────────────────
// 按 tenant 列成员（复用 better-auth user + tenant_members）
// ────────────────────────────────────────────────────────────────────
describe('GET /api/tenant/:id/members 列成员', () => {
  it('返回该 tenant 的 tenant_members + 关联 user email/role，schema 纯净', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenant_members tm/.test(sql) && /JOIN "user"/.test(sql))
        return {
          rows: [
            { user_id: 'usr-1', email: 'alice@t.test', name: 'Alice', role: 'owner', joined_at: '2026-06-22T00:00:00Z' },
            { user_id: 'usr-2', email: 'svc@t.test', name: '客服', role: 'member', joined_at: '2026-06-22T01:00:00Z' },
          ],
          rowCount: 2,
        };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).get(`/api/tenant/${TID}/members`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'total']);
    expect(res.body.total).toBe(2);
    expect(res.body.data[0]).toHaveProperty('user_id');
    expect(res.body.data[0]).toHaveProperty('email');
    expect(res.body.data[0]).toHaveProperty('role');
    expect(res.body.data[0].email).toBe('alice@t.test');
  });

  it('成员查询按 tenant_id 过滤（SQL 含 tm.tenant_id = $1）', async () => {
    setHandler(() => ({ rows: [], rowCount: 0 }));
    await request(app).get(`/api/tenant/${TID}/members`);
    const call = mockQuery.mock.calls.find((c) => /FROM zenithjoy\.tenant_members tm/.test(String(c[0])));
    expect(call).toBeDefined();
    expect(String(call![0])).toMatch(/tm\.tenant_id\s*=\s*\$1/);
  });
});

describe('POST /api/tenant/:id/members 拉成员进公司', () => {
  it('缺 user_id → 400 INVALID_INPUT', async () => {
    const res = await request(app).post(`/api/tenant/${TID}/members`).send({ role: 'member' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('user email 不存在 → 404 USER_NOT_FOUND', async () => {
    setHandler((sql) => {
      if (/FROM "user"/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).post(`/api/tenant/${TID}/members`).send({ email: 'ghost@t.test' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('按 email 拉用户进公司 → 201 写 tenant_members', async () => {
    setHandler((sql) => {
      if (/FROM "user"/.test(sql)) return { rows: [{ id: 'usr-9', email: 'svc@t.test' }], rowCount: 1 };
      if (/INSERT INTO zenithjoy\.tenant_members/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).post(`/api/tenant/${TID}/members`).send({ email: 'svc@t.test', role: 'member' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user_id).toBe('usr-9');
    const ins = mockQuery.mock.calls.find((c) => /INSERT INTO zenithjoy\.tenant_members/.test(String(c[0])));
    expect(ins).toBeDefined();
  });
});

describe('DELETE /api/tenant/:id/members/:userId 移除成员', () => {
  it('移除成员 → 200', async () => {
    setHandler((sql) => {
      if (/DELETE FROM zenithjoy\.tenant_members/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).delete(`/api/tenant/${TID}/members/usr-9`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// 子账号端点已废除（#816 tenant_sub_accounts 删除）
// ────────────────────────────────────────────────────────────────────
describe('子账号端点已移除（tenant_sub_accounts 废除）', () => {
  it('GET /api/tenant/:id/accounts → 404（路由不存在）', async () => {
    const res = await request(app).get(`/api/tenant/${TID}/accounts`);
    expect(res.status).toBe(404);
  });
  it('POST /api/tenant/:id/accounts → 404（路由不存在）', async () => {
    const res = await request(app)
      .post(`/api/tenant/${TID}/accounts`)
      .send({ email: 'x@t.test', role: 'service_agent' });
    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────
// 客服-PC 绑定：改绑真实成员（service_agents.member_user_id）
// ────────────────────────────────────────────────────────────────────
describe('POST /api/tenant/:id/service-agents/:userId/bind-device 绑真实成员', () => {
  it('成员不属于该公司 → 404 MEMBER_NOT_FOUND', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenant_members/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/usr-x/bind-device`)
      .send({ machine_id: 'pc-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEMBER_NOT_FOUND');
  });

  it('成员已绑 → 409 ALREADY_BOUND', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenant_members/.test(sql)) return { rows: [{ feishu_user_id: 'usr-1' }], rowCount: 1 };
      if (/WHERE member_user_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/usr-1/bind-device`)
      .send({ machine_id: 'pc-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_BOUND');
  });

  it('PC 已被绑 → 409 ALREADY_BOUND', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenant_members/.test(sql)) return { rows: [{ feishu_user_id: 'usr-1' }], rowCount: 1 };
      if (/WHERE member_user_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/WHERE machine_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/usr-1/bind-device`)
      .send({ machine_id: 'pc-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_BOUND');
  });

  it('机器配额满 → 409 MACHINE_QUOTA_EXCEEDED', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenant_members/.test(sql)) return { rows: [{ feishu_user_id: 'usr-1' }], rowCount: 1 };
      if (/WHERE member_user_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/WHERE machine_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'basic', max_machines: 1 }], rowCount: 1 };
      if (/count\(\*\)::int AS cnt FROM zenithjoy\.license_machines WHERE license_id = \$1$/.test(sql.trim()))
        return { rows: [{ cnt: 1 }], rowCount: 1 };
      if (/WHERE license_id = \$1 AND machine_id = \$2/.test(sql)) return { rows: [{ cnt: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/usr-1/bind-device`)
      .send({ machine_id: 'pc-new' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MACHINE_QUOTA_EXCEEDED');
  });

  it('正常绑定 → 201', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.tenant_members/.test(sql)) return { rows: [{ feishu_user_id: 'usr-1' }], rowCount: 1 };
      if (/WHERE member_user_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/WHERE machine_id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM zenithjoy\.licenses/.test(sql)) return { rows: [{ id: 'lic', tier: 'matrix', max_machines: 5 }], rowCount: 1 };
      if (/count\(\*\)::int AS cnt FROM zenithjoy\.license_machines WHERE license_id = \$1$/.test(sql.trim()))
        return { rows: [{ cnt: 0 }], rowCount: 1 };
      if (/WHERE license_id = \$1 AND machine_id = \$2/.test(sql)) return { rows: [{ cnt: 0 }], rowCount: 1 };
      if (/INSERT INTO zenithjoy\.service_agents/.test(sql)) return { rows: [{ id: 'bind-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post(`/api/tenant/${TID}/service-agents/usr-1/bind-device`)
      .send({ machine_id: 'pc-new' });
    expect(res.status).toBe(201);
    expect(res.body.data.binding_id).toBe('bind-1');
    expect(res.body.data.member_user_id).toBe('usr-1');
  });
});

describe('GET /api/tenant/:id/service-agents 绑定列表（join user 取 email）', () => {
  it('顶层 keys 恰为 [data,success,total]，data 项用 binding_id + member_user_id', async () => {
    setHandler((sql) => {
      if (/FROM zenithjoy\.service_agents sa/.test(sql))
        return {
          rows: [
            {
              binding_id: 'b-1',
              member_user_id: 'usr-1',
              member_email: 'svc@t.test',
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
    expect(res.body.data[0]).toHaveProperty('member_user_id');
    expect(res.body.data[0]).toHaveProperty('member_email');
    expect(res.body.data[0]).toHaveProperty('online');
    expect(res.body.data[0]).not.toHaveProperty('id');
  });
});
