// 公司Wiki与运行配置真身；身份来自认证租户，写入使用锁与版本比较。
import { isDeepStrictEqual } from 'node:util';
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { companyAccountRegistration, companyAccountRegistrationSession } from './company-account-registration';
import { validateCompanyIdentity, validateEnabledCompany, companyRecord, companyObject, type CompanyJsonRecord } from './company-profile-validation';
import { tenantContext } from '../middleware/tenant-context';
import { ipKeyFn, simpleRateLimit } from '../middleware/simple-rate-limit';

export const companyProfileRouter = Router();
const TEXT_FIELDS = ['company_name', 'city', 'industry', 'description', 'customer_problem', 'customer_portrait'] as const;
const ARRAY_FIELDS = ['products', 'key_advantages', 'qa_list'] as const;
const EDITABLE = [...TEXT_FIELDS, ...ARRAY_FIELDS, 'wiki', 'runtime_config', 'config_status', 'config_owner', 'source_evidence'];
function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data, timestamp: new Date().toISOString() });
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message }, timestamp: new Date().toISOString() });
}
function object(value: unknown): value is CompanyJsonRecord {
  return companyObject(value);
}
function profileForReadback(row: CompanyJsonRecord) {
  const data = { ...row };
  for (const field of TEXT_FIELDS) data[field] = row[field] ?? '';
  for (const field of ARRAY_FIELDS) data[field] = Array.isArray(row[field]) ? row[field] : [];
  data.wiki = row.wiki ?? {};
  data.runtime_config = row.runtime_config ?? {};
  data.source_evidence = row.source_evidence ?? [];
  data.config_version = row.config_version ?? 0;
  data.config_status = row.config_status ?? 'draft';
  return data;
}
function profile(row: CompanyJsonRecord, projections: CompanyJsonRecord[] = []) {
  const data = profileForReadback(row);
  const mappings = companyRecord(companyRecord(data.runtime_config).sync_mappings);
  // 映射存在不等于同步完成：只有同步器实际读回凭据才可显示verified。
  data.sync_status = Object.fromEntries(['notion', 'feishu'].map(platform => {
    const mapping = companyRecord(mappings[platform]);
    const projection = projections.find(p => p.platform === platform && p.company_id === row.company_id && p.tenant_id === row.tenant_id);
    const readback = companyRecord(projection?.readback_evidence).readback;
    const identityMatches = object(readback) && readback.company_id === row.company_id && readback.tenant_id === row.tenant_id && readback.config_version === data.config_version && (readback.version === undefined || readback.version === data.config_version);
    const contentMatches = identityMatches && [...TEXT_FIELDS, ...ARRAY_FIELDS, 'wiki', 'runtime_config', 'source_evidence', 'config_status', 'config_owner'].every(field => isDeepStrictEqual(profileForReadback(readback)[field], data[field]));
    const verified = projection?.status === 'verified' && projection.verified_version === data.config_version && contentMatches;
    const status = verified ? 'verified' : projection ? (projection.status === 'verified' ? 'pending' : projection.status) : mapping?.status === 'source_retained' ? 'source_retained' : 'unmapped';
    return [platform, { status, verified_version: projection?.verified_version ?? null, readback_evidence: projection?.readback_evidence ?? null }];
  }));
  return data;
}
function snapshot(row: CompanyJsonRecord) {
  const data = profile(row);
  delete data.sync_status;
  const runtime = companyRecord(data.runtime_config);
  return { ...data, version: data.config_version, product_ids: runtime.product_ids ?? [], policy_id: runtime.policy_id ?? null };
}
function validate(data: CompanyJsonRecord, previous: CompanyJsonRecord): string | null {
  if (typeof data.company_name !== 'string' || !data.company_name.trim()) return 'company_name 必填';
  for (const field of TEXT_FIELDS) if (typeof data[field] !== 'string') return `${field} 必须为文本`;
  for (const field of ARRAY_FIELDS) if (!Array.isArray(data[field])) return `${field} 必须为数组`;
  if (!(data.products as unknown[]).every((p: unknown) => typeof p === 'string') || !(data.key_advantages as unknown[]).every((p: unknown) => typeof p === 'string')) return '产品和优势必须为文本数组';
  if (!(data.qa_list as unknown[]).every((qa: unknown) => object(qa) && typeof qa.q === 'string' && typeof qa.a === 'string')) return 'qa_list 格式错误';
  if (!object(data.wiki) || (data.wiki.markdown !== undefined && typeof data.wiki.markdown !== 'string')) return 'Wiki 必须为对象且 markdown 为文本';
  if (!object(data.runtime_config)) return '运行配置必须为JSON对象';
  if (!['draft', 'confirmed', 'enabled'].includes(String(data.config_status))) return '配置状态不合法';
  if (typeof data.config_owner !== 'string') return '负责人必须为文本';
  if (!object(data.source_evidence) && !Array.isArray(data.source_evidence)) return '来源证据必须为对象或数组';
  if (data.config_status !== 'draft') {
    const markdown = companyRecord(data.wiki).markdown;
    if (!data.config_owner.trim() || typeof markdown !== 'string' || !markdown.trim() || !Object.keys(companyRecord(data.source_evidence)).length && !(Array.isArray(data.source_evidence) && data.source_evidence.length)) return '确认配置需要负责人、Wiki及来源证据';
  }
  if (data.config_status === 'enabled') {
    if (!['confirmed', 'enabled'].includes(String(previous.config_status))) return '请先保存确认状态，再启用';
    // 更改业务事实或规则需重新确认，防止保存后沿用旧确认。
    if (EDITABLE.some(field => !['config_status', 'config_owner'].includes(field) && JSON.stringify(data[field]) !== JSON.stringify(previous[field]))) return '业务资料或规则变更后必须重新确认';
    const invalid = validateEnabledCompany(data);
    if (invalid) return invalid;
    // 101-103仅依赖业务与判断规则；设备、触达和CRM缺口在对应执行步骤阻止动作。
  }
  return null;
}
companyProfileRouter.get('/', simpleRateLimit({ windowMs: 60_000, max: 120, keyFn: ipKeyFn }), tenantContext, async (req: Request, res: Response) => {
  if (!req.tenantId) return fail(res, 403, 'NO_TENANT', '缺少认证租户');
  try {
    const result = await pool.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id = $1', [req.tenantId]);
    if (!result.rows[0]?.company_id) return fail(res, 404, 'COMPANY_MAPPING_MISSING', '当前租户尚未关联公司主记录');
    const projections = await pool.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.company_config_projections WHERE company_id=$1 AND tenant_id=$2', [result.rows[0].company_id, req.tenantId]);
    return ok(res, profile(result.rows[0], projections.rows));
  } catch { return fail(res, 500, 'FETCH_FAILED', '公司资料读取失败'); }
});
companyProfileRouter.put('/', simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }), tenantContext, async (req: Request, res: Response) => {
  if (!req.tenantId) return fail(res, 403, 'NO_TENANT', '缺少认证租户');
  if (!['owner', 'admin'].includes(req.tenantRole ?? '')) return fail(res, 403, 'NOT_ADMIN', '仅租户负责人或管理员可修改');
  const body: CompanyJsonRecord = companyRecord(req.body as unknown);
  if (['tenant_id', 'company_id', 'company_key', 'id', 'config_version'].some(key => Object.prototype.hasOwnProperty.call(body, key))) return fail(res, 400, 'IMMUTABLE_IDENTITY', '不得修改公司或租户身份');
  if (typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version) || body.expected_version < 0) return fail(res, 400, 'EXPECTED_VERSION_REQUIRED', '保存必须提交 expected_version');
  const actor = req.feishuUserId ?? '';
  let client;
  try { client = await pool.connect(); } catch { return fail(res, 500, 'SAVE_FAILED', '公司配置数据库连接失败'); }
  let transaction = false;
  try {
    await client.query('BEGIN'); transaction = true;
    const result = await client.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id = $1 FOR UPDATE', [req.tenantId]);
    const old = result.rows[0];
    if (!old?.company_id) { await client.query('ROLLBACK'); transaction = false; return fail(res, 404, 'COMPANY_MAPPING_MISSING', '当前租户尚未关联公司主记录'); }
    const next = profile(old); delete next.sync_status;
    next.config_owner = next.config_owner ?? '';
    for (const field of EDITABLE) if (Object.prototype.hasOwnProperty.call(body, field)) next[field] = body[field];
    const oldSnapshot = snapshot(old);
    if (body.expected_version !== old.config_version) {
      await client.query(`INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES ($1,$2,$3,'web',$4::jsonb,$5::jsonb,$6::jsonb)`, [old.company_id, old.config_version, actor, JSON.stringify(oldSnapshot), JSON.stringify(snapshot(next)), JSON.stringify({ kind: 'version_conflict', expected_version: body.expected_version, actual_version: old.config_version })]);
      await client.query('COMMIT'); transaction = false;
      return fail(res, 409, 'VERSION_CONFLICT', `配置已更新到版本 ${old.config_version}，请重新读取后保存`);
    }
    if (JSON.stringify(companyRecord(next.runtime_config).sync_mappings) !== JSON.stringify(companyRecord(old.runtime_config).sync_mappings)) {
      await client.query('ROLLBACK'); transaction = false;
      return fail(res, 400, 'READONLY_SYNC_MAPPING', '同步映射与读回证据由同步器维护');
    }
    const identityError = validateCompanyIdentity(next, old);
    if (identityError) { await client.query('ROLLBACK'); transaction = false; return fail(res, 400, 'IMMUTABLE_COMPANY_BINDING', identityError); }
    const changed = EDITABLE.some(field => !['config_status', 'config_owner'].includes(field) && JSON.stringify(next[field]) !== JSON.stringify(profile(old)[field]));
    if (changed && ['confirmed', 'enabled'].includes(String(old.config_status)) && next.config_status !== 'draft') {
      // 修改已确认资料后先落草稿，显式再次确认必须是独立一次保存。
      if (body.config_status === 'enabled' || body.config_status === 'confirmed') { await client.query('ROLLBACK'); transaction = false; return fail(res, 400, 'RECONFIRM_REQUIRED', '资料或规则修改后请先保存草稿，再确认'); }
      next.config_status = 'draft';
    }
    const invalid = validate(next, profile(old));
    if (invalid) { await client.query('ROLLBACK'); transaction = false; return fail(res, 400, 'INVALID_CONFIG', invalid); }
    next.config_version = Number(old.config_version) + 1;
    const values = EDITABLE.map(field => ['wiki', 'runtime_config', 'source_evidence', ...ARRAY_FIELDS].includes(field) ? JSON.stringify(next[field]) : next[field]);
    await client.query(`UPDATE zenithjoy.tenant_company_profiles SET ${EDITABLE.map((field, index) => `${field} = $${index + 1}`).join(', ')}, config_version = $${values.length + 1}, updated_at = NOW() WHERE tenant_id = $${values.length + 2} AND config_version = $${values.length + 3}`, [...values, next.config_version, req.tenantId, body.expected_version]);
    const newSnapshot = snapshot(next);
    await client.query('INSERT INTO zenithjoy.company_config_versions (company_id,version,tenant_id,snapshot,actor) VALUES ($1,$2,$3,$4::jsonb,$5)', [old.company_id, next.config_version, req.tenantId, JSON.stringify(newSnapshot), actor]);
    await client.query(`INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES ($1,$2,$3,'web',$4::jsonb,$5::jsonb,$6::jsonb)`, [old.company_id, next.config_version, actor, JSON.stringify(oldSnapshot), JSON.stringify(newSnapshot), JSON.stringify({})]);
    const projections = await client.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.company_config_projections WHERE company_id=$1 AND tenant_id=$2', [old.company_id, req.tenantId]);
    await client.query('COMMIT'); transaction = false;
    return ok(res, { updated: true, config_version: next.config_version, profile: profile(next, projections.rows) });
  } catch { if (transaction) await client.query('ROLLBACK'); return fail(res, 500, 'SAVE_FAILED', '公司配置保存失败'); }
  finally { client.release(); }
});

// 独立登记入口；普通PUT继续拒绝身份变更，核验/启用另走独立协议。
companyProfileRouter.post('/platform-account-registrations', simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }), companyAccountRegistrationSession, tenantContext, companyAccountRegistration({ pool, profile, snapshot }));
