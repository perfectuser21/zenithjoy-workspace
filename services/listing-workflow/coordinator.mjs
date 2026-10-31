import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Array.from({ length: value.length }, (_, i) => i).some(i => !Object.hasOwn(value, i))) throw new Error('INVALID_JSON_INPUT');
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key).enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key)))) throw new Error('INVALID_JSON_INPUT');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('INVALID_JSON_INPUT');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const evidenceValid = x => Array.isArray(x) && x.length > 0 && x.every(v => typeof v === 'string' && v.trim());
function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// 仅支持所有写方使用同一可信本地 POSIX 文件系统；原子硬链接让唯一安装者拥有提交权。
function install(directory, name, value) {
  const temporary = join(directory, `.pending-${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    linkSync(temporary, join(directory, name));
    syncDirectory(directory);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally { unlinkSync(temporary); }
}

function parse(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`CORRUPT_RECORD: ${path}`); }
}
function binding(intent) {
  return { businessKey: intent.businessKey, intentId: intent.intentId, fingerprint: intent.fingerprint };
}
function bound(record, intent) {
  return canonical(record.binding) === canonical(binding(intent));
}
function snapshot(directory, intent) {
  const rank = { unknown: 0, rejected: 1, submitted: 2, verified: 3 };
  let current = { status: 'unknown', intent: binding(intent), productId: null };
  for (const name of readdirSync(directory).filter(x => /^event-.*\.json$/.test(x)).sort()) {
    const event = parse(join(directory, name));
    if (!bound(event, intent) || !(event.status in rank) || !evidenceValid(event.evidence)) throw new Error('CORRUPT_EVENT');
    if ((event.status === 'submitted' || event.status === 'verified') && !event.productId) throw new Error('CORRUPT_EVENT');
    if (current.productId && event.productId && current.productId !== event.productId) throw new Error('CONFLICTING_PRODUCT_ID');
    if (rank[event.status] > rank[current.status]) current = { ...event, intent: binding(intent) };
  }
  return current;
}
function append(directory, intent, status, data) {
  install(directory, `event-${randomUUID()}.json`, { status, binding: binding(intent), at: new Date().toISOString(), ...data });
  return snapshot(directory, intent);
}
function context(input) {
  if (!input || !['root', 'businessKey', 'runId'].every(k => typeof input[k] === 'string' && input[k].trim())) throw new Error('INVALID_INPUT');
  if (!input.target || !input.payload || Array.isArray(input.target) || Array.isArray(input.payload)) throw new Error('INVALID_INPUT');
  const fingerprint = hash(canonical({ target: input.target, payload: input.payload }));
  return { directory: join(resolve(input.root), hash(input.businessKey)), fingerprint };
}
function loadIntent(directory, input, fingerprint) {
  const intent = parse(join(directory, 'intent.json'));
  if (intent.version !== 1 || !intent.intentId || !intent.runId || !intent.at || !evidenceValid(intent.validationEvidence)) throw new Error('CORRUPT_INTENT');
  if (intent.businessKey !== input.businessKey || intent.fingerprint !== fingerprint || hash(canonical({ target: intent.target, payload: intent.payload })) !== fingerprint) throw new Error('IDENTITY_CONFLICT');
  return intent;
}

export function inspect(input) {
  const { directory, fingerprint } = context(input);
  return snapshot(directory, loadIntent(directory, input, fingerprint));
}

export async function coordinate(input, adapter) {
  input = immutable(JSON.parse(canonical(input)));
  const { directory, fingerprint } = context(input);
  if (!adapter || !['validate', 'submit', 'lookup'].every(k => typeof adapter[k] === 'function')) throw new Error('INVALID_ADAPTER');
  // 已有意图的重启路径只能查回；不因为业务前提变化而丢失对既有外部动作的核验。
  let existing;
  try { existing = readFileSync(join(directory, 'intent.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) return reconcile();
  const validation = await adapter.validate(input);
  if (validation?.ok !== true || !evidenceValid(validation.evidence)) throw new Error('PRECONDITIONS_UNVERIFIED');
  mkdirSync(input.root, { recursive: true, mode: 0o700 });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // 持久化每个新目录在父目录中的目录项；断电保证仍依赖底层FS/hardware正确实现fsync。
  for (let path = resolve(input.root); ; path = dirname(path)) { syncDirectory(path); if (path === dirname(path)) break; }
  const intent = immutable({ version: 1, businessKey: input.businessKey, fingerprint, target: input.target, payload: input.payload, runId: input.runId,
    intentId: randomUUID(), at: new Date().toISOString(), validationEvidence: [...validation.evidence] });
  if (!install(directory, 'intent.json', intent)) return reconcile();
  // 适配器必须在副作用前再次核对实时账号/资源，平台无条件写时仍有TOCTOU风险。
  const latest = await adapter.validate(input);
  if (latest?.ok !== true || !evidenceValid(latest.evidence)) return append(directory, intent, 'unknown', { evidence: ['preconditions_changed_before_submit'] });
  let receipt;
  try { receipt = await adapter.submit(intent); }
  catch (error) { return append(directory, intent, 'unknown', { evidence: [`submit_exception:${error.message}`] }); }
  if (!receipt?.productId || !evidenceValid(receipt.evidence)) return append(directory, intent, 'unknown', { evidence: ['submit_receipt_incomplete'] });
  return append(directory, intent, 'submitted', { productId: String(receipt.productId), evidence: receipt.evidence });

  async function reconcile() {
    const previous = loadIntent(directory, input, fingerprint);
    const current = snapshot(directory, previous);
    let result;
    try { result = await adapter.lookup(previous); }
    catch { return current; }
    if (result?.state !== 'verified') return current;
    if (!bound(result, previous) || !result.productId || !evidenceValid(result.evidence)) throw new Error('LOOKUP_BINDING_UNVERIFIED');
    if (current.productId && String(result.productId) !== current.productId) throw new Error('CONFLICTING_PRODUCT_ID');
    return append(directory, previous, 'verified', { productId: String(result.productId), evidence: result.evidence });
  }
}
