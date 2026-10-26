/** Real Chromium -> real API -> disposable PostgreSQL. Model and login are explicit test doubles. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

if (process.env.SMOKE_ALLOW_WRITE !== '1') {
  console.log('SKIP: set SMOKE_ALLOW_WRITE=1 to use disposable local data. No requests made.');
  process.exit(0);
}
const [{ build }, { Pool }, { chromium }, { createServer: createViteServer }] = await Promise.all([
  import('esbuild'), import('pg'), import('@playwright/test'), import('vite'),
]);
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(path.join(tmpdir(), 'crm-manual-history-'));
const pgDir = path.join(scratch, 'pg');
const generated = path.join(root, 'node_modules/.cache', `crm-manual-fixture-${process.pid}.cjs`);
let pgStarted = false, db, vite, server, browser, closeFixturePools;
const checks = [];
const realAI = process.env.CRM_MANUAL_REAL_AI === '1';
if (realAI && !process.env.OPENROUTER_API_KEY) throw new Error('Explicit real-AI check requires a credential in the environment');
const check = name => { checks.push(name); console.log(`PASS: ${name}`); };
async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
const pgPort = await freePort(), apiPort = await freePort(), webPort = await freePort();
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const material = { customer_id: '1', cs_wechat_id: 'cs-a', source_type: 'group',
  channel_name: '合成采购群', text: '小李：需要100件样品。\n日期未记录。' };
try {
  execFileSync('initdb', ['-D', pgDir, '-U', 'crm_fixture', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', pgDir, '-l', path.join(scratch, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ${scratch} -F`, '-w', 'start'], { stdio: 'pipe' });
  pgStarted = true;
  db = new Pool({ host: '127.0.0.1', port: pgPort, user: 'crm_fixture', database: 'postgres' });
  await db.query('CREATE DATABASE crm_manual_history_e2e'); await db.end();
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(pgPort),
    DATABASE_USER: 'crm_fixture', DATABASE_NAME: 'crm_manual_history_e2e', DATABASE_PASSWORD: '' });
  db = new Pool({ host: '127.0.0.1', port: pgPort, user: 'crm_fixture', database: 'crm_manual_history_e2e' });
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'crm_manual_history_e2e');
  await db.query(`CREATE SCHEMA zenithjoy;
    CREATE TABLE zenithjoy.llm_audit(id bigserial,request_purpose text,model text,prompt_tokens integer,completion_tokens integer,total_tokens integer,cost_usd numeric,duration_ms integer,success boolean,error_message text);
    CREATE TABLE zenithjoy.tenants(id uuid PRIMARY KEY);
    CREATE TABLE zenithjoy.service_agents(tenant_id uuid,wechat_id text,deleted_at timestamptz);
    CREATE TABLE zenithjoy.crm_customers(id bigint PRIMARY KEY,tenant_id uuid,cs_wechat_id text,contact text,status text DEFAULT 'A1',wechat_id text,deleted_at timestamptz);
    INSERT INTO zenithjoy.tenants VALUES('${tenantA}'),('${tenantB}');
    INSERT INTO zenithjoy.service_agents VALUES('${tenantA}','cs-a',NULL),('${tenantB}','cs-b',NULL);
    INSERT INTO zenithjoy.crm_customers(id,tenant_id,cs_wechat_id,contact) VALUES(1,'${tenantA}','cs-a','合成客户'),(2,'${tenantB}','cs-b','合成客户B');`);
  const migrations = (await readdir(path.join(root, 'apps/api/db/migrations'))).filter(n => /crm_manual_history\.sql$/.test(n));
  assert.equal(migrations.length, 1, 'manual history migration must exist');
  await db.query(await readFile(path.join(root, 'apps/api/db/migrations', migrations[0]), 'utf8'));
  await build({ entryPoints: [path.join(root, 'apps/dashboard/e2e/fixtures/crm-manual-history-api.ts')],
    outfile: generated, bundle: true, platform: 'node', packages: 'external', format: 'cjs',
    plugins: [{ name: 'fixture-auth-only', setup(builder) {
      builder.onResolve({ filter: /cs-config-guard$/ }, () => ({ path: 'fixture-auth-only', namespace: 'fixture-auth' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-auth' }, () => ({ contents: 'export function requireCsReadAccess(_req,res){res.sendStatus(401)}', loader: 'js' }));
    } }] });
  const fixtureModule = require(generated);
  const { createFixture } = fixtureModule;
  closeFixturePools = fixtureModule.closeFixturePools;
  const { app, state } = createFixture(db);
  server = await new Promise(resolve => { const s = app.listen(apiPort, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${apiPort}/api/crm/manual-history`;
  async function api(endpoint, body, who = 'a') {
    const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(who ? { Cookie: `crm_fixture_session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }
  const query = '?customer_id=1&cs_wechat_id=cs-a';
  assert.equal((await api('/preview', material, '')).status, 401);
  assert.equal((await api('/preview', material, 'b')).status, 404);
  assert.equal(state.calls, 0); check('unauthenticated/cross-tenant requests rejected before model');
  const p = (await api('/preview', material)).data.preview; assert.ok(p?.id);
  const body = { customer_id: '1', cs_wechat_id: 'cs-a', preview_id: p.id, preview_version: p.version,
    request_id: '33333333-3333-4333-8333-333333333333', confirmed_result: p.analysis };
  const results = await Promise.all([api('/commit', body), api('/commit', body)]);
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(results[0].data.record.id, results[1].data.record.id);
  const recordId = results[0].data.record.id;
  assert.equal((await api('/requests/' + body.request_id + query)).data.record.id, recordId);
  assert.equal((await api('/requests/' + body.request_id + query, undefined, 'b')).status, 404);
  assert.equal((await api('/commit', { ...body, confirmed_result: { ...p.analysis, summary: 'changed payload' } })).status, 409);
  assert.equal((await api('/' + recordId + query)).data.record.raw_text, material.text);
  check('real PostgreSQL concurrent idempotency, request recovery, payload conflict and exact readback');
  if (realAI) {
    const audits = await db.query('SELECT model,prompt_tokens,completion_tokens,success FROM zenithjoy.llm_audit');
    assert.equal(audits.rows.length, 1);
    assert.equal(audits.rows[0].success, true);
    assert.ok(audits.rows[0].prompt_tokens > 0);
    check('one real AI call produces grounded preview and human-confirmed durable history');
    console.log(JSON.stringify({ status: 'passed', checks, model_audit: audits.rows[0],
      authentication: 'synthetic session fixture; production login unverified', production_deployed: false }));
  } else {
  const secondPreview = (await api('/preview', material, 'a2')).data.preview;
  const secondBody = { ...body, preview_id: secondPreview.id, preview_version: secondPreview.version,
    request_id: '55555555-5555-4555-8555-555555555555',
    confirmed_result: { ...secondPreview.analysis, summary: 'second operator must not overwrite first result' } };
  const second = await api('/commit', secondBody, 'a2');
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.record.id, recordId);
  assert.equal(second.data.record.created_by, 'fixture-user-a');
  assert.equal(second.data.record.analysis.summary, p.analysis.summary);
  assert.equal((await api('/requests/' + body.request_id + query, undefined, 'a2')).status, 404);
  assert.equal((await api('/requests/' + secondBody.request_id + query, undefined, 'a2')).data.record.id, recordId);
  assert.equal(Number((await db.query('SELECT count(*) FROM zenithjoy.crm_manual_history_imports')).rows[0].count), 1);
  check('different authorized operators deduplicate material while preserving original author and private request receipts');
  const expired = (await api('/preview', { ...material, channel_name: '过期预览群' })).data.preview;
  state.timeShift = 16 * 60 * 1000;
  assert.equal((await api('/commit', { ...body, preview_id: expired.id, preview_version: expired.version,
    request_id: '66666666-6666-4666-8666-666666666666', confirmed_result: expired.analysis })).status, 409);
  state.timeShift = 0;
  state.delayMs = 75;
  const callsBeforeConcurrentPreview = state.calls;
  const previews = await Promise.all([api('/preview', { ...material, channel_name: '并发整理群' }), api('/preview', { ...material, channel_name: '并发整理群' })]);
  assert.deepEqual(previews.map(r => r.status).sort(), [200, 429]);
  assert.equal(state.calls, callsBeforeConcurrentPreview + 1);
  state.delayMs = 0;
  check('expired confirmations fail and concurrent preview requests cannot double-call the model');
  // Roll back a forced commit failure in the real database, then retry the same request.
  const rollbackMaterial = { ...material, channel_name: '回滚检查群' };
  const rp = (await api('/preview', rollbackMaterial)).data.preview;
  await db.query(`CREATE FUNCTION zenithjoy.fixture_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic rollback'; END$$;
    CREATE TRIGGER fixture_fail_import BEFORE INSERT ON zenithjoy.crm_manual_history_imports FOR EACH ROW EXECUTE FUNCTION zenithjoy.fixture_fail_insert();`);
  const rb = { ...body, request_id: '44444444-4444-4444-8444-444444444444', preview_id: rp.id, preview_version: rp.version, confirmed_result: rp.analysis };
  assert.ok((await api('/commit', rb)).status >= 500);
  assert.equal((await api('/requests/' + rb.request_id + query)).status, 404);
  await db.query('DROP TRIGGER fixture_fail_import ON zenithjoy.crm_manual_history_imports');
  assert.equal((await api('/commit', rb)).status, 200); check('database failure rolls back and same request can recover');
  state.failModel = true;
  assert.ok((await api('/preview', { ...material, channel_name: '模型失败群' })).status >= 500);
  state.failModel = false;
  assert.equal((await api('/preview', { ...material, text: '中'.repeat(12000) })).status, 413);
  check('model failure and oversized input are explicit failures');
  vite = await createViteServer({ root: path.join(root, 'apps/dashboard'),
    configFile: path.join(root, 'apps/dashboard/vite.config.ts'),
    server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api/crm': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([{ name: 'crm_fixture_session', value: 'a', domain: '127.0.0.1', path: '/' }]);
  const page = await context.newPage();
  const { expect } = await import('@playwright/test');
  const url = `http://127.0.0.1:${webPort}/e2e/fixtures/crm-manual-history.html`;
  await page.goto(url);
  await page.getByRole('button', { name: '补录聊天记录', exact: true }).click();
  await page.getByLabel('会话类型').selectOption('group');
  await page.getByLabel('会话名称').fill('浏览器粘贴群');
  await page.getByLabel('聊天记录', { exact: true }).fill(material.text);
  await page.getByRole('button', { name: '整理并预览', exact: true }).click();
  await expect(page.getByLabel('整理摘要')).toBeVisible();
  await page.getByLabel('整理摘要').fill('人工确认的样品需求');
  if (process.env.CRM_MANUAL_EVIDENCE_DIR) {
    await mkdir(process.env.CRM_MANUAL_EVIDENCE_DIR, { recursive: true, mode: 0o700 });
    await page.screenshot({ path: path.join(process.env.CRM_MANUAL_EVIDENCE_DIR, 'preview.png'), fullPage: true });
  }
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page.getByText(/保存成功/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /查看原文.*浏览器粘贴群/ }).click();
  await expect(page.getByTestId('crm-manual-history-record')).toContainText(material.text);
  await expect(page.getByTestId('crm-manual-history-record')).toContainText('人工确认的样品需求');
  await expect(page.getByTestId('crm-manual-history-record')).toContainText('100件样品');
  await expect(page.getByTestId('crm-manual-history-record')).toContainText('历史时间未知');
  if (process.env.CRM_MANUAL_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.CRM_MANUAL_EVIDENCE_DIR, 'saved-history.png'), fullPage: true });
  check('Chromium real customer page: paste, preview, manual confirmation, refresh and readback');
  await page.getByRole('button', { name: '补录聊天记录', exact: true }).click();
  await page.getByLabel('会话名称').fill('浏览器TXT群');
  await page.getByLabel('上传 TXT').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from(material.text) });
  await expect(page.getByLabel('聊天记录', { exact: true })).toHaveValue(material.text);
  await page.getByRole('button', { name: '整理并预览', exact: true }).click();
  await expect(page.getByLabel('整理摘要')).toBeVisible();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page.getByText(/保存成功/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /查看原文.*浏览器TXT群/ }).click();
  await expect(page.getByTestId('crm-manual-history-record')).toContainText(material.text);
  check('Chromium strict UTF-8 TXT upload uses same persisted import flow');
  console.log(JSON.stringify({ status: 'passed', checks, storage: 'disposable PostgreSQL', browser: 'real Chromium',
    model: 'deterministic test double; real AI unverified', authentication: 'synthetic session fixture; production login unverified', production_deployed: false }));
  }
} finally {
  await browser?.close(); await vite?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await closeFixturePools?.();
  await db?.end();
  if (pgStarted) execFileSync('pg_ctl', ['-D', pgDir, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  await rm(generated, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
