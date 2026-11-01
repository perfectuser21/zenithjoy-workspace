#!/usr/bin/env node
import {readProducerDescriptor} from './producer-descriptor.mjs';
import {createHash} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,realpathSync,lstatSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeDefinition,readFrozen,registerRun,locateRun,commentSamplingInput,discoveryInput,outreachScopeInput } from './runtime-definition.mjs';
import { bindRun,readBinding } from './runtime-binding.mjs';
import {readCollectionPhoneScopeInput,defaultCollectionPhoneScope} from './collection-phone-scope.mjs';
import {defaultDiscoveryPhoneScope} from './discovery-phone-scope.mjs';
import {readQualificationIdentitySnapshot} from './qualification-identity-snapshot.mjs';
import { enqueue,flush,occurrence } from './runtime-outbox.mjs';
const e=process.env;
const SHA256=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function centralDeviceLockEvidence({dir,stage,artifact,binding,frozen,env=e}){
  if(!['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW)||!['preflight','cleanup'].includes(stage))return null;
  const taskId=artifact.result?.central_lock_task_id;
  if(!taskId)return null;
  const runId=artifact.result?.central_lock_run_id,sourceCommit=frozen.deployment.source_commit;
  if(runId!==binding.run_id||taskId!==env.WF_BRAIN_TASK_ID&&taskId!==env.BRAIN_TASK_ID&&taskId!==env.WFR_BRAIN_TASK_ID&&taskId!==binding.task_id)
    throw Error('CENTRAL_LOCK_SPAN_IDENTITY_INVALID');
  const file=join(dir,'central-lock-events.jsonl'),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>10000)throw Error('CENTRAL_LOCK_SPAN_EVENTS_INVALID');
  const events=readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const acquired=events.filter(x=>x.event==='acquired'&&x.task_id===taskId&&x.run_id===runId&&x.device_name===env.SERIAL&&x.source_commit===sourceCommit);
  const released=events.filter(x=>x.event==='released'&&x.task_id===taskId&&x.run_id===runId&&x.device_name===env.SERIAL);
  if(acquired.length!==1||released.length>1||stage==='cleanup'&&Boolean(released.length)!==Boolean(artifact.result?.central_lock_released))
    throw Error('CENTRAL_LOCK_SPAN_EVENTS_INVALID');
  return {version:1,task_id:taskId,run_id:runId,device_name:env.SERIAL,source_commit:sourceCommit,acquired:true,released:stage==='cleanup'&&released.length===1};
}
export function qualificationIdentityEvidence({dir,frozen,binding}){
  const sample=frozen.sampling_input;
  if(!sample)return null;
  const file=join(dir,`${sample.run_tag}-qualification-progress.json`),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>3000000)
    throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
  const progress=JSON.parse(readFileSync(file,'utf8'));
  if(progress.run!==sample.run_tag||progress.source_commit!==frozen.deployment.source_commit
    ||!Array.isArray(progress.qualified_video_ids)||progress.qualified_video_ids.length>1000
    ||!Array.isArray(progress.videos)||new Set(progress.qualified_video_ids).size!==progress.qualified_video_ids.length)
    throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
  const videos=progress.qualified_video_ids.map(video_id=>{
    if(!/^\d{16,24}$/.test(video_id||''))throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
    const facts=progress.videos.filter(q=>q.video_id===video_id);
    if(facts.length!==1||facts[0].settled!==true||!Number.isSafeInteger(facts[0].recordingsRequired)
      ||facts[0].recordingsRequired<0)throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
    const identitySha=facts[0].identity_snapshot_sha256;
    const {sha256}=readQualificationIdentitySnapshot({dir,run:sample.run_tag,videoId:video_id,sha256:identitySha});
    const cached=facts[0].recordingsRequired===0;
    if(cached?!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(facts[0].cached_judgment_run||'')
      :facts[0].cached_judgment_run!==null)throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
    return {video_id,mode:cached?'cached':'fresh',prior_judgment_run:cached?facts[0].cached_judgment_run:sample.run_tag,
      identity_verified:true,identity_sha256:sha256};
  });
  return {run_id:binding.run_id,run_binding_id:binding.id,source_commit:frozen.deployment.source_commit,
    source_run:sample.source_run,line:sample.line,videos};
}
export function samplingAdmissionEvidence({dir,artifact,frozen,binding}){
  const sample=frozen.sampling_input;
  if(!sample)return null;
  if(artifact.result?.sampling_required_count===0&&Array.isArray(artifact.result.sampling_receipts)
    &&artifact.result.sampling_receipts.length===0)return null;
  const file=join(dir,`${sample.run_tag}-sampling-readback.json`),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>3000000)
    throw Error('SAMPLING_ADMISSION_RECEIPT_INVALID');
  const receipt=JSON.parse(readFileSync(file,'utf8'));
  const qualification=qualificationIdentityEvidence({dir,frozen,binding});
  if(receipt.verified!==true||receipt.run_id!==binding.run_id
    ||JSON.stringify(receipt.sampling_input)!==JSON.stringify(sample)
    ||!Array.isArray(receipt.videos)||receipt.videos.length<1||receipt.videos.length>1000
    ||artifact.result?.sampling_required_count!==receipt.videos.length
    ||JSON.stringify(artifact.result?.sampling_receipts)!==JSON.stringify(receipt.videos.map(({pg_rows,...rest})=>rest)))
    throw Error('SAMPLING_ADMISSION_RECEIPT_INVALID');
  const seenVideos=new Set(),seenComments=new Set();
  const videos=receipt.videos.map(v=>{
    if(!/^\d{16,24}$/.test(v.video_id||'')||v.video_url!==`https://www.douyin.com/video/${v.video_id}`
      ||seenVideos.has(v.video_id)||v.source_run!==sample.source_run||v.comment_limit!==sample.comment_limit
      ||!['quota_reached','footer_reached','no_comments'].includes(v.stop_reason)
      ||!Number.isSafeInteger(v.coverage)||v.coverage<0||v.coverage>sample.comment_limit
      ||v.stop_reason==='quota_reached'&&v.coverage!==sample.comment_limit
      ||!Number.isSafeInteger(v.comments_inserted)||!Number.isSafeInteger(v.history_verified)
      ||v.comments_inserted<0||v.history_verified<0||v.comments_inserted+v.history_verified!==v.coverage
      ||!Array.isArray(v.pg_rows)||v.pg_rows.length!==v.coverage)throw Error('SAMPLING_ADMISSION_VIDEO_INVALID');
    seenVideos.add(v.video_id);
    const facts=qualification.videos.filter(q=>q.video_id===v.video_id);
    if(facts.length!==1)
      throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
    const commentIds=v.pg_rows.map(r=>{
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.id||'')
        ||typeof r.douyinId!=='string'||!r.douyinId||typeof r.commentBody!=='string'||!r.commentBody
        ||typeof r.sourceVideoUrl!=='string'||!r.sourceVideoUrl||seenComments.has(r.id))throw Error('SAMPLING_ADMISSION_ROW_INVALID');
      seenComments.add(r.id);return r.id;
    });
    return {video_id:v.video_id,video_url:v.video_url,stop_reason:v.stop_reason,coverage:v.coverage,
      comments_inserted:v.comments_inserted,history_verified:v.history_verified,comment_ids:commentIds,
      qualification:{mode:facts[0].mode,prior_judgment_run:facts[0].prior_judgment_run,
        identity_verified:facts[0].identity_verified,identity_sha256:facts[0].identity_sha256},
      pg_rows_sha256:SHA256(v.pg_rows.map(r=>({id:r.id,douyinId:r.douyinId,commentBody:r.commentBody,sourceVideoUrl:r.sourceVideoUrl})))};
  });
  if(videos.length!==qualification.videos.length)throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
  return {run_id:binding.run_id,run_binding_id:binding.id,source_commit:frozen.deployment.source_commit,
    source_run:sample.source_run,line:sample.line,comment_limit:sample.comment_limit,videos};
}
// 只在prepare前选择中央同一MMV的登记地址；恢复既有run仍读取原冻结路由。
export function selectMmvTransport(inventory,route='tailscale'){
  if(!['tailscale','public'].includes(route))throw Error('WF_MMV_SSH_ROUTE仅允许tailscale或public');
  const rows=Array.isArray(inventory)?inventory:inventory?.machines;
  const matches=Array.isArray(rows)?rows.filter(m=>m?.id==='ed3555dc-4777-446c-bdf0-d928d6a08ef1'):[];
  if(matches.length!==1)throw Error('中央MMV执行路由缺少唯一登记');
  const machine=matches[0],address=machine.metadata?.tailscale_ip,alias=machine.metadata?.public_ip;
  const ipv4=value=>typeof value==='string'&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)&&value.split('.').every(n=>Number(n)<=255);
  if(machine.status!=='active'||!ipv4(address)||!address.startsWith('100.')||!ipv4(alias))throw Error('中央MMV执行路由缺少可核验地址');
  return {machine_id:machine.id,ssh_hostname:route==='public'?alias:address,ssh_hostkey_alias:alias};
}
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
// 上报最多60秒；正式入口已有整轮起点/预算，证据不能越过剩余预算。
function deliveryDeadline(now=Date.now()){
  let deadline=now+60000;
  const start=Number(e.WF_RUN_START_TS),budget=Number(e.WF_RUN_MAX_SECONDS);
  if(Number.isFinite(start)&&start>0&&Number.isFinite(budget)&&budget>0)deadline=Math.min(deadline,(start+budget)*1000);
  const explicit=Number(e.WFR_EVIDENCE_DEADLINE_MS);
  if(Number.isFinite(explicit)&&explicit>0)deadline=Math.min(deadline,explicit);
  return deadline;
}
export function send(event,{deadline=deliveryDeadline()}={}){
  if(!e.BRAIN_INTERNAL_TOKEN)return 0;
  const remaining=(deadline-Date.now())/1000;
  if(remaining<=0)return 0;
  const maxTime=String(Math.min(60,remaining));
  const output=execFileSync('curl',['-s','--connect-timeout','3','-m',maxTime,'-w','\n%{http_code}','-X','POST',event.endpoint,'-H',`Authorization: Bearer ${e.BRAIN_INTERNAL_TOKEN}`,'-H','Content-Type: application/json','--data-binary','@-'],{encoding:'utf8',input:JSON.stringify(event.body)});
  return Number(output.trim().split('\n').at(-1));
}
async function flushReceipts(dir){const deadline=deliveryDeadline();const status=await flush(dir,{send:event=>send(event,{deadline}),limit:Math.max(1,Math.min(20,Number(e.WFR_OUTBOX_LIMIT)||3))});if(status.pending||status.blocked)process.stderr.write(`WFR_WARN span/callback evidence pending=${status.pending} blocked=${status.blocked}\n`);return status;}
export async function run(args){
  const [cmd,...rest]=args; const dir=e.WFR_RUN_DIR;
  const indexRoot=resolve(e.WFR_HOME||resolve(e.HOME,'.config/zenithjoy'),'run-index');
  if(cmd==='locate-run'){
    const [capability,tag,profile,serial]=rest;const runDir=locateRun(indexRoot,{capability,tag,profile,serial});
    if(runDir)process.stdout.write(runDir+'\n');return;
  }
  if(cmd==='prepare'){
    if(rest.length&&!(rest.length===2&&rest[0]==='--collection-phone-scope'))throw Error('COLLECTION_SCOPE_ARGUMENT_INVALID');
    if(e.WF_MMV_SSH_ROUTE&&!['tailscale','public'].includes(e.WF_MMV_SSH_ROUTE))throw Error('WF_MMV_SSH_ROUTE仅允许tailscale或public');
    const collectionPhoneScope=rest.length?readCollectionPhoneScopeInput(rest[1]):(e.WF_DEPLOYMENT_ROOT||e.WF_HOME?defaultCollectionPhoneScope({root:e.WF_DEPLOYMENT_ROOT||e.WF_HOME,env:e}):undefined);
    const discoveryPhoneScope=e.WF_DEPLOYMENT_ROOT||e.WF_HOME?defaultDiscoveryPhoneScope({root:e.WF_DEPLOYMENT_ROOT||e.WF_HOME,env:e}):undefined;
    if(e.WF_BRAIN_WORKFLOW==='douyin_video_discovery'&&!discoveryPhoneScope)throw Error('DISCOVERY_PHONE_SCOPE_REQUIRED');
    if(collectionPhoneScope&&(e.WF_BRAIN_WORKFLOW!=='douyin_video_processing'||collectionPhoneScope.profile!==e.P||collectionPhoneScope.serial!==e.SERIAL||collectionPhoneScope.run_id!==`${e.WFR_RUN_ID}__${collectionPhoneScope.attempt}`))throw Error('COLLECTION_SCOPE_INPUT_IDENTITY_INVALID');
    if(['douyin_video_discovery','douyin_video_processing'].includes(e.WF_BRAIN_WORKFLOW)){
      const taskIds=[e.WF_BRAIN_TASK_ID,e.BRAIN_TASK_ID,e.WFR_BRAIN_TASK_ID].filter(Boolean);
      if(taskIds.length===0||new Set(taskIds).size!==1)throw Error('CENTRAL_TASK_INPUT_INVALID');
      const scope=e.WF_BRAIN_WORKFLOW==='douyin_video_discovery'?discoveryPhoneScope:collectionPhoneScope;
      if(scope&&scope.task_id!==taskIds[0])throw Error('CENTRAL_TASK_FROZEN_SCOPE_MISMATCH');
    }
    const samplingInput=commentSamplingInput(e),fixedDiscoveryInput=discoveryInput(e),outreachScope=outreachScopeInput(e);
    const producerDescriptor=e.LEADGEN_PRODUCER_DESCRIPTOR_FILE?readProducerDescriptor(e.LEADGEN_PRODUCER_DESCRIPTOR_FILE):undefined;
    const runIdentity=e.WF_ARG_CAP?{capability:e.WF_ARG_CAP,tag:e.WFR_TAG,profile:e.P,serial:e.SERIAL,run_id:e.WFR_RUN_ID}:null;
    const root=e.WF_DEPLOYMENT_ROOT||e.WF_HOME;
    let runtimeTransport;
    if(['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'].includes(e.WF_BRAIN_WORKFLOW)){
      const inventory=await request('/api/brain/machines');
      runtimeTransport=selectMmvTransport(inventory,e.WF_MMV_SSH_ROUTE);
    }
    await freezeDefinition({discoveryInput:fixedDiscoveryInput,producerDescriptor,discoveryPhoneScope,collectionPhoneScope,samplingInput,outreachScope,requireRelease:true,runtimeTransport,releaseId:e.WF_RELEASE_ID,runIdentity,runDir:dir,deploymentRoot:root,manifestPath:e.WF_DEPLOYMENT_MANIFEST,workflowKey:e.WF_BRAIN_WORKFLOW,rawContractSha256:e.WF_CONTRACT_RAW_SHA256,activityRefs:e.WF_ACTIVITY_REFS?JSON.parse(e.WF_ACTIVITY_REFS):null,planPath:e.WF_PLAN_PATH,stepSpecPath:resolve(root,e.WF_STEP_SPEC||''),releaseCacheDir:resolve(e.WFR_HOME||resolve(e.HOME,'.config/zenithjoy'),'release-cache'),get:request});
    if(runtimeTransport){
      // prepare冻结入口统一在freezeDefinition中记录，不能由业务活动改投影台账。
      const snapshot=readFrozen(dir);
      if(!snapshot.runtime_transport)throw Error('本批缺冻结执行路由');
    }
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
    const avatar=stage==='collection'?Math.max(0,Number(artifact.metrics?.avatar_recovery_count||0)):0;
    const admission=stage==='collection'&&status==='completed'&&frozen.sampling_input
      ?samplingAdmissionEvidence({dir,artifact,frozen,binding}):null;
    const qualificationIdentity=stage==='qualification'&&status==='completed'&&frozen.sampling_input
      ?qualificationIdentityEvidence({dir,frozen,binding}):null;
    const centralLock=centralDeviceLockEvidence({dir,stage,artifact,binding,frozen,env:e});
    const body=[{identity_protocol:2,run_binding_id:binding.id,reference_id:a.reference.reference_id,workflow_definition_version_id:frozen.workflow_version.id,activity_definition_version_id:a.version.id,attempt_key:binding.attempt_key,enabler_call_id:null,run_id:`${e.WFR_RUN_ID}__${e.WFR_ATTEMPT||'a0'}`,occurrence_key:oc.key,workflow_id:frozen.workflow_version.payload.workflow_id,activity_id:a.reference.activity_id,step_id:null,enabler_id:null,started_at:oc.started_at,ended_at:artifact.observed_at||new Date().toISOString(),executor_kind:['qualification','scoring'].includes(stage)?'agent':'code',executor_id:e.WFR_HOSTKEY||'unknown',attempts:rescan+avatar+1,fallback:rescan+avatar>0,outcome:({completed:'pass',failed:'fail',blocked:'skipped'})[status]||'unknown',evidence:{sampling_input:frozen.sampling_input||null,...(admission?{sampling_admission_v1:admission}:{}),...(qualificationIdentity?{qualification_identity_v1:qualificationIdentity}:{}),...(centralLock?{central_device_lock_v1:centralLock}:{}),...(status==='blocked'?{skip_reason:artifact.skip_reason||artifact.summary||artifact.reason||'stage_blocked'}:{}),activity_key:stage,stage_attempt:Number(n),word,artifact:file.split('/').at(-1),rescan_count:rescan,identity_rescan_count:rescan,avatar_recovery_count:avatar,rescan_rate:Number(artifact.metrics?.rescan_rate||0),workflow_definition_version_id:frozen.workflow_version.id,activity_definition_version_id:a.version.id,reference_id:a.reference.reference_id,slot_key:a.reference.slot_key,sequence_no:a.reference.sequence_no,implementation_bindings:a.implementations,steps:a.version.payload.steps,runtime_snapshot_sha256:frozen.snapshot_sha256}}];
    for(const step of (artifact.verification?.step_dod||[]).flatMap(check=>check.steps||[])){
      const owner=frozen.activities.find(owner=>owner.reference.slot_key===step.activity);
      const definition=owner?.version.payload.steps?.find(s=>step.key?.endsWith(`.${s.locator?.step_key}`));
      if(!definition?.step_id)throw Error(`实际步骤证据缺规范版本绑定: ${step.key}`);
      body.push({...body[0],reference_id:owner.reference.reference_id,activity_id:owner.reference.activity_id,
        activity_definition_version_id:owner.version.id,step_id:definition.step_id,
        occurrence_key:`${oc.key}:${definition.step_id}`,outcome:step.pass===true?'pass':step.pass===false?'fail':'unknown',
        evidence:{...body[0].evidence,sampling_admission_v1:undefined,qualification_identity_v1:undefined,reference_id:owner.reference.reference_id,slot_key:owner.reference.slot_key,
          activity_definition_version_id:owner.version.id,step_key:step.key,observed_step:step,observed_at_stage:stage}});
    }
    if(Buffer.byteLength(JSON.stringify(body))>3000000)throw Error('SAMPLING_ADMISSION_SPAN_TOO_LARGE');
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
      evidence:{profile:e.WFR_PROFILE||'',orders_picked:picked,delivered,restricted,failed,requeued:n('requeued'),
        // 派发总闸D(dd7767b8)：手机 Brain 设备锁的领取/释放/跳过证据原样带上（只收对象）
        ...(counts.brain_lock&&typeof counts.brain_lock==='object'&&!Array.isArray(counts.brain_lock)?{brain_lock:counts.brain_lock}:{})}}];
    const outboxDir=resolve(e.WFR_HOME||resolve(e.HOME,'.config/zenithjoy'),'outreach-outbox');
    enqueue(outboxDir,{key:`${runId}:send_dm`,endpoint:`${e.BRAIN_URL?.replace(/\/$/,'')}/api/brain/spans`,body});await flushReceipts(outboxDir);return;
  }
  throw Error(`未知runtime命令: ${cmd}`);
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))run(process.argv.slice(2)).catch(err=>{process.stderr.write(`WFR_RUNTIME_ERROR ${err.message}\n`);process.exitCode=1;});
