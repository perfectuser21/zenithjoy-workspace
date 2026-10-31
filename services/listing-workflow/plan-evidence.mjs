import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { validSchema, matchesSchema } from './field-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 不执行调用者的 getter/toJSON；非 JSON 值不会被悄悄丢失或改写。
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error('INVALID_JSON');
    const entries = Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, i));
    if (entries.some(x => !x || !x.enumerable || !own(x, 'value'))) throw new Error('INVALID_JSON');
    return `[${entries.map(x => canonical(x.value)).join(',')}]`;
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Reflect.ownKeys(value);
    if (keys.some(k => typeof k !== 'string' || !Object.getOwnPropertyDescriptor(value, k).enumerable || !own(Object.getOwnPropertyDescriptor(value, k), 'value'))) throw new Error('INVALID_JSON');
    return `{${keys.sort().map(k => `${JSON.stringify(k)}:${canonical(Object.getOwnPropertyDescriptor(value, k).value)}`).join(',')}}`;
  }
  throw new Error('INVALID_JSON');
}

function readEvidence(root, reference, maxBytes) {
  if (!text(reference?.path) || isAbsolute(reference.path) || !sha(reference.sha256)) throw new Error('INVALID_EVIDENCE_REFERENCE');
  const candidate = realpathSync(resolve(root, reference.path));
  const rel = relative(root, candidate);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('EVIDENCE_PATH_ESCAPE');
  const stats = statSync(candidate);
  if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) throw new Error('EVIDENCE_SIZE_OR_TYPE');
  const bytes = readFileSync(candidate);
  if (!bytes.length || bytes.length > maxBytes || hash(bytes) !== reference.sha256) throw new Error('EVIDENCE_HASH_MISMATCH');
  return bytes;
}

// policy 属于受信任执行配置；trustedDigests 必须由独立审阅维护，不能从请求中自建。
// matched 只表示方案与固定的文档字节一致，不是现实真值、发布授权或平台状态证明。
export function evaluatePlan(request, { evidenceRoot, policy, now = new Date().toISOString(), maxDocumentBytes = 1_048_576 } = {}) {
  const reasons = [], checked = [];
  const issue = (code, severity = 'unknown', extra = {}) => reasons.push({ code, severity, ...extra });
  const finish = () => ({ status: reasons.some(x => x.severity === 'rejected') ? 'rejected' : reasons.length ? 'unknown' : 'matched',
    publicationAuthorized: false, factsIndependentlyEstablished: false, checked, reasons });
  let root, input, config;
  try {
    input = JSON.parse(canonical(request)); config = JSON.parse(canonical(policy));
    root = realpathSync(evidenceRoot);
    if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes < 1 || !Number.isFinite(Date.parse(now))) throw new Error('INVALID_CONFIGURATION');
    if (!Array.isArray(config.required) || !config.required.length || !Array.isArray(config.trustedDigests) || !config.trustedDigests.every(sha) || !config.schemas) throw new Error('INVALID_POLICY');
    const kinds = new Set();
    for (const rule of config.required) {
      if (!text(rule.kind) || kinds.has(rule.kind) || !Array.isArray(rule.fields) || !rule.fields.length || !rule.fields.every(text) ||
        !Array.isArray(rule.sourceRoles) || !rule.sourceRoles.length || !rule.sourceRoles.every(text)) throw new Error('INVALID_POLICY');
      kinds.add(rule.kind);
      if (rule.fields.some(field => !own(config.schemas, field) || !validSchema(config.schemas[field]))) throw new Error('FIELD_SCHEMA_REQUIRED');
    }
    const identities = ['productId', 'sourceProductKey'];
    if (!text(input.businessKey) || !text(input.target?.storeId) || !identities.some(k => text(input.target?.[k])) ||
      Object.entries(input.target).some(([k, v]) => k === 'businessKey' || (v == null ? !identities.includes(k) : !text(v))) || !input.plan || Array.isArray(input.plan) ||
      typeof input.plan !== 'object' || !Array.isArray(input.proofs)) throw new Error('INVALID_REQUEST');
  } catch (error) { issue(error.message, 'rejected'); return finish(); }
  const documents = new Map();
  for (const reference of input.proofs) {
    let document;
    try { document = JSON.parse(readEvidence(root, reference, maxDocumentBytes)); }
    catch (error) { issue(error.message, 'rejected'); continue; }
    if (!config.trustedDigests.includes(reference.sha256)) { issue('UNTRUSTED_DOCUMENT', 'unknown', { path: reference.path }); continue; }
    if (document?.version !== 1 || !text(document.kind) || !text(document.source?.id) || !text(document.source?.role) || !text(document.reviewedBy) ||
      !document.facts || typeof document.facts !== 'object' || Array.isArray(document.facts) || !Array.isArray(document.artifacts)) {
      issue('INVALID_DOCUMENT', 'rejected', { path: reference.path }); continue;
    }
    if (documents.has(document.kind)) { issue('DUPLICATE_DOCUMENT_KIND', 'rejected', { kind: document.kind }); continue; }
    documents.set(document.kind, document);
    const subject = { businessKey: input.businessKey, storeId: input.target.storeId };
    for (const [key, value] of Object.entries(input.target)) if (text(value)) subject[key] = value;
    for (const [key, expected] of Object.entries(subject)) {
      if (document.subject?.[key] !== expected) issue('SUBJECT_MISMATCH', 'rejected', { kind: document.kind, field: key });
    }
    // 创建请求尚无平台ID，不得把旧商品的观察记录冒充该次创建的前置证据。
    if (!text(input.target.productId) && document.subject?.productId != null) issue('SUBJECT_MISMATCH', 'rejected', { kind: document.kind, field: 'productId' });
    const issued = Date.parse(document.issuedAt), expires = Date.parse(document.expiresAt), time = Date.parse(now);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > time || expires <= time || expires <= issued) {
      issue('EVIDENCE_OUTSIDE_VALIDITY', 'unknown', { kind: document.kind });
    }
    for (const artifact of document.artifacts) {
      try { readEvidence(root, artifact, maxDocumentBytes); }
      catch (error) { issue(error.message, 'rejected', { kind: document.kind }); }
    }
    if (!document.artifacts.length) issue('ORIGINAL_ARTIFACT_MISSING', 'unknown', { kind: document.kind });
    checked.push({ kind: document.kind, source: document.source.id, reviewedBy: document.reviewedBy, sha256: reference.sha256 });
  }
  for (const rule of config.required) {
    const document = documents.get(rule.kind);
    if (!document) { issue('REQUIRED_DOCUMENT_MISSING', 'unknown', { kind: rule.kind }); continue; }
    if (!rule.sourceRoles.includes(document.source.role)) issue('SOURCE_ROLE_UNAPPROVED', 'unknown', { kind: rule.kind });
    for (const field of rule.fields) {
      if (!own(input.plan, field) || !own(document.facts, field)) issue('REQUIRED_FACT_MISSING', 'unknown', { kind: rule.kind, field });
      else {
        if (!matchesSchema(input.plan[field], config.schemas[field]) || !matchesSchema(document.facts[field], config.schemas[field])) {
          issue('FIELD_SCHEMA_INVALID', 'rejected', { kind: rule.kind, field });
        }
        if (canonical(input.plan[field]) !== canonical(document.facts[field])) issue('FACT_MISMATCH', 'rejected', { kind: rule.kind, field });
      }
    }
  }
  return finish();
}
