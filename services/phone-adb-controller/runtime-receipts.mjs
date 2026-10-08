#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeDefinition,readFrozen,registerRun,locateRun } from './runtime-definition.mjs';
import { bindRun,readBinding } from './runtime-binding.mjs';
import { enqueue,flush,occurrence } from './runtime-outbox.mjs';
const e=process.env;
// release 整包数百 KB，执行机经中继跨境下载晚高峰要 6–10 秒：GET 给 60 秒并重试；POST 只放宽超时不盲目重试。
// curl 失败时 Node 的报错会带整条命令（含 Bearer token），这里换成只含方法/路径/退出码/stderr 摘要的错误。
export function request(path,body){
  if(!e.BRAIN_URL)throw Error('BRAIN_URL缺失，不能固定运行版本');
  const endpoint=path.startsWith('http')?path:`${e.BRAIN_URL.replace(/\/$/,'')}${path}`;
  const timing=body?['--connect-timeout','10','-m','30']:['--connect-timeout','10','-m','60','--retry','3','--retry-all-errors','--retry-delay','2'];
  const args=['-sS',...timing,endpoint,'-H',`Authorization: Bearer ${e.BRAIN_INTERNAL_TOKEN||''}`,'-w','\n%{http_code}'];
  if(body)args.push('-X','POST','-H','Content-Type: application/json','-d',JSON.stringify(body));
  let output;
  try{output=execFileSync('curl',args,{encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','pipe']});}
  catch(err){
    const why=String(err.stderr||'').replace(/Bearer\s+\S+/g,'Bearer ***').trim().split('\n').slice(-2).join(' ').slice(0,200);
    throw Error(`Brain请求失败 ${body?'POST':'GET'} ${path} curl=${err.status??'?'} ${why}`);
  }
  const split=output.lastIndexOf('\n'),status=Number(output.slice(split+1));
  if(status<200||status>=300){const err=Error(`Brain HTTP ${status}`);err.status=status;throw err;}
  return JSON.parse(output.slice(0,split));
}
export function send(event){
  if(!e.BRAIN_INTERNAL_TOKEN)return 0;
  const output=execFileSync('curl',['-s','--connect-timeout','3','-m','8','-w','\n%{http_code}','-X','POST',event.endpoint,'-H',`Authorization: Bearer ${e.BRAIN_INTERNAL_TOKEN}`,'-H','Content-Type: application/json','-d',JSON.stringify(event.body)],{encoding:'utf8'});
  return Number(output.trim().split('\n').at(-1));
}
async function flushReceipts(dir){const status=await flush(dir,{send,limit:Math.max(1,Math.min(20,Number(e.WFR_OUTBOX_LIMIT)||3))});if(status.pending||status.blocked)process.stderr.write(`WFR_WARN span/callback evidence pending=${status.pending} blocked=${status.blocked}\n`);return status;}
export async function run(args){
  const [cmd,...rest]=args; const dir=e.WFR_RUN_DIR;
  const indexRoot=resolve(e.WFR_HOME||resolve(e.HOME,'.config/zenithjoy'),'run-index');
  if(cmd==='locate-run'){
    const [capability,tag,profile,serial]=rest;const runDir=locateRun(indexRoot,{capability,tag,profile,serial});
    if(runDir)process.stdout.write(runDir+'\n');return;
  }
  if(cmd==='prepare'){
    const runIdentity=e.WF_ARG_CAP?{capability:e.WF_ARG_CAP,tag:e.WFR_TAG,profile:e.P,serial:e.SERIAL,run_id:e.WFR_RUN_ID}:null;
    const root=e.WF_DEPLOYMENT_ROOT||e.WF_HOME;
    await freezeDefinition({requireRelease:true,releaseId:e.WF_RELEASE_ID,runIdentity,runDir:dir,deploymentRoot:root,manifestPath:e.WF_DEPLOYMENT_MANIFEST,workflowKey:e.WF_BRAIN_WORKFLOW,rawContractSha256:e.WF_CONTRACT_RAW_SHA256,activityRefs:e.WF_ACTIVITY_REFS?JSON.parse(e.WF_ACTIVITY_REFS):null,planPath:e.WF_PLAN_PATH,stepSpecPath:resolve(root,e.WF_STEP_SPEC||''),releaseCacheDir:resolve(e.WFR_HOME||resolve(e.HOME,'.config/zenithjoy'),'release-cache'),get:request});
    if(runIdentity)registerRun(indexRoot,dir,runIdentity);return;
  }
  if(cmd==='bind-run'){const result=await bindRun({dir,runId:e.WFR_RUN_ID,brainUrl:e.BRAIN_URL,request});process.stdout.write(`WFR_ATTEMPT=${result.attempt_key}\nWFR_SKIP_WORDS='${result.skip_words.join('|').replace(/'/g,"'\\''")}'\n`);return;}
  if(cmd==='flush'){const status=await flushReceipts(dir);process.stdout.write(`WFR_EVIDENCE_STATUS=${status.blocked?'blocked':status.pending?'pending':'sent'}\n`);return;}
  if(cmd==='mark-start'){
    const started=occurrence(dir,`${e.WFR_ATTEMPT||'a0'}.${rest[0]}.${rest[1]||1}`,true);
    writeFileSync(resolve(dir,`span-start.${e.WFR_ATTEMPT||'a0'}.${rest[0]}.${rest[1]||1}`),started.started_at);return;
  }
  if(cmd==='callback'){
    const body=JSON.parse(readFileSync(0,'utf8'));
    enqueue(dir,{key:body.run_id,endpoint:`${e.BRAIN_URL?.replace(/\/$/,'')}/api/brain/execution-callback`,body});await flushReceipts(dir);return;
  }
  if(cmd==='span'){
    const [stage,status,n,file,word='']=rest;const frozen=readFrozen(dir);
    const binding=readBinding(dir,e.WFR_ATTEMPT||'a0',frozen);
    if(binding.run_id!==`${e.WFR_RUN_ID}__${e.WFR_ATTEMPT||'a0'}`)throw Error('span运行身份与绑定不匹配');
    const a=frozen.activities.find(a=>a.reference.slot_key===stage);
    if(!a)throw Error(`冻结定义无活动: ${stage}`);
    const artifact=JSON.parse(readFileSync(file,'utf8'));const oc=occurrence(dir,`${e.WFR_ATTEMPT||'a0'}.${stage}.${n}`,false,artifact.observed_at);
    const rescan=stage==='collection'?Math.max(0,Number(artifact.metrics?.rescan_count||0)):0;
    const body=[{identity_protocol:2,run_binding_id:binding.id,reference_id:a.reference.reference_id,workflow_definition_version_id:frozen.workflow_version.id,activity_definition_version_id:a.version.id,attempt_key:binding.attempt_key,enabler_call_id:null,run_id:`${e.WFR_RUN_ID}__${e.WFR_ATTEMPT||'a0'}`,occurrence_key:oc.key,workflow_id:frozen.workflow_version.payload.workflow_id,activity_id:a.reference.activity_id,step_id:null,enabler_id:null,started_at:oc.started_at,ended_at:artifact.observed_at||new Date().toISOString(),executor_kind:['qualification','scoring'].includes(stage)?'agent':'code',executor_id:e.WFR_HOSTKEY||'unknown',attempts:rescan+1,fallback:rescan>0,outcome:({completed:'pass',failed:'fail',blocked:'skipped'})[status]||'unknown',evidence:{...(status==='blocked'?{skip_reason:artifact.skip_reason||artifact.summary||artifact.reason||'stage_blocked'}:{}),activity_key:stage,stage_attempt:Number(n),word,artifact:file.split('/').at(-1),rescan_count:rescan,rescan_rate:Number(artifact.metrics?.rescan_rate||0),workflow_definition_version_id:frozen.workflow_version.id,activity_definition_version_id:a.version.id,reference_id:a.reference.reference_id,slot_key:a.reference.slot_key,sequence_no:a.reference.sequence_no,implementation_bindings:a.implementations,steps:a.version.payload.steps,runtime_snapshot_sha256:frozen.snapshot_sha256}}];
    enqueue(dir,{key:oc.key,endpoint:`${e.BRAIN_URL?.replace(/\/$/,'')}/api/brain/spans`,body});await flushReceipts(dir);return;
  }
  if(cmd==='outreach-span'){
    // 触达 tick 不是绑定了发布版本的运行(没有 run-definition / run_definition_bindings)：不发绑定 span，
    // 发一条旧协议 Activity span(发私信，挂「抖音·线索触达」流程，迁移 533)，Brain 的 spans 触发器据此建/汇总 runs 行。
    // outbox 放固定目录，前几轮没发出去的(断网/无 token)下一轮一起重发。
    const [runId,startedAt,countsJson]=rest;const counts=JSON.parse(countsJson||'{}');
    const n=k=>Math.max(0,Number(counts[k])||0);
    const picked=n('orders_picked'),delivered=n('delivered'),restricted=n('restricted'),failed=n('failed');
    const outcome=picked===0?'skipped':failed>0&&delivered===0&&restricted===0?'fail':'pass';
    const body=[{run_id:runId,occurrence_key:`${runId}:send_dm`,workflow_id:e.WFR_OUTREACH_WORKFLOW_ID||'b1000000-0000-4000-8000-000000000104',
      activity_id:e.WFR_OUTREACH_ACTIVITY_ID||'bb4fdc47-a543-4374-9078-8e78151b69c6',started_at:startedAt,ended_at:new Date().toISOString(),
      executor_kind:'code',executor_id:e.WFR_HOSTKEY||'unknown',outcome,
      evidence:{profile:e.WFR_PROFILE||'',orders_picked:picked,delivered,restricted,failed,requeued:n('requeued')}}];
    const outboxDir=resolve(e.WFR_HOME||resolve(e.HOME,'.config/zenithjoy'),'outreach-outbox');
    enqueue(outboxDir,{key:`${runId}:send_dm`,endpoint:`${e.BRAIN_URL?.replace(/\/$/,'')}/api/brain/spans`,body});await flushReceipts(outboxDir);return;
  }
  throw Error(`未知runtime命令: ${cmd}`);
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))run(process.argv.slice(2)).catch(err=>{process.stderr.write(`WFR_RUNTIME_ERROR ${err.message}\n`);process.exitCode=1;});
