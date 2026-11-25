import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import pool from '../db/connection';
import { createWorkspaceAdapter } from './customer-workspace-adapters';
import { normalizeWorkspaceParent, type WorkspacePlatform } from './customer-workspace';
import { SOURCE_TABLES, importCompanySource, type SourceRows } from './company-source-import';
import { getTenantToken } from './feishu-client';
import { companyRecord, validateCompanyIdentity, validateEnabledCompany, type CompanyJsonRecord } from '../routes/company-profile-validation';

export const companyQuery = 'SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1';
export class SourceSyncError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function getSources(profile: CompanyJsonRecord) {
  const registered = (await pool.query(
    "SELECT platform,parent_id,state FROM zenithjoy.customer_workspaces WHERE company_id=$1 AND tenant_id=$2 AND status='structure_ready'",
    [profile.company_id, profile.tenant_id],
  )).rows;
  return registered.flatMap(row => {
      if (row.platform !== 'notion' && row.platform !== 'feishu') return [];
      const platform = row.platform as WorkspacePlatform;
      const resources = companyRecord(companyRecord(row.state).resources);
      const ids = SOURCE_TABLES.map(key => companyRecord(resources[key]).id);
      if (!ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) || new Set(ids).size !== ids.length) return [];
      const parent = normalizeWorkspaceParent(platform, String(row.parent_id));
      const reference = companyRecord(row.state).credential_ref;
      return [{ platform, parent, ids: ids as string[], reference }];
    });
}

export async function readCompanySource(profile: CompanyJsonRecord, source: Awaited<ReturnType<typeof getSources>>[number]) {
  const bound = (await pool.query(`SELECT company_id FROM zenithjoy.customer_workspaces WHERE platform=$1 AND (CASE WHEN platform='notion' THEN lower(replace(parent_id,'-','')) ELSE parent_id END)=$2 AND company_id<>$3 UNION ALL SELECT company_id FROM zenithjoy.company_source_sync WHERE platform=$1 AND parent_id=$2 AND company_id<>$3`,
    [source.platform, source.parent, profile.company_id])).rowCount;
  if (bound) throw new SourceSyncError(409, '此工作台已归属其他公司');
  let inputs: SourceRows;
  try {
    const token = typeof source.reference === 'string' ? process.env[source.reference] :
      source.platform === 'notion' ? process.env.NOTION_INTEGRATION_TOKEN : await getTenantToken();
    if (!token) throw Error('missing workspace credential');
    const adapter = createWorkspaceAdapter(source.platform, token);
    await adapter.preflight(source.parent);
    inputs = Object.fromEntries(await Promise.all(SOURCE_TABLES.map(async (key, i) => [
      key, await adapter.readRows(source.parent, source.ids[i]),
    ]))) as SourceRows;
  } catch { throw new SourceSyncError(502, '工作台读取失败，请检查应用读权限、表绑定和平台连接'); }
  let fields;
  try { fields = importCompanySource(profile, inputs); }
  catch (cause) { throw new SourceSyncError(422, cause instanceof Error ? cause.message : '资料格式不正确'); }
  const next = { ...profile, ...fields };
  const invalid = validateCompanyIdentity(next, profile) ?? validateEnabledCompany(next);
  if (invalid) throw new SourceSyncError(422, invalid);
  return { fields, inputs };
}

export async function saveCompanySource(client: PoolClient, old: CompanyJsonRecord, fields: CompanyJsonRecord, platform: string, actor: string, snapshot: (row: CompanyJsonRecord) => CompanyJsonRecord) {
  const key = [old.company_id, old.tenant_id];
  const next = { ...old, ...fields };
  const invalid = validateCompanyIdentity(next, old) ?? validateEnabledCompany(next);
  if (invalid) throw new SourceSyncError(422, invalid);
  const changed = Object.keys(fields).some(field => !isDeepStrictEqual(old[field], fields[field]));
  const version = Number(old.config_version) + Number(changed);
  if (changed) {
    await client.query('UPDATE zenithjoy.tenant_company_profiles SET products=$1::jsonb,wiki=$2::jsonb,runtime_config=$3::jsonb,config_version=$4,updated_at=now() WHERE company_id=$5 AND tenant_id=$6',
      [JSON.stringify(fields.products), JSON.stringify(fields.wiki), JSON.stringify(fields.runtime_config), version, ...key]);
    const current = (await client.query<CompanyJsonRecord>(companyQuery, [old.tenant_id])).rows[0];
    if (current?.config_version !== version || Object.keys(fields).some(field => !isDeepStrictEqual(current[field], fields[field]))) throw Error('company source readback mismatch');
    const evidence = JSON.stringify(snapshot(current));
    await client.query('INSERT INTO zenithjoy.company_config_versions(company_id,version,tenant_id,snapshot,actor) VALUES($1,$2,$3,$4::jsonb,$5)', [old.company_id, version, old.tenant_id, evidence, actor]);
    await client.query('INSERT INTO zenithjoy.company_config_changes(company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)',
      [old.company_id, version, actor, platform, JSON.stringify(snapshot(old)), evidence, '{}']);
  }
  return version;
}
