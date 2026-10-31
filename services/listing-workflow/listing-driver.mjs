import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { coordinate } from './coordinator.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const text = x => typeof x === 'string' && x.trim().length > 0;
const evidence = x => Array.isArray(x) && x.length > 0 && x.every(text);
// 接口只接受闭合JSON，禁止适配器/调用者在等待期间改变执行内容或运行getter。
function snapshot(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || ![Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value))) throw new Error('INVALID_JSON_INPUT');
  const array = Array.isArray(value), result = array ? [] : {};
  if (array && Reflect.ownKeys(value).length !== value.length + 1) throw new Error('INVALID_JSON_INPUT');
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value') || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('INVALID_JSON_INPUT');
    result[key] = snapshot(d.value);
  }
  return Object.freeze(result);
}

function materialize(input, contract, profile) {
  const reasons = [], actions = [], plan = input.payload?.plan;
  if (!contract || contract.version !== 1 || !Array.isArray(contract.actions) || !contract.actions.length) return { reasons: ['UI_CONTRACT_UNVERIFIED'], actions };
  if (!plan || !Array.isArray(plan.images)) return { reasons: ['PLAN_INCOMPLETE'], actions };
  const identifiers = new Set(), imageIndexes = [];
  if (!profile || !Array.isArray(profile.requiredPlanFields) || !profile.requiredPlanFields.length || !Array.isArray(profile.requiredWriteFields) || !profile.requiredWriteFields.length || !Number.isSafeInteger(profile.minImages) || profile.minImages < 1 || profile.minImages > 9) reasons.push('BUSINESS_PROFILE_UNCONFIGURED');
  else if (profile.requiredPlanFields.some(k => !text(k) || !Object.hasOwn(plan, k) || plan[k] === '' || plan[k] === null) || plan.images.length < profile.minImages || profile.requiredWriteFields.some(k => contract.actions.filter(a => a.operation === 'setField' && a.field === k).length !== 1)) reasons.push('BUSINESS_PROFILE_INCOMPLETE');
  for (const action of contract.actions) {
    if (!['navigate', 'setField', 'upload', 'publish'].includes(action.operation)) { reasons.push('FORBIDDEN_ACTION'); continue; }
    if (!text(action.id) || identifiers.has(action.id) || !text(action.page) || !text(action.anchor)) { reasons.push('UI_CONTRACT_UNVERIFIED'); continue; }
    identifiers.add(action.id);
    let value;
    if (action.operation === 'setField') {
      // 只写商品字段，不接受聊天、客服或其他外部消息目标。
      if (!['title', 'isbn', 'edition', 'inventory', 'groupPrice', 'singlePrice', 'referencePrice', 'description'].includes(action.field) || !Object.hasOwn(plan, action.field)) { reasons.push('FIELD_UNVERIFIED'); continue; }
      value = plan[action.field];
      if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) { reasons.push('FIELD_UNVERIFIED'); continue; }
    }
    if (action.operation === 'upload') {
      const image = plan.images[action.imageIndex];
      try {
        if (!Number.isSafeInteger(action.imageIndex) || !image || !text(image.path) || !/^[a-f0-9]{64}$/.test(image.sha256) || !statSync(image.path).isFile() || statSync(image.path).size > 32 * 1024 * 1024) throw new Error();
        if (digest(readFileSync(image.path)) !== image.sha256) throw new Error();
        imageIndexes.push(action.imageIndex);
        value = image;
      } catch { reasons.push('MEDIA_HASH_MISMATCH'); continue; }
    }
    actions.push(snapshot({ ...action, ...(value === undefined ? {} : { value }) }));
  }
  if (JSON.stringify(imageIndexes) !== JSON.stringify(plan.images.map((_, i) => i))) reasons.push('IMAGE_ORDER_UNVERIFIED');
  const publications = actions.filter(x => x.operation === 'publish');
  if (publications.length !== 1 || actions.at(-1)?.operation !== 'publish') reasons.push('SINGLE_FINAL_SUBMIT_REQUIRED');
  return { reasons: [...new Set(reasons)], actions };
}

// runtime 是受信任执行侧插件，不从商品请求加载。它负责真实锁、店铺、页面锚点和事实授权。
// 本模块不把适配器自报或dry-run结果提升为独立事实、在售或生产发布授权。
export async function runListing(request, runtime = {}) {
  const input = snapshot(request), contract = runtime.contract ? snapshot(runtime.contract) : null;
  const profile = runtime.profile ? snapshot(runtime.profile) : null, binding = runtime.deviceBinding ? snapshot(runtime.deviceBinding) : null;
  const mode = input.mode ?? 'dry-run';
  if (!['dry-run', 'live'].includes(mode)) throw new Error('INVALID_MODE');
  const built = materialize(input, contract, profile);
  const reasons = [...built.reasons];
  if (!['inspect', 'act', 'lookup', 'authorize', 'verifyAction', 'reviewPlan'].every(k => typeof runtime[k] === 'function')) reasons.push('TRUSTED_RUNTIME_INCOMPLETE');
  const result = { mode, status: reasons.length ? 'blocked' : 'planned', publicationAuthorized: false,
    factsIndependentlyEstablished: false, reasons, wouldActions: built.actions };
  if (mode === 'dry-run') {
    if (typeof runtime.inspect === 'function') {
      try {
        result.observation = await runtime.inspect({ operation: 'preflight', target: input.target });
        if (result.observation?.ok !== true || result.observation.storeId !== input.target.storeId || !evidence(result.observation.evidence)) { reasons.push('CURRENT_CONTEXT_UNVERIFIED'); result.status = 'blocked'; }
      }
      catch (error) { reasons.push(`OBSERVATION_UNAVAILABLE:${error.message}`); result.status = 'blocked'; if (error.manifest) result.observation = { status: 'blocked', manifest: error.manifest }; }
      finally { if (typeof runtime.cleanup === 'function') { try { await runtime.cleanup(); } catch (error) { result.cleanupError = error.message; result.status = 'blocked'; } } }
    }
    return result;
  }
  if (runtime.productionEnabled !== true) reasons.push('PRODUCTION_GATE_CLOSED');
  let eventDirectory;
  function record(stage, status, details = {}) {
    if (!eventDirectory) {
      eventDirectory = join(input.root, 'driver-runs', randomUUID());
      mkdirSync(eventDirectory, { recursive: true, mode: 0o700 });
    }
    const path = join(eventDirectory, `${Date.now()}-${randomUUID()}.json`);
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ stage, status, businessKey: input.businessKey, runId: input.runId, ...details })); fsyncSync(fd); }
    finally { closeSync(fd); }
    const directoryFd = openSync(eventDirectory, 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    return path;
  }
  async function inspect(action) {
    const current = await runtime.inspect(action);
    if (current?.ok !== true || current.storeId !== input.target.storeId || current.serial !== binding?.serial || current.package !== binding?.package || current.leaseValid !== true || current.uiApproved !== true || current.unique !== true || (action.operation !== 'preflight' && (current.page !== action.page || current.anchor !== action.anchor)) || !evidence(current.evidence)) throw new Error('CURRENT_CONTEXT_UNVERIFIED');
    return current;
  }
  const adapter = {
    async validate() {
      if (reasons.length) return { ok: false, evidence: [] };
      const approval = await runtime.authorize(input);
      if (approval?.ok !== true || !evidence(approval.evidence)) { reasons.push('FACTS_OR_AUTHORIZATION_UNVERIFIED'); return { ok: false, evidence: [] }; }
      try {
        const current = await inspect({ operation: 'preflight', target: input.target });
        return { ok: true, evidence: [...approval.evidence, ...current.evidence] };
      } catch { reasons.push('CURRENT_CONTEXT_UNVERIFIED'); return { ok: false, evidence: [] }; }
    },
    async submit(intent) {
      record('plan', 'checked', { intentId: intent.intentId });
      record('preflight', 'checked');
      for (const action of built.actions) {
        // 每个动作前重查素材字节和实时页面。运行时必须在act内再次验证锁/锚点，避免TOCTOU。
        if (materialize(input, contract, profile).reasons.length) throw new Error('PLAN_CHANGED_BEFORE_ACTION');
        const before = await inspect(action);
        if (materialize(input, contract, profile).reasons.length) throw new Error('PLAN_CHANGED_BEFORE_ACTION');
        if (action.operation === 'publish') {
          const review = await runtime.reviewPlan(input, built.actions, intent);
          if (review?.ok !== true || review.storeId !== input.target.storeId || !evidence(review.evidence) || profile.requiredWriteFields.some(k => JSON.stringify(review.fields?.[k]) !== JSON.stringify(input.payload.plan[k])) || JSON.stringify(review.images) !== JSON.stringify(input.payload.plan.images.map(x => x.sha256))) throw new Error('FINAL_FORM_UNVERIFIED');
          record('review', 'checked', { evidence: review.evidence });
        }
        const stage = action.operation === 'publish' ? 'submit' : 'prepare';
        const pending = record(stage, 'intent', { actionId: action.id, operation: action.operation, evidence: before.evidence });
        // 上传按已核验的不可变字节交接，真实transport不得重新从可能被替换的原路径取文件。
        let dispatched = action;
        if (action.operation === 'upload') {
          const bytes = readFileSync(action.value.path);
          if (digest(bytes) !== action.value.sha256) throw new Error('MEDIA_CHANGED_BEFORE_UPLOAD');
          dispatched = snapshot({ ...action, value: { sha256: action.value.sha256, bytesBase64: bytes.toString('base64') } });
        }
        const reply = await runtime.act(dispatched, { intent, pendingEvidence: pending });
        if (reply?.ok !== true || !evidence(reply.evidence)) throw new Error('ACTION_RESULT_UNVERIFIED');
        if (action.operation === 'setField' || action.operation === 'upload') {
          const actual = await runtime.verifyAction(action, reply, { intent });
          if (actual?.ok !== true || !evidence(actual.evidence) || (action.operation === 'setField' && JSON.stringify(actual.value) !== JSON.stringify(action.value)) || (action.operation === 'upload' && actual.sha256 !== action.value.sha256)) throw new Error('ACTION_READBACK_MISMATCH');
        }
        record(stage, 'observed', { actionId: action.id, evidence: reply.evidence });
        if (action.operation === 'publish') return { productId: reply.productId, evidence: reply.evidence };
      }
      throw new Error('SUBMISSION_DRIVER_INCOMPLETE');
    },
    async lookup(intent) { record('readback', 'started'); return runtime.lookup(intent); },
  };
  let outcome;
  try {
    const coordinated = await coordinate({ root: input.root, businessKey: input.businessKey, runId: input.runId, target: input.target, payload: input.payload }, adapter);
    outcome = { ...result, ...coordinated, reasons, eventDirectory }; return outcome;
  } catch (error) {
    if (error.message !== 'PRECONDITIONS_UNVERIFIED') throw error;
    outcome = { ...result, status: 'blocked', reasons: reasons.length ? reasons : ['PRECONDITIONS_UNVERIFIED'], eventDirectory }; return outcome;
  } finally {
    // cleanup只能清本人资源；运行时遇到远端终止未知必须保留有限租约并拒绝误释放。
    if (typeof runtime.cleanup === 'function') {
      try { await runtime.cleanup(); if (eventDirectory) record('cleanup', 'observed'); }
      catch (error) { if (outcome) outcome.cleanupError = error.message; else throw error; }
    }
  }
}
