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

function trustedShort(value) {
  if(typeof value!=='string'||!/^https:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?(?:\?[^\s#]*)?(?:#[^\s]*)?$/.test(value))throw Error('RPC_SHARE_LINK_INVALID');
  return value;
}

// 只解析本次已复制的受信短链；不抓正文，不从标题猜ID，不动PG。
export async function resolveCopiedShareLink(value,{execute=exec}={}) {
  let url=trustedShort(value);
  for(let hop=0;hop<2;hop++){
    let stdout;
    try {({stdout}=await execute('curl',['-sS','-I','--connect-timeout','5','--max-time','10','-A','Mozilla/5.0',url],{timeout:12000,maxBuffer:1024*1024}));}
    catch {throw Error('RPC_SHARE_LINK_NETWORK');}
    const lines=stdout.split(/\r?\n/),statuses=lines.filter(s=>/^HTTP\//.test(s));
    const status=statuses.at(-1)?.match(/^HTTP\/\S+\s+(\d{3})/)?.[1];
    const location=lines.filter(s=>/^location:/i.test(s)).at(-1)?.replace(/^location:\s*/i,'').trim();
    if(!/^3\d\d$/.test(status||'')||!location)throw Error('RPC_SHARE_LINK_HTTP');
    let next;try {next=new URL(location);}catch {throw Error('RPC_SHARE_LINK_UNTRUSTED');}
    if(next.protocol!=='https:'||!['v.douyin.com','www.douyin.com','www.iesdouyin.com'].includes(location.split('/')[2])||next.username||next.password)throw Error('RPC_SHARE_LINK_UNTRUSTED');
    const match=next.pathname.match(/^\/(?:share\/)?(video|note)\/([0-9]{16,24})\/?$/);
    if(match&&['www.douyin.com','www.iesdouyin.com'].includes(next.hostname))return {resolved_url:`https://www.douyin.com/${match[1]}/${match[2]}`,content_id:match[2],content_type:match[1]};
    try {url=trustedShort(location);}catch {throw Error('RPC_SHARE_LINK_ID_MISSING');}
  }
  throw Error('RPC_SHARE_LINK_ID_MISSING');
}

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
  for (const path of ['queued-comment-history.js','leadgen-rpc.mjs','leadgen-queue.js','activity-commander.mjs','leadgen-db-lib.js',
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
    if(input.kind==='resolve_share_link')return {ok:true,result:await resolveCopiedShareLink(input.url,{execute:deps.resolveExec||exec})};
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
    if (input.kind === 'queue') return { ok: true, result: await require('./leadgen-queue.js').queueRequest(pool, input.request,{resolveHistoryUrl:url=>resolveCopiedShareLink(url,{execute:deps.resolveExec||exec})}) };
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
