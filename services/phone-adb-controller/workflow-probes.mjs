import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runProbes, evaluateExpect, summarizeGate } from './verify-step.mjs';

const require = createRequire(import.meta.url);
const checksFile = fileURLToPath(new URL('./checks/social-keyword-leadgen.yaml', import.meta.url));
const schemaFile = fileURLToPath(new URL('./checks/schema.json', import.meta.url));
const { doc, errors } = require('./checks/probes-lib.js').loadChecks(checksFile, schemaFile);
if (errors.length) throw new Error('invalid_workflow_checks');

export const checksDigest = () => createHash('sha256').update(readFileSync(checksFile)).digest('hex');
export const checksDocument = () => structuredClone(doc);

export function metricsForProbe(stage, metrics = {}) {
  if (stage !== 'delivery') return structuredClone(metrics);
  // 原探针的leads_written口径是池新增，JSON活动同名指标则是最终线索。
  return { ...metrics, final_leads_written: metrics.leads_written ?? 0,
    leads_written: metrics.comments_written, videos_pushed: metrics.videos_pushed ?? 0 };
}

export async function verifyWorkflowStage({ stage, input, result, metrics, word = '',
  defer = false, evaluatedAfter = stage }, { remote } = {}) {
  const specs = doc.probes.filter(p => p.stage === stage);
  if (!specs.length) throw new Error('unknown_workflow_stage');
  const observedMetrics = metrics ?? metricsForProbe(stage, result.metrics);
  const frame = { stage, scope: word ? { run_tag: input.run_tag, word } : { run_tag: input.run_tag },
    checks_sha256: checksDigest(), evaluated_after: evaluatedAfter, execution_status: result.status };
  if (defer) {
    return { ...frame, probes: specs.map(p => ({ key: p.key, pass: null, status: 'deferred',
      failure_class: p.failure_class, on_fail: p.on_fail })),
    gate: { verdict: 'deferred', action: 'continue', failed: [], unknown: [], alert: false } };
  }
  const local = await runProbes({ doc: { ...doc, probes: specs.filter(p => p.probe.type === 'metric') },
    stage, params: { runTag: input.run_tag, lineKey: input.line_key, word, metrics: observedMetrics } });
  const network = specs.filter(p => p.probe.type !== 'metric');
  let response;
  if (network.length) {
    try { response = await remote?.({ stage, run_tag: input.run_tag, line_key: input.line_key,
      word, metrics: observedMetrics, checks_sha256: frame.checks_sha256 }); }
    catch { response = null; }
  }
  const probes = specs.map(spec => {
    if (spec.probe.type === 'metric') return local.probes.find(p => p.key === spec.key);
    const values = Array.isArray(response?.probes) ? response.probes.filter(p => p && p.key === spec.key) : [];
    const p = values?.length === 1 ? values[0] : null;
    if (response?.checks_sha256 !== frame.checks_sha256 || !p || p.error
      || !Object.hasOwn(p, 'observed') || !Number.isFinite(Date.parse(p.probed_at))) {
      return { key: spec.key, pass: null, error: 'probe_readback_unavailable',
        probed_at: new Date().toISOString(), failure_class: spec.failure_class, on_fail: spec.on_fail };
    }
    return { key: spec.key, observed: p.observed, probed_at: p.probed_at,
      pass: evaluateExpect(spec.expect, p.observed, observedMetrics),
      failure_class: spec.failure_class, on_fail: spec.on_fail };
  });
  return { ...frame, probes, gate: summarizeGate(probes) };
}
