import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContext } from '../middleware/tenant-context';
import { ipKeyFn, simpleRateLimit } from '../middleware/simple-rate-limit';
import { previewCompanySource } from '../services/company-source-import';
import { companyRecord, type CompanyJsonRecord } from './company-profile-validation';
import { companyQuery, getSources, readCompanySource, saveCompanySource, SourceSyncError } from '../services/company-source-sync';

const path = '/source-sync';
const limit = simpleRateLimit({ windowMs: 60_000, max: 15, keyFn: ipKeyFn });
const stateQuery = 'SELECT platform,parent_id,draft,draft_id,base_version,applied_version,fetched_at,applied_at FROM zenithjoy.company_source_sync WHERE company_id=$1 AND tenant_id=$2';
const error = (res: Response, status: number, message: string) => res.status(status).json({ success: false, error: { message } });
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

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
    const { fields, inputs } = await readCompanySource(profile, source);
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
      const version = await saveCompanySource(client, old, fields, String(saved.platform), req.feishuUserId ?? 'company-admin', snapshot);
      const applied = await client.query<CompanyJsonRecord>('UPDATE zenithjoy.company_source_sync SET draft=NULL,applied_version=$3,applied_at=now() WHERE company_id=$1 AND tenant_id=$2 RETURNING *', [...key, version]);
      await client.query('COMMIT');
      return status(applied.rows[0]);
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally { client.release(); }
  }));
}
