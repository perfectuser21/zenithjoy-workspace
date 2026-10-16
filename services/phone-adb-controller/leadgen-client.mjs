import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrozen } from './runtime-definition.mjs';

export const RPC_FILES = ['capture-strategy.mjs','outreach-order-lock.py','queued-recipient-evidence.js','judge-recipient.js','leadgen-outreach-bridge.js','lead-fields-lib.js','nickname-match-lib.js','queued-comment-history.js','leadgen-rpc.mjs', 'leadgen-queue.js', 'activity-commander.mjs','commander/AGENTS.md','commander/skills/workflow-commander/SKILL.md','leadgen-client.mjs','runtime-definition.mjs','runtime-host.mjs','runtime-release.mjs','skills/leadgen-activity-execution.md','skills/douyin-leadgen-activity-101-collect-videos/SKILL.md','skills/douyin-leadgen-activity-102-preflight/SKILL.md','skills/douyin-leadgen-activity-102-dedup/SKILL.md','skills/douyin-leadgen-activity-102-qualification/SKILL.md','skills/douyin-leadgen-activity-102-collection/SKILL.md','skills/douyin-leadgen-activity-102-cleanup/SKILL.md','skills/douyin-leadgen-activity-103-scoring/SKILL.md','skills/douyin-leadgen-activity-103-mark-leads/SKILL.md','skills/douyin-leadgen-activity-104-preflight/SKILL.md','skills/douyin-leadgen-activity-104-send-dm/SKILL.md','skills/douyin-leadgen-activity-104-write-back/SKILL.md','skills/douyin-leadgen-activity-104-cleanup/SKILL.md','activity-skill-recovery.mjs','activity-skill-broker.mjs','activity-skill-tool.mjs','leadgen-skill-agent.mjs','commander/wf-agent-handoff.py','commander/wf-agent-lib.py',
  'leadgen-outreach-orders.js','next-outreach-lib.js','dm-rate-ramp-lib.js','config/leadgen-outreach-rate-ramp.json',
  'leadgen-db-lib.js', 'company-config-lib.js', 'leadgen-db-connect.js', 'judge-video.js', 'judge-video-lib.js',
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

export function execInput(command, args, { input = '', timeoutMs = 180000, env = process.env } = {}) {
  return new Promise((resolveResult, reject) => {
    // Mac/Linux上每次动作独占进程组，只停止本次动作及其子进程，不碰ADB服务或其他批次。
    const ownGroup = process.platform !== 'win32';
    const child = spawn(command, args, { env, detached: ownGroup, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false, stoppingError, forceTimer, stderrTruncated = false;
    const timer = setTimeout(() => stop(Error('EXECUTION_DEADLINE')), timeoutMs);
    function signalOwned(signal) {
      try { if (ownGroup && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
    }
    function stop(error) {
      if (settled || stoppingError) return;
      stoppingError = error;
      signalOwned('SIGTERM');
      forceTimer = setTimeout(() => signalOwned('SIGKILL'), 1000);
    }
    function finish(error, result) {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forceTimer);
      if (error) {
        error.stdout = safeExecutionDiagnostic(stdout, env);
        error.stderr = safeExecutionDiagnostic(stderr, env);
        reject(error);
      } else resolveResult(result);
    }
    child.on('error', () => finish(Error('EXECUTION_START_FAILED')));
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
    child.on('close', code => finish(stoppingError, { code, stdout, stderr }));
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

export function createRpc({ frozen, execute = execInput, local = false } = {}) {
  const source = rpcSource(frozen);
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
          'set -a; source ~/.credentials/zenithjoy-db.env; set +a; cd ~/.openclaw/leadgen-scripts && node leadgen-rpc.mjs'],
          {input:JSON.stringify({...payload,source}),timeoutMs:remaining});
      }catch(error){
        // 进程已关闭才可恢复；不把源码/数据库明确错误当网络抖动。
        if(['EXECUTION_DEADLINE','EXECUTION_START_FAILED'].includes(error.message))error.receiptMissing=true;
        throw error;
      }
      let response;
      try{
        response=JSON.parse(result.stdout.trim());
        if(!response||typeof response.ok!=='boolean')throw Error('INVALID_RECEIPT');
      }catch{
        const error=Error('远端没有合法回执');error.receiptMissing=true;throw error;
      }
      if(result.code!==0||response.ok!==true)throw Error(response.error||'远端执行失败');
      return response;
    };
    if(body.kind==='queue'&&body.request?.op==='discover'){
      try{return await send(body,20000);}catch(error){
        if(!error.receiptMissing||Date.now()+250>=deadline)throw error;
        const readback=await send({...body,request:{...body.request,op:'discover_readback'}},20000);
        if(readback.result!==null){
          if(!['pending','matched','rejected'].includes(readback.result?.status)||readback.result.inserted!==false||readback.result.recovered!==true)throw Error('发现恢复读回无效');
          return readback;
        }
        // discover以(line_key,video_id)唯一键upsert，相同输入补写一次；不恢复评论/评分等其他写操作。
        return send(body,20000);
      }
    }
    const attempts=['commander','resolve_share_link'].includes(body.kind)?2:1;
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
