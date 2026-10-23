import { spawn,execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrozen } from './runtime-definition.mjs';
import {beginNativeOperation,nativeOperationIdentityMatches} from './native-operation-receipt.mjs';

export const RPC_FILES = ['capture-strategy.mjs','outreach-order-lock.py','queued-recipient-evidence.js','judge-recipient.js','leadgen-outreach-bridge.js','lead-fields-lib.js','nickname-match-lib.js','queued-comment-history.js','leadgen-rpc.mjs', 'leadgen-queue.js','leadgen-policy-review.js','leadgen-scoring-handler.mjs', 'commander-model-receipt.mjs','activity-commander.mjs','commander-owner-state.mjs','commander-owner-lock.mjs','commander-owner-reconcile.mjs','commander/AGENTS.md','commander/skills/workflow-commander/SKILL.md','leadgen-client.mjs','native-operation-receipt.mjs','leadgen-discovery-action.mjs','leadgen-phone-action.mjs','discovery-phone-scope.mjs','collection-phone-scope.mjs','collection-leaf-producer.mjs','collection-acceptance-probe.mjs','runtime-binding.mjs','runtime-outbox.mjs','runtime-definition.mjs','runtime-host.mjs','runtime-release.mjs','skills/leadgen-activity-execution.md','skills/douyin-leadgen-activity-101-collect-videos/SKILL.md','skills/douyin-leadgen-activity-102-preflight/SKILL.md','skills/douyin-leadgen-activity-102-dedup/SKILL.md','skills/douyin-leadgen-activity-102-qualification/SKILL.md','skills/douyin-leadgen-activity-102-collection/SKILL.md','skills/douyin-leadgen-activity-102-cleanup/SKILL.md','skills/douyin-leadgen-activity-103-scoring/SKILL.md','skills/douyin-leadgen-activity-103-mark-leads/SKILL.md','skills/douyin-leadgen-activity-104-preflight/SKILL.md','skills/douyin-leadgen-activity-104-send-dm/SKILL.md','skills/douyin-leadgen-activity-104-write-back/SKILL.md','skills/douyin-leadgen-activity-104-cleanup/SKILL.md','activity-skill-recovery.mjs','activity-skill-broker.mjs','activity-skill-tool.mjs','leadgen-skill-agent.mjs','commander/wf-agent-handoff.py','commander/wf-agent-lib.py',
  'leadgen-outreach-orders.js','next-outreach-lib.js','dm-rate-ramp-lib.js','config/collection-phone-hosts.json','config/own-accounts.json','config/leadgen-outreach-rate-ramp.json',
  'discovery-metrics.js','discovery-metrics-queue.js','leadgen-db-lib.js', 'company-config-lib.js', 'leadgen-db-connect.js', 'judge-video.js', 'judge-video-lib.js',
  'judge-jev.js', 'judge-comment.js', 'qualify-video.js', 'transcribe-qwen-audio.js',
  'line-routes.js', 'stats-line.js', 'next-keywords.js', 'keyword-enabled-lib.js',
  'verify-step.mjs', 'step-judge.mjs', 'checks/probes-lib.js', 'checks/schema.json',
  'checks/douyin-video-discovery.yaml', 'checks/douyin-video-processing.yaml',
  'checks/douyin-comment-scoring.yaml', 'checks/douyin-lead-outreach.yaml',
  'plans/douyin_video_discovery.steps.json', 'plans/douyin_video_processing.steps.json',
  'plans/douyin_comment_scoring.steps.json', 'plans/douyin_lead_outreach.steps.json'];

// 失败诊断先脱敏后限长；长不完整行不留无前缀的秘密/图片尾巴。
export function safeExecutionDiagnostic(value, env = process.env) {
  let text = String(value ?? '');
  for (const [name, secret] of Object.entries(env)) {
    if (/key|token|secret|password/i.test(name) && typeof secret === 'string' && secret.length >= 4)
      text = text.split(secret).join('[REDACTED]');
  }
  text = text.replace(/data:[^;\s]+;base64,[^\s"']*/gi, '[REDACTED_IMAGE]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|token|password|secret|authorization)["']?\s*[:=]\s*)["']?[^\r\n"']*/gi, '$1[REDACTED]');
  if (text.length <= 8000) return text;
  const prefix = text.slice(0, 7900), boundary = prefix.lastIndexOf('\n');
  return (boundary >= 0 ? prefix.slice(0, boundary + 1) : '') + '[diagnostic truncated]\n';
}

// This capability is process-local and bound to the exact executor invocation.
// A serialized message/code or an error from a later filesystem read is no proof.
const nativeNotStarted=new WeakMap();
const trustedNotStartedProofs=new WeakSet();
function markNotStarted(error,cause,command,args,child,spawned){
  if(!spawned&&child?.pid===undefined&&cause?.path===command&&cause?.syscall==='spawn '+command)nativeNotStarted.set(error,{command,args});
  return error;
}
export function executionDidNotStart(error,command,args,context){
  const proof=error&&typeof error==='object'?nativeNotStarted.get(error):null;
  return Boolean(proof&&proof.command===command&&proof.args===args&&
    (context===undefined||verifiedNativeNotStartedProof(proof.receipt,context)));
}
export function verifiedNativeNotStartedProof(proof,context){
  return Boolean(proof&&trustedNotStartedProofs.has(proof)&&proof.status==='not_started'&&
    proof.execution_stopped===true&&Array.isArray(proof.processes)&&proof.processes.length===0&&nativeOperationIdentityMatches(proof,context));
}
export function nativeNotStartedProof(error,command,args,context){
  return error?.message==='EXECUTION_START_FAILED'&&executionDidNotStart(error,command,args,context)?nativeNotStarted.get(error).receipt:null;
}
export function applyNativeFailure(error,command,args,opts,state){
    if(opts.receipt){
      const proof=nativeNotStartedProof(error,command,args,opts.receipt);
      const valid=Boolean(proof&&!state.nativeStopUnproven);
      error.executionStopped=valid;error.externalEffect='unknown';error.operationId=opts.receipt.operationId;
      state.nativeStopProof=valid?proof:null;
    }
    if(error.executionStopped===false||(/\b(?:EXECUTION_OUTPUT_LIMIT|EXECUTION_DEADLINE|RECORD_CAPTURE_EXIT_UNVERIFIED)\b/.test(error.message)&&error.executionStopped!==true)){
      state.executionUnknown=true;error.executionStopped=false;
    }
    return error;
}
export function execFileReceipt(command,args,options){
  return new Promise((resolveResult,reject)=>{
    let spawned=false,child;
    child=execFile(command,args,options,(error,stdout,stderr)=>{
      if(error){error.stdout=stdout;error.stderr=stderr;reject(markNotStarted(error,error,command,args,child,spawned));}
      else resolveResult({stdout,stderr});
    });
    child.once('spawn',()=>{spawned=true;});
  });
}

export function execInput(command, args, { input = '', timeoutMs = 180000, env = process.env, receipt } = {}) {
  return new Promise((resolveResult, reject) => {
    let operation;
    try{if(receipt)operation=beginNativeOperation(receipt);}catch(error){reject(error);return;}
    // Mac/Linux上每次动作独占进程组，只停止本次动作及其子进程，不碰ADB服务或其他批次。
    const ownGroup = process.platform !== 'win32';
    const child = spawn(command, args, { env, detached: ownGroup, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false, stoppingError, forceTimer, abandonTimer, stderrTruncated = false, spawned = false,ready=Promise.resolve();
    const timer = setTimeout(() => stop(Error('EXECUTION_DEADLINE')), timeoutMs);
    function signalOwned(signal) {
      if(operation){void ready.then(()=>operation.signalTargets(signal)).then(sent=>{if(sent===0){operation.markUnknown();child.kill(signal);}}).catch(()=>{operation.markUnknown();try{child.kill(signal);}catch{}});return;}
      try { if (ownGroup && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
    }
    function stop(error) {
      if (settled || stoppingError) return;
      stoppingError = error;
      signalOwned('SIGTERM');
      forceTimer = setTimeout(() => signalOwned('SIGKILL'), 1000);
      if(operation)abandonTimer=setTimeout(()=>{operation.markUnknown();child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();child.unref();void finish(stoppingError,{code:null,stdout,stderr});},5000);
    }
    async function finish(error, result, waitSignal) {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forceTimer);clearTimeout(abandonTimer);
      if(operation){
        try{await ready;const notStarted=executionDidNotStart(error,command,args);
          const final=notStarted?operation.notStarted():await operation.stop(stoppingError?'SIGTERM/SIGKILL':null,result?.code,waitSignal);
          if(notStarted){Object.freeze(final.processes);Object.freeze(final);trustedNotStartedProofs.add(final);nativeNotStarted.get(error).receipt=final;}
          // A normal command return is not a proof that every descendant stopped.
          // Its actual Activity result still needs the existing business contract.
          if(error){error.executionStopped=notStarted;error.externalEffect='unknown';error.operationId=receipt.operationId;}
          else Object.assign(result,{executionStopped:false,externalEffect:'unknown',operationId:receipt.operationId});}
        catch{if(!error)error=Error('NATIVE_OPERATION_RECEIPT_UNKNOWN');error.executionStopped=false;error.externalEffect='unknown';error.operationId=receipt.operationId;}
      }
      if (error) {
        error.stdout = safeExecutionDiagnostic(stdout, env);
        error.stderr = safeExecutionDiagnostic(stderr, env);
        reject(error);
      } else resolveResult(result);
    }
    child.once('spawn',()=>{spawned=true;if(operation)ready=operation.started(child.pid).catch(()=>{operation.markUnknown();});});
    child.on('error', cause => finish(markNotStarted(Error('EXECUTION_START_FAILED'),cause,command,args,child,spawned)));
    child.stdout.on('data', chunk => {
      if (stoppingError) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) stop(Error('EXECUTION_OUTPUT_LIMIT'));
    });
    child.stderr.on('data', chunk => {
      if (stderrTruncated) return;
      stderr += chunk;
      if (stderr.length > 16000) {
        const prefix = stderr.slice(0, 15000), boundary = prefix.lastIndexOf('\n');
        stderr = (boundary >= 0 ? prefix.slice(0, boundary + 1) : '') + '[diagnostic truncated]\n';
        stderrTruncated = true;
      }
    });
    // 必须等close：旧动作还活着时不可返回失败并开始操作同一台手机的下一候选。
    child.on('close', (code,signal) => finish(stoppingError, { code, stdout, stderr },signal));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function rpcSource(frozen) {
  return { commit: frozen.deployment.source_commit, files: RPC_FILES.map(path => {
    const sha256 = frozen.files[`runtime/${path}`];
    if (!sha256) throw Error(`冻结发布缺远端依赖: ${path}`);
    return { path, sha256 };
  }) };
}

export function createRpc({ frozen, execute = execInput, local = false, runContext } = {}) {
  const source = rpcSource(frozen);
  if(runContext)source.execution={...runContext};
  if(frozen.deployment.environment&&frozen.deployment.environment!=='production'
    &&(!/^[a-f0-9]{40}$/.test(source.commit)||frozen.deployment.environment!==`staging:${source.commit}`))throw Error('候选RPC缺固定SHA或环境版本不符');
  const peerRoot=frozen.deployment.environment?.startsWith('staging:')
    ?`~/.local/share/zenithjoy/phone-candidates/${source.commit}/runtime`:'~/.openclaw/leadgen-scripts';
  const peer=frozen.runtime_transport;
  const transport=peer?['-o',`HostName=${peer.ssh_hostname}`,'-o',`HostKeyAlias=${peer.ssh_hostkey_alias}`]:[];
  return async (body, { timeoutMs = 180000 } = {}) => {
    const deadline=Date.now()+timeoutMs;
    const send=async(payload,maxMs=timeoutMs)=>{
      const remaining=Math.min(maxMs,deadline-Date.now());
      if(remaining<=0)throw Error('EXECUTION_DEADLINE');
      let result;
      try{
        if(local)result=await execute(process.execPath,[resolve(process.env.WF_HOME,'leadgen-rpc.mjs')],
          {input:JSON.stringify({...payload,source}),timeoutMs:remaining});
        else result=await execute('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15',
          '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',...transport,'mmv',
          `set -a; source ~/.credentials/zenithjoy-db.env; set +a; export NODE_PATH="$HOME/.openclaw/leadgen-scripts/node_modules:$HOME/.openclaw/node_modules"; cd ${peerRoot} && node leadgen-rpc.mjs`],
          {input:JSON.stringify({...payload,source}),timeoutMs:remaining});
      }catch(error){
        // 进程已关闭才可恢复；不把源码/数据库明确错误当网络抖动。
        if(['EXECUTION_DEADLINE','EXECUTION_START_FAILED'].includes(error.message))error.receiptMissing=true;
        if(payload.kind==='commander')error.executionStopped=false;
        throw error;
      }
      let response;
      try{
        response=JSON.parse(result.stdout.trim());
        if(!response||typeof response.ok!=='boolean')throw Error('INVALID_RECEIPT');
      }catch{
        const kind=['queue','commander','keywords','verify','qualify','outreach','outreach_policy','resolve_share_link','activity_skill','activity_skill_authority'].includes(payload.kind)?payload.kind:'unknown';
        const stderr=String(result.stderr??'');
        const transport=/timed? out|timeout/i.test(stderr)?'timeout'
          :/permission denied|authentication failed/i.test(stderr)?'authentication'
          :/connection refused/i.test(stderr)?'connection_refused'
          :/could not resolve|name or service not known/i.test(stderr)?'name_resolution'
          :/connection (?:reset|closed)|broken pipe|mux_client.*failed/i.test(stderr)?'connection_closed'
          :result.stdout.trim()?'invalid_receipt':'empty_stdout';
        // 只把固定分类和计数写入回执；远端输出与请求正文不得进入错误或模型。
        const exit=Number.isSafeInteger(result.code)?result.code:'unknown';
        const error=Error(`远端没有合法回执: kind=${kind}; exit=${exit}; stdout_bytes=${Buffer.byteLength(result.stdout)}; transport=${transport}`);
        error.receiptMissing=true;if(payload.kind==='commander')error.executionStopped=false;throw error;
      }
      if(result.code!==0||response.ok!==true){const error=Error(response.error||'远端执行失败');if(response.error==='RPC_EXECUTION_STOP_UNKNOWN'||response.execution_stopped===false)error.executionStopped=false;throw error;}
      return response;
    };
    if(body.kind==='queue'&&body.request?.op==='discover'){
      try{return await send(body,20000);}catch(error){
        if(!error.receiptMissing||Date.now()+250>=deadline)throw error;
        const readback=await send({...body,request:{...body.request,op:'discover_readback'}},20000);
        if(readback.result!==null){
          if(!['pending','matched','rejected'].includes(readback.result?.status)||readback.result.inserted!==false||readback.result.recovered!==true)throw Error('发现恢复读回无效');
          if(body.request.video?.metrics&&(readback.result.metrics_verified!==true||readback.result.metrics_digest!==body.request.video.metrics.digest))throw Error('发现指标恢复读回无效');
          return readback;
        }
        // discover以(line_key,video_id)唯一键upsert，相同输入补写一次；不恢复评论/评分等其他写操作。
        return send(body,20000);
      }
    }
    const attempts=body.kind==='resolve_share_link'?2:1;
    for(let attempt=0;attempt<attempts;attempt++){
      try{return await send(body);}catch(error){
        if(!error.receiptMissing||attempt+1>=attempts||Date.now()+250>=deadline)throw error;
      }
    }
  };
}

// SSH 建连与两跳短链解析共用有限预算；调用者的更短截止时间仍优先。
export async function resolveShareViaFrozenPeer({ frozen, url, execute = execInput, local = false, timeoutMs = 50000 } = {}) {
  const rpc = createRpc({ frozen, execute, local });
  const { result } = await rpc({ kind: 'resolve_share_link', url }, { timeoutMs });
  if (!/^https:\/\/www\.douyin\.com\/(video|note)\/[0-9]{16,24}$/.test(result?.resolved_url || '') ||
      result.resolved_url !== `https://www.douyin.com/${result.content_type}/${result.content_id}`) throw Error('解析回执身份无效');
  return result.resolved_url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if(process.argv[2]==='resolve-share-link'){
      if(process.argv.length!==4)throw Error('解析参数无效');
      const url = await resolveShareViaFrozenPeer({frozen:readFrozen(process.env.WFR_RUN_DIR),url:process.argv[3],local:process.env.LEADGEN_LOCAL_RPC==='1'});
      process.stdout.write(url+'\n');
    }else{
    if (process.argv[2] !== 'qualify' || process.argv[3] !== 'judge') throw Error('未知调用');
    const args = {};
    const options = { '--line': 'line', '--run': 'run', '--source-run': 'sourceRun', '--video-id': 'videoId', '--audio': 'audio' };
    for (let n = 4; n < process.argv.length; n += 2) {
      if (!Object.hasOwn(options, process.argv[n])) throw Error('调用参数无效');
      const key = options[process.argv[n]];
      const value = process.argv[n + 1];
      if (!key || value === undefined || value.startsWith('--') || (!value && key !== 'sourceRun') || Object.hasOwn(args, key)) throw Error('调用参数无效');
      args[key] = process.argv[n + 1];
    }
    const validRun = value => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value || '');
    if (!validRun(args.run) || (args.sourceRun && (!validRun(args.sourceRun) || args.sourceRun === args.run))) throw Error('运行身份参数无效');
    const rpc = createRpc({ frozen: readFrozen(process.env.WFR_RUN_DIR), local: process.env.LEADGEN_LOCAL_RPC === '1' });
    const { result } = await rpc({ kind: 'qualify', request: { ...args, cmd: 'judge' } });
    process.stdout.write(`QUAL_RESULT ${JSON.stringify(result)}\n`);
    }
  } catch {
    if(process.argv[2]==='resolve-share-link')process.stderr.write('SHARE_LINK_PEER_FAILED\n');
    else process.stdout.write('QUAL_RESULT {"verdict":"pending","kind":"rpc_error"}\n');
    process.exitCode = 1;
  }
}
