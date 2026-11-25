import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import pg from 'pg';
import { requireDisposableDatabases } from './disposable-db';

const fixture = vi.hoisted(() => ({ pool: null as pg.Pool | null, schema: '', readRows: vi.fn() }));
const sql = (query: string) => query.replaceAll('zenithjoy.', fixture.schema + '.');
vi.mock('../../src/db/connection', () => ({ default: {
  query: (query: string, args?: unknown[]) => fixture.pool!.query(sql(query), args),
  connect: async () => {
    const client = await fixture.pool!.connect();
    return { query: (query: string, args?: unknown[]) => client.query(sql(query), args), release: () => client.release() };
  },
} }));
vi.mock('../../src/middleware/tenant-context', () => ({
  tenantContext: (req: Request, _res: Response, next: NextFunction) => {
    req.tenantId = req.header('x-fixture-tenant');
    req.tenantRole = req.header('x-fixture-role') ?? 'owner';
    req.feishuUserId = 'fixture-user';
    next();
  },
}));
vi.mock('../../src/services/customer-workspace-adapters', () => ({
  createWorkspaceAdapter: () => ({ preflight: async () => {}, readRows: fixture.readRows }),
}));
import { registerCompanySourceSync } from '../../src/routes/company-source-sync';

const tenant = randomUUID(), company = randomUUID(), unboundTenant = randomUUID(), unboundCompany = randomUUID();
const parent = randomUUID().replaceAll('-', '');
const router = express.Router(), app = express();
registerCompanySourceSync(router, row => row);
app.use(express.json(), router);
const profile = () => fixture.pool!.query(sql('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1'), [tenant]).then(result => result.rows[0]);

beforeAll(async () => {
  fixture.schema = 'company_source_' + randomUUID().replaceAll('-', '');
  fixture.pool = new pg.Pool({ ...requireDisposableDatabases(), database: 'cecelia_scratch' });
  await fixture.pool.query(`CREATE SCHEMA ${fixture.schema}`);
  await fixture.pool.query(sql(`
    CREATE TABLE zenithjoy.tenant_company_profiles (
      company_id uuid UNIQUE, tenant_id uuid PRIMARY KEY, UNIQUE(company_id,tenant_id),
      products jsonb, wiki jsonb, runtime_config jsonb, config_version integer,
      config_status text, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE zenithjoy.company_config_versions(company_id uuid,version integer,tenant_id uuid,snapshot jsonb,actor text, PRIMARY KEY(company_id,version));
    CREATE TABLE zenithjoy.company_config_changes(company_id uuid,version integer,actor text,source text,old_snapshot jsonb,new_snapshot jsonb,conflict jsonb);
  `));
  for (const filename of ['20261018_120000_customer_workspace_bindings.sql', '20261125_120000_company_source_sync.sql']) {
    await fixture.pool.query(sql(await readFile(new URL('../../db/migrations/' + filename, import.meta.url), 'utf8')));
  }
  const runtime = {
    product_ids: ['p'], policy_id: 'policy', language: 'zh-CN', timezone: 'Asia/Shanghai',
    routing: { line_key: 'line', profiles: ['phone'], feishu_base: 'old-base' },
    platform_accounts: [{ id: 'phone' }],
    search_strategy: { keywords: [{ id: 'k', word: '旧词', enabled: true }] },
    video_judgment: { instructions: '现役视频规则' },
    comment_scoring: { criteria: { A: '高', B: '中', C: '低', 不相关: '无' }, confidence_threshold: 0.7 },
  };
  for (const [id, owner] of [[company, tenant], [unboundCompany, unboundTenant]]) {
    await fixture.pool.query(sql("INSERT INTO zenithjoy.tenant_company_profiles(company_id,tenant_id,products,wiki,runtime_config,config_version,config_status) VALUES ($1,$2,$3,$4,$5,3,'enabled')"),
      [id, owner, '["原服务"]', { products: [{ id: 'p', name: '原服务' }], audiences: [{ id: 'a', name: '旧画像' }] }, runtime]);
  }
  await fixture.pool.query(sql("INSERT INTO zenithjoy.customer_workspaces (company_id,tenant_id,platform,parent_id,template_version,status,state) VALUES ($1,$2,'notion',$3,1,'structure_ready',$4)"),
    [company, tenant, parent, { company_id: company, tenant_id: tenant, platform: 'notion', parent_id: parent, resources: { products: { id: 'products' }, audiences: { id: 'audiences' }, keywords: { id: 'keywords' } } }]);
  vi.stubEnv('NOTION_INTEGRATION_TOKEN', 'fixture-only');
  fixture.readRows.mockImplementation(async (_parent, table) => {
    const rows = {
      products: { 名称: '新服务', 产品标识: 'p', 介绍: '新版', 价格说明: '', 交付内容: '' },
      audiences: { 名称: '新画像', 画像标识: 'a', 需求: '效率', 客户特征: '', 排除条件: '' },
      keywords: { 名称: '新词', 记录标识: 'k', 启用: true, 优先级: '', 时间范围: '', 排序方式: '' },
    };
    return [{ id: table, fields: rows[table as keyof typeof rows] }];
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (!fixture.pool) return;
  await fixture.pool.query(`DROP SCHEMA IF EXISTS ${fixture.schema} CASCADE`);
  await fixture.pool.end();
});
const preview = (owner = tenant) => request(app).post('/source-sync/preview').set('x-fixture-tenant', owner).send({ platform: 'notion', tenant_id: tenant, parent_id: parent });
const apply = (draft: string) => request(app).post('/source-sync/apply').set('x-fixture-tenant', tenant).send({ draft_id: draft });

it('只读取认证公司的映射，预览保留现役版本，确认写入并读回真实 PostgreSQL', async () => {
  expect((await preview(unboundTenant)).status).toBe(400);
  expect(fixture.readRows).not.toHaveBeenCalled();
  expect((await request(app).get('/source-sync').set('x-fixture-tenant', tenant).set('x-fixture-role', 'member')).status).toBe(403);
  const proposed = await preview();
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
  expect(proposed.body.data.preview.keywords).toEqual([{ word: '新词', enabled: true }]);
  expect((await profile()).config_version).toBe(3);
  const id = proposed.body.data.draft_id;
  expect((await apply(id)).body.data.applied_version).toBe(4);
  expect((await apply(id)).body.data.applied_version).toBe(4);
  const saved = await profile();
  expect(saved.config_status).toBe('enabled');
  expect(saved.runtime_config.search_strategy.keywords[0].word).toBe('新词');
  expect(saved.runtime_config.platform_accounts).toEqual([{ id: 'phone' }]);
  const receipts = await fixture.pool!.query(sql('SELECT source,version,actor FROM zenithjoy.company_config_changes WHERE company_id=$1'), [company]);
  expect(receipts.rows).toEqual([{ source: 'notion', version: 4, actor: 'fixture-user' }]);
  const second = await preview();
  expect((await apply(second.body.data.draft_id)).body.data.applied_version).toBe(4);
  const stale = await preview();
  await fixture.pool!.query(sql('UPDATE zenithjoy.tenant_company_profiles SET config_version=5 WHERE tenant_id=$1'), [tenant]);
  expect((await apply(stale.body.data.draft_id)).status).toBe(409);
  expect((await profile()).config_version).toBe(5);
});
