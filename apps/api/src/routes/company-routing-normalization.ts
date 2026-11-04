// A separate authenticated repair protocol; ordinary profile editing still
// cannot alter routing identity. Old versions/runs are never rewritten.
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { companyObject, companyRecord, type CompanyJsonRecord } from './company-profile-validation';

type Helpers = { pool: Pick<Pool, 'connect'>; snapshot: (row: CompanyJsonRecord) => CompanyJsonRecord };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const profileName = /^[A-Za-z0-9_.-]{1,160}$/;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (companyObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
// pg returns timestamptz as Date while immutable JSONB snapshots return strings.
// Hash the actual JSON representation on both sides of the durable boundary.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
function fail(res: Response, status: number, code: string, message: string) { res.status(status).json({ success: false, error: { code, message } }); }
function authorized(req: Request, res: Response) {
  if (!req.tenantId) { fail(res, 403, 'NO_TENANT', '缺少认证租户'); return false; }
  if (!['owner', 'admin'].includes(req.tenantRole ?? '') || !req.feishuUserId || res.locals.companyAccountRegistrationActor !== req.feishuUserId) {
    fail(res, 403, 'NOT_ADMIN', '仅同一真实会话的租户负责人或管理员可修复'); return false;
  }
  return true;
}
function input(raw: unknown) {
  if (!companyObject(raw) || Object.keys(raw).sort().join(',') !== 'expected_version,request_id'
    || !Number.isSafeInteger(raw.expected_version) || Number(raw.expected_version) < 1
    || typeof raw.request_id !== 'string' || !UUID.test(raw.request_id)) return null;
  return { expectedVersion: Number(raw.expected_version), requestId: raw.request_id };
}
async function receipt(client: PoolClient, companyId: unknown, requestId: string) {
  const rows = (await client.query<CompanyJsonRecord>(`SELECT actor, old_snapshot, new_snapshot, conflict FROM zenithjoy.company_config_changes
    WHERE company_id=$1 AND source='routing_profile_normalization' AND conflict->>'request_id'=$2 ORDER BY id LIMIT 2`, [companyId, requestId])).rows;
  if (rows.length > 1) throw Error('ambiguous normalization receipt');
  return rows[0];
}
function reply(res: Response, saved: CompanyJsonRecord, idempotent: boolean, receipt: CompanyJsonRecord) {
  res.status(idempotent ? 200 : 201).json({ success: true, data: { normalized: true, idempotent, config_version: saved.config_version, config_status: saved.config_status, profile: saved, receipt } });
}
function verifiedReceipt(row: CompanyJsonRecord, old: CompanyJsonRecord) {
  const saved = companyRecord(row.new_snapshot), original = companyRecord(row.old_snapshot), meta = companyRecord(row.conflict);
  if (saved.company_id !== old.company_id || saved.tenant_id !== old.tenant_id || original.company_id !== old.company_id || original.tenant_id !== old.tenant_id
      || meta.outcome !== 'applied' || meta.operation !== 'deduplicate_exact_profiles'
      || !Number.isSafeInteger(saved.config_version) || saved.config_status !== 'draft' || original.config_status !== 'draft'
      || original.config_version !== meta.expected_version || Number(saved.config_version) !== Number(original.config_version) + 1
      || meta.before_sha256 !== hash(original) || meta.after_sha256 !== hash(saved)) throw Error('invalid normalization receipt');
  return saved;
}

export function companyRoutingNormalization({ pool, snapshot }: Helpers) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!authorized(req, res)) return;
    const request = input(req.body);
    if (!request) { fail(res, 400, 'INVALID_NORMALIZATION', '只接受原版本和唯一请求ID；修复内容由服务端生成'); return; }
    let client: PoolClient | undefined, transaction = false;
    try {
      client = await pool.connect(); await client.query('BEGIN'); transaction = true;
      const old = (await client.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1 FOR UPDATE', [req.tenantId])).rows[0];
      if (!old?.company_id) { await client.query('ROLLBACK'); transaction = false; fail(res, 404, 'COMPANY_MAPPING_MISSING', '租户未关联公司'); return; }
      const previous = await receipt(client, old.company_id, request.requestId);
      if (previous) {
        const meta = companyRecord(previous.conflict);
        if (previous.actor !== req.feishuUserId || meta.expected_version !== request.expectedVersion) {
          await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'NORMALIZATION_REQUEST_CONFLICT', '请求ID已用于其他修复'); return;
        }
        const saved = verifiedReceipt(previous, old);
        await client.query('COMMIT'); transaction = false; reply(res, saved, true, { ...meta, actor: previous.actor }); return;
      }
      if (old.config_version !== request.expectedVersion) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERSION_CONFLICT', '请读取当前版本后重新审查'); return; }
      if (old.config_status !== 'draft') { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'DRAFT_REQUIRED', '先按正常配置流程另存草稿，再执行修复'); return; }
      const runtime = companyRecord(old.runtime_config), routing = companyRecord(runtime.routing), profiles = routing.profiles;
      if (!Array.isArray(profiles) || !profiles.length || profiles.length > 1000 || profiles.some(p => typeof p !== 'string' || !profileName.test(p))) {
        await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'ROUTING_NOT_REPAIRABLE', '仅修复规范Profile字符串的完全重复项'); return;
      }
      const unique = [...new Set(profiles)];
      if (unique.length === profiles.length) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'NO_DUPLICATE_PROFILES', '没有完全相同的重复Profile'); return; }
      const next = structuredClone(old);
      next.runtime_config = { ...runtime, routing: { ...routing, profiles: unique } };
      next.config_version = Number(old.config_version) + 1;
      const updated = await client.query(`UPDATE zenithjoy.tenant_company_profiles SET runtime_config=$1::jsonb, config_status=$2, config_version=$3, updated_at=NOW()
        WHERE company_id=$4 AND tenant_id=$5 AND config_version=$6 RETURNING company_id`, [JSON.stringify(next.runtime_config), next.config_status, next.config_version, old.company_id, req.tenantId, request.expectedVersion]);
      if (updated.rowCount !== 1) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERSION_CONFLICT', '版本已变化，修复未提交'); return; }
      const before = snapshot(old), after = snapshot(next);
      const meta = { operation: 'deduplicate_exact_profiles', outcome: 'applied', request_id: request.requestId, expected_version: request.expectedVersion, before_sha256: hash(before), after_sha256: hash(after) };
      await client.query('INSERT INTO zenithjoy.company_config_versions (company_id,version,tenant_id,snapshot,actor) VALUES ($1,$2,$3,$4::jsonb,$5)', [old.company_id, next.config_version, req.tenantId, JSON.stringify(after), req.feishuUserId]);
      await client.query(`INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict)
        VALUES ($1,$2,$3,'routing_profile_normalization',$4::jsonb,$5::jsonb,$6::jsonb)`, [old.company_id, next.config_version, req.feishuUserId, JSON.stringify(before), JSON.stringify(after), JSON.stringify(meta)]);
      await client.query('COMMIT'); transaction = false; reply(res, after, false, { ...meta, actor: req.feishuUserId });
    } catch { if (transaction && client) await client.query('ROLLBACK'); fail(res, 500, 'NORMALIZATION_FAILED', '修复未获确认，请按原请求ID只读查询'); }
    finally { client?.release(); }
  };
}

export function companyRoutingNormalizationReadback({ pool }: Helpers) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!authorized(req, res)) return;
    const requestId = req.params.requestId;
    if (typeof requestId !== 'string' || !UUID.test(requestId)) { fail(res, 400, 'INVALID_NORMALIZATION', '请求ID格式错误'); return; }
    let client: PoolClient | undefined, transaction = false;
    try {
      client = await pool.connect(); await client.query('BEGIN READ ONLY'); transaction = true;
      const old = (await client.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1', [req.tenantId])).rows[0];
      if (!old?.company_id) { await client.query('ROLLBACK'); transaction = false; fail(res, 404, 'COMPANY_MAPPING_MISSING', '租户未关联公司'); return; }
      const found = await receipt(client, old.company_id, requestId);
      if (!found) { await client.query('COMMIT'); transaction = false; fail(res, 404, 'NORMALIZATION_NOT_FOUND', '本公司没有该修复回执'); return; }
      const saved = verifiedReceipt(found, old);
      await client.query('COMMIT'); transaction = false; reply(res, saved, true, { ...companyRecord(found.conflict), actor: found.actor });
    } catch { if (transaction && client) await client.query('ROLLBACK'); fail(res, 500, 'NORMALIZATION_READBACK_FAILED', '无法核验原修复回执'); }
    finally { client?.release(); }
  };
}
