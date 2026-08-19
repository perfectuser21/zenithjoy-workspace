/**
 * knowledgeAuthGuard —— 身份只来自服务端会话，任何请求头都不影响判定（GP 合同 lifeline#1 命门）
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 不 mock 会话解析：用真 express app + 真 better-auth 会话 cookie；
 *   - 不 mock tenant_members 查询：真 Postgres。
 * 允许 mock 的仅飞书 OAuth 上游（走 FEISHU_API_BASE 指向本地假上游，非代码分支）。
 *
 * TDD Red：apps/api/src/middleware/knowledge-auth.ts 与知识路由尚不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Client } from 'pg';
// @ts-expect-error 中间件尚未实现（TDD Red 阶段），实现后删除本行
import { knowledgeAuthGuard } from '../../../apps/api/src/middleware/knowledge-auth';
import app from '../../../apps/api/src/app';

const PGURL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/cecelia';

const ORGA_OPENID = 'ou_guard_orga';
const ORGA_EMAIL = 'guard-orga@zenithjoy.local';

let client: Client;
let orgATenantId = '';
let sessionCookie = '';

beforeAll(async () => {
  client = new Client({ connectionString: PGURL });
  await client.connect();
  const a = await client.query(
    "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('GUARD-A-'||substr(md5(random()::text),1,8), 'free') RETURNING id"
  );
  orgATenantId = a.rows[0].id;

  process.env.FEISHU_API_BASE = 'http://127.0.0.1:0/api/_smoke/fake-feishu';
  process.env.STAFF_FEISHU_OPENIDS = ORGA_OPENID;
  process.env.STAFF_EMAILS = ORGA_EMAIL;
  process.env.STAFF_FEISHU_OPENIDS__ORGA = ORGA_OPENID;
  process.env.STAFF_EMAILS__ORGA = ORGA_EMAIL;
  process.env.STAFF_ORG_MAP = `ORGA:${orgATenantId}`;

  const login = await request(app)
    .post('/api/staff/feishu-login')
    .send({ code: 'e2e-code-orga' });
  const raw = login.headers['set-cookie'];
  sessionCookie = Array.isArray(raw) ? raw.join('; ') : String(raw ?? '');
});

afterAll(async () => {
  if (client) {
    await client.query('DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id = $1', [ORGA_OPENID]);
    await client.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [orgATenantId]);
    await client.end();
  }
});

describe('knowledgeAuthGuard 身份只来自会话 [BEHAVIOR]', () => {
  it('中间件被导出且是函数（A27 扫描目标存在）', () => {
    expect(typeof knowledgeAuthGuard).toBe('function');
  });

  it('无会话返回 401 SESSION_REQUIRED，文案为「登录已失效，请重新登录」', async () => {
    const res = await request(app).get('/api/staff/knowledge/recent');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
    expect(res.body.error.message).toBe('登录已失效，请重新登录');
  });

  it('伪造身份头不改变判定 —— 无会话时带真实白名单头仍是 401', async () => {
    const res = await request(app)
      .get('/api/staff/knowledge/recent')
      .set('X-User-Email', ORGA_EMAIL)
      .set('X-Feishu-User-Id', ORGA_OPENID);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
  });

  it('伪造身份头不改变判定 —— 有会话时加攻击者头，判定与不加时逐字相同', async () => {
    const clean = await request(app).get('/api/staff/knowledge/recent').set('Cookie', sessionCookie);
    const forged = await request(app)
      .get('/api/staff/knowledge/recent')
      .set('Cookie', sessionCookie)
      .set('X-User-Email', 'attacker@evil.local')
      .set('X-Feishu-User-Id', 'ou_attacker');
    expect(forged.status).toBe(clean.status);
    expect(forged.body.data?.items?.length ?? 0).toBe(clean.body.data?.items?.length ?? 0);
  });

  it('有会话无成员行返回 403 NO_TENANT，文案为「没有权限」，与 401 文案不同', async () => {
    await client.query('DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id = $1', [ORGA_OPENID]);
    const res = await request(app).get('/api/staff/knowledge/recent').set('Cookie', sessionCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_TENANT');
    expect(res.body.error.message).toBe('没有权限');
    expect(res.body.error.message).not.toBe('登录已失效，请重新登录');
  });
});
