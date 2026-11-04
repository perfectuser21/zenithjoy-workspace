import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { requireDisposableDatabases } from './disposable-db';
const shared = vi.hoisted(() => ({ pool: null as pg.Pool | null, schema: '', loseCommitAck: false }));
const query = (sql: string) => sql.replaceAll('zenithjoy.', shared.schema + '.');
vi.mock('../../src/db/connection', () => ({ default: {
  query: (sql: string, args?: unknown[]) => shared.pool!.query(query(sql), args),
  connect: async () => { const client = await shared.pool!.connect(); return { query: async (sql: string, args?: unknown[]) => {
    const result = await client.query(query(sql), args);
    if (sql === 'COMMIT' && shared.loseCommitAck) { shared.loseCommitAck = false; throw Error('fixture lost COMMIT ACK after actual PG commit'); }
    return result;
  }, release: () => client.release() }; },
} }));
// Only the external identity provider is replaced. Real tenantContext, session
// gate, routes, concurrent connections, row locks, CAS and transactions execute.
vi.mock('../../src/auth', () => ({ auth: { api: { getSession: async ({ headers }: { headers: Headers }) => {
  const cookie = headers.get('cookie'); return cookie === 'ownerA' ? { user: { id: 'actor-a' } } : cookie === 'ownerB' ? { user: { id: 'actor-b' } } : cookie === 'memberA' ? { user: { id: 'member-a' } } : null;
} } } }));
import { companyProfileRouter } from '../../src/routes/company-profile';
const app = express(); app.use(express.json()); app.use('/profile', companyProfileRouter);
const company = randomUUID(), tenant = randomUUID(), otherCompany = randomUUID(), otherTenant = randomUUID();
const profiles = ['work', 'work', 'work', 'other'];
const base = { company_id: company, tenant_id: tenant, company_key: 'fixture-own', company_name: 'Fixture', config_version: 26, config_status: 'enabled', config_owner: 'fixture-owner', wiki: { markdown: '# fixture' }, source_evidence: { fixture: 'only' }, runtime_config: { routing: { profiles, line_key: 'yuesheng', feishu_base: 'fixture' }, policy_id: 'keep-original-policy', platform_accounts: [{ id: 'fixture-account', profile: 'work', company_id: company, tenant_id: tenant, device_serial: 'fixture-device', enabled: true, verification_status: 'verified' }] } };
beforeAll(async () => {
  shared.pool = new pg.Pool({ ...requireDisposableDatabases(), database: 'cecelia_scratch', max: 6 });
  expect((await shared.pool.query('SELECT current_database() AS db')).rows[0].db).toBe('cecelia_scratch');
  shared.schema = 'routing_' + randomUUID().replaceAll('-', '');
  // A unique schema owned by this test. No DROP/clear of existing scratch data.
  await shared.pool.query(`CREATE SCHEMA ${shared.schema}`);
  await shared.pool.query(query(`
    CREATE TABLE zenithjoy.tenant_members(tenant_id uuid, feishu_user_id text, role text, created_at timestamptz DEFAULT now());
    CREATE TABLE zenithjoy.tenant_company_profiles(company_id uuid UNIQUE NOT NULL, tenant_id uuid PRIMARY KEY, company_key text, company_name text, city text DEFAULT '', industry text DEFAULT '', description text DEFAULT '', customer_problem text DEFAULT '', customer_portrait text DEFAULT '', products jsonb DEFAULT '[]', key_advantages jsonb DEFAULT '[]', qa_list jsonb DEFAULT '[]', wiki jsonb, runtime_config jsonb, source_evidence jsonb, config_status text, config_owner text, config_version integer, updated_at timestamptz DEFAULT now());
    CREATE TABLE zenithjoy.company_config_versions(company_id uuid, version integer, tenant_id uuid, snapshot jsonb, actor text, PRIMARY KEY(company_id,version));
    CREATE TABLE zenithjoy.company_config_changes(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid, version integer, actor text, source text, old_snapshot jsonb, new_snapshot jsonb, conflict jsonb);
    CREATE TABLE zenithjoy.company_config_runs(company_id uuid, run_id text, version integer, tenant_id uuid, snapshot jsonb, PRIMARY KEY(company_id,run_id));
    CREATE TABLE zenithjoy.company_config_projections(company_id uuid, tenant_id uuid, platform text);`));
  for (const [id, tid] of [[company, tenant], [otherCompany, otherTenant]]) {
    const row = { ...base, company_id: id, tenant_id: tid };
    await shared.pool.query(query(`INSERT INTO zenithjoy.tenant_company_profiles(company_id,tenant_id,company_key,company_name,wiki,runtime_config,source_evidence,config_status,config_owner,config_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`), [id, tid, row.company_key, row.company_name, row.wiki, row.runtime_config, row.source_evidence, row.config_status, row.config_owner, 26]);
    await shared.pool.query(query('INSERT INTO zenithjoy.company_config_versions VALUES($1,26,$2,$3,$4)'), [id, tid, row, 'fixture']);
    await shared.pool.query(query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,26,$3,$4)'), [id, 'old-fixture-run', tid, row]);
  }
  await shared.pool.query(query('INSERT INTO zenithjoy.tenant_members(tenant_id,feishu_user_id,role) VALUES($1,$2,$3),($4,$5,$3),($1,$6,$7)'), [tenant, 'actor-a', 'owner', otherTenant, 'actor-b', 'member-a', 'member']);
});
afterAll(async () => {
  if (shared.pool) { if (/^routing_[a-f0-9]{32}$/.test(shared.schema)) await shared.pool.query(`DROP SCHEMA ${shared.schema} CASCADE`); await shared.pool.end(); }
});

it('真实PG并发仅一提交，ACK重放返回固定历史，跨租户/旧快照/账号政策均不漂移', async () => {
  const pool = shared.pool!;
  const old = (await pool.query(query('SELECT snapshot::text FROM zenithjoy.company_config_versions WHERE company_id=$1 AND version=26'), [company])).rows[0].snapshot;
  const oldRun = (await pool.query(query('SELECT snapshot::text FROM zenithjoy.company_config_runs WHERE company_id=$1'), [company])).rows[0].snapshot;
  const normalize = (id: string, version = 27) => request(app).post('/profile/routing-profile-normalizations').set('Cookie', 'ownerA').send({ expected_version: version, request_id: id });
  const firstId = randomUUID(), secondId = randomUUID();
  expect((await normalize(firstId, 26)).body.error.code).toBe('DRAFT_REQUIRED');
  expect((await request(app).put('/profile').set('Cookie', 'ownerA').send({ expected_version: 26, config_status: 'draft' })).status).toBe(200);
  const outcomes = await Promise.all([normalize(firstId), normalize(secondId)]);
  expect(outcomes.map(r => r.status).sort()).toEqual([201, 409]);
  const appliedId = outcomes[0].status === 201 ? firstId : secondId;
  const selected = (await pool.query(query('SELECT * FROM zenithjoy.tenant_company_profiles WHERE company_id=$1'), [company])).rows[0];
  expect(selected.config_version).toBe(28); expect(selected.config_status).toBe('draft');
  expect(selected.runtime_config.routing.profiles).toEqual(['work', 'other']);
  expect(selected.runtime_config.platform_accounts).toEqual(base.runtime_config.platform_accounts); expect(selected.runtime_config.policy_id).toBe('keep-original-policy');
  expect((await pool.query(query("SELECT count(*)::int AS n FROM zenithjoy.company_config_changes WHERE company_id=$1 AND source='routing_profile_normalization'"), [company])).rows[0].n).toBe(1);
  expect((await pool.query(query('SELECT count(*)::int AS n FROM zenithjoy.company_config_versions WHERE company_id=$1 AND version=28'), [company])).rows[0].n).toBe(1);
  expect((await normalize(appliedId)).status).toBe(200);
  expect((await normalize(appliedId, 28)).status).toBe(409);
  expect((await request(app).put('/profile').set('Cookie', 'ownerA').send({ expected_version: 28, config_status: 'confirmed' })).status).toBe(200);
  const receipt = await request(app).get('/profile/routing-profile-normalizations/' + appliedId).set('Cookie', 'ownerA');
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(200); expect(receipt.body.data.config_version).toBe(28); expect(receipt.body.data.config_status).toBe('draft');
  expect((await request(app).get('/profile/routing-profile-normalizations/' + appliedId).set('Cookie', 'ownerB')).status).toBe(404);
  expect((await request(app).post('/profile/routing-profile-normalizations').set('Cookie', 'memberA').send({ expected_version: 29, request_id: randomUUID() })).status).toBe(403);
  expect((await request(app).post('/profile/routing-profile-normalizations').set('X-Feishu-User-Id', 'actor-a').set('X-Bypass-Tenant', 'true').send({ expected_version: 29, request_id: randomUUID() })).status).toBe(401);
  expect((await pool.query(query('SELECT snapshot::text FROM zenithjoy.company_config_versions WHERE company_id=$1 AND version=26'), [company])).rows[0].snapshot).toBe(old);
  expect((await pool.query(query('SELECT snapshot::text FROM zenithjoy.company_config_runs WHERE company_id=$1'), [company])).rows[0].snapshot).toBe(oldRun);
  expect((await pool.query(query('SELECT config_version FROM zenithjoy.tenant_company_profiles WHERE company_id=$1'), [otherCompany])).rows[0].config_version).toBe(26);
});

it('真实PG已COMMIT后丢ACK只能按原request读回，哈希冲突不能冒成功', async () => {
  const pool = shared.pool!, id = randomUUID();
  expect((await request(app).put('/profile').set('Cookie', 'ownerB').send({ expected_version: 26, config_status: 'draft' })).status).toBe(200);
  shared.loseCommitAck = true;
  const send = () => request(app).post('/profile/routing-profile-normalizations').set('Cookie', 'ownerB').send({ expected_version: 27, request_id: id });
  expect((await send()).status).toBe(500);
  const get = () => request(app).get('/profile/routing-profile-normalizations/' + id).set('Cookie', 'ownerB');
  expect((await get()).body.data.config_version).toBe(28);
  expect((await send()).status).toBe(200);
  expect((await pool.query(query("SELECT count(*)::int AS n FROM zenithjoy.company_config_changes WHERE company_id=$1 AND source='routing_profile_normalization'"), [otherCompany])).rows[0].n).toBe(1);
  expect((await pool.query(query('SELECT count(*)::int AS n FROM zenithjoy.company_config_versions WHERE company_id=$1 AND version=28'), [otherCompany])).rows[0].n).toBe(1);
  await pool.query(query("UPDATE zenithjoy.company_config_changes SET conflict=jsonb_set(conflict,'{after_sha256}','\"invalid-fixture-hash\"'::jsonb) WHERE company_id=$1 AND source='routing_profile_normalization'"), [otherCompany]);
  expect((await get()).status).toBe(500);
  expect((await pool.query(query('SELECT config_version FROM zenithjoy.tenant_company_profiles WHERE company_id=$1'), [otherCompany])).rows[0].config_version).toBe(28);
});
