import { parseActivityContract, parseActivityResult, readActivityPath, object } from './activity-contract.js';
import { callActivityProcess } from './activity-process.js';
import { judgeActivityCheck, activityStatus, activityRoute } from './activity-judgment.js';

function addMetrics(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) target[key] = (target[key] || 0) + value;
    else if (object(value)) { target[key] ||= {}; addMetrics(target[key], value); }
    else target[key] = structuredClone(value);
  }
}
const hasProducts = outputs => Object.values(outputs).some(value => Array.isArray(value) ? value.length > 0 : value != null);
const unknownExecution = result => result?.execution_stopped === false || result?.adapter_result?.execution_stopped === false;
const failedResult = (input, reason, strict) => ({ schema_version: 1, run_tag: input.run_tag,
  ...(input.line_key === undefined ? {} : {line_key: input.line_key}), status: strict ? 'needs_review' : 'failed',
  failure_class: strict ? 'needs_human' : 'fatal', reason_code: reason, outputs: {}, metrics: {}, evidence: [] });

/** 唯一活动循环。业务适配器仅提供执行、独立检查与资源安全回调。 */
export async function runActivityContract(contract, input, {
  cwd = process.cwd(), signal, onEvent = async () => {}, prepareInput = async (_activity, value) => value,
  executeActivity = callActivityProcess, recoverActivity, checkActivity, commander,
  canFinalize, isExecutionUnknown = unknownExecution,
} = {}) {
  const plan = parseActivityContract(contract);
  if (!object(input) || typeof input.run_tag !== 'string' || !input.run_tag.trim()) throw new Error('run_tag_required');
  const original = structuredClone(input), context = structuredClone(input);
  const strict = Boolean(checkActivity || commander || contract.on_status || contract.activities.some(a => a.runtime.on_status || a.on_status));
  const receipt = { schema_version: 1, workflow: plan.workflow, run_tag: input.run_tag,
    status: 'running', outputs: {}, metrics: {}, evidence: [], activities: [] };
  let cursor = 0, failed = false, productive = false, stopped = false, needsReview = false;
  const emit = async (event_type, payload = {}) => {
    const event = { cursor: ++cursor, event_type, run_tag: input.run_tag, ...payload };
    try { await onEvent(event, structuredClone(receipt)); return true; }
    catch {
      failed = true; stopped = true; receipt.reason_code = 'event_sink_failed';
      receipt.event_failures ||= []; receipt.event_failures.push({ cursor: event.cursor, event_type }); return false;
    }
  };
  const snapshot = () => ({ context, input: original, item: null });
  const notify = async (a, event, kind) => {
    try { return await commander?.notify(a.key, event, {executor_kind: kind}); }
    catch { await emit('COMMANDER_UNAVAILABLE', {activity: a.key}); return {action: 'none'}; }
  };
  const aborted = a => commander?.isAborted?.(a.key) === true;

  function mergeOutputs(result, grouping, item) {
    for (const identity of ['run_tag', 'line_key']) {
      if (Object.hasOwn(result.outputs, identity) && result.outputs[identity] !== original[identity]) throw new Error('activity_output_run_identity_mismatch');
    }
    if (grouping) {
      const values = result.outputs[grouping.items.slice(2)];
      if (values !== undefined && (!Array.isArray(values)
        || values.some(row => !object(row) || row[grouping.identity] !== item[grouping.identity]))) throw new Error('per_item_output_identity_mismatch');
    }
    for (const [key, value] of Object.entries(result.outputs)) {
      if (grouping && key === grouping.items.slice(2)) {
        const current = context[key], at = current.findIndex(row => row[grouping.identity] === item[grouping.identity]);
        for (const update of value) Object.assign(current[at], update);
        receipt.outputs[key] = structuredClone(current);
      } else {
        const next = grouping && Array.isArray(value) ? [...(context[key] || []), ...value] : structuredClone(value);
        context[key] = next; receipt.outputs[key] = structuredClone(next);
      }
    }
  }

  async function execute(a, grouping = null, item = null) {
    if (a.runtime.detached) { await emit('ACTIVITY_SKIPPED', {activity: a.key, reason_code: 'detached'}); return; }
    const record = { key: a.key, order: a.order, item: grouping ? item[grouping.identity] : null, status: 'running', attempts: [],
      commander_interventions: 0, commander_status: commander?.status ?? 'unavailable', rescued: false, code_failures: 0, skill_rescues: 0, validator_verdict: {verdict: 'unknown', reason: 'check_not_configured'}, checks: [] };
    receipt.activities.push(record);
    const roots = {...snapshot(), item};
    if (grouping?.when && readActivityPath(grouping.when.path, roots) !== grouping.when.equals) {
      record.status = 'skipped'; await emit('ACTIVITY_SKIPPED', {activity: a.key, item: record.item, reason_code: 'condition_unmatched'}); return;
    }
    let deadline = Date.now() + a.budget.max_duration_s * 1000;
    const observe = async event => {
      const began = Date.now();
      try {return await notify(a, event, a.runtime.executor_kind ?? 'code');}
      finally {deadline += Date.now() - began;}
    };
    let nextRecovery = false, recoveryUsed = false, attempt = 0, lastResult;
    const runCheck = async (phase, result, activityInput) => {
      if (!checkActivity) return {verdict: 'pass', unchecked: true};
      let verdict, timer;
      const control = new AbortController(), remaining_ms = Math.max(0, deadline - Date.now());
      try {
        if (!remaining_ms) throw new Error('activity_check_timeout');
        const checkSignal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
        const pending = checkActivity(a, result, {phase, receipt: structuredClone(receipt), input: activityInput, attempt, remaining_ms, signal: checkSignal});
        const value = await Promise.race([pending, new Promise((_, reject) => {timer = setTimeout(() => {control.abort();reject(new Error('activity_check_timeout'));}, remaining_ms);})]);
        verdict = judgeActivityCheck(value);
      } catch (error) { verdict = {verdict: 'unknown', reason: error.message}; }
      finally {clearTimeout(timer);}

      record.checks.push({phase, attempt, ...verdict});
      if (phase === 'end') record.validator_verdict = verdict;
      await emit('ACTIVITY_CHECKED', {activity: a.key, item: record.item, phase, attempt, verdict});
      const began = Date.now();
      try {await notify(a, {type: 'check_result', phase, verdict}, a.runtime.executor_kind ?? (activityInput?.skill ? 'agent' : 'code'));}
      finally {deadline += Date.now() - began;}
      return verdict;
    };
    while (true) {
      attempt++;
      let activityInput, result, transport, boundaryResult, check, checked = false;
      const recovering = nextRecovery; nextRecovery = false;
      try {
        activityInput = a.runtime.input ? Object.fromEntries(Object.entries(a.runtime.input).map(([key, path]) => {
          const value = readActivityPath(path, roots); if (value === undefined) throw new Error('activity_input_path_missing'); return [key, structuredClone(value)];
        })) : structuredClone(context);
        if (grouping) activityInput[grouping.input] = structuredClone(item);
        activityInput.budget = structuredClone(a.budget);
        activityInput.remaining_duration_s = Math.max(0.001, (deadline - Date.now()) / 1000);
        activityInput.attempt = attempt;
        activityInput = await prepareInput(a, activityInput);
        const guidance = commander?.takeGuidance?.(a.key) ?? [];
        if (guidance.length) activityInput.commander_guidance = guidance;
        if (recovering) activityInput.recovery_mode = lastResult.external_effect === 'unknown' ? 'readback_only' : 'repair';
        const start = await runCheck('start', null, activityInput);
        if (start.verdict !== 'pass' && a.runtime.phase !== 'finalize') {
          result = failedResult(activityInput, 'activity_precondition_unconfirmed', true); check = start;
        } else {
          if (aborted(a) && a.runtime.phase !== 'finalize') throw new Error('commander_aborted');
          if (deadline <= Date.now()) throw new Error('activity_budget_exhausted');
          const recorded = await emit('ACTIVITY_STARTED', {activity: a.key, item: record.item, attempt, recovery: recovering, budget: a.budget, input: activityInput});
          if (!recorded && a.runtime.phase !== 'finalize') throw new Error('event_sink_failed');
          const kind = recovering ? 'agent' : a.runtime.executor_kind ?? (activityInput.skill ? 'agent' : 'code');
          const opts = {cwd, signal: a.runtime.phase === 'finalize' ? undefined : signal,
            onHeartbeat: async details => { if (!await emit('ACTIVITY_HEARTBEAT', {activity: a.key, item: record.item, attempt, ...details})) throw new Error('event_sink_failed'); },
            onAgentEvent: async event => { await emit('ACTIVITY_AGENT_EVENT', {activity: a.key, item: record.item, attempt, event}); return notify(a, event, kind); }};
          const remaining = {...a, budget: {...a.budget, max_duration_s: Math.max(0.001, (deadline - Date.now()) / 1000)}};
          const raw = recovering ? await recoverActivity(remaining, activityInput, {...opts, failure: lastResult, guidance, remaining_ms: deadline - Date.now()})
            : await executeActivity(remaining, activityInput, opts);
          transport = object(raw) && typeof raw.stdout === 'string' ? raw : null;
          if (Number.isFinite(transport?.supervision_wait_ms) && transport.supervision_wait_ms > 0) deadline += transport.supervision_wait_ms;
          boundaryResult = transport ? JSON.parse(transport.stdout) : raw;
          result = parseActivityResult(boundaryResult, activityInput);
          if (result.status === 'done') result = {...result, status: 'completed'};
          if (transport && result.status === 'completed' && transport.exit_code !== 0 && !transport.reason_code) throw new Error('activity_exit_status_mismatch');
          if (transport?.reason_code) result = {...result, status: hasProducts(result.outputs) ? 'partial' : 'failed', failure_class: 'retryable', reason_code: transport.reason_code};
          if (aborted(a) && a.runtime.phase !== 'finalize') result = {...result, status: 'needs_review', failure_class: 'needs_human', reason_code: 'commander_aborted'};
          check = await runCheck('end', result, activityInput); checked = true;
          if (check.verdict !== 'pass') result = {...result, status: 'needs_review', failure_class: 'needs_human', verification: check};
          else if (aborted(a) && a.runtime.phase !== 'finalize') result = {...result, status: 'needs_review', failure_class: 'needs_human', reason_code: 'commander_aborted'};
          else mergeOutputs(result, grouping, item);
        }
      } catch (error) {
        result = failedResult(activityInput ?? input, transport?.reason_code ?? error.message, strict);
        if (error.executionStopped === false) result.execution_stopped = false;
        if (error.externalEffect === 'unknown' || error.external_effect === 'unknown') result.external_effect = 'unknown';
        if (transport?.reason_code && !strict) result.failure_class = 'retryable';
      }
      // 格式或身份检查失败也不能抹掉保守的安全事实；它们只会收紧执行权。
      if (transport?.execution_stopped === false || boundaryResult?.execution_stopped === false) result.execution_stopped = false;
      if (transport?.external_effect === 'unknown' || boundaryResult?.external_effect === 'unknown') result.external_effect = 'unknown';
      if (isExecutionUnknown(result)) { receipt.execution_unknown = true; result.status = 'needs_review'; result.failure_class = 'needs_human'; }
      const attemptReceipt = {attempt, ...result, recovery: recovering, transport: transport || null};
      record.attempts.push(attemptReceipt); lastResult = attemptReceipt;
      receipt.metrics[a.key] ||= {}; addMetrics(receipt.metrics[a.key], result.metrics);
      receipt.evidence.push(...structuredClone(result.evidence)); record.status = result.status;
      record.commander_interventions = commander?.interventions?.(a.key) ?? 0;
      record.commander_status = commander?.status ?? 'unavailable';
      let status = activityStatus(result);
      record.business_status = status;
      await emit('ACTIVITY_FINISHED', {activity: a.key, item: record.item, attempt, status: result.status, failure_class: result.failure_class});
      if (status === 'done' && recovering) { record.rescued = true; record.skill_rescues++; }
      if (!['done','empty'].includes(status) && !recovering && (a.runtime.executor_kind ?? (activityInput?.skill ? 'agent' : 'code')) === 'code') record.code_failures++;
      if (!['done', 'empty'].includes(status)) await observe({type: 'error', result, verdict: check});
      if (aborted(a) && a.runtime.phase !== 'finalize') {
        result.status = record.status = lastResult.status = 'needs_review'; result.failure_class = lastResult.failure_class = 'needs_human';
        status = record.business_status = 'needs_review';
      }
      if (checked && check.verdict !== 'pass' && !recoveryUsed && recoverActivity && a.runtime.recovery_safe === true
        && a.runtime.phase !== 'finalize' && !receipt.execution_unknown && !aborted(a) && !signal?.aborted && !stopped && deadline > Date.now()) {
        recoveryUsed = true;
        let action;
        const began = Date.now();
        try { action = await commander?.recovery?.(a.key, {result, verdict: check}, {executor_kind: 'agent'}); }
        catch { await emit('COMMANDER_UNAVAILABLE', {activity: a.key}); }
        finally {deadline += Date.now() - began;}
        if (['steer', 'answer'].includes(action?.action) && !aborted(a)) { nextRecovery = true; continue; }
      }
      let route = activityRoute(plan, a, status, result, strict);
      if (!strict && route === 'retry' && attempt >= (a.runtime.max_attempts ?? 1) && a.runtime.on_failure === 'continue' && result.failure_class === 'retryable') route = 'next';
      await emit('ACTIVITY_ROUTED', {activity: a.key, item: record.item, attempt, status, route});
      if (status === 'done' || status === 'empty') {
        if (route === 'next') break;
      } else if (!strict) {
        const declared = result.failure_class === 'needs_human' ? a.failure.needs_human.cases : a.failure[result.failure_class];
        if (!declared?.length) {record.reason_code = 'undeclared_failure_class'; failed = true; stopped = true; break;}
      }
      if (route === 'retry' && !recovering && !receipt.execution_unknown && result.external_effect !== 'unknown'
        && !aborted(a) && !signal?.aborted && !stopped && attempt < (a.runtime.max_attempts ?? 1)
        && (!strict || a.runtime.retry_safe === true) && deadline > Date.now()) continue;
      if (route === 'pause' || status === 'needs_review' || route === 'retry') {
        if (strict) { record.status = 'needs_review'; record.business_status = 'needs_review'; needsReview = true; }
      }
      if (!['done', 'empty'].includes(status) || route !== 'next') failed = true;
      if (a.runtime.phase !== 'finalize' && (route !== 'next' || ['fatal', 'needs_human'].includes(result.failure_class) || signal?.aborted || receipt.execution_unknown)) stopped = true;
      break;
    }
    record.commander_interventions = commander?.interventions?.(a.key) ?? 0;
    record.commander_status = commander?.status ?? 'unavailable';
    if (a.runtime.phase !== 'finalize' && record.attempts.some(row => hasProducts(row.outputs))) productive = true;
  }

  await emit('WF_RUN_STARTED', {workflow: plan.workflow});
  const main = plan.activities.filter(a => a.runtime.phase !== 'finalize');
  try {
    for (let i = 0; i < main.length && !stopped; i++) {
      if (signal?.aborted) {failed = true; stopped = true; break;}
      const a = main[i];
      if (a.runtime.phase !== 'per_item') {await execute(a); continue;}
      const grouping = a.runtime.per_item, chain = [a];
      while (main[i + 1]?.runtime.per_item?.group === grouping.group) chain.push(main[++i]);
      const items = readActivityPath(grouping.items, snapshot());
      if (!Array.isArray(items) || items.some(row => !object(row) || row[grouping.identity] == null)
        || new Set(items.map(row => row[grouping.identity])).size !== items.length) throw new Error('per_item_input_identity_invalid');
      for (const item of items) { for (const member of chain) {if (stopped) break; await execute(member, member.runtime.per_item, item);} if (stopped) break; }
    }
  } catch (error) {failed = true; receipt.reason_code = error.message;}
  finally {
    for (const a of plan.activities.filter(a => a.runtime.phase === 'finalize')) {
      try {
        if ((canFinalize && !await canFinalize(structuredClone(receipt), a)) || (!canFinalize && receipt.execution_unknown)) {
          receipt.execution_unknown = true; needsReview = true; stopped = true;
          receipt.activities.push({key: a.key, order: a.order, status: 'blocked', attempts: [], reason_code: 'execution_termination_unknown', commander_interventions: 0, commander_status: commander?.status ?? 'unavailable', rescued: false, validator_verdict: {verdict: 'unknown'}});
          await emit('ACTIVITY_SKIPPED', {activity: a.key, reason_code: 'execution_termination_unknown'}); continue;
        }
        await execute(a);
      } catch (error) {failed = true; receipt.reason_code = error.message;}
    }
  }
  const finalStatus = () => needsReview ? 'needs_review' : failed ? productive ? 'partial' : 'failed' : 'completed';
  receipt.status = finalStatus(); await emit('WF_RUN_FINALIZED', {status: receipt.status}); receipt.status = finalStatus();
  return receipt;
}
