// 仅Code观察者的冻结授权；不授予Worker、手机、业务队列或Skill接手能力。
import {realpathSync,existsSync,readFileSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes} from 'node:crypto';
import {readFrozen,digest,canonical,frozenExecutionMode,discoveryInput} from './runtime-definition.mjs';import {readBinding} from './runtime-binding.mjs';import {verifyRpcSource} from './leadgen-rpc.mjs';import {assertRuntimeHost} from './runtime-host.mjs';
const caps=new WeakMap(),fail=()=>{throw Object.assign(Error('CODE_OBSERVER_AUTHORITY_INVALID'),{code:'CODE_OBSERVER_AUTHORITY_INVALID'});};
const workflows=new Set(['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring']);
const consumedKeys=['send','run_max_seconds','limit','source_run','comment_limit','sort','time_layer','location','max_attempts','max_candidates','max_screens','keyword','execution_mode'];
const consumedPayload=payload=>structuredClone(Object.fromEntries(consumedKeys.filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]])));
export const isCodeObserverRequest=q=>q?.protocol==='code-runner-observer/v1'&&q.execution_mode==='code'&&!Object.hasOwn(q,'execution_transport')&&!Object.hasOwn(q,'mode')&&!Object.hasOwn(q,'max_turns');
function local({runtimeRoot,source,request:q}){
 if(!isCodeObserverRequest(q)||realpathSync(runtimeRoot)!==dirname(fileURLToPath(import.meta.url))||resolve(runtimeRoot)!==runtimeRoot||!/^a[1-9][0-9]*$/.test(q.attempt||'')||!/^[a-f0-9]{48}$/.test(q.nonce||''))fail();
 verifyRpcSource(source,{base:runtimeRoot});const runDir=dirname(runtimeRoot),frozen=readFrozen(runDir),binding=readBinding(runDir,q.attempt,frozen),s=frozen.code_observer_scope;
 const registration=JSON.parse(readFileSync(join(runDir,'run-bindings',q.attempt+'.request.json'),'utf8'));if(!registration.body||Object.hasOwn(registration.body,'task_id')||Object.hasOwn(registration.body,'task_run_id')||binding.source_kind!=='external'||binding.task_run_id!==null||binding.payload_sha256!==digest(registration.body))fail();
 if(!s||!s.consumed_task_payload||typeof s.consumed_task_payload!=='object'||Array.isArray(s.consumed_task_payload)||Object.keys(s.consumed_task_payload).some(key=>!consumedKeys.includes(key))||s.schema_version!==1||frozenExecutionMode(frozen)!=='code'||frozen.execution_transport!==undefined||frozen.deployment?.target!=='mmv'||source.commit!==frozen.deployment.source_commit||!workflows.has(frozen.workflow_version.payload.key))fail();
 if(assertRuntimeHost(frozen.release,frozen.deployment)!=='mmv')fail();
 const row=frozen.activities.find(a=>a.reference.slot_key===q.activity_key);if(!row||frozen.activities.filter(a=>a.reference.slot_key===q.activity_key).length!==1)fail();
 const methods=(row.version.payload.implementation_bindings||[]).filter(b=>b.kind==='code');if(!methods.length||methods.some(b=>b.status!=='verified'||b.revision!==source.commit||b.repo!=='perfectuser21/zenithjoy-workspace'))fail();
 for(const method of methods){const prefix='services/phone-adb-controller/';if(!method.path?.startsWith(prefix))fail();const path=method.path.slice(prefix.length),hash=method.digest?.replace(/^sha256:/,'');if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||path.split('/').some(x=>x==='.'||x==='..')||!/^[a-f0-9]{64}$/.test(hash??'')||method.content_sha256!==undefined&&method.content_sha256!==hash||frozen.files['runtime/'+path]!==hash||digest(readFileSync(join(runtimeRoot,path)))!==hash)fail();}
 const fixed={protocol:'code-runner-observer/v1',execution_mode:'code',broker_host:'mmv',run_id:binding.run_id,binding_id:binding.id,task_id:s.task_id,source_commit:source.commit,workflow_key:s.workflow_key,workflow_id:frozen.workflow_version.payload.workflow_id,workflow_definition_version_id:frozen.workflow_version.id,release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,runtime_snapshot_sha256:frozen.snapshot_sha256,activity_key:row.reference.slot_key,activity_id:row.reference.activity_id,activity_version_id:row.version.id,method_sha256:digest(methods),claim:s.claim,run_tag:s.run_tag,profile:s.profile,serial:s.serial,line:s.line,run_start_ts:s.run_start_ts,run_max_seconds:s.run_max_seconds,scope:s.scope,consumed_task_payload:s.consumed_task_payload};
 for(const[k,v]of Object.entries(fixed))if(canonical(q[k])!==canonical(v))fail();
 if(binding.run_id!==s.workflow_key+'-'+s.run_tag+'__'+q.attempt||s.workflow_key!==frozen.workflow_version.payload.key||typeof s.claim?.claimed_by!=='string'||!s.claim.claimed_by.trim()||typeof s.claim.claimed_at!=='string'||!Number.isFinite(Date.parse(s.claim.claimed_at))||!Number.isSafeInteger(s.run_start_ts)||!Number.isSafeInteger(s.run_max_seconds)||s.run_max_seconds<1)fail();
 const end=(s.run_start_ts+s.run_max_seconds)*1000,budget=Number(row.version.payload.contract?.budget?.max_duration_s)*1000;
 if(!Number.isSafeInteger(budget)||budget<1||!['activity_started_ms','worker_deadline_ms','receipt_deadline_ms','deadline_ms'].every(k=>Number.isSafeInteger(q[k]))||q.activity_started_ms<s.run_start_ts*1000||q.activity_started_ms>Date.now()+1000||q.worker_deadline_ms<=q.activity_started_ms||q.worker_deadline_ms>=q.receipt_deadline_ms||q.receipt_deadline_ms>=q.deadline_ms||q.deadline_ms>end||q.deadline_ms>q.activity_started_ms+budget)fail();
 const allowed=[...Object.keys(fixed),'attempt','nonce','activity_started_ms','worker_deadline_ms','receipt_deadline_ms','deadline_ms'].sort();if(Object.keys(q).sort().join(',')!==allowed.join(','))fail();
 return {frozen,binding,scope:s,row,runDir};
}
export function createCodeObserverRequest({runtimeRoot,source,activity,attempt,now=Date.now()}){
 const frozen=readFrozen(dirname(runtimeRoot)),binding=readBinding(dirname(runtimeRoot),attempt,frozen),s=frozen.code_observer_scope,row=frozen.activities.find(a=>a.reference.slot_key===activity.key);
 if(!s||!row)fail();const end=Math.min((s.run_start_ts+s.run_max_seconds)*1000,now+Number(row.version.payload.contract?.budget?.max_duration_s)*1000),reserve=Math.min(10000,Math.max(3000,Math.floor((end-now)/5)));
 const q={protocol:'code-runner-observer/v1',execution_mode:'code',broker_host:'mmv',run_id:binding.run_id,binding_id:binding.id,task_id:s.task_id,source_commit:source.commit,workflow_key:s.workflow_key,workflow_id:frozen.workflow_version.payload.workflow_id,workflow_definition_version_id:frozen.workflow_version.id,release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,runtime_snapshot_sha256:frozen.snapshot_sha256,activity_key:row.reference.slot_key,activity_id:row.reference.activity_id,activity_version_id:row.version.id,method_sha256:digest((row.version.payload.implementation_bindings||[]).filter(b=>b.kind==='code')),claim:s.claim,run_tag:s.run_tag,profile:s.profile,serial:s.serial,line:s.line,run_start_ts:s.run_start_ts,run_max_seconds:s.run_max_seconds,scope:s.scope,consumed_task_payload:s.consumed_task_payload,attempt,nonce:randomBytes(24).toString('hex'),activity_started_ms:now,worker_deadline_ms:end-reserve,receipt_deadline_ms:end-Math.floor(reserve/2),deadline_ms:end};
 local({runtimeRoot,source,request:q});return q;
}
export function issueCodeObserverCapability(options){local(options);const cap=Object.freeze({});caps.set(cap,{request:canonical(options.request),source:canonical(options.source),runtimeRoot:options.runtimeRoot,authorized:false});return cap;}
export function verifyCodeObserverCapability(cap,options){const v=caps.get(cap);if(!v||v.request!==canonical(options.request)||v.source!==canonical(options.source)||v.runtimeRoot!==options.runtimeRoot||options.requireAuthorized===true&&v.authorized!==true)fail();local(options);return true;}
export async function verifyCodeObserverAuthority({runtimeRoot,source,request:q,get}){
 const {frozen,binding,row,scope:s}=local({runtimeRoot,source,request:q});if(Date.now()>=q.worker_deadline_ms)fail();
 const rb=(await get('/api/brain/runs/'+q.run_id+'/definition')).binding,value=(b,k)=>{const top=Object.hasOwn(b??{},k),nested=Object.hasOwn(b?.payload??{},k);if(top&&nested&&canonical(b[k])!==canonical(b.payload[k]))fail();return top?b[k]:b?.payload?.[k];};
 for(const k of ['id','run_id','actor','workflow_id','workflow_definition_version_id','release_id','observation_id','runtime_snapshot_sha256','external_origin','source_kind','task_run_id','payload_sha256'])if(canonical(value(rb,k))!==canonical(value(binding,k)))fail();
 if(value(rb,'actor')!=='runtime:phone-adb-controller'||value(rb,'external_origin')!=='zenithjoy:mmv'||value(rb,'source_kind')!=='external'||value(rb,'task_run_id')!==null)fail();
 if(value(rb,'task_id')!=null&&value(rb,'task_id')!==q.task_id)fail();
 const taskResponse=await get('/api/brain/tasks/'+q.task_id),task=taskResponse.task??taskResponse,p=task?.payload;
 if(task.id!==q.task_id||task.status!=='in_progress'||task.claimed_by!==s.claim.claimed_by||task.claimed_at!==s.claim.claimed_at||!p||p.workflow_key!==s.workflow_key||p.source_commit!==source.commit||p.run_tag!==s.run_tag||p.profile!==s.profile||p.company_line!==s.line||canonical(p.scope??{})!==canonical(s.scope)||canonical(consumedPayload(p))!==canonical(s.consumed_task_payload)||p.execution_mode&&p.execution_mode!=='code'||p.scope?.execution_mode&&p.scope.execution_mode!=='code'||Object.hasOwn(p,'execution_transport')||Object.hasOwn(p.scope??{},'execution_transport')||Object.hasOwn(p,'max_turns')||Object.hasOwn(p.scope??{},'max_turns'))fail();
 if(s.workflow_key==='douyin_comment_scoring'?(s.serial!=='none'||p.device_serial!=null):p.device_serial!==s.serial)fail();
 const wf=(await get('/api/brain/workflows/'+q.workflow_id+'/versions/'+q.workflow_definition_version_id)).version,av=(await get('/api/brain/activities/'+q.activity_id+'/versions/'+q.activity_version_id)).version;
 if(wf?.source_commit!==source.commit||digest(wf.payload)!==digest(frozen.workflow_version.payload)||av?.source_commit!==source.commit||digest(av.payload)!==digest(row.version.payload))fail();
 local({runtimeRoot,source,request:q});return true;
}

// prepare前固定一次绝对Code预算；恢复只能读取原冻结起点。
export function initializeCodeBudget({env,now=Date.now()}={}){
 if((env.LEADGEN_EXECUTION_MODE??'code')!=='code'||env.LEADGEN_EXECUTION_TRANSPORT!==undefined||env.LEADGEN_MAX_TURNS!==undefined)fail();
 const path=env.WFR_RUN_DIR&&join(env.WFR_RUN_DIR,'run-definition.json');
 if(path&&existsSync(path)){
  const frozen=readFrozen(env.WFR_RUN_DIR),s=frozen.code_observer_scope;if(!s||frozenExecutionMode(frozen)!=='code'||!Number.isSafeInteger(s.run_start_ts)||!Number.isSafeInteger(s.run_max_seconds)||now>=(s.run_start_ts+s.run_max_seconds)*1000)fail();
  if(env.WF_RUN_START_TS!==undefined&&Number(env.WF_RUN_START_TS)!==s.run_start_ts||env.WF_RUN_MAX_SECONDS!==undefined&&Number(env.WF_RUN_MAX_SECONDS)!==s.run_max_seconds)fail();
  return {run_start_ts:s.run_start_ts,run_max_seconds:s.run_max_seconds};
 }
 const run_start_ts=env.WF_RUN_START_TS===undefined?Math.floor(now/1000):Number(env.WF_RUN_START_TS),run_max_seconds=Number(env.WF_RUN_MAX_SECONDS??1800);
 if(!Number.isSafeInteger(run_start_ts)||run_start_ts<1||run_start_ts>Math.floor(now/1000)+1||!Number.isSafeInteger(run_max_seconds)||run_max_seconds<1||run_max_seconds>86400||now>=(run_start_ts+run_max_seconds)*1000)fail();
 return {run_start_ts,run_max_seconds};
}
export async function buildCodeObserverScope({env,sourceCommit,get}){
 const budget=initializeCodeBudget({env}),aliases=[env.WF_BRAIN_TASK_ID,env.BRAIN_TASK_ID,env.WFR_BRAIN_TASK_ID].filter(value=>value!==undefined&&value!==null&&value!=='');if(new Set(aliases).size!==1)fail();const taskId=aliases[0];
 if(typeof get!=='function'||!/^[a-f0-9-]{36}$/.test(taskId??'')||!workflows.has(env.WF_BRAIN_WORKFLOW))fail();
 const response=await get('/api/brain/tasks/'+taskId),task=response.task??response,p=task.payload,scope=p?.scope??{};if(!scope||typeof scope!=='object'||Array.isArray(scope))fail();
 if(task.id!==taskId||task.status!=='in_progress'||typeof task.claimed_by!=='string'||!task.claimed_by.trim()||typeof task.claimed_at!=='string'||!Number.isFinite(Date.parse(task.claimed_at))||!p||p.source_commit!==sourceCommit||p.workflow_key!==env.WF_BRAIN_WORKFLOW||p.run_tag!==env.WFR_TAG||p.profile!==env.P||p.company_line!==env.LEADGEN_LINE||Object.hasOwn(p,'execution_transport')||Object.hasOwn(scope,'execution_transport')||p.execution_mode&&p.execution_mode!=='code'||scope.execution_mode&&scope.execution_mode!=='code')fail();
 if(p.workflow_key==='douyin_comment_scoring'?(env.SERIAL!=='none'||p.device_serial!=null):p.device_serial!==env.SERIAL)fail();
 for(const item of [p,scope]){
  if(Object.hasOwn(item,'send')&&item.send!==0||Object.hasOwn(item,'max_turns'))fail();
  if(Object.hasOwn(item,'run_max_seconds')&&item.run_max_seconds!==budget.run_max_seconds)fail();
  for(const [key,name]of [['limit','LEADGEN_LIMIT'],['source_run','LEADGEN_SOURCE_RUN'],['comment_limit','LEADGEN_COMMENT_LIMIT'],['sort','LEADGEN_SORT'],['time_layer','LEADGEN_TIME_LAYER'],['location','LEADGEN_LOCATION'],['max_attempts','LEADGEN_DISCOVERY_MAX_ATTEMPTS'],['max_candidates','LEADGEN_DISCOVERY_MAX_CANDIDATES'],['max_screens','LEADGEN_MAX_SCREENS']])if(Object.hasOwn(item,key)&&item[key]!==null&&(env[name]===undefined||String(item[key])!==env[name]))fail();
  if(Object.hasOwn(item,'keyword')){const d=discoveryInput(env);if(!d||d.sources.length!==1||d.sources[0]!==item.keyword)fail();}
 }
 return {schema_version:1,task_id:taskId,claim:{claimed_by:task.claimed_by,claimed_at:task.claimed_at},run_tag:env.WFR_TAG,workflow_key:env.WF_BRAIN_WORKFLOW,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,...budget,scope:structuredClone(scope),consumed_task_payload:consumedPayload(p)};
}

// 仅实际Caller的完整中央读管线完成后，运输层才能消费该私有能力。
export async function authorizeCodeObserverCapability(cap,options){verifyCodeObserverCapability(cap,options);await verifyCodeObserverAuthority(options);verifyCodeObserverCapability(cap,options);caps.get(cap).authorized=true;return true;}
