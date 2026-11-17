import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { companyObject, companyRecord, type CompanyJsonRecord as Row } from './company-profile-validation';
import { accountRequestWasUsed } from './company-account-request-history';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const text = (v: unknown, pattern: RegExp, max = 160): v is string => typeof v === 'string' && v.length <= max && pattern.test(v);
const keys = (v: Row, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (companyObject(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function parse(raw: unknown) {
  if (!companyObject(raw) || !keys(raw, ['expected_version', 'account_id', 'request_id', 'ownership_decision_id', 'device', 'evidence_refs'])
    || !Number.isSafeInteger(raw.expected_version) || Number(raw.expected_version) < 0
    || !['account_id', 'request_id', 'ownership_decision_id'].every(k => text(raw[k], UUID))) return null;
  const device = raw.device, evidence = raw.evidence_refs;
  if (!companyObject(device) || !keys(device, ['profile', 'device_serial', 'device_instance_id', 'device_host'])
    || !text(device.profile, /^[A-Za-z0-9_.-]+$/, 120) || !text(device.device_serial, /^[A-Za-z0-9_.:@-]+$/)
    || !text(device.device_instance_id, /^[A-Za-z0-9_.:-]+$/) || !text(device.device_host, /^[A-Za-z0-9_.:-]+$/, 120)
    || !Array.isArray(evidence) || !evidence.length || evidence.length > 10
    || !evidence.every(e => companyObject(e) && keys(e, ['uri', 'sha256']) && text(e.uri, /^(?:https:\/\/|\/)[^\r\n]+$/, 2048) && text(e.sha256, SHA, 64))) return null;
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ account_id: raw.account_id, device,
    ownership_decision_id: raw.ownership_decision_id, evidence_refs: evidence }))).digest('hex');
  return { accountId: String(raw.account_id), requestId: String(raw.request_id), decisionId: raw.ownership_decision_id,
    expectedVersion: Number(raw.expected_version), device, evidence, fingerprint };
}
function accounts(company: Row): Row[] {
  const rows = companyRecord(company.runtime_config).platform_accounts;
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || !rows.every(companyObject)) throw Error('invalid account registry');
  return rows;
}
const normalized = (v: unknown) => typeof v === 'string' ? v.normalize('NFKC').trim().toLowerCase() : '';
function fail(res: Response, status: number, code: string) {
  res.status(status).json({ success: false, error: { code, message: '账号换机登记未完成，请核对本公司账号、目标设备与配置版本；不会自动核验或启用' } });
}
type Helpers = { pool: Pick<Pool, 'connect'>; profile: (row: Row) => Row; snapshot: (row: Row) => Row };

export function companyAccountDeviceReplacement({ pool, profile, snapshot }: Helpers) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!req.tenantId || req.tenantRole !== 'owner' || !req.feishuUserId || res.locals.companyAccountRegistrationActor !== req.feishuUserId) {
      fail(res, 403, 'OWNER_REQUIRED'); return;
    }
    const input = parse(req.body);
    if (!input) { fail(res, 400, 'INVALID_DEVICE_REPLACEMENT'); return; }
    let client: PoolClient | undefined, transaction = false;
    try {
      client = await pool.connect(); await client.query('BEGIN'); transaction = true;
      await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['company-platform-account-registration:v1']);
      const old = (await client.query<Row>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1 FOR UPDATE', [req.tenantId])).rows[0];
      const reject = async (status: number, code: string) => { await client!.query('ROLLBACK'); transaction = false; fail(res, status, code); };
      if (!old?.company_id || old.tenant_id !== req.tenantId) { await reject(404, 'COMPANY_MAPPING_MISSING'); return; }
      const all = (await client.query<Row>('SELECT company_id, tenant_id, runtime_config FROM zenithjoy.tenant_company_profiles ORDER BY company_id FOR SHARE')).rows;
      const found = accounts(old).filter(a => a.id === input.accountId);
      const account = found[0], source = companyRecord(account?.source);
      const reply = (current: Row, replaced: Row, idempotent: boolean) => {
        res.status(idempotent ? 200 : 201).json({ success: true, data: { replaced: true, idempotent,
          verification_required: replaced.verification_status !== 'verified', config_version: current.config_version, account: replaced, profile: profile(current) } });
      };
      for (const company of all) for (const existing of accounts(company)) {
        const original = companyRecord(existing.source);
        if (original.registration_request_id !== input.requestId) continue;
        if (company.company_id !== old.company_id || found.length !== 1 || existing.id !== input.accountId
          || original.operation !== 'device_replacement' || original.registration_fingerprint !== input.fingerprint || original.actor !== req.feishuUserId) {
          await reject(409, 'REPLACEMENT_REQUEST_CONFLICT'); return;
        }
        await client.query('COMMIT'); transaction = false; reply(old, existing, true); return;
      }
      if (await accountRequestWasUsed(client, input.requestId)) { await reject(409, 'REPLACEMENT_REQUEST_SUPERSEDED'); return; }
      if (old.config_version !== input.expectedVersion) { await reject(409, 'VERSION_CONFLICT'); return; }
      if (found.length !== 1 || account.company_id !== old.company_id || account.tenant_id !== old.tenant_id || account.platform !== 'douyin'
        || !text(account.douyin_id, /^[A-Za-z0-9_.-]+$/, 64) || source.kind !== 'tenant_owner_registration'
        || !text(source.registration_request_id, UUID) || !text(source.registration_fingerprint, SHA, 64)
        || !['verified', 'unverified'].includes(String(account.verification_status)) || typeof account.enabled !== 'boolean'
        || account.enabled && account.verification_status !== 'verified') { await reject(409, 'FORMAL_ACCOUNT_REQUIRED'); return; }
      const device = input.device;
      if (account.profile === device.profile && account.device_serial === device.device_serial && account.device_id === device.device_instance_id
        && (account.device_host ?? source.device_host) === device.device_host) { await reject(409, 'DEVICE_UNCHANGED'); return; }
      for (const company of all) for (const existing of accounts(company)) {
        if (company.company_id === old.company_id && existing.id === input.accountId) continue;
        const fields = companyRecord(existing.fields), origin = companyRecord(existing.source);
        const sameAccount = [existing.douyin_id, fields.抖音号, fields.抖音账号].some(v => normalized(v) === normalized(account.douyin_id));
        const formal = origin.kind === 'tenant_owner_registration' || existing.verification_status === 'verified' || existing.verification_source !== undefined;
        const serial = existing.device_serial ?? (formal ? fields.ADB序列号 : undefined);
        const boundProfile = existing.profile ?? (formal ? fields.手机Profile : undefined);
        const host = existing.device_host ?? origin.device_host ?? (formal ? fields.绑定机器 : undefined);
        const sameDevice = serial === device.device_serial || [existing.device_id, existing.device_instance_id, origin.device_instance_id].includes(device.device_instance_id)
          || boundProfile === device.profile && host === device.device_host;
        if (sameAccount || company.company_id !== old.company_id && sameDevice) { await reject(409, 'ACCOUNT_OWNERSHIP_CONFLICT'); return; }
      }
      const runtime = structuredClone(companyRecord(old.runtime_config)), routing = companyRecord(runtime.routing);
      if (typeof routing.line_key !== 'string' || !Array.isArray(routing.profiles) || !routing.profiles.every(v => typeof v === 'string')) {
        await reject(409, 'COMPANY_MAPPING_MISSING'); return;
      }
      const replaced: Row = { ...account, ...device, device_id: device.device_instance_id, enabled: false, verification_status: 'unverified',
        fields: { ...companyRecord(account.fields), 手机Profile: device.profile, ADB序列号: device.device_serial, 绑定机器: device.device_host },
        source: { kind: 'tenant_owner_registration', platform: 'douyin', operation: 'device_replacement', registration_request_id: input.requestId,
          registration_fingerprint: input.fingerprint, ownership_decision_id: input.decisionId, evidence_refs: input.evidence, actor: req.feishuUserId,
          registered_at: new Date().toISOString(), device_host: device.device_host, device_instance_id: device.device_instance_id, replaced_from_version: old.config_version } };
      delete replaced.verification_source; delete replaced.machine_id;
      if (Object.prototype.hasOwnProperty.call(replaced, 'profile_name')) replaced.profile_name = device.profile;
      runtime.platform_accounts = accounts(old).map(a => a.id === input.accountId ? replaced : a);
      runtime.routing = { ...routing, profiles: routing.profiles.includes(String(device.profile)) ? routing.profiles : [...routing.profiles, device.profile] };
      const next = { ...old, runtime_config: runtime, config_version: Number(old.config_version) + 1 };
      const saved = await client.query<Row>('UPDATE zenithjoy.tenant_company_profiles SET runtime_config=$1::jsonb, config_version=$2, updated_at=NOW() WHERE company_id=$3 AND tenant_id=$4 AND config_version=$5 RETURNING *',
        [JSON.stringify(runtime), next.config_version, old.company_id, req.tenantId, input.expectedVersion]);
      if (saved.rowCount !== 1) { await reject(409, 'VERSION_CONFLICT'); return; }
      await client.query('INSERT INTO zenithjoy.company_config_versions (company_id,version,tenant_id,snapshot,actor) VALUES ($1,$2,$3,$4::jsonb,$5)',
        [old.company_id, next.config_version, old.tenant_id, JSON.stringify(snapshot(next)), req.feishuUserId]);
      await client.query("INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES ($1,$2,$3,'account_device_replacement',$4::jsonb,$5::jsonb,$6::jsonb)",
        [old.company_id, next.config_version, req.feishuUserId, JSON.stringify(snapshot(old)), JSON.stringify(snapshot(next)),
          JSON.stringify({ operation: 'platform_account_device_replacement', request_id: input.requestId, request_fingerprint: input.fingerprint, account_id: input.accountId })]);
      await client.query('COMMIT'); transaction = false; reply(saved.rows[0], replaced, false);
    } catch {
      if (transaction && client) { try { await client.query('ROLLBACK'); } catch { /* 未知提交结果只能用原请求读回。 */ } }
      fail(res, 500, 'DEVICE_REPLACEMENT_READBACK_REQUIRED');
    } finally { client?.release(); }
  };
}
