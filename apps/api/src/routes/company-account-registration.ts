// 归属声明登记与设备核验分离：此入口永远不启用账号或升级 verified。
import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import type { Pool, PoolClient } from 'pg';
import { companyObject, companyRecord, type CompanyJsonRecord } from './company-profile-validation';

type Helpers = {
  pool: Pick<Pool, 'connect'>;
  profile: (row: CompanyJsonRecord) => CompanyJsonRecord;
  snapshot: (row: CompanyJsonRecord) => CompanyJsonRecord;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ success: false, error: { code, message }, timestamp: new Date().toISOString() });
}
function onlyKeys(value: CompanyJsonRecord, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}
function text(value: unknown, pattern: RegExp, max = 160): value is string {
  return typeof value === 'string' && value.length <= max && pattern.test(value);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (companyObject(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function normalized(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
}
function accounts(row: CompanyJsonRecord): CompanyJsonRecord[] {
  const raw = companyRecord(row.runtime_config).platform_accounts;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every(companyObject)) throw new Error('invalid account registry');
  return raw;
}
function registrationInput(raw: unknown) {
  if (!companyObject(raw) || !onlyKeys(raw, ['expected_version', 'request_id', 'ownership_decision_id', 'account', 'evidence_refs', 'legacy_account_id'])) return null;
  const account = raw.account;
  if (raw.legacy_account_id !== undefined && !text(raw.legacy_account_id, /^[A-Za-z0-9_-]+$/, 160)) return null;
  if (!Number.isInteger(raw.expected_version) || Number(raw.expected_version) < 0 || !text(raw.request_id, UUID) || !text(raw.ownership_decision_id, UUID)) return null;
  if (!companyObject(account) || !onlyKeys(account, ['platform', 'douyin_id', 'nickname', 'profile', 'device_serial', 'device_instance_id', 'device_host'])) return null;
  if (account.platform !== 'douyin' || !text(account.douyin_id, /^[A-Za-z0-9_.-]+$/, 64)
      || !text(account.profile, /^[A-Za-z0-9_.-]+$/, 120)
      || !text(account.device_serial, /^[A-Za-z0-9_.:@-]+$/)
      || !text(account.device_host, /^[A-Za-z0-9_.:-]+$/, 120)
      || account.device_instance_id !== undefined && !text(account.device_instance_id, /^[A-Za-z0-9_.:-]+$/)
      || account.nickname !== undefined && (typeof account.nickname !== 'string' || account.nickname.length > 120)) return null;
  const evidence = raw.evidence_refs;
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 10
      || !evidence.every(v => companyObject(v) && onlyKeys(v, ['uri', 'sha256']) && text(v.uri, /^(?:https:\/\/|\/)[^\r\n]+$/, 2048) && text(v.sha256, /^[a-f0-9]{64}$/, 64))) return null;
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ account, ownership_decision_id: raw.ownership_decision_id, evidence_refs: evidence, ...(raw.legacy_account_id !== undefined ? { legacy_account_id: raw.legacy_account_id } : {}) }))).digest('hex');
  return { expectedVersion: Number(raw.expected_version), requestId: raw.request_id, decisionId: raw.ownership_decision_id, legacyAccountId: raw.legacy_account_id as string | undefined, account, evidence, fingerprint };
}

// 高敏身份登记要求真实会话；兼容Feishu身份头不构成此入口的认证凭据。
export async function companyAccountRegistrationSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const origin = req.header('origin');
  const trusted = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173,https://autopilot.zenjoymedia.media').split(',').map(value => value.trim()).filter(Boolean);
  try { trusted.push(new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5200').origin); } catch { /* invalid base URL cannot grant trust */ }
  if (origin && !trusted.includes(origin) || !origin && req.header('sec-fetch-site') === 'cross-site') {
    fail(res, 403, 'UNTRUSTED_ORIGIN', '归属登记不接受未信任来源'); return;
  }
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) { fail(res, 401, 'SESSION_REQUIRED', '归属登记需要真实负责人登录会话'); return; }
    res.locals.companyAccountRegistrationActor = session.user.id;
    // 后续tenantContext只能以同一真实session解析，不能在过期时回退到客户端身份头。
    delete req.headers['x-feishu-user-id'];
    delete req.headers['x-bypass-tenant'];
    next();
  } catch { fail(res, 401, 'SESSION_REQUIRED', '归属登记会话不可验证'); }
}

export function companyAccountRegistration({ pool, profile, snapshot }: Helpers) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!req.tenantId) { fail(res, 403, 'NO_TENANT', '缺少认证租户'); return; }
    if (!['owner', 'admin'].includes(req.tenantRole ?? '') || !req.feishuUserId || res.locals.companyAccountRegistrationActor !== req.feishuUserId) { fail(res, 403, 'NOT_ADMIN', '仅认证租户负责人或管理员可登记'); return; }
    const input = registrationInput(req.body);
    if (!input) { fail(res, 400, 'INVALID_REGISTRATION', '登记需合法版本、请求ID、归属决定、账号设备和原件引用；不得自报核验或启用'); return; }
    let client: PoolClient | undefined;
    let transaction = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN'); transaction = true;
      // 全部登记器先取同一事务锁，再读公司行；第二个申请会看到第一个的已提交账号。
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['company-platform-account-registration:v1']);
      const old = (await client.query<CompanyJsonRecord>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1 FOR UPDATE', [req.tenantId])).rows[0];
      if (!old?.company_id) { await client.query('ROLLBACK'); transaction = false; fail(res, 404, 'COMPANY_MAPPING_MISSING', '租户未关联公司'); return; }
      const all = (await client.query<CompanyJsonRecord>('SELECT company_id, tenant_id, runtime_config FROM zenithjoy.tenant_company_profiles ORDER BY company_id FOR SHARE')).rows;
      const reply = (account: CompanyJsonRecord, current: CompanyJsonRecord, idempotent: boolean) => {
        res.status(idempotent ? 200 : 201).json({ success: true, data: { registered: true, idempotent, registration_status: 'declared', verification_required: account.verification_status !== 'verified', config_version: current.config_version, account, profile: profile(current) } });
      };
      // 同一请求可安全处理失去响应后的重试；不同主体/正文不能借旧回执。
      for (const company of all) for (const account of accounts(company)) {
        const source = companyRecord(account.source);
        if (source.registration_request_id === input.requestId) {
          if (company.company_id !== old.company_id || source.registration_fingerprint !== input.fingerprint) {
            await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'REGISTRATION_REQUEST_CONFLICT', '请求ID已用于其他登记'); return;
          }
          await client.query('COMMIT'); transaction = false; reply(account, old, true); return;
        }
      }
      const audit = async (next: CompanyJsonRecord, conflict: CompanyJsonRecord = {}) => {
        await client!.query("INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES ($1,$2,$3,'account_registration',$4::jsonb,$5::jsonb,$6::jsonb)", [old.company_id, next.config_version, req.feishuUserId, JSON.stringify(snapshot(old)), JSON.stringify(snapshot(next)), JSON.stringify(conflict)]);
      };
      if (old.config_version !== input.expectedVersion) {
        await audit(old, { kind: 'version_conflict', expected_version: input.expectedVersion, actual_version: old.config_version, request_id: input.requestId });
        await client.query('COMMIT'); transaction = false; fail(res, 409, 'VERSION_CONFLICT', '公司版本已变化，请读回后重新审查'); return;
      }
      if (old.config_status !== 'draft') { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'DRAFT_REQUIRED', '请先按正常配置流程保存草稿；登记器不更改确认或启用状态'); return; }
      const wanted = input.account;
      let legacy: CompanyJsonRecord | undefined;
      if (input.legacyAccountId !== undefined) {
        const local = accounts(old), candidates = local.filter(account => account.id === input.legacyAccountId);
        const candidate = candidates[0], fields = companyRecord(candidate?.fields), source = companyRecord(candidate?.source);
        const nativeMatches = local.filter(account => [account.douyin_id, companyRecord(account.fields).抖音号, companyRecord(account.fields).抖音账号].map(normalized).includes(normalized(wanted.douyin_id)));
        // 仅原始Feishu声明可迁移。任何正式登记/核验历史都不能降格重建。
        if (candidates.length !== 1 || nativeMatches.length !== 1 || nativeMatches[0] !== candidate
            || candidate.enabled !== false || candidate.verification_status !== 'unverified'
            || source.platform !== 'feishu' || source.kind !== undefined
            || ['registration_request_id', 'registration_fingerprint', 'registered_at', 'ownership_decision_id', 'verification_source'].some(key => source[key] !== undefined)
            || candidate.verification_source !== undefined
            || candidate.platform !== undefined && candidate.platform !== 'douyin'
            || candidate.company_id !== undefined && candidate.company_id !== old.company_id
            || candidate.tenant_id !== undefined && candidate.tenant_id !== old.tenant_id
            || fields.抖音号 !== wanted.douyin_id
            || candidate.douyin_id !== undefined && candidate.douyin_id !== wanted.douyin_id) {
          await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'LEGACY_ACCOUNT_NOT_MIGRATABLE', '仅可显式迁移本公司唯一、未登记未核验且停用的同号Feishu声明'); return;
        }
        legacy = candidate;
      }
      for (const company of all) for (const account of accounts(company)) {
        const fields = companyRecord(account.fields), source = companyRecord(account.source);
        const ids = [account.douyin_id, fields.抖音号, fields.抖音账号].map(normalized).filter(Boolean);
        const sameAccount = ids.includes(normalized(wanted.douyin_id));
        const foreign = company.company_id !== old.company_id;
        // 正式typed绑定优先于导入时陈旧的raw描述；纯Feishu声明不是现役设备占用。
        const formal = source.kind === 'tenant_owner_registration' || account.verification_status === 'verified' || account.verification_source !== undefined;
        const boundSerial = account.device_serial ?? (formal ? fields.ADB序列号 : undefined);
        const boundProfile = account.profile ?? (formal ? fields.手机Profile : undefined);
        const boundHost = account.device_host ?? source.device_host ?? (formal ? fields.绑定机器 : undefined);
        const sameDevice = !!boundSerial && boundSerial === wanted.device_serial
          || !!wanted.device_instance_id && [account.device_id, account.device_instance_id, source.device_instance_id].includes(wanted.device_instance_id)
          || boundProfile === wanted.profile && boundHost === wanted.device_host;
        const migratingOwnLegacy = !foreign && legacy !== undefined && account.id === legacy.id;
        if (sameAccount && !migratingOwnLegacy || foreign && sameDevice) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'ACCOUNT_OWNERSHIP_CONFLICT', '账号或设备已有归属，需走独立归属变更流程'); return; }
      }
      const runtime = structuredClone(companyRecord(old.runtime_config));
      const routing = companyRecord(runtime.routing);
      if (typeof routing.line_key !== 'string' || !Array.isArray(routing.profiles) || !routing.profiles.every(v => typeof v === 'string')) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'COMPANY_MAPPING_MISSING', '公司业务路由尚未建立'); return; }
      const account: CompanyJsonRecord = {
        id: randomUUID(), company_id: old.company_id, tenant_id: old.tenant_id,
        platform: 'douyin', douyin_id: wanted.douyin_id, nickname: wanted.nickname ?? '',
        profile: wanted.profile, device_serial: wanted.device_serial,
        ...(wanted.device_instance_id ? { device_id: wanted.device_instance_id } : {}),
        enabled: false, verification_status: 'unverified',
        fields: { 手机Profile: wanted.profile, 抖音号: wanted.douyin_id, ADB序列号: wanted.device_serial, 绑定机器: wanted.device_host },
        source: { kind: 'tenant_owner_registration', platform: 'douyin', registration_request_id: input.requestId, registration_fingerprint: input.fingerprint, ownership_decision_id: input.decisionId, evidence_refs: input.evidence, device_host: wanted.device_host, ...(wanted.device_instance_id ? { device_instance_id: wanted.device_instance_id } : {}), actor: req.feishuUserId, registered_at: new Date().toISOString(), ...(legacy ? { legacy_migration: { legacy_account_id: legacy.id, legacy_account: structuredClone(legacy), from_config_version: old.config_version } } : {}) },
      };
      runtime.platform_accounts = legacy ? accounts(old).map(previous => previous.id === legacy!.id ? account : previous) : [...accounts(old), account];
      runtime.routing = { ...routing, profiles: routing.profiles.some(value => value === wanted.profile) ? routing.profiles : [...routing.profiles, wanted.profile] };
      const next = { ...old, runtime_config: runtime, config_version: Number(old.config_version) + 1 };
      const updated = await client.query<CompanyJsonRecord>('UPDATE zenithjoy.tenant_company_profiles SET runtime_config=$1::jsonb, config_version=$2, updated_at=NOW() WHERE company_id=$3 AND tenant_id=$4 AND config_version=$5 RETURNING *', [JSON.stringify(runtime), next.config_version, old.company_id, req.tenantId, input.expectedVersion]);
      if (updated.rowCount !== 1) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERSION_CONFLICT', '公司配置并发变化，未写入登记'); return; }
      await client.query('INSERT INTO zenithjoy.company_config_versions (company_id,version,tenant_id,snapshot,actor) VALUES ($1,$2,$3,$4::jsonb,$5)', [old.company_id, next.config_version, req.tenantId, JSON.stringify(snapshot(next)), req.feishuUserId]);
      await audit(next, { operation: legacy ? 'platform_account_legacy_migration' : 'platform_account_registration', request_id: input.requestId, ...(legacy ? { legacy_account_id: legacy.id, account_id: account.id } : {}) });
      await client.query('COMMIT'); transaction = false; reply(account, updated.rows[0], false);
    } catch {
      if (transaction && client) { try { await client.query('ROLLBACK'); } catch { /* commit/connection failure remains unknown; caller must read back */ } }
      fail(res, 500, 'REGISTRATION_FAILED', '归属登记未完成，请按请求ID读回后再决定是否重试');
    } finally { client?.release(); }
  };
}
