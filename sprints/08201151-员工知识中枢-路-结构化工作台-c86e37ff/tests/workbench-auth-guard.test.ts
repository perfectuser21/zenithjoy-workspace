/**
 * workbenchAuthGuard —— 路③ G0 命门：身份与组织归属只来自服务端会话
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 不 mock 会话解析：真 better-auth 会话 cookie；
 *   - 不 mock tenant_members 查询：真 Postgres 真插真查。
 *
 * TDD Red：apps/api/src/middleware/workbench-auth.ts 与 /api/knowledge/db/* 端点族
 * 尚不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
// @ts-expect-error 中间件尚未实现（TDD Red 阶段），实现后删除本行
import { workbenchAuthGuard } from '../../../apps/api/src/middleware/workbench-auth';
import app from '../../../apps/api/src/app';
import { seedTwoTenants, cleanupSeed, type TwoTenantSeed } from './_workbench-fixture';

let seed: TwoTenantSeed;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-GUARD');
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('workbenchAuthGuard 身份只来自会话 [BEHAVIOR]', () => {
  it('中间件被导出且是函数（A2 扫描目标存在）', () => {
    expect(typeof workbenchAuthGuard).toBe('function');
  });

  it('无会话返 401 SESSION_REQUIRED，且文案与 403 两两不同', async () => {
    const res = await request(app).get('/api/knowledge/db/tables');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
    expect(res.body.error.message).toBe('登录已失效，请重新登录');
  });

  it('伪造身份头不改变判定且不写库 —— 无会话时带白名单头仍是 401', async () => {
    const before = await seed.client.query('SELECT count(*)::int AS c FROM zenithjoy.db_tables');
    const res = await request(app)
      .post('/api/knowledge/db/tables')
      // 这两个头是既有 staffGuard 端点的凭据；路③ 闸压根不读请求头，带上也无效
      .set('X-User-Email', `wb-attacker-${seed.sfx}@zenithjoy.local`)
      .set('X-Feishu-User-Id', seed.aliceOpenId)
      .send({ name: `伪造-${seed.sfx}`, visibility: 'org', fields: [] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
    const after = await seed.client.query('SELECT count(*)::int AS c FROM zenithjoy.db_tables');
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('伪造身份头不改变判定且不写库 —— 有会话时加攻击者头，落库归属仍是会话组织', async () => {
    const res = await request(app)
      .post('/api/knowledge/db/tables')
      .set('Cookie', seed.aliceCookie)
      .set('X-Tenant-Id', seed.orgBTenantId)
      .set('X-Bypass-Tenant', 'true')
      .send({ name: `头无效-${seed.sfx}`, visibility: 'org', fields: [], org_id: seed.orgBTenantId });
    expect(res.status).toBe(201);
    // 头和请求体都指向 B 企业，落库必须仍是 A 企业
    expect(res.body.data.org_id).toBe(seed.orgATenantId);
    const row = await seed.client.query(
      'SELECT org_id::text AS org_id FROM zenithjoy.db_tables WHERE id = $1',
      [res.body.data.table_id]
    );
    expect(row.rows[0].org_id).toBe(seed.orgATenantId);
  });

  it('成员行查询失败返 503 LEDGER_UNREACHABLE，绝不吞成 403', async () => {
    // 把成员表改名制造真实不可达 —— 不是 mock，是真让那张表查不到
    await seed.client.query('ALTER TABLE zenithjoy.tenant_members RENAME TO tenant_members_wb_hidden');
    try {
      const res = await request(app).get('/api/knowledge/db/tables').set('Cookie', seed.aliceCookie);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('LEDGER_UNREACHABLE');
    } finally {
      await seed.client.query('ALTER TABLE zenithjoy.tenant_members_wb_hidden RENAME TO tenant_members');
    }
  });

  it('多组织行返 409 MULTI_ORG_MEMBER 不取第一条（A11 请求期分支）', async () => {
    // 给甲补一条 B 企业成员行 —— 现实里这是配置事故，判据绝不能是「按 created_at 取第一条」
    await seed.client.query(
      'INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id) VALUES ($1, $2)',
      [seed.orgBTenantId, seed.aliceOpenId]
    );
    try {
      const res = await request(app).get('/api/knowledge/db/tables').set('Cookie', seed.aliceCookie);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MULTI_ORG_MEMBER');
      // 不许静默挑一个组织返数据
      expect(res.body.data).toBeNull();
    } finally {
      await seed.client.query(
        'DELETE FROM zenithjoy.tenant_members WHERE tenant_id = $1 AND feishu_user_id = $2',
        [seed.orgBTenantId, seed.aliceOpenId]
      );
    }
  });
});
