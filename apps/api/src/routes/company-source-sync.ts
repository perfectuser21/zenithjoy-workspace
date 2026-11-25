import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContext } from '../middleware/tenant-context';
import { ipKeyFn, simpleRateLimit } from '../middleware/simple-rate-limit';
import { createWorkspaceAdapter } from '../services/customer-workspace-adapters';
import { normalizeWorkspaceParent, type WorkspacePlatform } from '../services/customer-workspace';
import { SOURCE_TABLES, importCompanySource, previewCompanySource, type SourceRows } from '../services/company-source-import';
import { getTenantToken } from '../services/feishu-client';
import { companyRecord, validateCompanyIdentity, validateEnabledCompany, type CompanyJsonRecord } from './company-profile-validation';

const path = '/source-sync';
const limit = simpleRateLimit({ windowMs: 60_000, max: 15, keyFn: ipKeyFn });
const stateQuery = 'SELECT platform,parent_id,draft,draft_id,base_version,applied_version,fetched_at,applied_at FROM zenithjoy.company_source_sync WHERE company_id=$1 AND tenant_id=$2';
const companyQuery = 'SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1';
const error = (res: Response, status: number, message: string) => res.status(status).json({ success: false, error: { message } });
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

class SourceSyncError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function getSources(profile: CompanyJsonRecord) {
  const registered = (await pool.query(
    "SELECT platform,parent_id,state FROM zenithjoy.customer_workspaces WHERE company_id=$1 AND tenant_id=$2 AND status='structure_ready'",
    [profile.company_id, profile.tenant_id],
  )).rows;
  return registered    .flatMap(row => {
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

function status(result: CompanyJsonRecord = {}) {
  const draft = companyRecord(result.draft);
  return {
    platform: result.platform, parent_id: result.parent_id, draft_id: result.draft_id,
    base_version: result.base_version, applied_version: result.applied_version,
    fetched_at: result.fetched_at, applied_at: result.applied_at,
    preview: draft.preview,
  };
}

export function registerCompanySourceSync(router: Router, snapshot: (row: CompanyJsonRecord) => CompanyJsonRecord) {
  const admin = async (req: Request, res: Response, action: (profile: CompanyJsonRecord) => Promise<unknown>) => {
    if (!req.tenantId || !['owner', 'admin'].includes(req.tenantRole ?? '')) return error(res, 403, '仅公司负责人或管理员可设置资料同步');
    try {
      const profile = (await pool.query<CompanyJsonRecord>(companyQuery, [req.tenantId])).rows[0];
      if (!profile?.company_id) return error(res, 404, '当前租户没有公司档案');
      return ok(res, await action(profile));
    } catch (cause) {
      if (cause instanceof SourceSyncError) return error(res, cause.status, cause.message);
      if ((cause as { code?: string }).code === '23505') return error(res, 409, '工作台已绑定到其他公司');
      return error(res, 503, '资料同步服务暂不可用，请重新读取状态');
    }
  };

  router.get(path, limit, tenantContext, (req, res) => admin(req, res, async profile => {
    const [sources, stored] = await Promise.all([
      getSources(profile),
      pool.query<CompanyJsonRecord>(stateQuery, [profile.company_id, profile.tenant_id]),
    ]);
    return { sources: sources.map(({ platform, parent }) => ({ platform, parent })), state: status(stored.rows[0]) };
  }));

  router.post(path + '/preview', limit, tenantContext, (req, res) => admin(req, res, async profile => {
    const source = (await getSources(profile)).find(item => item.platform === req.body?.platform);
    if (!source) throw new SourceSyncError(400, '此工作台尚未登记到当前公司');
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
    const draft = { fields, table_ids: source.ids, preview: {
      rows: previewCompanySource(inputs),
      products: fields.products,
      audiences: fields.wiki.audiences.map(row => row.name),
      keywords: fields.runtime_config.search_strategy.keywords.map(row => ({ word: row.word, enabled: row.enabled })),
    } };
    const saved = await pool.query<CompanyJsonRecord>(`INSERT INTO zenithjoy.company_source_sync
      (company_id,tenant_id,platform,parent_id,draft,draft_id,base_version,fetched_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now())
      ON CONFLICT (company_id) DO UPDATE SET platform=excluded.platform,parent_id=excluded.parent_id,
        draft=excluded.draft,draft_id=excluded.draft_id,base_version=excluded.base_version,fetched_at=excluded.fetched_at
      WHERE company_source_sync.tenant_id=excluded.tenant_id
      RETURNING *`,
    [profile.company_id, profile.tenant_id, source.platform, source.parent, JSON.stringify(draft), randomUUID(), profile.config_version]);
    return status(saved.rows[0]);
  }));

  router.post(path + '/apply', limit, tenantContext, (req, res) => admin(req, res, async profile => {
    if (typeof req.body?.draft_id !== 'string') throw new SourceSyncError(400, '缺少同步预览编号');
    const sources = await getSources(profile);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const old = (await client.query<CompanyJsonRecord>(companyQuery + ' FOR UPDATE', [profile.tenant_id])).rows[0];
      if (old?.company_id !== profile.company_id) throw new SourceSyncError(409, '公司绑定已变化');
      const key = [old.company_id, old.tenant_id];
      const saved = (await client.query<CompanyJsonRecord>(stateQuery + ' FOR UPDATE', key)).rows[0];
      if (!saved || saved.draft_id !== req.body.draft_id) throw new SourceSyncError(409, '同步预览已更新，请重新查看');
      if (!sources.some(source => source.platform === saved.platform && source.parent === saved.parent_id && (!saved.draft || isDeepStrictEqual(source.ids, companyRecord(saved.draft).table_ids)))) throw new SourceSyncError(409, '资料来源已变更，请重新拉取预览');
      if (!saved.draft) {
        await client.query('COMMIT');
        return status(saved);
      }
      if (old.config_status !== 'enabled' || old.config_version !== saved.base_version) throw new SourceSyncError(409, '当前正式配置已变化或未启用，请重新拉取预览');
      const fields = companyRecord(companyRecord(saved.draft).fields);
      const next = { ...old, ...fields };
      const invalid = validateCompanyIdentity(next, old) ?? validateEnabledCompany(next);
      if (invalid) throw new SourceSyncError(422, invalid);
      const changed = Object.keys(fields).some(field => !isDeepStrictEqual(old[field], fields[field]));
      const version = Number(old.config_version) + Number(changed);
      const actor = req.feishuUserId ?? 'company-admin';
      if (changed) {
        await client.query('UPDATE zenithjoy.tenant_company_profiles SET products=$1::jsonb,wiki=$2::jsonb,runtime_config=$3::jsonb,config_version=$4,updated_at=now() WHERE company_id=$5 AND tenant_id=$6',
          [JSON.stringify(fields.products), JSON.stringify(fields.wiki), JSON.stringify(fields.runtime_config), version, ...key]);
        const current = (await client.query<CompanyJsonRecord>(companyQuery, [old.tenant_id])).rows[0];
        if (current?.config_version !== version || Object.keys(fields).some(field => !isDeepStrictEqual(current[field], fields[field]))) throw Error('company source readback mismatch');
        const evidence = JSON.stringify(snapshot(current));
        await client.query('INSERT INTO zenithjoy.company_config_versions(company_id,version,tenant_id,snapshot,actor) VALUES($1,$2,$3,$4::jsonb,$5)', [old.company_id, version, old.tenant_id, evidence, actor]);
        await client.query('INSERT INTO zenithjoy.company_config_changes(company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)',
          [old.company_id, version, actor, saved.platform, JSON.stringify(snapshot(old)), evidence, '{}']);
      }
      const applied = await client.query<CompanyJsonRecord>('UPDATE zenithjoy.company_source_sync SET draft=NULL,applied_version=$3,applied_at=now() WHERE company_id=$1 AND tenant_id=$2 RETURNING *', [...key, version]);
      await client.query('COMMIT');
      return status(applied.rows[0]);
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally { client.release(); }
  }));
}
