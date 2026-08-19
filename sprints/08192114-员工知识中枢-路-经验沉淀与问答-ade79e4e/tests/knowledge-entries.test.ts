/**
 * 知识端点落库与读端 —— 录入写 Cecelia 账本带归属 / 缺组织 fail-closed / 跨企业隔离 / 不静默降级
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ public.learnings：真 INSERT 真 SELECT，不得 stub DB 层；
 *   - 代码 ↔ zenithjoy.tenant_members：真查真删；
 *   - 会话 → 成员行 → org_id 这一跳全程真跑。
 *
 * TDD Red：apps/api/src/routes/knowledge.ts 尚未注册，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Client } from 'pg';
import app from '../../../apps/api/src/app';

const PGURL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/cecelia';

const ORGA_OPENID = 'ou_entry_orga';
const ORGA_EMAIL = 'entry-orga@zenithjoy.local';
const ORGB_OPENID = 'ou_entry_orgb';

let client: Client;
let orgATenantId = '';
let orgBTenantId = '';
let cookieA = '';
let cookieB = '';
const createdEntryIds: string[] = [];

async function login(code: string): Promise<string> {
  const res = await request(app).post('/api/staff/feishu-login').send({ code });
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw.join('; ') : String(raw ?? '');
}

beforeAll(async () => {
  client = new Client({ connectionString: PGURL });
  await client.connect();
  orgATenantId = (
    await client.query(
      "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('ENTRY-A-'||substr(md5(random()::text),1,8), 'free') RETURNING id"
    )
  ).rows[0].id;
  orgBTenantId = (
    await client.query(
      "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('ENTRY-B-'||substr(md5(random()::text),1,8), 'free') RETURNING id"
    )
  ).rows[0].id;

  process.env.FEISHU_API_BASE = 'http://127.0.0.1:0/api/_smoke/fake-feishu';
  process.env.STAFF_FEISHU_OPENIDS = ORGA_OPENID;
  process.env.STAFF_EMAILS = ORGA_EMAIL;
  process.env.STAFF_FEISHU_OPENIDS__ORGA = ORGA_OPENID;
  process.env.STAFF_EMAILS__ORGA = ORGA_EMAIL;
  process.env.STAFF_FEISHU_OPENIDS__ORGB = ORGB_OPENID;
  process.env.STAFF_ORG_MAP = `ORGA:${orgATenantId},ORGB:${orgBTenantId}`;

  cookieA = await login('e2e-code-orga');
  cookieB = await login('e2e-code-orgb');
});

afterAll(async () => {
  if (client) {
    if (createdEntryIds.length > 0) {
      await client.query('DELETE FROM public.learnings WHERE id = ANY($1)', [createdEntryIds]);
    }
    await client.query('DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id = ANY($1)', [
      [ORGA_OPENID, ORGB_OPENID],
    ]);
    await client.query('DELETE FROM zenithjoy.tenants WHERE id = ANY($1)', [[orgATenantId, orgBTenantId]]);
    await client.end();
  }
});

describe('知识端点录入与读端 [BEHAVIOR]', () => {
  it('录入返回 201 且 data.org_id 等于声明组织，账本本轮真有该行带归属', async () => {
    const startedAt = (await client.query('SELECT now() AS t')).rows[0].t;
    const evidence = `https://github.com/perfectuser21/zenithjoy-workspace/pull/${Date.now()}`;
    const res = await request(app)
      .post('/api/staff/knowledge/entries')
      .set('Cookie', cookieA)
      .send({ trigger_condition: '单测触发条件', conclusion: '单测结论', evidence_url: evidence });

    expect(res.status).toBe(201);
    expect(res.body.data.org_id).toBe(orgATenantId);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(res.body.data).sort()).toEqual(['created_at', 'entry_id', 'org_id']);

    const entryId = res.body.data.entry_id as string;
    createdEntryIds.push(entryId);
    const row = await client.query(
      `SELECT metadata->>'org_id' AS org_id, metadata->>'author_member_id' AS author
       FROM public.learnings WHERE id = $1 AND created_at > $2`,
      [entryId, startedAt]
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].org_id).toBe(orgATenantId);
    expect(row.rows[0].author).toBeTruthy();
  });

  it('录入响应不含禁用字段 tenant_id / learning_id', async () => {
    const res = await request(app)
      .post('/api/staff/knowledge/entries')
      .set('Cookie', cookieA)
      .send({
        trigger_condition: '禁用字段检查',
        conclusion: '禁用字段检查',
        evidence_url: 'https://example.com/forbidden-keys',
      });
    expect(res.status).toBe(201);
    createdEntryIds.push(res.body.data.entry_id);
    for (const k of ['tenant_id', 'learning_id', 'user_email', 'feishu_user_id']) {
      expect(res.body).not.toHaveProperty(k);
      expect(res.body.data).not.toHaveProperty(k);
    }
  });

  it('缺组织上下文返回 403 NO_ORG_CONTEXT 且零写入', async () => {
    const before = (await client.query('SELECT count(*)::int AS c FROM public.learnings')).rows[0].c;
    await client.query('DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id = $1', [ORGA_OPENID]);

    const res = await request(app)
      .post('/api/staff/knowledge/entries')
      .set('Cookie', cookieA)
      .send({ trigger_condition: 'no-org', conclusion: 'no-org', evidence_url: 'https://example.com/no-org' });

    expect(res.status).toBe(403);
    expect(['NO_ORG_CONTEXT', 'NO_TENANT']).toContain(res.body.error.code);
    const after = (await client.query('SELECT count(*)::int AS c FROM public.learnings')).rows[0].c;
    expect(after).toBe(before);

    await client.query(
      "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
      [orgATenantId, ORGA_OPENID]
    );
  });

  it('请求体里的 org_id 被忽略，落库归属仍为会话声明组织', async () => {
    const res = await request(app)
      .post('/api/staff/knowledge/entries')
      .set('Cookie', cookieA)
      .send({
        trigger_condition: 'override',
        conclusion: 'override',
        evidence_url: 'https://example.com/override',
        org_id: orgBTenantId,
      });
    expect(res.status).toBe(201);
    const entryId = res.body.data.entry_id as string;
    createdEntryIds.push(entryId);
    const row = await client.query("SELECT metadata->>'org_id' AS org_id FROM public.learnings WHERE id = $1", [
      entryId,
    ]);
    expect(row.rows[0].org_id).toBe(orgATenantId);
  });

  it('非法 evidence_url 返回 400 且零写入', async () => {
    const before = (await client.query('SELECT count(*)::int AS c FROM public.learnings')).rows[0].c;
    const res = await request(app)
      .post('/api/staff/knowledge/entries')
      .set('Cookie', cookieA)
      .send({ trigger_condition: 'x', conclusion: 'y', evidence_url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error.code).toBe('string');
    const after = (await client.query('SELECT count(*)::int AS c FROM public.learnings')).rows[0].c;
    expect(after).toBe(before);
  });

  it('最近沉淀只返回本组织条目 —— 企业B 会话看不到企业A 刚写的那条', async () => {
    const evidence = `https://example.com/isolation-${Date.now()}`;
    const created = await request(app)
      .post('/api/staff/knowledge/entries')
      .set('Cookie', cookieA)
      .send({ trigger_condition: '隔离验证', conclusion: '隔离验证', evidence_url: evidence });
    const entryId = created.body.data.entry_id as string;
    createdEntryIds.push(entryId);

    const listA = await request(app).get('/api/staff/knowledge/recent').set('Cookie', cookieA);
    expect(listA.status).toBe(200);
    expect(listA.body.data.items.filter((i: { entry_id: string }) => i.entry_id === entryId)).toHaveLength(1);
    expect(listA.body.data.items.filter((i: { org_id: string }) => i.org_id !== orgATenantId)).toHaveLength(0);
    expect(listA.body.data.count).toBe(listA.body.data.items.length);

    const listB = await request(app).get('/api/staff/knowledge/recent').set('Cookie', cookieB);
    expect(listB.status).toBe(200);
    expect(listB.body.data.items.filter((i: { entry_id: string }) => i.entry_id === entryId)).toHaveLength(0);
    expect(listB.body.data.items.filter((i: { org_id: string }) => i.org_id === orgATenantId)).toHaveLength(0);
  });

  it('账本不可达返回 503 LEDGER_UNREACHABLE，不静默降级成空列表', async () => {
    await client.query('ALTER TABLE public.learnings RENAME TO learnings_unit_hidden');
    try {
      const res = await request(app).get('/api/staff/knowledge/recent').set('Cookie', cookieA);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('LEDGER_UNREACHABLE');
    } finally {
      await client.query('ALTER TABLE public.learnings_unit_hidden RENAME TO learnings');
    }
  });
});
