#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { resolve, join, isAbsolute } = require('node:path');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createWorkflowControl } = require('./keyword-workflow-control.js');

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const service = __dirname;

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
  if (options.contract !== undefined && options.bindings !== undefined) {
    return failure(input, 'workflow_contract_binding_conflict');
  }
  const runtime = options.runtime || process.env.CECELIA_ACTIVITY_RUNTIME;
  if (!runtime || !isAbsolute(runtime) || !existsSync(runtime)) return failure(input, 'explicit_runtime_required');
  const invoke = options.invoke || execute;
  let compiled;
  if (options.contract !== undefined) {
    try {
      if (typeof options.contract !== 'string' || !options.contract.trim()) throw Error('invalid_contract_file');
      const text = readFileSync(options.contract, 'utf8');
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error('contract_file_too_large');
      compiled = { code: 0, value: JSON.parse(text) };
    } catch { return failure(input, 'invalid_workflow_contract'); }
  } else {
    const bindings = options.bindings || join(service, 'plans/keyword_workflow.bindings.json');
    const compiler = resolve(service, '../../scripts/product-map/wf-plan.mjs');
    try {
      compiled = await invoke(compiler, ['keyword_acquisition', '--json', '--bindings', bindings], undefined,
        { env: process.env, signal: options.signal });
    } catch { return failure(input, 'workflow_compilation_unavailable'); }
  }
  if (compiled.code !== 0 || typeof compiled.value?.contract?.workflow !== 'string'
      || !compiled.value.contract.workflow.trim() || !Array.isArray(compiled.value.contract.activities)
      || !compiled.value.contract.activities.length) return failure(input, 'invalid_workflow_contract');
  if (options.signal?.aborted) return failure(input, 'workflow_cancelled_before_start');
  const controlDir = mkdtempSync(join(tmpdir(), 'keyword-workflow-'));
  const stopFile = join(controlDir, 'stop');
  const receiptPath = options.receipt || join(controlDir, 'receipt.json');
  const argv = ['--cwd', service, '--receipt', receiptPath];
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
  const context = { ...input, videos: [], comments: [], workflow_artifacts: {}, return_to_results: true,
    execution: input.execution || {} };
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
  const valueFlags = new Set(['--runtime', '--receipt', '--bindings', '--contract', '--brain-run-id', '--event-source-id']);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key) || (!valueFlags.has(key) && key !== '--event-db')) throw new Error('invalid_arguments');
    if (key === '--event-db') flags.set(key, true);
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid_arguments'); flags.set(key, args[++i]); }
  }
  process.stdin.setEncoding?.('utf8');
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1024 * 1024) throw new Error('input_too_large'); }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const input = JSON.parse(raw);
  const result = await runKeywordWorkflow(input, {
    runtime: flags.get('--runtime'), receipt: flags.get('--receipt'), bindings: flags.get('--bindings'),
    contract: flags.get('--contract'),
    eventDb: flags.get('--event-db'), brainRunId: flags.get('--brain-run-id'), eventSourceId: flags.get('--event-source-id'),
    signal: controller.signal,
  });
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
}

module.exports = { runKeywordWorkflow, invalidInput };
if (require.main === module) main().catch(() => {
  process.stdout.write(JSON.stringify(failure(null, 'invalid_workflow_input')) + '\n'); process.exitCode = 1;
});
