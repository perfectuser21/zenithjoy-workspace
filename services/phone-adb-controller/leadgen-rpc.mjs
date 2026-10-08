// mmv执行端：每次请求先核固定发布SHA及完整声明文件，再允许队列或模型动作。
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const require = createRequire(import.meta.url);

export function verifyRpcSource(source, { read = readFileSync, base = root } = {}) {
  if (!/^[a-f0-9]{40}$/.test(source?.commit || '') || !Array.isArray(source.files) || !source.files.length) throw Error('RPC_SOURCE_MISSING');
  const manifest = JSON.parse(read(resolve(base, 'deployment-manifest.json'), 'utf8'));
  if (manifest.source_commit !== source.commit) throw Error('RPC_SOURCE_REVISION_MISMATCH');
  for (const file of source.files) {
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file.path || '')
        || file.path.split('/').some(p => p === '..' || p === '.') || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) throw Error('RPC_SOURCE_PATH_INVALID');
    const actual = createHash('sha256').update(read(resolve(base, file.path))).digest('hex');
    if (actual !== file.sha256) throw Error('RPC_SOURCE_BYTES_MISMATCH');
  }
  for (const path of ['leadgen-rpc.mjs','leadgen-queue.js','activity-commander.mjs','leadgen-db-lib.js',
    'leadgen-db-connect.js','judge-video.js','judge-video-lib.js','judge-jev.js','judge-comment.js','qualify-video.js',
    'transcribe-qwen-audio.js','line-routes.js','stats-line.js','next-keywords.js','keyword-enabled-lib.js',
    'verify-step.mjs','step-judge.mjs','checks/probes-lib.js','checks/schema.json',
    'checks/douyin-video-discovery.yaml','checks/douyin-video-processing.yaml','checks/douyin-comment-scoring.yaml',
    'checks/douyin-lead-outreach.yaml','plans/douyin_video_discovery.steps.json','plans/douyin_video_processing.steps.json',
    'plans/douyin_comment_scoring.steps.json','plans/douyin_lead_outreach.steps.json']) {
    if (!source.files.some(f => f.path === path)) throw Error(`RPC_SOURCE_DEPENDENCY_MISSING:${path}`);
  }
}

export async function handleRpc(input, deps = {}) {
  (deps.verify || verifyRpcSource)(input.source);
  let pool;
  try {
    if (input.kind === 'commander') {
      const { openRouterCommander } = await import('./activity-commander.mjs');
      return { ok: true, decision: await openRouterCommander()(input.receipt) };
    }
    if (input.kind === 'keywords') {
      const { routeOf } = require('./line-routes.js');
      const route = routeOf(input.line);
      const count = Math.max(1, Math.min(12, Number(input.limit) || 2));
      if (!input.source.files.some(f => f.path === 'next-keywords.js')
          || !input.source.files.some(f => f.path === 'keyword-enabled-lib.js')) throw Error('RPC_KEYWORDS_DEPENDENCY_MISSING');
      const { stdout } = await exec(process.execPath, [resolve(root, 'next-keywords.js'), route.line, String(count)],
        { timeout: 60000, maxBuffer: 1024 * 1024 });
      return { ok: true, result: stdout.trim().split('\n').filter(Boolean) };
    }
    if(input.kind==='verify'){
      const names={douyin_video_discovery:'douyin-video-discovery',douyin_video_processing:'douyin-video-processing',
        douyin_comment_scoring:'douyin-comment-scoring',douyin_lead_outreach:'douyin-lead-outreach'};
      const name=names[input.workflow];if(!name)throw Error('RPC_VERIFY_WORKFLOW_INVALID');
      const {loadChecks}=require('./checks/probes-lib.js');
      const {doc,errors}=loadChecks(resolve(root,'checks',`${name}.yaml`),resolve(root,'checks/schema.json'));
      if(errors.length)throw Error('RPC_VERIFY_CHECKS_INVALID');
      const spec=JSON.parse(readFileSync(resolve(root,'plans',`${input.workflow}.steps.json`),'utf8'));
      const {runProbes,runSteps,resolveLineKey}=await import('./verify-step.mjs');
      pool=deps.pool||require('./leadgen-db-connect.js').getPool();
      const params={runTag:input.run,lineKey:resolveLineKey(input.line),metrics:input.metrics||{},word:''};
      const probes=await runProbes({doc,stage:input.stage,params,deps:{pool},timeoutMs:45000});
      const steps=await runSteps({spec,stage:input.stage,params,deps:{pool},timeoutMs:45000});
      return {ok:true,result:{...probes,steps}};
    }
    pool = deps.pool || require('./leadgen-db-connect.js').getPool();
    if (input.kind === 'queue') return { ok: true, result: await require('./leadgen-queue.js').queueRequest(pool, input.request) };
    if (input.kind === 'qualify') {
      const args = input.request;
      if (!['judge'].includes(args?.cmd) || !/^\d{16,24}$/.test(args.videoId || '')) throw Error('RPC_QUALIFY_INVALID');
      if (args.audio && !/^\/tmp\/(?:qa|qv)-[a-zA-Z0-9_.-]+$/.test(args.audio)) throw Error('RPC_AUDIO_PATH_INVALID');
      return { ok: true, result: await require('./qualify-video.js').runQualify({ cmd: args.cmd, args, pool }) };
    }
    throw Error('RPC_KIND_INVALID');
  } finally { if (pool && !deps.pool) await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await handleRpc(JSON.parse(readFileSync(0, 'utf8')))) + '\n'); }
  catch (error) {
    const code = /^RPC_[A-Z_]+(?::[a-zA-Z0-9_.-]+)?$/.test(error.message) ? error.message : 'RPC_OPERATION_FAILED';
    process.stdout.write(JSON.stringify({ ok: false, error: code }) + '\n'); process.exitCode = 1;
  }
}
