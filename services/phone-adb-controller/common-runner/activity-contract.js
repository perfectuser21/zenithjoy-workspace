// 业务契约只消费组装后的活动；不替代 AI TaskBundle/HarnessResult。
import {assertStatusRoutes} from './activity-judgment.js';
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PATH = /^(?:\$|\$input|\$item)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}
function safeField(value) { return typeof value === 'string' && FIELD.test(value) && !UNSAFE.has(value); }
function safePath(value) {
  return typeof value === 'string' && PATH.test(value) && value.split('.').slice(1).every(safeField);
}
export function readActivityPath(path, { context, input, item }) {
  requireValid(safePath(path), 'invalid_input_path');
  const [root, ...fields] = path.split('.');
  let value = root === '$input' ? input : root === '$item' ? item : context;
  for (const field of fields) {
    if (!object(value) || !Object.hasOwn(value, field)) return undefined;
    value = value[field];
  }
  return value;
}

export function parseActivityContract(contract) {
  requireValid(object(contract) && typeof contract.workflow === 'string' && contract.workflow.trim(), 'workflow_required');
  requireValid(Array.isArray(contract.activities) && contract.activities.length > 0, 'activities_required');
  if (contract.on_status !== undefined) assertStatusRoutes(contract.on_status);
  const orders = new Set(), keys = new Set(), groups = new Set();
  const activities = structuredClone(contract.activities).sort((a, b) => a.order - b.order);
  let previous = null;
  for (const a of activities) {
    requireValid(object(a) && !a.ref && safeField(a.key) && !keys.has(a.key), 'activity_key_invalid');
    keys.add(a.key);
    requireValid(Number.isFinite(a.order) && a.order > 0 && !orders.has(a.order), 'activity_order_invalid');
    orders.add(a.order);
    requireValid(Number.isSafeInteger(a.budget?.max_duration_s) && a.budget.max_duration_s > 0
      && Number.isSafeInteger(a.budget?.heartbeat_s) && a.budget.heartbeat_s > 0, 'activity_budget_invalid');
    const failure = a.failure;
    requireValid(object(failure) && ['empty_ok', 'retryable', 'fatal'].every(key => Array.isArray(failure[key]))
      && Array.isArray(failure.needs_human?.cases), 'activity_failure_invalid');
    const r = a.runtime;
    requireValid(object(r) && r.protocol === 'json-stdio-v1', 'json_stdio_protocol_required');
    requireValid(['setup', 'source', 'per_item', 'batch_end', 'finalize'].includes(r.phase), 'activity_phase_invalid');
    requireValid(typeof r.entry === 'string' && /^(?:[a-zA-Z0-9_][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9_][a-zA-Z0-9_-]*\.(?:js|mjs|sh)$/.test(r.entry), 'activity_entry_invalid');
    requireValid(r.argv === undefined || (Array.isArray(r.argv) && r.argv.every(v => typeof v === 'string')), 'activity_argv_invalid');
    if (r.on_status !== undefined || a.on_status !== undefined) assertStatusRoutes(r.on_status ?? a.on_status);
    for (const flag of ['retry_safe', 'recovery_safe', 'interactive']) requireValid(r[flag] === undefined || typeof r[flag] === 'boolean', 'activity_safety_flag_invalid');
    requireValid(r.executor_kind === undefined || ['code', 'agent'].includes(r.executor_kind), 'activity_executor_kind_invalid');
    requireValid(r.on_failure === undefined || ['continue', 'stop_run'].includes(r.on_failure), 'activity_failure_policy_invalid');
    requireValid(r.max_attempts === undefined || [1, 2].includes(r.max_attempts), 'activity_attempts_invalid');
    requireValid(r.cleanup_grace_s === undefined || (Number.isSafeInteger(r.cleanup_grace_s)
      && r.cleanup_grace_s >= 1 && r.cleanup_grace_s <= 30), 'activity_cleanup_grace_invalid');
    requireValid(r.detached === undefined || typeof r.detached === 'boolean', 'activity_detached_invalid');
    if (r.input !== undefined) requireValid(object(r.input)
      && Object.entries(r.input).every(([key, value]) => safeField(key) && safePath(value)), 'activity_input_mapping_invalid');
    if (r.phase === 'per_item') {
      const p = r.per_item;
      requireValid(object(p) && safeField(p.group) && safeField(p.input) && safeField(p.identity)
        && /^\$\.[A-Za-z_][A-Za-z0-9_]*$/.test(p.items) && safePath(p.items), 'per_item_binding_required');
      if (p.when !== undefined) requireValid(object(p.when) && safePath(p.when.path)
        && Object.hasOwn(p.when, 'equals'), 'per_item_condition_invalid');
      if (previous?.runtime.per_item?.group === p.group) {
        const before = previous.runtime.per_item;
        requireValid(['items', 'input', 'identity'].every(key => before[key] === p[key]), 'per_item_group_binding_mismatch');
      } else {
        requireValid(!groups.has(p.group), 'per_item_group_not_contiguous'); groups.add(p.group);
      }
    } else requireValid(r.per_item === undefined, 'per_item_phase_required');
    previous = a;
  }
  return { ...contract, activities };
}

export function parseActivityResult(value, input) {
  requireValid(object(value) && value.schema_version === 1, 'activity_result_version_invalid');
  requireValid(['completed', 'done', 'partial', 'failed', 'empty', 'retry', 'needs_review'].includes(value.status), 'activity_result_status_invalid');
  requireValid(value.run_tag === input.run_tag
    && (input.line_key === undefined || value.line_key === input.line_key), 'activity_result_identity_mismatch');
  requireValid(object(value.outputs) && Object.keys(value.outputs).every(safeField)
    && object(value.metrics) && Array.isArray(value.evidence), 'activity_result_payload_invalid');
  requireValid(['completed', 'done', 'empty'].includes(value.status) ? value.failure_class == null
    : value.status === 'needs_review' ? value.failure_class == null || value.failure_class === 'needs_human'
    : ['retryable', 'needs_human', 'fatal'].includes(value.failure_class), 'activity_result_failure_invalid');
  return value;
}
