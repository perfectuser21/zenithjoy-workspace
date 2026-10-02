#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { resolve, join, isAbsolute } = require('node:path');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, openSync, closeSync, fstatSync, constants } = require('node:fs');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { createWorkflowControl } = require('./keyword-workflow-control.js');

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const service = __dirname;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 执行与确认必须使用完全相同的原生输入归一化。
function workflowContext(input) {
  return { ...input, videos: [], comments: [], workflow_artifacts: {}, return_to_results: true,
    execution: input.execution || {} };
}
function validStartupOptions(options) {
  const path = options.startupReceipt, id = options.startupId;
  if (path === undefined && id === undefined) return true;
  return typeof path === 'string' && Boolean(path.trim()) && typeof id === 'string' && UUID.test(id)
    && (!options.receipt || resolve(path) !== resolve(options.receipt));
}
function readContract(path) {
  if (typeof path !== 'string' || !path.trim()) throw Error('invalid_workflow_contract');
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error('invalid_workflow_contract');
  return JSON.parse(text).contract;
}
function contractShape(contract) {
  return typeof contract?.workflow === 'string' && Boolean(contract.workflow.trim())
    && Array.isArray(contract.activities) && contract.activities.length > 0;
}
function keywordContractIdentity(contract, input) {
  const canonical = readContract(join(service, 'plans/keyword_workflow.contract.json'));
  return contractShape(contract) && contractShape(canonical) && contract.workflow === canonical.workflow
    && (input.capability === undefined || input.capability === 'keyword_acquisition')
    && (contract.capability === undefined || contract.capability === 'keyword_acquisition')
    && contract.activities.every(a => a?.source_contract?.capability === 'keyword_acquisition'
      && (a.from === undefined || a.from === 'keyword_acquisition'));
}
function confirmKeywordStart(input, options) {
  if (invalidInput(input) || (input.capability !== undefined && input.capability !== 'keyword_acquisition')) {
    return failure(input, 'invalid_workflow_input');
  }
  if (!validStartupOptions(options) || !options.startupReceipt || !options.contract) return failure(input, 'invalid_cli_argument');
  let contract;
  try { contract = readContract(options.contract); } catch { return failure(input, 'invalid_workflow_contract'); }
  try { if (!keywordContractIdentity(contract, input)) return failure(input, 'workflow_capability_mismatch'); }
  catch { return failure(input, 'invalid_workflow_contract'); }
  let start, descriptor;
  try {
    // 不跟随symlink；先核普通文件再读，避免FIFO或设备文件阻塞只读helper。
    descriptor = openSync(options.startupReceipt, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 64 * 1024) throw Error('invalid_startup_file');
    start = JSON.parse(readFileSync(descriptor, 'utf8'));
  } catch { return failure(input, 'startup_receipt_unavailable'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
  // 本轮UUID由调用方先保存；绝不以文件中的UUID替代调度预期值。
  if (start?.schema_version !== 1 || start.event_type !== 'WF_RUN_STARTED' || start.cursor !== 1
    || start.startup_id !== options.startupId || start.run_tag !== input.run_tag || start.workflow !== contract.workflow
    || typeof start.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(start.at)
    || !Number.isFinite(Date.parse(start.at)) || new Date(start.at).toISOString() !== start.at
    || start.contract_sha256 !== sha(contract) || start.input_sha256 !== sha(workflowContext(input))) {
    return failure(input, 'startup_receipt_identity_mismatch');
  }
  return { schema_version: 1, event_type: 'WF_RUN_START_CONFIRMED', run_tag: input.run_tag,
    capability: 'keyword_acquisition', line_key: input.line_key, profile: input.device.profile, serial: input.device.serial,
    startup_id: options.startupId, workflow: start.workflow, contract_sha256: start.contract_sha256,
    input_sha256: start.input_sha256, at: start.at };
}

function invalidInput(input) {
  if (!input || typeof input !== 'object' || !SAFE.test(input.run_tag || '')) return true;
  if (typeof input.line_key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.line_key)) return true;
  if (!input.device || !SAFE.test(input.device.profile || '') || !SAFE.test(input.device.serial || '')
      || input.device.lock_holder !== input.run_tag) return true;
  if (!input.account || typeof input.account.sender_id !== 'string' || !input.account.sender_id.trim()) return true;
  if (!Array.isArray(input.keywords) || input.keywords.length === 0 || input.keywords.length > 100) return true;
  if (input.keywords.some(k => !k || typeof k.word !== 'string' || !k.word.trim()
      || k.word.length > 256 || (k.max_videos !== undefined && (!Number.isSafeInteger(k.max_videos) || k.max_videos < 1)))) return true;
  if (input.run_budget_s !== undefined && (!Number.isSafeInteger(input.run_budget_s) || input.run_budget_s < 1)) return true;
  if (input.return_to_results !== undefined && input.return_to_results !== true) return true;
  return false;
}

function failure(input, reason) {
  return { schema_version: 1, run_tag: input?.run_tag || 'invalid', line_key: input?.line_key,
    status: 'failed', failure_class: 'fatal', reason_code: reason, outputs: {}, metrics: {}, evidence: [] };
}

function execute(file, argv, input, { env, signal, onStop } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [file, ...argv], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    let stdout = '', tooLarge = false;
    const abort = () => { onStop?.(); child.kill('SIGTERM'); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { tooLarge = true; child.kill('SIGTERM'); }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (tooLarge) return reject(new Error('workflow_output_too_large'));
      try { resolvePromise({ code, value: JSON.parse(stdout) }); }
      catch { reject(new Error('workflow_readback_unavailable')); }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

async function runKeywordWorkflow(input, options = {}) {
  if (invalidInput(input)) return failure(input, 'invalid_workflow_input');
  if (!validStartupOptions(options)) return failure(input, 'invalid_cli_argument');
  if (options.contract !== undefined && options.bindings !== undefined) {
    return failure(input, 'workflow_contract_binding_conflict');
  }
  const runtime = options.runtime || process.env.CECELIA_ACTIVITY_RUNTIME;
  if (!runtime || !isAbsolute(runtime) || !existsSync(runtime)) return failure(input, 'explicit_runtime_required');
  const invoke = options.invoke || execute;
  let compiled;
  if (options.contract !== undefined) {
    try {
      compiled = { code: 0, value: { contract: readContract(options.contract) } };
    } catch { return failure(input, 'invalid_workflow_contract'); }
  } else {
    const bindings = options.bindings || join(service, 'plans/keyword_workflow.bindings.json');
    const compiler = resolve(service, '../../scripts/product-map/wf-plan.mjs');
    try {
      compiled = await invoke(compiler, ['keyword_acquisition', '--json', '--bindings', bindings], undefined,
        { env: process.env, signal: options.signal });
    } catch { return failure(input, 'workflow_compilation_unavailable'); }
  }
  if (compiled.code !== 0 || !contractShape(compiled.value?.contract)) return failure(input, 'invalid_workflow_contract');
  if (options.startupReceipt !== undefined) {
    try { if (!keywordContractIdentity(compiled.value.contract, input)) return failure(input, 'workflow_capability_mismatch'); }
    catch { return failure(input, 'invalid_workflow_contract'); }
  }
  if (options.signal?.aborted) return failure(input, 'workflow_cancelled_before_start');
  const controlDir = mkdtempSync(join(tmpdir(), 'keyword-workflow-'));
  const stopFile = join(controlDir, 'stop');
  const receiptPath = options.receipt || join(controlDir, 'receipt.json');
  const argv = ['--cwd', service, '--receipt', receiptPath];
  if (options.startupReceipt !== undefined) argv.push('--startup-receipt', options.startupReceipt, '--startup-id', options.startupId);
  if (options.eventDb) {
    if (!options.brainRunId || !options.eventSourceId || !process.env.ACTIVITY_EVENT_DATABASE_URL) {
      rmSync(controlDir, { recursive: true, force: true });
      return failure(input, 'explicit_event_identity_required');
    }
    argv.push('--event-db', '--brain-run-id', options.brainRunId, '--event-source-id', options.eventSourceId);
  }
  const maxSeconds = input.run_budget_s ?? Number(process.env.WF_RUN_MAX_SECONDS ?? 14400);
  const env = { ...process.env, WF_RUN_START_TS: String(Math.floor(Date.now() / 1000)),
    WF_RUN_MAX_SECONDS: String(maxSeconds), WF_STOP_FILE: stopFile };
  const context = workflowContext(input);
  let control;
  try {
    control = createWorkflowControl(input, { receiptPath, stopFile, signal: options.signal, env, maxSeconds,
      waitForRunStart: true });
    const result = await invoke(runtime, argv, { contract: compiled.value.contract, input: context }, {
      env, signal: control.signal, onStop: () => writeFileSync(stopFile, 'commander_stop\n', { mode: 0o600 }),
    });
    if (!result.value || result.value.run_tag !== input.run_tag
        || !['completed', 'partial', 'failed'].includes(result.value.status)) return failure(input, 'workflow_readback_unavailable');
    return result.value;
  } catch { return failure(input, 'workflow_transport_unavailable'); }
  finally { await control?.dispose(); rmSync(controlDir, { recursive: true, force: true }); }
}

async function main() {
  const flags = new Map();
  const valueFlags = new Set(['--runtime', '--receipt', '--bindings', '--contract', '--brain-run-id', '--event-source-id', '--startup-receipt', '--startup-id']);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key) || (!valueFlags.has(key) && !['--event-db', '--confirm-start'].includes(key))) throw new Error('invalid_arguments');
    if (['--event-db', '--confirm-start'].includes(key)) flags.set(key, true);
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid_arguments'); flags.set(key, args[++i]); }
  }
  process.stdin.setEncoding?.('utf8');
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1024 * 1024) throw new Error('input_too_large'); }
  const input = JSON.parse(raw);
  if (flags.has('--confirm-start')) {
    if ([...flags.keys()].some(key => !['--confirm-start', '--contract', '--startup-receipt', '--startup-id'].includes(key))) throw Error('invalid_cli_argument');
    const result = confirmKeywordStart(input, { contract: flags.get('--contract'),
      startupReceipt: flags.get('--startup-receipt'), startupId: flags.get('--startup-id') });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.event_type === 'WF_RUN_START_CONFIRMED' ? 0 : 1;
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const result = await runKeywordWorkflow(input, {
    runtime: flags.get('--runtime'), receipt: flags.get('--receipt'), bindings: flags.get('--bindings'),
    contract: flags.get('--contract'), startupReceipt: flags.get('--startup-receipt'), startupId: flags.get('--startup-id'),
    eventDb: flags.get('--event-db'), brainRunId: flags.get('--brain-run-id'), eventSourceId: flags.get('--event-source-id'),
    signal: controller.signal,
  });
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
}

module.exports = { runKeywordWorkflow, invalidInput, confirmKeywordStart };
if (require.main === module) main().catch(error => {
  process.stdout.write(JSON.stringify(failure(null, error.message === 'invalid_cli_argument' ? 'invalid_cli_argument' : 'invalid_workflow_input')) + '\n'); process.exitCode = 1;
});
