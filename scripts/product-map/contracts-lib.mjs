/**
 * contracts-lib.mjs — 主干活动契约：加载 / 校验 / 组装 / 哈希（决策 3240824c / f18f56b8）
 *
 * 契约与能力地图同处同校验：product-map/contracts/<能力>.yaml，能力 id 必须在 product-map.yaml。
 * 导出：
 *   loadContractsFromDisk(repoRoot?) → ctx {objectTypes, contracts, checks, ledgerStages, productMapIds}
 *   validateContracts(ctx)           → string[]（空 = 通过）
 *   assemble(ctx, capId)             → {ok, errors, activities:[{key, order, from, ...契约}]}
 *   contractsDigest(ctx)             → {object_types, capabilities:{id:{sha256, activities:{key:sha256}}}}
 *
 * 组装闸（无契约不得进工作流）：按 order 串活动，每个活动的输入类型必须由 trigger_inputs 或前序活动交出；
 * 账本 req_keys 与探针文件里出现的每个 stage 都必须有同名活动契约。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACTS_DIR = 'product-map/contracts';
const OBJECT_TYPES = 'object-types.yaml';

const ajv = new Ajv2020({ allErrors: true, strict: true });
function schemaValidator(repoRoot) {
  const schema = JSON.parse(readFileSync(join(repoRoot, CONTRACTS_DIR, 'activity-contract.schema.json'), 'utf8'));
  return ajv.getSchema(schema.$id) || ajv.compile(schema);
}

const readYaml = (p) => parseYaml(readFileSync(p, 'utf8'));

function ledgerStagesOf(text) {
  return [...text.matchAll(/^\s+(\w+)\) echo "[a-z_ ]+";;$/gm)].map((m) => m[1]);
}

// ─── 加载 ──────────────────────────────────────────────────────────────────

export function loadContractsFromDisk(repoRoot = REPO_ROOT) {
  const dir = join(repoRoot, CONTRACTS_DIR);
  const contracts = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.yaml') && n !== OBJECT_TYPES).sort()) {
    const doc = readYaml(join(dir, f));
    const key = doc?.contract_key ?? doc?.capability ?? f;
    if (contracts[key]) throw new Error(`契约身份重复: ${key}`);
    if (f !== `${key}.yaml`) throw new Error(`契约文件身份不符: ${f}`);
    contracts[key] = doc;
  }
  const checks = {};
  const ledgerStages = {};
  for (const doc of Object.values(contracts)) {
    if (doc?.checks && !checks[doc.checks]) checks[doc.checks] = readYaml(join(repoRoot, doc.checks));
    if (doc?.ledger && !ledgerStages[doc.ledger]) ledgerStages[doc.ledger] = ledgerStagesOf(readFileSync(join(repoRoot, doc.ledger), 'utf8'));
  }
  const pm = readYaml(join(repoRoot, 'product-map/product-map.yaml'));
  return {
    repoRoot,
    objectTypes: readYaml(join(dir, OBJECT_TYPES)).types,
    contracts,
    checks,
    ledgerStages,
    productMapIds: new Set((pm.golden_paths || []).map((g) => g.id)),
  };
}

// ─── 解析 ref ──────────────────────────────────────────────────────────────

function resolveActivities(ctx, capId, errors) {
  const doc = ctx.contracts[capId];
  return (doc.activities || []).map((a) => {
    if (!a.ref) return { ...a, from: capId };
    const [cap, key] = a.ref.split('.');
    const target = ctx.contracts[cap]?.activities?.find((x) => !x.ref && x.key === key);
    if (!target) { errors.push(`${capId}: ref ${a.ref} 不存在（只能引别的能力里自带的活动，不能链式引用）`); return null; }
    return { ...JSON.parse(JSON.stringify(target)), from: cap };
  }).filter(Boolean);
}

// ─── 校验 ──────────────────────────────────────────────────────────────────

function checkFields(ctx, where, type, fields, errors) {
  const t = ctx.objectTypes[type];
  if (!t) { errors.push(`${where}: 对象类型 ${type} 未登记在 ${OBJECT_TYPES}`); return; }
  for (const f of fields) if (!t.fields.includes(f)) errors.push(`${where}: 字段 ${f} 不在对象类型 ${type}`);
}

function validateObjectTypes(ctx, errors) {
  for (const [name, t] of Object.entries(ctx.objectTypes)) {
    for (const k of t.identity || []) if (!t.fields.includes(k)) errors.push(`对象类型 ${name}: 身份键 ${k} 不在 fields`);
    if (!t.source_of_truth) errors.push(`对象类型 ${name}: 缺 source_of_truth`);
  }
}

function validateActivity(ctx, capId, a, probesByKey, checksPath, errors) {
  const at = `${capId}.${a.key}`;
  for (const io of [...a.inputs, ...a.outputs]) checkFields(ctx, at, io.type, io.fields, errors);
  for (const pc of a.postconditions) {
    const p = probesByKey.get(pc.probe);
    if (!p) { errors.push(`${at}: 后置条件探针 ${pc.probe} 不存在于 ${checksPath}`); continue; }
    if (p.stage !== a.key) errors.push(`${at}: 后置条件探针 ${pc.probe} stage=${p.stage} 与活动 ${a.key} 不符`);
    // 6b133a81 运行时拦截：探针不过时按 failure_class 处理，该分类必须是本活动 failure 闭集里声明过（非空）的
    const cls = p.failure_class;
    const declared = cls === 'needs_human' ? a.failure?.needs_human?.cases : a.failure?.[cls];
    if (!Array.isArray(declared) || declared.length === 0) errors.push(`${at}: 后置条件探针 ${pc.probe} failure_class=${cls} 未在活动 failure 声明（运行时拦截无失败语义可依）`);
  }
  if (a.steps.some((s) => s.uses_llm) && !a.model) errors.push(`${at}: 有 uses_llm 步骤但缺 model（模型与成本字段）`);
  const inTypes = new Set(a.inputs.map((i) => i.type));
  const outTypes = new Set(a.outputs.map((o) => o.type));
  const written = new Set();
  const seenOrder = new Set();
  for (const s of [...a.steps].sort((x, y) => x.order - y.order)) {
    const st = `${at}.${s.key}`;
    if (seenOrder.has(s.order)) errors.push(`${st}: order ${s.order} 与同活动其它步骤重复`);
    seenOrder.add(s.order);
    for (const tf of s.reads) {
      const [type, field] = tf.split('.');
      checkFields(ctx, st, type, [field], errors);
      if (!inTypes.has(type) && !written.has(type)) errors.push(`${st}: 读 ${tf}，但 ${type} 不在本活动 inputs 也不是前序步骤写出的`);
    }
    for (const tf of s.writes) {
      const [type, field] = tf.split('.');
      checkFields(ctx, st, type, [field], errors);
      if (!outTypes.has(type)) errors.push(`${st}: 写 ${tf}，但 ${type} 不在本活动 outputs`);
      written.add(type);
    }
  }
  const keys = a.steps.map((s) => s.key);
  if (new Set(keys).size !== keys.length) errors.push(`${at}: 步骤 key 重复`);
  for (const s of a.steps) validateStepDod(ctx, capId, a, s, errors);
}

// 步骤 DoD（任务 9032cdad，决策 2a60378a）：结构由 schema 守，这里守语义——none 必写原因且不得 hard、
// 非 none 必有 expect、sql 必按本批归属($RUN_TAG)、at 只能是本活动或其后（判定时产物已存在）
function validateStepDod(ctx, capId, a, s, errors) {
  const st = `${capId}.${a.key}.${s.key}`;
  const d = s.dod;
  if (!d) return;   // 缺 dod 由 schema 报
  const rb = d.readback || {};
  if (rb.type === 'none') {
    if (!d.reason) errors.push(`${st}: dod readback=none 必须写 reason（为什么确实读不回）`);
    if (d.mode === 'hard') errors.push(`${st}: dod mode=hard 却 readback=none（读不回的步骤不能硬拦）`);
    return;
  }
  if (!rb.expect) errors.push(`${st}: dod readback 缺 expect`);
  const need = { evidence: 'glob', log: 'regex', tsv: 'regex', ledger: 'field', metric: 'ref', sql: 'query', http: 'url' }[rb.type];
  if (need && !rb[need]) errors.push(`${st}: dod readback type=${rb.type} 缺 ${need}`);
  if (rb.type === 'sql' && !String(rb.query || '').includes('$RUN_TAG')) errors.push(`${st}: dod sql 读回必须按本批 $RUN_TAG 归属`);
  if (d.at) {
    const acts = ctx.contracts[capId].activities;
    const target = acts.find((x) => x.key === d.at);
    if (!target || (target.order ?? 0) < a.order) errors.push(`${st}: dod at=${d.at} 必须是本活动或其后的活动（判定时产物要已存在）`);
  }
}

export function validateContracts(ctx) {
  const errors = [];
  validateObjectTypes(ctx, errors);
  const validate = schemaValidator(ctx.repoRoot);

  for (const [path, doc] of Object.entries(ctx.checks)) {
    for (const p of doc?.probes || []) {
      if (p.severity !== 'error') errors.push(`${path}: 探针 ${p.key} severity=${p.severity}，必须 error（决策 f18f56b8 每步拦截）`);
    }
  }

  for (const [capId, doc] of Object.entries(ctx.contracts)) {
    if (!validate(doc)) {
      for (const e of validate.errors) errors.push(`${capId}: schema ${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
      continue;
    }
    if (!ctx.productMapIds.has(doc.capability)) errors.push(`${capId}: 能力不在 product-map.yaml golden_paths`);
    const checksDoc = ctx.checks[doc.checks];
    if (!checksDoc) { errors.push(`${capId}: 探针文件 ${doc.checks} 未加载`); continue; }
    const probesByKey = new Map((checksDoc.probes || []).map((p) => [p.key, p]));

    const own = doc.activities.filter((a) => !a.ref);
    for (const a of own) validateActivity(ctx, capId, a, probesByKey, doc.checks, errors);

    const acts = resolveActivities(ctx, capId, errors);
    const keys = acts.map((a) => a.key);
    if (new Set(keys).size !== keys.length) errors.push(`${capId}: 活动 key 重复`);
    const orders = acts.map((a) => a.order);
    if (new Set(orders).size !== orders.length) errors.push(`${capId}: 活动 order 重复`);
    for (const t of doc.trigger_inputs) if (!ctx.objectTypes[t]) errors.push(`${capId}: trigger_inputs ${t} 未登记在 ${OBJECT_TYPES}`);

    const need = new Set([...(ctx.ledgerStages[doc.ledger] || []), ...(checksDoc.probes || []).map((p) => p.stage)]);
    for (const s of need) if (!keys.includes(s)) errors.push(`${capId}: 账本/探针 stage ${s} 无契约（无契约不得进工作流）`);

    errors.push(...assemble(ctx, capId).errors.filter((e) => !errors.includes(e)));
  }
  return errors;
}

// ─── 步骤 DoD 生成物（step-dod.json：随部署下发给统一裁判 step-judge.mjs / verify-step.mjs --steps）────────

export function stepDodSpec(ctx, capId) {
  const doc = ctx.contracts[capId];
  const assembly = assemble(ctx, capId);
  if (!assembly.ok) throw new Error(assembly.errors.join('\n'));
  const steps = [];
  for (const a of assembly.activities) {
    for (const s of [...a.steps].sort((x, y) => x.order - y.order)) {
      const e = { key: `${a.from}.${a.key}.${s.key}`, activity: a.key, at: s.dod.at || a.key, mode: s.dod.mode, readback: s.dod.readback,
        usage: { workflow_key: doc.brain_workflow_key, slot_key: a.key, sequence_no: a.order } };
      if (s.dod.reason) e.reason = s.dod.reason;
      steps.push(e);
    }
  }
  return {
    version: 1,
    capability: capId,
    brain_workflow_key: doc.brain_workflow_key,
    contract_sha256: contractsDigest(ctx).capabilities[capId].sha256,
    promotion: doc.dod_promotion || { min_consecutive_pass: 20 },
    steps,
  };
}

// ─── 组装 ──────────────────────────────────────────────────────────────────

export function assemble(ctx, capId) {
  const errors = [];
  const doc = ctx.contracts[capId];
  if (!doc) return { ok: false, errors: [`能力 ${capId} 无契约`], activities: [] };
  const acts = resolveActivities(ctx, capId, errors).sort((x, y) => x.order - y.order);
  const available = new Set(doc.trigger_inputs || []);
  for (const a of acts) {
    for (const i of a.inputs || []) {
      if (!available.has(i.type)) errors.push(`${capId}: ${a.key} 输入 ${i.type} 未由 trigger_inputs 或前序活动交出`);
    }
    for (const o of a.outputs || []) available.add(o.type);
  }
  const need = [...(ctx.ledgerStages[doc.ledger] || [])];
  for (const s of need) if (!acts.some((a) => a.key === s)) errors.push(`${capId}: 账本 stage ${s} 无契约（无契约不得进工作流）`);
  return { ok: errors.length === 0, errors, activities: acts };
}

// ─── 哈希 ──────────────────────────────────────────────────────────────────

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const contractHash = (v) => createHash('sha256').update(canonical(v)).digest('hex');
const sha = contractHash;

export function contractsDigest(ctx) {
  const capabilities = {};
  for (const capId of Object.keys(ctx.contracts).sort()) {
    const acts = resolveActivities(ctx, capId, []);
    const activities = {};
    for (const a of acts) activities[a.key] = sha(a);
    capabilities[capId] = { sha256: sha({ ...ctx.contracts[capId], activities: acts }), activities };
  }
  return { object_types: sha(ctx.objectTypes), capabilities };
}
