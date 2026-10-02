'use strict';

const { spawn } = require('node:child_process');
const { join, posix } = require('node:path');
const { pathToFileURL } = require('node:url');
const STATUS_WEIGHT = { completed: 0, skipped: 0, partial: 1, failed: 2 };
const NATIVE = {
  preflight: ['batch-activity.js', 'preflight'], discovery: ['batch-activity.js', 'discovery'],
  qualification: ['video-activity.js', 'qualification'], collection: ['video-activity.js', 'collection'],
  scoring: ['comment-activity.js', 'scoring'], delivery: ['comment-activity.js', 'raw-delivery'],
  cleanup: ['batch-activity.js', 'cleanup'],
};

function shellQuote(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'"; }

function invokeJson(entry, args, input, { gateway, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let command = process.execPath, argv = [join(__dirname, entry), ...args];
    if (gateway) {
      if (!gateway || typeof gateway.host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$/.test(gateway.host)
          || typeof gateway.cwd !== 'string' || !gateway.cwd.startsWith('/') || /[\n\r\0]/.test(gateway.cwd)) {
        return reject(new Error('invalid_gateway'));
      }
      const node = gateway.node || 'node';
      if (typeof node !== 'string' || !/^(?:node|\/[A-Za-z0-9_./-]+)$/.test(node)) return reject(new Error('invalid_gateway'));
      let prefix = '';
      if (gateway.env_file !== undefined) {
        if (typeof gateway.env_file !== 'string' || !/^\/[A-Za-z0-9_./-]+\/\.credentials\/[A-Za-z0-9_.-]+$/.test(gateway.env_file)) {
          return reject(new Error('invalid_gateway_credentials_path'));
        }
        prefix = `set -e; set -a; . ${shellQuote(gateway.env_file)}; set +a; `;
      }
      command = 'ssh';
      argv = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', gateway.host,
        prefix + 'exec ' + [node, posix.join(gateway.cwd, entry), ...args].map(shellQuote).join(' ')];
    }
    const child = spawn(command, argv, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', settled = false, timedOut = false;
    const onStop = () => child.kill('SIGTERM');
    process.on('SIGTERM', onStop); process.on('SIGINT', onStop);
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs) : null;
    const finish = () => { clearTimeout(timer); process.removeListener('SIGTERM', onStop); process.removeListener('SIGINT', onStop); };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) child.kill('SIGTERM'); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => { if (!settled) { settled = true; finish(); reject(new Error('activity_transport_unavailable')); } });
    child.on('close', code => {
      if (settled) return; settled = true; finish();
      if (timedOut) return reject(new Error('probe_timeout'));
      try { resolve({ code, value: JSON.parse(stdout) }); }
      catch { reject(new Error('activity_readback_unavailable')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function updateArtifacts(previous, stage, result, { word } = {}) {
  const artifacts = structuredClone(previous || {});
  const prior = artifacts[stage];
  const metrics = { ...(prior?.metrics || {}) };
  for (const [key, value] of Object.entries(result.metrics || {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (key.endsWith('_rate') || key.endsWith('_ratio')) continue;
    metrics[key] = (metrics[key] || 0) + value;
  }
  const calls = (prior?.calls || 0) + 1;
  if (stage === 'collection') {
    const confirmed = (prior?.confirmed_returns || 0)
      + (result.metrics?.returns_attempted === 1 && Number.isFinite(result.metrics?.rescan_count) ? 1 : 0);
    if (confirmed === calls) metrics.rescan_rate = metrics.rescan_count / confirmed;
    else delete metrics.rescan_rate;
    artifacts[stage] = { confirmed_returns: confirmed };
  }
  artifacts[stage] = {
    ...(prior || {}), ...(artifacts[stage] || {}),
    calls,
    status: prior && (STATUS_WEIGHT[prior.status] ?? 2) > (STATUS_WEIGHT[result.status] ?? 2)
      ? prior.status : result.status,
    metrics,
    failure_class: result.failure_class || prior?.failure_class || null,
    evidence: [...(prior?.evidence || []), ...(result.evidence || [])],
  };
  if (stage === 'collection' && typeof word === 'string' && word) {
    const old = prior?.words && Object.hasOwn(prior.words, word) ? prior.words[word] : undefined;
    const state = updateArtifacts(old ? { collection: old } : {}, stage, result).collection;
    artifacts[stage].words = { ...(prior?.words || {}), [word]: state };
  }
  return artifacts;
}

function nativeInput(stage, input) {
  const result = { run_tag: input.run_tag, line_key: input.line_key, budget: input.budget };
  if (['preflight', 'discovery', 'cleanup'].includes(stage)) {
    Object.assign(result, { device: input.device, account: input.account, keywords: input.keywords, execution: input.execution });
  } else if (stage === 'qualification' || stage === 'collection') {
    Object.assign(result, { device: input.device, video: input.video });
    if (stage === 'collection') result.return_to_results = input.return_to_results;
  } else {
    result.comments = input.comments;
    if (stage === 'delivery') result.videos = input.videos;
  }
  return result;
}

function markGate(result, reports) {
  const bad = reports.flatMap(report => report?.probes || []).filter(probe => probe.status !== 'deferred' && probe.pass !== true);
  if (!bad.length) return;
  const classes = [result.failure_class, ...bad.map(probe => probe.failure_class)];
  result.failure_class = classes.includes('fatal') ? 'fatal' : classes.includes('needs_human') ? 'needs_human' : 'retryable';
  result.status = result.status === 'failed' || result.failure_class === 'fatal' ? 'failed' : 'partial';
  result.reason_code ||= bad.some(probe => probe.pass === null) ? 'workflow_probe_unknown' : 'workflow_postcondition_failed';
}

async function runWorkflowActivity(stage, input, { invoke = invokeJson, isStopping = () => false } = {}) {
  if (!NATIVE[stage]) throw new Error('invalid_activity');
  const [entry, action] = NATIVE[stage];
  const gateway = ['scoring', 'delivery'].includes(stage) ? input.execution?.gateway : undefined;
  let result;
  try {
    const response = await invoke(entry, [action], nativeInput(stage, input), { gateway });
    result = response.value;
    if (!result || result.schema_version !== 1 || result.run_tag !== input.run_tag || result.line_key !== input.line_key
        || !['completed', 'partial', 'failed'].includes(result.status) || !result.outputs || Array.isArray(result.outputs)
        || !result.metrics || Array.isArray(result.metrics) || !Array.isArray(result.evidence)
        || response.code !== (result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1)) {
      throw new Error('invalid_activity_readback');
    }
  } catch {
    result = { schema_version: 1, run_tag: input.run_tag, line_key: input.line_key, status: 'failed',
      failure_class: 'retryable', reason_code: 'activity_transport_unavailable', outputs: {}, metrics: {}, evidence: [] };
  }
  const artifacts = updateArtifacts(input.workflow_artifacts, stage, result, { word: input.video?.keyword });
  try {
  const { verifyWorkflowStage, metricsForProbe } = await import(pathToFileURL(join(__dirname, 'workflow-probes.mjs')).href);
  let collectionReadback;
  const remote = async request => {
    // 原collection SQL是全批读回；各词指标独立，复用同次真实SQL快照。
    if (request.stage === 'collection' && collectionReadback) return collectionReadback;
    const args = process.env.WF_PROBE_DEPS ? ['--deps', process.env.WF_PROBE_DEPS] : [];
    const response = await invoke('workflow-probe.js', args, request, { gateway: input.execution?.gateway, timeoutMs: 20000 });
    if (request.stage === 'collection') collectionReadback = response.value;
    return response.value;
  };
  const reports = [];
  const probe = async (key, options = {}) => {
    const report = await verifyWorkflowStage({ stage: key, input, result: { status: artifacts[key]?.status || result.status },
      metrics: metricsForProbe(key, artifacts[key]?.metrics || {}), evaluatedAfter: stage, ...options,
      defer: options.defer || (isStopping() && !['delivery', 'cleanup'].includes(stage)) }, { remote });
    (artifacts[key] ||= { status: 'skipped', calls: 0, metrics: {}, evidence: [] }).probes ||= [];
    artifacts[key].probes.push(report);
    if (!options.defer && report.probes?.some(item => item.pass !== true)) {
      if (artifacts[key].status === 'completed') artifacts[key].status = 'partial';
      const classes = (report.probes || []).filter(item => item.pass !== true).map(item => item.failure_class);
      artifacts[key].failure_class ||= classes.includes('fatal') ? 'fatal' : classes.includes('needs_human') ? 'needs_human' : 'retryable';
      if (options.word && artifacts[key].words?.[options.word]) {
        const state = artifacts[key].words[options.word];
        if (state.status === 'completed') state.status = 'partial';
        state.failure_class ||= artifacts[key].failure_class;
      }
    }
    reports.push(report);
    return report;
  };
  const probeCollection = async () => {
    const words = Object.entries(artifacts.collection?.words || {});
    if (!words.length) return probe('collection');
    for (const [word, state] of words) await probe('collection', { word, metrics: state.metrics });
  };
  if (stage === 'discovery') {
    for (const keyword of input.keywords || []) {
      const candidates = (result.outputs.videos || []).filter(video => video.keyword === keyword.word).length;
      await probe(stage, { word: keyword.word, metrics: { candidates } });
    }
  } else if (stage === 'qualification') {
    await probe(stage, { defer: artifacts[stage].calls < (input.videos || []).length });
  } else if (stage === 'collection' || stage === 'scoring') {
    await probe(stage, { defer: true });
  } else {
    await probe(stage);
  }
  if (stage === 'delivery') {
    if (artifacts.qualification) await probe('qualification');
    if (artifacts.collection) await probeCollection();
    if (artifacts.scoring) await probe('scoring');
    result.evidence.push({ type: 'probe_coverage', stage: 'collection',
      reason_code: 'pg_binding_probe_covers_pg_comments_only',
      raw_pool_source_identity: result.status === 'completed' ? 'native_delivery_readback' : 'unconfirmed' });
  }
  if (stage === 'cleanup') {
    for (const key of ['qualification', 'collection', 'scoring']) {
      const state = artifacts[key];
      if (state && !(state.probes || []).some(report => report.evaluated_after === 'delivery')) {
        if (key === 'collection') await probeCollection(); else await probe(key);
      }
    }
  }
  markGate(result, reports);
  if (artifacts[stage].status === 'completed' && result.status !== 'completed') artifacts[stage].status = result.status;
  artifacts[stage].failure_class ||= result.failure_class || null;
  } catch {
    if (result.status === 'completed') result.status = 'partial';
    result.failure_class ||= 'retryable';
    result.reason_code ||= 'workflow_probe_unavailable';
    if (artifacts[stage].status === 'completed') artifacts[stage].status = result.status;
    artifacts[stage].failure_class ||= result.failure_class;
    artifacts[stage].probe_error = 'workflow_probe_unavailable';
  }
  result.outputs.workflow_artifacts = artifacts;
  return result;
}

async function main() {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
  process.stdin.setEncoding?.('utf8');
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (text.length > 16 * 1024 * 1024) throw new Error('input_too_large'); }
  const input = JSON.parse(text);
  const stage = process.argv[2];
  const result = await runWorkflowActivity(stage, input, { isStopping: () => stopping });
  if (stopping && result.status === 'completed') {
    result.status = 'partial'; result.failure_class = 'retryable'; result.reason_code = 'interrupted';
    result.outputs.workflow_artifacts[stage].status = 'partial';
    result.outputs.workflow_artifacts[stage].failure_class ||= 'retryable';
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}

module.exports = { updateArtifacts, runWorkflowActivity };
if (require.main === module) main().catch(() => {
  process.stdout.write(JSON.stringify({ schema_version: 1, run_tag: 'invalid', status: 'failed',
    failure_class: 'fatal', reason_code: 'invalid_workflow_activity', outputs: {}, metrics: {}, evidence: [] }) + '\n');
  process.exitCode = 1;
});
