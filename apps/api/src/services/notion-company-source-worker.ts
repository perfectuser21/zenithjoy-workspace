import type { PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import pool from '../db/connection';
import { companyQuery, getSources, readCompanySource, saveCompanySource, SourceSyncError } from './company-source-sync';
import { createWorkspaceAdapter, type NotionSyncPage } from './customer-workspace-adapters';
import { SOURCE_TABLES } from './company-source-import';
import { companyRecord, type CompanyJsonRecord } from '../routes/company-profile-validation';

const pageId = (value: unknown) => typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '';
export function notionSyncBinding(input: unknown) {
  const record = companyRecord(input), table = pageId(record.database_id);
  const actors = Array.isArray(record.approved_editors) ? record.approved_editors.map(pageId) : [];
  const uuid = /^[0-9a-f]{32}$/;
  if (!uuid.test(table) || actors.length < 1 || actors.length > 30 || !actors.every(actor => uuid.test(actor))) return null;
  return { database_id: table, approved_editors: [...new Set(actors)].sort() };
}

type Snapshot = (row: CompanyJsonRecord) => CompanyJsonRecord;
type Receipt = { success: boolean; version?: number; receipt: string };
const readReceipt = 'SELECT company_id,tenant_id,success,version,receipt FROM zenithjoy.notion_company_source_requests WHERE page_id=$1';
const writeReceipt = 'INSERT INTO zenithjoy.notion_company_source_requests(page_id,company_id,tenant_id,actor,success,version,receipt) VALUES ($1,$2,$3,$4,$5,$6,$7)';
const failure = (receipt: string): Receipt => ({ success: false, receipt });

async function transactRequest(client: PoolClient, profile: CompanyJsonRecord, binding: NonNullable<ReturnType<typeof notionSyncBinding>>, request: NotionSyncPage, expectedSource: { parent: string; ids: string[] }, fields: CompanyJsonRecord | undefined, outcome: Receipt | undefined, snapshot: Snapshot): Promise<Receipt> {
  const id = pageId(request.id), actor = 'notion:' + pageId(request.creator);
  const old = (await client.query<CompanyJsonRecord>(companyQuery + ' FOR UPDATE', [profile.tenant_id])).rows[0];
  if (old?.company_id !== profile.company_id) throw Error('公司档案归属已变化');
  const registered = (await client.query("SELECT parent_id,state FROM zenithjoy.customer_workspaces WHERE company_id=$1 AND tenant_id=$2 AND platform='notion' AND status='structure_ready' FOR SHARE",
    [profile.company_id, profile.tenant_id])).rows[0];
  const resources = companyRecord(companyRecord(registered?.state).resources);
  const sourceIds = SOURCE_TABLES.map(key => companyRecord(resources[key]).id);
  if (pageId(registered?.parent_id) !== expectedSource.parent || !isDeepStrictEqual(sourceIds, expectedSource.ids) ||
      !isDeepStrictEqual(notionSyncBinding(registered?.state?.notion_sync), binding)) throw Error('Notion 同步绑定已变化');
  const previous = (await client.query(readReceipt, [id])).rows[0];
  if (previous) {
    if (previous.company_id !== profile.company_id || previous.tenant_id !== profile.tenant_id) throw Error('请求已经归属于其他公司');
    return previous;
  }
  if (!outcome && (old.config_status !== 'enabled' || old.config_version !== profile.config_version)) {
    outcome = failure('当前正式配置已变化或未启用，请重新提交同步');
  }
  if (!outcome) {
    if (!fields) throw Error('缺少已校验的资料');
    const version = await saveCompanySource(client, old, fields, 'notion', actor, snapshot);
    outcome = { success: true, version, receipt: `已启用 v${version} · ${new Date().toISOString()}` };
  }
  await client.query(writeReceipt, [id, profile.company_id, profile.tenant_id, actor, outcome.success, outcome.version ?? null, outcome.receipt]);
  return outcome;
}

export async function syncNotionCompanyWorkspace(row: CompanyJsonRecord, snapshot: Snapshot) {
  const workspace = companyRecord(row.state), binding = notionSyncBinding(workspace.notion_sync);
  if (!binding) return;
  const profile = (await pool.query<CompanyJsonRecord>(companyQuery, [row.tenant_id])).rows[0];
  if (profile?.company_id !== row.company_id) return;
  const source = (await getSources(profile)).find(item => item.platform === 'notion');
  if (!source || source.ids.some(id => pageId(id) === binding.database_id)) return;
  const token = typeof source.reference === 'string' ? process.env[source.reference] : process.env.NOTION_INTEGRATION_TOKEN;
  if (!token) throw Error('Notion 工作台凭据缺失');
  const adapter = createWorkspaceAdapter('notion', token);
  for (const request of await adapter.readSyncRequests(source.parent, binding.database_id)) {
    const id = pageId(request.id);
    if (!/^[0-9a-f]{32}$/.test(id)) continue;
    const stored = (await pool.query(readReceipt, [id])).rows[0];
    if (stored) {
      if (stored.company_id === profile.company_id && stored.tenant_id === profile.tenant_id) await adapter.writeSyncReceipt(id, stored.success, stored.receipt);
      continue;
    }
    let outcome: Receipt | undefined;
    let fields: CompanyJsonRecord | undefined;
    let expectedProfile = profile;
    if (![request.creator, request.editor].every(actor => binding.approved_editors.includes(pageId(actor)))) {
      outcome = failure('只有本公司已登记的资料负责人可以提交同步');
    } else {
      // 每条请求按读取资料时的确切版本提交。上一请求更新后，再读取新版本。
      const current = (await pool.query<CompanyJsonRecord>(companyQuery, [profile.tenant_id])).rows[0];
      if (current?.company_id !== profile.company_id) break;
      expectedProfile = current;
      try { ({ fields } = await readCompanySource(current, source)); }
      catch (cause) { if (cause instanceof SourceSyncError) outcome = failure(cause.message); else throw cause; }
    }
    const client = await pool.connect();
    let receipt;
    try {
      await client.query('BEGIN');
      receipt = await transactRequest(client, expectedProfile, binding, request, source, fields, outcome, snapshot);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    // 请求收据与业务版本同事务提交。Notion 写回失败，下轮按 page_id 重放收据。
    await adapter.writeSyncReceipt(id, receipt.success, receipt.receipt);
  }
}

export function startNotionCompanySourceWorker(snapshot: Snapshot): NodeJS.Timeout | undefined {
  if (process.env.NOTION_COMPANY_SOURCE_SYNC_ENABLED !== 'true') return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await pool.query("SELECT company_id,tenant_id,state FROM zenithjoy.customer_workspaces WHERE platform='notion' AND status='structure_ready' AND state ? 'notion_sync' ORDER BY company_id");
      for (const workspace of result.rows) {
        try { await syncNotionCompanyWorkspace(workspace, snapshot); }
        catch { console.warn('[notion-company-source] sync failed; pending request can be retried'); }
      }
    } catch { console.warn('[notion-company-source] workspace query failed'); }
    finally { running = false; }
  }, 30000);
  timer.unref();
  return timer;
}
