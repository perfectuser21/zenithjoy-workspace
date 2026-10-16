// 只消费受信Brain双任务的核验桥；不接受owner自报actualID/verified，不启用账号或政策。
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { readVerificationTasks, verificationTrust, type VerificationTrust } from '../services/company-verification-brain';
import { companyObject, companyRecord, type CompanyJsonRecord as Row } from './company-profile-validation';
const PROTOCOL = 'company-account-verification-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (companyObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
// 完工会清claim并添加handoff；仅稳定签收内容入摘要，不以可变行快照做幂等。
function statement(task: Row): Row {
  const result = companyRecord(task.result);
  return { id: task.id, task_type: task.task_type, source_id: task.source_id, parent_task_id: task.parent_task_id ?? null, payload: task.payload, actor: result.actor, facts: result.facts, evidence: result.evidence, proof: result.account_verification };
}
function receiptMatches(task: Row, source: Row, kind: 'capture' | 'validation'): boolean {
  const witness = companyRecord(source[kind + '_claim_witness']), actor = source[kind + '_actor'];
  if (!text(actor) || witness.actor !== actor || witness.task_id !== task.id || !text(witness.claimed_at) || !Number.isFinite(Date.parse(witness.claimed_at)) || !text(witness.observed_at)) return false;
  if (companyRecord(task.result).actor !== actor || source[kind + '_task_sha256'] !== digest(statement(task))) return false;
  if (task.status === 'in_progress') return task.claimed_by === actor && task.claimed_at === witness.claimed_at;
  return task.status === 'completed' && (task.claimed_by == null || task.claimed_by === actor) && Number.isFinite(Date.parse(String(task.completed_at)));
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function fail(res: Response, status: number, code: string) { res.status(status).json({ success: false, error: { code, message: '账号核验未确认，请检查正式双任务、来源配置和公司版本；未启用账号或政策' } }); }
function accountRows(row: Row): Row[] {
  const list = companyRecord(row.runtime_config).platform_accounts;
  if (list === undefined) return [];
  if (!Array.isArray(list) || !list.every(companyObject)) throw Error('invalid registry');
  return list;
}
function bindingFor(company: Row, account: Row): Row | null {
  const source = companyRecord(account.source);
  const binding: Row = { company_id: company.company_id, tenant_id: company.tenant_id, account_id: account.id, platform: account.platform, douyin_id: account.douyin_id, profile: account.profile, device_serial: account.device_serial, device_instance_id: source.device_instance_id, device_host: source.device_host, registration_request_id: source.registration_request_id, ownership_decision_id: source.ownership_decision_id, registration_fingerprint: source.registration_fingerprint };
  if (!Object.values(binding).every(text) || binding.platform !== 'douyin' || account.company_id !== company.company_id || account.tenant_id !== company.tenant_id || account.device_id !== binding.device_instance_id || !SHA.test(String(binding.registration_fingerprint)) || !UUID.test(String(binding.registration_request_id)) || !UUID.test(String(binding.ownership_decision_id))) return null;
  return binding;
}
function validEvidence(value: unknown): value is Row[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10 && value.every(v => companyObject(v) && typeof v.uri === 'string' && /^(?:https:\/\/|\/)[^\r\n]+$/.test(v.uri) && v.uri.length <= 2048 && typeof v.sha256 === 'string' && SHA.test(v.sha256));
}
function validTask(task: Row, id: string, kind: string, binding: Row, trust: VerificationTrust, owner: string, registeredAt: number, now: number): boolean {
  const payload = companyRecord(task.payload), p = companyRecord(payload.account_verification), result = companyRecord(task.result), proof = companyRecord(result.account_verification);
  const allowed = kind === 'capture' ? trust.collectors : trust.validators;
  const created = Date.parse(String(task.created_at)), claimed = Date.parse(String(task.claimed_at)), started = Date.parse(String(task.started_at)), checked = Date.parse(String(proof.checked_at)), updated = Date.parse(String(task.updated_at));
  const identity = Object.fromEntries(['platform', 'douyin_id', 'profile', 'device_serial', 'device_instance_id', 'device_host'].map(key => [key, binding[key]]));
  return task.id === id && task.task_type === 'research' && task.status === 'in_progress' && task.completed_at == null
    && typeof task.claimed_by === 'string' && task.claimed_by !== owner && allowed.includes(task.claimed_by)
    && result.actor === task.claimed_by && Array.isArray(result.facts) && result.facts.length > 0 && result.facts.every(text)
    && typeof task.source_id === 'string' && task.source_id.startsWith(`company-account-verification:${kind}:${binding.account_id}:`)
    && UUID.test(task.source_id.slice(`company-account-verification:${kind}:${binding.account_id}:`.length))
    && payload.source === 'company_account_verification' && payload.source_repo === 'perfectuser21/zenithjoy-workspace' && payload.source_revision === trust.revision
    && p.protocol === PROTOCOL && p.kind === kind && p.completion_scope === 'company_verification_writeback' && isDeepStrictEqual(p.binding, binding)
    && proof.protocol === PROTOCOL && proof.kind === kind && proof.status === 'PASS' && isDeepStrictEqual(proof.binding, binding)
    && isDeepStrictEqual(proof.actual_identity, identity) && validEvidence(proof.evidence_refs)
    && Array.isArray(result.evidence) && proof.evidence_refs.every(ref => (result.evidence as unknown[]).includes(ref.uri))
    && [registeredAt, created, claimed, started, checked, updated].every(Number.isFinite)
    && registeredAt <= created && created <= claimed && claimed <= started && started <= checked && checked <= updated && updated <= now + 30000
    && checked >= now - 900000;
}
type Helpers = { pool: Pick<Pool, 'connect'>; profile: (row: Row) => Row; snapshot: (row: Row) => Row };
export function companyAccountVerification({ pool, profile, snapshot }: Helpers) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!req.tenantId || req.tenantRole !== 'owner' || !req.feishuUserId || res.locals.companyAccountRegistrationActor !== req.feishuUserId) { fail(res, 403, 'OWNER_REQUIRED'); return; }
    const input = companyRecord(req.body);
    if (Object.keys(input).some(k => !['account_id', 'expected_version', 'capture_task_id', 'validation_task_id'].includes(k)) || !Number.isInteger(input.expected_version) || Number(input.expected_version) < 0
      || !['account_id', 'capture_task_id', 'validation_task_id'].every(k => typeof input[k] === 'string' && UUID.test(input[k])) || input.capture_task_id === input.validation_task_id) { fail(res, 400, 'INVALID_VERIFICATION_REQUEST'); return; }
    let trust: VerificationTrust;
    try { trust = verificationTrust(); }
    catch { fail(res, 503, 'VERIFICATION_SOURCE_UNAVAILABLE'); return; }
    let client: PoolClient | undefined, transaction = false;
    try {
      client = await pool.connect(); await client.query('BEGIN'); transaction = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['company-platform-account-registration:v1']);
      const old = (await client.query<Row>('SELECT * FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1 FOR UPDATE', [req.tenantId])).rows[0];
      if (!old || old.tenant_id !== req.tenantId) { await client.query('ROLLBACK'); transaction = false; fail(res, 404, 'COMPANY_MAPPING_MISSING'); return; }
      const all = (await client.query<Row>('SELECT company_id, tenant_id, runtime_config FROM zenithjoy.tenant_company_profiles ORDER BY company_id FOR SHARE')).rows;
      const found = accountRows(old).filter(a => a.id === input.account_id);
      const binding = found.length === 1 ? bindingFor(old, found[0]) : null;
      if (!binding) { await client.query('ROLLBACK'); transaction = false; fail(res, 422, 'DECLARED_ACCOUNT_REQUIRED'); return; }
      const account = found[0], previous = companyRecord(account.verification_source);
      // 等待PG锁之后才读真实live claim；网络有独立8秒上限，不拿锁前旧快照冒当前状态。
      let tasks: [Row, Row];
      try { tasks = await readVerificationTasks([String(input.capture_task_id), String(input.validation_task_id)], trust); }
      catch { await client.query('ROLLBACK'); transaction = false; fail(res, 503, 'VERIFICATION_SOURCE_UNAVAILABLE'); return; }
      const observedAt = new Date().toISOString();
      const reply = (current: Row, verified: Row, idempotent: boolean) => res.status(200).json({ success: true, data: { verified: true, idempotent, account: verified, config_version: current.config_version, profile: profile(current) } });
      // 成功响应丢失后，只允许精确相同两回执读回；不产生第二次核验或版本。
      if (account.verification_status === 'verified' && previous.capture_task_id === input.capture_task_id && previous.validation_task_id === input.validation_task_id) {
        if (!isDeepStrictEqual(companyRecord(companyRecord(tasks[0].result).account_verification).binding, binding) || !isDeepStrictEqual(companyRecord(companyRecord(tasks[1].result).account_verification).binding, binding) || !receiptMatches(tasks[0], previous, 'capture') || !receiptMatches(tasks[1], previous, 'validation')) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERIFICATION_RECEIPT_CHANGED'); return; }
        await client.query('COMMIT'); transaction = false; reply(old, account, true); return;
      }
      for (const company of all) for (const used of accountRows(company)) {
        const source = companyRecord(used.verification_source);
        if ([source.capture_task_id, source.validation_task_id].some(id => id === input.capture_task_id || id === input.validation_task_id)) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERIFICATION_RECEIPT_USED'); return; }
      }
      const consumed = await client.query<Row>("SELECT company_id, conflict FROM zenithjoy.company_config_changes WHERE source='account_verification' AND (conflict->>'capture_task_id' = ANY($1::text[]) OR conflict->>'validation_task_id' = ANY($1::text[])) LIMIT 1", [[input.capture_task_id, input.validation_task_id]]);
      if (consumed.rows.length) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERIFICATION_RECEIPT_USED'); return; }
      if (old.config_version !== input.expected_version) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERSION_CONFLICT'); return; }
      const [capture, validation] = tasks, captureProof = companyRecord(companyRecord(capture.result).account_verification), validationProof = companyRecord(companyRecord(validation.result).account_verification);
      const assertions = companyRecord(validationProof.assertions), lock = companyRecord(captureProof.lock);
      const valid = account.verification_status === 'unverified' && account.enabled === false
        && validTask(capture, String(input.capture_task_id), 'capture', binding, trust, req.feishuUserId, Date.parse(String(companyRecord(account.source).registered_at)), Date.now())
        && validTask(validation, String(input.validation_task_id), 'validation', binding, trust, req.feishuUserId, Date.parse(String(companyRecord(account.source).registered_at)), Date.now())
        && capture.claimed_by !== validation.claimed_by && String(capture.source_id).split(':').pop() === String(validation.source_id).split(':').pop() && validation.parent_task_id === capture.id
        && companyRecord(companyRecord(validation.payload).account_verification).capture_task_id === capture.id && validationProof.capture_task_id === capture.id
        && validationProof.capture_proof_sha256 === digest(captureProof) && isDeepStrictEqual(validationProof.evidence_refs, captureProof.evidence_refs)
        && Date.parse(String(validationProof.checked_at)) >= Date.parse(String(captureProof.checked_at))
        && ['native_id_exact', 'own_page', 'device_binding', 'registration_binding', 'evidence_sha256', 'lock_cleanup'].every(key => assertions[key] === true)
        && lock.owner === capture.id && lock.acquired === true && lock.released === true;
      if (!valid) { await client.query('ROLLBACK'); transaction = false; fail(res, 422, 'VERIFICATION_PROOF_REJECTED'); return; }
      const verified = { ...account, verification_status: 'verified', verification_source: { protocol: PROTOCOL, capture_task_id: capture.id, validation_task_id: validation.id, capture_task_sha256: digest(statement(capture)), validation_task_sha256: digest(statement(validation)), capture_claim_witness: { task_id: capture.id, actor: capture.claimed_by, claimed_at: capture.claimed_at, started_at: capture.started_at, observed_at: observedAt }, validation_claim_witness: { task_id: validation.id, actor: validation.claimed_by, claimed_at: validation.claimed_at, started_at: validation.started_at, observed_at: observedAt }, source_revision: trust.revision, capture_actor: capture.claimed_by, validation_actor: validation.claimed_by, evidence_refs: captureProof.evidence_refs, checked_at: captureProof.checked_at, verified_at: new Date().toISOString(), consumed_by: req.feishuUserId } };
      const runtime = structuredClone(companyRecord(old.runtime_config)); runtime.platform_accounts = accountRows(old).map(a => a.id === account.id ? verified : a);
      const next = { ...old, runtime_config: runtime, config_version: Number(old.config_version) + 1 };
      const saved = await client.query<Row>('UPDATE zenithjoy.tenant_company_profiles SET runtime_config=$1::jsonb, config_version=$2, updated_at=NOW() WHERE company_id=$3 AND tenant_id=$4 AND config_version=$5 RETURNING *', [JSON.stringify(runtime), next.config_version, old.company_id, req.tenantId, input.expected_version]);
      if (saved.rowCount !== 1) { await client.query('ROLLBACK'); transaction = false; fail(res, 409, 'VERSION_CONFLICT'); return; }
      await client.query('INSERT INTO zenithjoy.company_config_versions (company_id,version,tenant_id,snapshot,actor) VALUES ($1,$2,$3,$4::jsonb,$5)', [old.company_id, next.config_version, req.tenantId, JSON.stringify(snapshot(next)), req.feishuUserId]);
      await client.query("INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES ($1,$2,$3,'account_verification',$4::jsonb,$5::jsonb,$6::jsonb)", [old.company_id, next.config_version, req.feishuUserId, JSON.stringify(snapshot(old)), JSON.stringify(snapshot(next)), JSON.stringify({ operation: 'platform_account_verification', capture_task_id: capture.id, validation_task_id: validation.id })]);
      await client.query('COMMIT'); transaction = false; reply(saved.rows[0], verified, false);
    } catch {
      if (transaction && client) { try { await client.query('ROLLBACK'); } catch { /* unknown commit: exact task pair readback only */ } }
      fail(res, 500, 'VERIFICATION_FAILED_READBACK_REQUIRED');
    } finally { client?.release(); }
  };
}
