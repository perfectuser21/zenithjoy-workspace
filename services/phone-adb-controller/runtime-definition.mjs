import {prepareFrozenPreflightPg} from './preflight-pg-dependencies.mjs';
import {controlAcceptanceFromTask,validateFrozenControlAcceptance} from './control-acceptance-tools.mjs';
import {validateProducerDescriptor,assertProducerSampling} from './producer-descriptor.mjs';
import outreachScope from './leadgen-outreach-scope.js';
import lineRoutes from './line-routes.js';
import {userInfo} from 'node:os';
import { assertRuntimeHost } from './runtime-host.mjs';
import { loadRuntimeRelease } from './runtime-release.mjs';
// 运行前只读固定版本；运行目录是之后所有判定与身份解析的唯一来源。
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, realpathSync, statSync, lstatSync } from 'node:fs';
import { resolve, dirname, sep, basename, isAbsolute } from 'node:path';
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
export function validatePreflightProfile(value){
 const keys=['schema_version','path','sha256','profile','serial','model','width','height','enabled'];
 if(!value||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))||value.schema_version!==1||!isAbsolute(value.path||'')||resolve(value.path)!==value.path||!/^[-A-Za-z0-9_.]+$/.test(value.profile||'')||!(/^[-A-Za-z0-9_]+$/.test(value.serial||'')||isCanonicalTcpDeviceSerial(value.serial))||!/^[a-f0-9]{64}$/.test(value.sha256||'')||typeof value.model!=='string'||!value.model.trim()||/[\r\n]/.test(value.model)||!['width','height'].every(k=>Number.isSafeInteger(value[k])&&value[k]>0)||value.enabled!==true)throw Error('PREFLIGHT_PROFILE_INVALID');
 return structuredClone(value);
}
const agentWorkflows=new Set(['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring']);
function transportPair(value,mode,workflow,{environment=false}={}){
 const transportKey=environment?'LEADGEN_EXECUTION_TRANSPORT':'execution_transport',turnKey=environment?'LEADGEN_MAX_TURNS':'max_turns';
 if(!Object.hasOwn(value,transportKey)&&!Object.hasOwn(value,turnKey))return null;
 const turns=value[turnKey];
 if(mode!=='agent'||!agentWorkflows.has(workflow)||value[transportKey]!=='raw-model-v1'
  ||environment&&!(typeof turns==='string'&&/^[1-9][0-9]*$/.test(turns))
  ||!environment&&!Number.isInteger(turns)||Number(turns)<1||Number(turns)>64)throw Error('EXECUTION_TRANSPORT_INVALID');
 return {execution_transport:'raw-model-v1',max_turns:Number(turns)};
}
export function executionModeInput(env){
 const mode=Object.hasOwn(env,'LEADGEN_EXECUTION_MODE')?env.LEADGEN_EXECUTION_MODE:'code';
 if(!['code','agent'].includes(mode)||mode==='agent'&&!agentWorkflows.has(env.WF_BRAIN_WORKFLOW))throw Error('EXECUTION_MODE_INVALID');
 transportPair(env,mode,env.WF_BRAIN_WORKFLOW,{environment:true});
 return mode;
}
export function executionTransportInput(env){return transportPair(env,executionModeInput(env),env.WF_BRAIN_WORKFLOW,{environment:true});}
export function frozenExecutionMode(snapshot){
 const mode=Object.hasOwn(snapshot,'execution_mode')?snapshot.execution_mode:'code';
 if(!['code','agent'].includes(mode)||mode==='agent'&&!agentWorkflows.has(snapshot.workflow_version?.payload?.key))throw Error('EXECUTION_MODE_FROZEN_INVALID');
 transportPair(snapshot,mode,snapshot.workflow_version?.payload?.key);
 validateFrozenControlAcceptance(snapshot);
 return mode;
}
export function assertExecutionMode(snapshot,env){
 const mode=executionModeInput(env),frozen=frozenExecutionMode(snapshot);
 if(mode!==frozen)throw Error('EXECUTION_MODE_RESUME_MISMATCH');
 if(canonical(executionTransportInput(env))!==canonical(transportPair(snapshot,frozen,snapshot.workflow_version?.payload?.key)))throw Error('EXECUTION_TRANSPORT_RESUME_MISMATCH');
 return frozen;
}
export function assertExecutionTransport(snapshot,env){const mode=assertExecutionMode(snapshot,env);return transportPair(snapshot,mode,snapshot.workflow_version?.payload?.key);}
export function methodAllowsExecutionTransport(text,transport){
 if(transport!=='raw-model-v1'||typeof text!=='string')return false;
 const front=text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]||'';
 const metadata=front.match(/^metadata:\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1]||'';
 const primary=[...metadata.matchAll(/^  primary_execution: *(\S+) *$/gm)],declared=[...metadata.matchAll(/^  execution_transports:([^\n]*)$/gm)];
 let values=[];
 if(declared.length===1){
  const inline=declared[0][1].trim();
  if(/^\[[a-z0-9., -]+\]$/.test(inline))values=inline.slice(1,-1).split(',').map(value=>value.trim());
  else if(inline===''){
   const tail=metadata.slice(declared[0].index+declared[0][0].length),block=tail.match(/^\n((?:    - [a-z0-9][a-z0-9.-]* *(?:\n|$))+)/)?.[1];
   if(block)values=block.trimEnd().split('\n').map(line=>line.slice(6).trim());
  }
 }
 return (front.match(/^metadata:$/gm)||[]).length===1&&primary.length===1&&primary[0][1]==='agent-v1'
  &&declared.length===1&&new Set(values).size===values.length&&values.includes(transport);
}
export const executionActor=snapshot=>frozenExecutionMode(snapshot)==='agent'?'runtime:phone-adb-controller:agent-v1':'runtime:phone-adb-controller';
const agentInputKeys=['schema_version','workflow_key','task_id','run_tag','profile','serial','line','source_run','limit','comment_limit','run_max_seconds','run_start_ts','discovery_filters','collection_budget_s'];
const agentUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const agentToken=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(value);
// Syntax only: a TCP serial still needs the exact frozen host/profile resource binding.
export function isCanonicalTcpDeviceSerial(value){
 if(typeof value!=='string'||value.length>21)return false;
 const match=/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):([1-9][0-9]{0,4})$/.exec(value);
 return Boolean(match&&match[1].split('.').every(part=>String(Number(part))===part&&Number(part)<=255)&&Number(match[2])<=65535);
}

function agentInteger(raw,min=1,max=Number.MAX_SAFE_INTEGER){
 if(typeof raw!=='string'||!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw Error('AGENT_INPUT_INTEGER_INVALID');
 return Number(raw);
}
export function agentInput(env){
 if(executionModeInput(env)!=='agent')return null;
 const tasks=[env.WF_BRAIN_TASK_ID,env.BRAIN_TASK_ID,env.WFR_BRAIN_TASK_ID].filter(Boolean);
 if(!tasks.length||new Set(tasks).size!==1||typeof tasks[0]!=='string'||!agentUuid.test(tasks[0])
   ||!['WFR_TAG','P','LEADGEN_LINE'].every(key=>agentToken(env[key]))||!(agentToken(env.SERIAL)||isCanonicalTcpDeviceSerial(env.SERIAL)))throw Error('AGENT_INPUT_IDENTITY_INVALID');
 const workflow=env.WF_BRAIN_WORKFLOW,source=env.LEADGEN_SOURCE_RUN||null;
 if(source!==null&&!agentToken(source)||workflow==='douyin_video_discovery'&&source!==null||workflow==='douyin_video_processing'&&source===null
   ||workflow==='douyin_comment_scoring'&&env.SERIAL!=='none'||workflow!=='douyin_comment_scoring'&&env.SERIAL==='none')throw Error('AGENT_INPUT_SOURCE_DEVICE_INVALID');
 const limit=agentInteger(Object.hasOwn(env,'LEADGEN_LIMIT')?env.LEADGEN_LIMIT:'2',1,50);
 const runMax=agentInteger(Object.hasOwn(env,'WF_RUN_MAX_SECONDS')?env.WF_RUN_MAX_SECONDS:'1800'),runStart=agentInteger(env.WF_RUN_START_TS);
 if(!Number.isSafeInteger((runStart+runMax)*1000)||runStart>Math.floor(Date.now()/1000)+5)throw Error('AGENT_INPUT_BUDGET_INVALID');
 let filters=null,sampling=null,collectionBudget=null;
 if(workflow==='douyin_video_discovery'){
  filters={sort:env.LEADGEN_SORT||'latest',time_layer:env.LEADGEN_TIME_LAYER||'six_months',location:env.LEADGEN_LOCATION||'same_city'};
  if(!['comprehensive','latest','most_liked','most_commented','most_favorited'].includes(filters.sort)||!['unlimited','one_day','one_week','six_months'].includes(filters.time_layer)||!['same_city','unlimited'].includes(filters.location))throw Error('AGENT_INPUT_FILTERS_INVALID');
 }
 try{
  sampling=commentSamplingInput(env);
  if(workflow==='douyin_video_processing'){if(!sampling)throw Error('explicit sampling quota required');collectionBudget=collectionBudgetSeconds(env);}
 }catch{throw Error('AGENT_INPUT_COMMENT_QUOTA_INVALID');}
 const transport=executionTransportInput(env);
 return {schema_version:1,workflow_key:workflow,task_id:tasks[0],run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,
  source_run:source,limit,comment_limit:sampling?.comment_limit??null,run_max_seconds:runMax,run_start_ts:runStart,discovery_filters:filters,collection_budget_s:collectionBudget,...(transport||{})};
}
export function validateAgentInput(input){
 const transport=input&&transportPair(input,'agent',input.workflow_key),keys=[...agentInputKeys,...(transport?['execution_transport','max_turns']:[])];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(key=>!keys.includes(key))||input.schema_version!==1)throw Error('AGENT_INPUT_FROZEN_INVALID');
 const env={LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:input.workflow_key,WF_BRAIN_TASK_ID:input.task_id,WFR_TAG:input.run_tag,P:input.profile,SERIAL:input.serial,LEADGEN_LINE:input.line,
  LEADGEN_LIMIT:String(input.limit),WF_RUN_MAX_SECONDS:String(input.run_max_seconds),WF_RUN_START_TS:String(input.run_start_ts),...(input.source_run===null?{}:{LEADGEN_SOURCE_RUN:input.source_run}),
  ...(input.comment_limit===null?{}:{LEADGEN_COMMENT_LIMIT:String(input.comment_limit)}),...(input.collection_budget_s===null?{}:{QUEUED_VIDEO_COLLECTION_SECONDS:String(input.collection_budget_s)}),
  ...(input.discovery_filters?{LEADGEN_SORT:input.discovery_filters.sort,LEADGEN_TIME_LAYER:input.discovery_filters.time_layer,LEADGEN_LOCATION:input.discovery_filters.location}:{}),
  ...(transport?{LEADGEN_EXECUTION_TRANSPORT:transport.execution_transport,LEADGEN_MAX_TURNS:String(transport.max_turns)}:{})};
 if(canonical(agentInput(env))!==canonical(input))throw Error('AGENT_INPUT_FROZEN_INVALID');
 return input;
}
export function assertAgentInput(snapshot,env){
 if(assertExecutionMode(snapshot,env)!=='agent'){
  if(Object.hasOwn(snapshot,'agent_input'))throw Error('AGENT_INPUT_FROZEN_INVALID');return null;
 }
 const fixed=validateAgentInput(snapshot.agent_input);
 if(fixed.workflow_key!==snapshot.workflow_version.payload.key||canonical(agentInput(env))!==canonical(fixed))throw Error('AGENT_INPUT_RESUME_MISMATCH');
 return fixed;
}
export function initializeAgentBudget(env,{now=Date.now()}={}){
 if(executionModeInput(env)!=='agent'||!isAbsolute(env.WFR_RUN_DIR||''))throw Error('AGENT_INPUT_BUDGET_INIT_INVALID');
 let start,max;
 if(existsSync(resolve(env.WFR_RUN_DIR,'run-definition.json'))){
  const snapshot=readFrozen(env.WFR_RUN_DIR);if(frozenExecutionMode(snapshot)!=='agent')throw Error('EXECUTION_MODE_RESUME_MISMATCH');
  const fixed=validateAgentInput(snapshot.agent_input);start=fixed.run_start_ts;max=fixed.run_max_seconds;
  if(Object.hasOwn(env,'WF_RUN_START_TS')&&String(start)!==env.WF_RUN_START_TS||Object.hasOwn(env,'WF_RUN_MAX_SECONDS')&&String(max)!==env.WF_RUN_MAX_SECONDS)throw Error('AGENT_INPUT_BUDGET_RESUME_MISMATCH');
  assertAgentInput(snapshot,{...env,WF_RUN_START_TS:String(start),WF_RUN_MAX_SECONDS:String(max)});
 }else{
  start=Object.hasOwn(env,'WF_RUN_START_TS')?agentInteger(env.WF_RUN_START_TS):Math.floor(now/1000);
  max=Object.hasOwn(env,'WF_RUN_MAX_SECONDS')?agentInteger(env.WF_RUN_MAX_SECONDS):1800;
  agentInput({...env,WF_RUN_START_TS:String(start),WF_RUN_MAX_SECONDS:String(max)});
 }
 return {run_start_ts:start,run_max_seconds:max};
}
// 单视频软预算加480秒收尾不得超过collection的7200秒合同。
export function collectionBudgetSeconds(env){
 if(!Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS'))return 480;
 const value=String(env.QUEUED_VIDEO_COLLECTION_SECONDS);
 if(!/^[1-9][0-9]{0,3}$/.test(value)||Number(value)>6720)throw Error('评论采集预算必须为1至6720整数');
 return Number(value);
}
// 本轮可选采样输入是冻结定义的一部分，续跑不许改变配额或上游来源。
export function commentSamplingInput(env){
 const collectionBudget=collectionBudgetSeconds(env);
 if(!Object.hasOwn(env,'LEADGEN_COMMENT_LIMIT'))return null;
 if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(String(env.LEADGEN_COMMENT_LIMIT)))throw Error('评论采样上限必须为1至50整数');
 if(env.WF_BRAIN_WORKFLOW!=='douyin_video_processing')throw Error('评论采样只允许102视频处理流程');
 if(!/^[A-Za-z0-9_-]+$/.test(env.LEADGEN_SOURCE_RUN||'')||!/^[A-Za-z0-9_-]+$/.test(env.WFR_TAG||'')||!env.P||!env.SERIAL||!env.LEADGEN_LINE)throw Error('评论采样缺少本run及上游来源身份');
 return {schema_version:1,workflow_key:env.WF_BRAIN_WORKFLOW,run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:env.LEADGEN_SOURCE_RUN,comment_limit:Number(env.LEADGEN_COMMENT_LIMIT),...(Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS')?{collection_budget_s:collectionBudget}:{})};
}
export function assertCommentSampling(snapshot,env){
 const requested=commentSamplingInput(env),fixed=snapshot.sampling_input||null;
 if(canonical(requested)!==canonical(fixed))throw Error('评论采样请求与本run冻结输入不符');
 return fixed;
}
// 104只接受私有文件中的唯一订单身份，冻结进run后续跑逐字段核对。
export function outreachScopeInput(env){
 const file=env.LEADGEN_OUTREACH_SCOPE_FILE;
 if(env.LEADGEN_OUTREACH_MODE&&!['exact','company_queue'].includes(env.LEADGEN_OUTREACH_MODE))throw Error('OUTREACH_SCOPE_MODE_MISMATCH');
 if(file===undefined||file===null||file===''){
  if(env.LEADGEN_OUTREACH_MODE==='exact')throw Error('OUTREACH_SCOPE_REQUIRED');
  return null;
 }
 if(env.LEADGEN_OUTREACH_MODE==='company_queue'||env.WF_BRAIN_WORKFLOW!=='douyin_lead_outreach'||!isAbsolute(file))throw Error('OUTREACH_SCOPE_INVALID');
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size<1||stat.size>4096)throw Error('OUTREACH_SCOPE_FILE_INVALID');
 const input=JSON.parse(readFileSync(file,'utf8'));
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==7)throw Error('OUTREACH_SCOPE_INVALID');
 const scope={schema_version:1,...input,run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL};
 return outreachScope.validateOutreachScope(scope,{line_key:lineRoutes.routeOf(env.LEADGEN_LINE).key});
}
export function assertOutreachScope(snapshot,env){
 const requested=outreachScopeInput(env),frozen=snapshot.outreach_scope||null;
 if(canonical(requested)!==canonical(frozen))throw Error('OUTREACH_SCOPE_RESUME_MISMATCH');
 return frozen;
}
// v1严格限制首屏候选数；v2显式限制实际尝试，二者均独立于成功入库数。
export function validateDiscoveryInput(value){
 const quotaKey=value?.schema_version===2?'max_attempts':'max_candidates';
 const keys=['schema_version','workflow_key','run_tag','profile','serial','line',quotaKey,'max_screens','source_kind','sources','source_sha256'];
 if(!value||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))||![1,2].includes(value.schema_version)||value.workflow_key!=='douyin_video_discovery'||!['run_tag','profile','line'].every(k=>/^[A-Za-z0-9_-]+$/.test(value[k]||''))||!(/^[A-Za-z0-9_-]+$/.test(value.serial||'')||isCanonicalTcpDeviceSerial(value.serial))||!Number.isSafeInteger(value[quotaKey])||value[quotaKey]<1||value[quotaKey]>1000||value.max_screens!==1||value.source_kind!=='keyword'||!Array.isArray(value.sources)||value.sources.length!==1||typeof value.sources[0]!=='string'||!value.sources[0].trim()||/[\r\n]/.test(value.sources[0])||!/^[a-f0-9]{64}$/.test(value.source_sha256||''))throw Error('DISCOVERY_INPUT_INVALID');
 return value;
}
export function discoveryInput(env){
 const candidates=Object.hasOwn(env,'LEADGEN_DISCOVERY_MAX_CANDIDATES'),attempts=Object.hasOwn(env,'LEADGEN_DISCOVERY_MAX_ATTEMPTS');
 if(!candidates&&!attempts)return null;
 const quota=attempts?env.LEADGEN_DISCOVERY_MAX_ATTEMPTS:env.LEADGEN_DISCOVERY_MAX_CANDIDATES;
 if(candidates&&attempts||!/^[1-9][0-9]{0,3}$/.test(String(quota))||env.LEADGEN_MAX_SCREENS!=='1'||env.LEADGEN_SOURCE_KIND!=='keyword'||!env.LEADGEN_SOURCES_FILE)throw Error('DISCOVERY_INPUT_INVALID');
 const bytes=readFileSync(env.LEADGEN_SOURCES_FILE);if(bytes.length>10000)throw Error('DISCOVERY_INPUT_INVALID');
 return validateDiscoveryInput({schema_version:attempts?2:1,workflow_key:env.WF_BRAIN_WORKFLOW,run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,[attempts?'max_attempts':'max_candidates']:Number(quota),max_screens:1,source_kind:'keyword',sources:bytes.toString('utf8').split('\n').filter(Boolean),source_sha256:digest(bytes)});
}
export function assertDiscoveryInput(snapshot,env){
 const requested=discoveryInput(env),fixed=snapshot.discovery_input||null;
 if(fixed)validateDiscoveryInput(fixed);
 if(canonical(requested)!==canonical(fixed))throw Error('DISCOVERY_INPUT_MISMATCH');
 return fixed;
}
export function localPath(root, relative) {
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) throw Error('非法部署路径');
  const p=realpathSync(resolve(root,relative)); const base=realpathSync(root);
  if (!p.startsWith(base+sep)) throw Error('部署路径越界'); return p;
}
function verifyVersion(v, type, id, versionId) {
  if (!v || v.id!==versionId || v.payload?.[`${type}_id`]!==id || !/^[a-f0-9]{40}$/.test(v.source_commit)) throw Error('版本规范身份或固定来源无效');
  const source={repo:v.source_repo,path:v.source_path,commit:v.source_commit};
  if (digest({source,payload:v.payload})!==v.payload_sha256 || digest(v.payload.contract)!==v.contract_sha256) throw Error('版本digest摘要不符');
}
export function readFrozen(runDir) {
  const snapshot=JSON.parse(readFileSync(resolve(runDir,'run-definition.json'),'utf8'));
  const {snapshot_sha256,...body}=snapshot;
  if (digest(body)!==snapshot_sha256) throw Error('运行快照digest不符');
  for (const [file,hash] of Object.entries(snapshot.files)) if (digest(readFileSync(resolve(runDir,file)))!==hash) throw Error(`冻结文件digest不符: ${file}`);
  return snapshot;
}
function assertRunIdentity(snapshot,identity,runDir){
  const recorded=snapshot.run_identity;
  if(recorded && (!['capability','tag','profile','serial','run_id'].every(key=>typeof recorded[key]==='string' && recorded[key].length) || (runDir && basename(resolve(runDir))!==recorded.run_id))) throw Error('运行身份或目录不匹配');
  const contract=snapshot.workflow_version.payload.contract;
  if(!recorded || (contract?.contract_key??contract?.capability)!==identity.capability) throw Error('运行快照capability身份不匹配');
  for(const key of ['capability','tag','profile','serial','run_id']) if(identity[key]!==undefined && identity[key]!==recorded[key]) throw Error(`运行身份不匹配: ${key}`);
}
export function registerRun(indexRoot,runDir,identity){
  assertRunIdentity(readFrozen(runDir),identity,runDir);
  mkdirSync(indexRoot,{recursive:true,mode:0o700});
  const file=resolve(indexRoot,`${digest([identity.capability,identity.tag])}.json`);
  const temp=`${file}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify({run_dir:resolve(runDir)}),{mode:0o600});renameSync(temp,file);
}
export function locateRun(indexRoot,identity){
  const file=resolve(indexRoot,`${digest([identity.capability,identity.tag])}.json`);
  if(!existsSync(file))return null;
  const record=JSON.parse(readFileSync(file,'utf8'));assertRunIdentity(readFrozen(record.run_dir),identity,record.run_dir);return record.run_dir;
}
export function assertDeploymentAdmission(deploymentRoot,home=userInfo().homedir){
 const actual=realpathSync(deploymentRoot),base=realpathSync(home);
 if(![resolve(base,'bin-harvest'),resolve(base,'.openclaw/leadgen-scripts')].includes(actual))return;
 const marker=resolve(base,'.local/share/zenithjoy/phone-transactions/active.json');
 for(let path=dirname(marker);path!==base;path=dirname(path)){
  try{if(lstatSync(path).isSymbolicLink())throw Error('整包部署状态路径异常');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 try{lstatSync(marker);throw Error('整包部署或恢复未完成，拒绝新运行冻结');}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function freezeDefinition(o) {
  const executionMode=executionModeInput({WF_BRAIN_WORKFLOW:o.workflowKey,...(Object.hasOwn(o,'executionMode')?{LEADGEN_EXECUTION_MODE:o.executionMode}:{})});
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&frozenExecutionMode(readFrozen(o.runDir))!==executionMode)throw Error('EXECUTION_MODE_RESUME_MISMATCH');
  const fixedAgentInput=executionMode==='agent'?validateAgentInput(o.agentInput):null;
  const executionTransport=fixedAgentInput?transportPair(fixedAgentInput,executionMode,o.workflowKey):null;
  const loadControlAuthority=async sourceCommit=>{
    if(!executionTransport)return null;
    const response=await o.get('/api/brain/tasks/'+fixedAgentInput.task_id);
    return controlAcceptanceFromTask({task:response?.task??response,input:fixedAgentInput,sourceCommit});
  };
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(transportPair(readFrozen(o.runDir),executionMode,o.workflowKey))!==canonical(executionTransport))throw Error('EXECUTION_TRANSPORT_RESUME_MISMATCH');
  const hasPreflight=o.preflightPg!=null||o.preflightControlScope!=null||o.preflightProfile!=null;
  if(existsSync(resolve(o.runDir,'run-definition.json'))){const old=readFrozen(o.runDir);if(canonical(old.preflight_pg||null)!==canonical(o.preflightPg||null)||canonical(old.preflight_control_scope||null)!==canonical(o.preflightControlScope||null)||canonical(old.preflight_profile||null)!==canonical(o.preflightProfile||null))throw Error('PREFLIGHT_INPUT_RESUME_MISMATCH');}
  if(hasPreflight&&(executionMode!=='agent'||!['douyin_video_discovery','douyin_video_processing'].includes(o.workflowKey)||!o.preflightPg||!o.preflightControlScope||!o.preflightProfile||Object.keys(o.preflightPg).sort().join(',')!=='lock_sha256,package_lock_sha256'||Object.values(o.preflightPg).some(v=>!/^[a-f0-9]{64}$/.test(v))))throw Error('PREFLIGHT_INPUT_MODE_INVALID');
  if(hasPreflight){const p=validatePreflightProfile(o.preflightProfile);if(p.profile!==fixedAgentInput?.profile||p.serial!==fixedAgentInput?.serial)throw Error('PREFLIGHT_PROFILE_IDENTITY');}
  if(executionMode==='code'&&o.agentInput!=null)throw Error('AGENT_INPUT_MODE_INVALID');
  if(fixedAgentInput&&(fixedAgentInput.workflow_key!==o.workflowKey||o.runIdentity&&['tag','profile','serial'].some(key=>o.runIdentity[key]!==fixedAgentInput[key==='tag'?'run_tag':key])))throw Error('AGENT_INPUT_FREEZE_SCOPE_INVALID');
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).agent_input||null)!==canonical(fixedAgentInput))throw Error('AGENT_INPUT_RESUME_MISMATCH');
  if(fixedAgentInput?.workflow_key==='douyin_video_processing'&&!o.samplingInput)throw Error('AGENT_INPUT_FREEZE_SAMPLING_MISMATCH');
  if(fixedAgentInput&&o.samplingInput&&(['workflow_key','run_tag','profile','serial','line','source_run','comment_limit'].some(key=>fixedAgentInput[key]!==o.samplingInput[key])||fixedAgentInput.collection_budget_s!==(o.samplingInput.collection_budget_s??480)))throw Error('AGENT_INPUT_FREEZE_SAMPLING_MISMATCH');
  if(fixedAgentInput&&o.discoveryInput&&['run_tag','profile','serial','line'].some(key=>fixedAgentInput[key]!==o.discoveryInput[key]))throw Error('AGENT_INPUT_FREEZE_DISCOVERY_MISMATCH');
  if(o.outreachScope){const scope=outreachScope.validateOutreachScope(o.outreachScope);if(o.workflowKey!=='douyin_lead_outreach'||o.runIdentity&&['tag','profile','serial'].some(k=>o.runIdentity[k]!==scope[k==='tag'?'run_tag':k]))throw Error('OUTREACH_SCOPE_FREEZE_IDENTITY_INVALID');}
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).outreach_scope||null)!==canonical(o.outreachScope||null))throw Error('OUTREACH_SCOPE_RESUME_MISMATCH');
  if(o.discoveryInput){const d=validateDiscoveryInput(o.discoveryInput);if(d.workflow_key!==o.workflowKey||o.runIdentity&&['tag','profile','serial'].some(k=>o.runIdentity[k]!==d[k==='tag'?'run_tag':k]))throw Error('DISCOVERY_INPUT_FREEZE_SCOPE_INVALID');}
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).discovery_input||null)!==canonical(o.discoveryInput||null))throw Error('DISCOVERY_INPUT_RESUME_MISMATCH');
  if(o.producerDescriptor){const d=validateProducerDescriptor(o.producerDescriptor);assertProducerSampling(d,o.samplingInput);if(o.workflowKey!=='douyin_video_processing'||o.runIdentity?.profile!==d.profile||o.runIdentity?.serial!==d.serial||o.samplingInput?.source_run!==d.run_tag)throw Error('PRODUCER_DESCRIPTOR_FREEZE_SCOPE_INVALID');}
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).producer_descriptor||null)!==canonical(o.producerDescriptor||null))throw Error('PRODUCER_DESCRIPTOR_RESUME_MISMATCH');
  if(existsSync(resolve(o.runDir,'run-definition.json'))&&canonical(readFrozen(o.runDir).discovery_phone_scope||null)!==canonical(o.discoveryPhoneScope||null))throw Error('discovery phone scope续跑输入与冻结请求不符');
  if(o.samplingInput){
    const q=o.samplingInput;
    const checked=commentSamplingInput({LEADGEN_COMMENT_LIMIT:String(q.comment_limit),WF_BRAIN_WORKFLOW:q.workflow_key,WFR_TAG:q.run_tag,P:q.profile,SERIAL:q.serial,LEADGEN_LINE:q.line,LEADGEN_SOURCE_RUN:q.source_run,...(Object.hasOwn(q,'collection_budget_s')?{QUEUED_VIDEO_COLLECTION_SECONDS:String(q.collection_budget_s)}:{})});
    if(canonical(checked)!==canonical(q)||q.workflow_key!==o.workflowKey)throw Error('冻结采样输入scope/schema非法');
    if(o.runIdentity&&['tag','profile','serial'].some(k=>o.runIdentity[k]!==q[k==='tag'?'run_tag':k]))throw Error('冻结采样输入运行身份不符');
  }
  if (existsSync(resolve(o.runDir,'run-definition.json'))) {const frozen=readFrozen(o.runDir);if(canonical(frozen.sampling_input||null)!==canonical(o.samplingInput||null))throw Error('评论采样续跑输入与冻结请求不符');if(canonical(frozen.collection_phone_scope||null)!==canonical(o.collectionPhoneScope||null))throw Error('collection phone scope续跑输入与冻结请求不符');
    const control=await loadControlAuthority(frozen.deployment.source_commit),oldControl=frozen.control_scope?{control_scope:frozen.control_scope,control_claim:frozen.control_claim}:null;
    if(canonical(control)!==canonical(oldControl))throw Error('CONTROL_ACCEPTANCE_RESUME_MISMATCH');
    if(o.runIdentity)assertRunIdentity(frozen,o.runIdentity,o.runDir);if(frozen.release)assertRuntimeHost(frozen.release,frozen.deployment);return frozen;}
  assertDeploymentAdmission(o.deploymentRoot);
  const manifestPath=o.manifestPath||resolve(o.deploymentRoot,'deployment-manifest.json');
  const originalManifest=readFileSync(manifestPath);
  const manifest=JSON.parse(originalManifest);
  const controlAuthority=await loadControlAuthority(manifest.source_commit);
  const fixed=(o.releaseId||manifest.release_id||o.requireRelease)?await loadRuntimeRelease(o,manifest,digest):null;
  let version;
  if(fixed){assertRuntimeHost(fixed.release,manifest);version=fixed.version;}
  else {
    const list=await o.get('/api/brain/workflows');const matches=(Array.isArray(list)?list:list.workflows||[]).filter(w=>w.key===o.workflowKey);
    if(matches.length!==1 || !matches[0].current_definition_version_id)throw Error('工作流必须有唯一已登记current version');
    const w=matches[0];version=(await o.get(`/api/brain/workflows/${w.id}/versions/${w.current_definition_version_id}`))?.version;
    verifyVersion(version,'workflow',w.id,w.current_definition_version_id);
  }
  verifyVersion(version,'workflow',version.payload.workflow_id,version.id);
  if(o.samplingInput&&version.payload.key!==o.samplingInput.workflow_key)throw Error('冻结采样流程版本身份不符');
  if (!o.rawContractSha256 || version.contract_sha256!==o.rawContractSha256) throw Error('部署计划contract摘要与版本不同');
  if(manifest.source_commit!==version.source_commit || manifest.source_repo!==version.source_repo) throw Error('部署来源与固定版本不同');
  const checked=new Map();
  for (const file of manifest.files||[]) {
    const sourcePath=localPath(o.deploymentRoot,file.deployed_path);
    const bytes=readFileSync(sourcePath); const mode=statSync(sourcePath).mode & 0o555;
    const actual=digest(bytes);
    if(actual!==file.content_sha256) throw Error(`实际部署文件digest不符: ${file.path}`);
    checked.set(file.path,{...file,actual_content_sha256:actual,status:'verified_local',bytes,mode,sourcePath});
  }
  if(!checked.size) throw Error('部署实现清单为空');
  const checkedBytes=path=>{
    const file=[...checked.values()].find(file=>file.sourcePath===realpathSync(path));
    if(!file)throw Error('实际plan/step文件不在部署清单manifest');
    return file.bytes;
  };
  const plan=checkedBytes(o.planPath);const steps=checkedBytes(o.stepSpecPath);JSON.parse(steps);
  const activities=[];
  for(const ref of version.payload.activities||[]) {
    if(!ref.reference_id || !ref.activity_version_id) throw Error('缺少活动使用位置或版本');
    const av=fixed?fixed.activityVersion(ref):(await o.get(`/api/brain/activities/${ref.activity_id}/versions/${ref.activity_version_id}`))?.version;
    verifyVersion(av,'activity',ref.activity_id,ref.activity_version_id);
    const implementations=(av.payload.implementation_bindings||[]).map(binding=>{
      const deployed=checked.get(binding.path);
      if(binding.status==='verified' && deployed) {
        const expected=binding.content_sha256 || binding.digest?.replace(/^sha256:/,'');
        if(binding.repo!==manifest.source_repo || binding.revision!==manifest.source_commit || expected!==deployed.actual_content_sha256) throw Error(`实现binding digest或来源不符: ${binding.path}`);
        return {...binding,execution_verification:'verified_local',actual_content_sha256:deployed.actual_content_sha256,execution_path:`runtime/${deployed.deployed_path}`};
      }
      return {...binding,execution_verification:'unknown',execution_reason:'not_verified_on_execution_host'};
    });
    const entry=av.payload.contract.runtime?.entry;
    if(entry && !implementations.some(b=>b.execution_verification==='verified_local' && b.path===`services/phone-adb-controller/${entry}`)) throw Error(`运行入口没有本机已核验binding: ${entry}`);
    if(executionMode==='agent'&&implementations.filter(b=>b.kind==='skill'&&b.execution_verification==='verified_local').length!==1)throw Error('AGENT_PRIMARY_SKILL_BINDING_UNVERIFIED');
    if(executionTransport){
      const method=implementations.find(b=>b.kind==='skill'&&b.execution_verification==='verified_local');
      if(!methodAllowsExecutionTransport(checked.get(method.path).bytes.toString('utf8'),executionTransport.execution_transport))throw Error('EXECUTION_TRANSPORT_METHOD_UNSUPPORTED');
    }
    activities.push({reference:ref,version:av,implementations});
  }
  if(!activities.length) throw Error('运行工作流无活动');
  if(o.activityRefs && o.activityRefs.length!==activities.length) throw Error('部署活动引用数量与版本不同');
  if(o.activityRefs) for(const expected of o.activityRefs){
    const actual=activities.find(a=>a.reference.slot_key===expected.slot_key);
    if(!actual || actual.reference.sequence_no!==expected.sequence_no || actual.version.payload.definition_key!==expected.definition_key || actual.version.contract_sha256!==expected.contract_sha256) throw Error('部署计划活动引用与版本不同');
  }
  const files={'workflow.plan':digest(plan),'step-dod.json':digest(steps)};
  for(const file of checked.values()) files[`runtime/${file.deployed_path}`]=file.actual_content_sha256;
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));
  if(files['runtime/deployment-manifest.json'])throw Error('源码不能占用冻结部署声明路径');
  files['runtime/deployment-manifest.json']=digest(manifestBytes);
  if(o.collectionPhoneScope&&(o.collectionPhoneScope.source_commit!==manifest.source_commit||o.collectionPhoneScope.target!==manifest.target))throw Error('collection phone scope部署来源不符');
  if(o.discoveryPhoneScope&&(o.discoveryPhoneScope.source_commit!==manifest.source_commit||o.discoveryPhoneScope.target!==manifest.target||o.workflowKey!=='douyin_video_discovery'))throw Error('discovery phone scope部署来源不符');
  const body={schema_version:fixed?2:1,...(fixed?{release:fixed.release}:{}),workflow_version:version,activities,deployment:manifest,files,
    ...(executionMode==='agent'?{execution_mode:'agent',agent_input:structuredClone(fixedAgentInput),...(executionTransport||{}),...(controlAuthority||{})}:{}),...(hasPreflight?{preflight_pg:structuredClone(o.preflightPg),preflight_control_scope:structuredClone(o.preflightControlScope),preflight_profile:structuredClone(o.preflightProfile)}:{}),
    ...(o.discoveryInput?{discovery_input:structuredClone(o.discoveryInput)}:{}),...(o.discoveryPhoneScope?{discovery_phone_scope:structuredClone(o.discoveryPhoneScope)}:{}),...(o.collectionPhoneScope?{collection_phone_scope:structuredClone(o.collectionPhoneScope)}:{}),...(o.runtimeTransport?{runtime_transport:o.runtimeTransport}:{}),...(o.samplingInput?{sampling_input:o.samplingInput}:{}),...(o.outreachScope?{outreach_scope:structuredClone(o.outreachScope)}:{}),...(o.producerDescriptor?{producer_descriptor:structuredClone(o.producerDescriptor)}:{}),...(o.runIdentity?{run_identity:o.runIdentity}:{})};
  if(o.runIdentity)assertRunIdentity(body,o.runIdentity);
  const snapshot={...body,snapshot_sha256:digest(body)};
  const staging=`${o.runDir}.freeze-${randomUUID()}`; mkdirSync(staging,{recursive:true,mode:0o700});
  try {
    for(const file of checked.values()){
      const target=resolve(staging,'runtime',file.deployed_path);mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,file.bytes,{mode:file.mode});
    }
    if(hasPreflight||manifest.dependencies?.preflight_pg){
      const dependency=manifest.dependencies?.preflight_pg,dependencyScope=hasPreflight?snapshot:{...snapshot,preflight_pg:{lock_sha256:dependency?.lock_sha256,package_lock_sha256:dependency?.package_lock_sha256}};
      await prepareFrozenPreflightPg({sourceRuntimeRoot:o.deploymentRoot,runtimeRoot:resolve(staging,'runtime'),frozen:dependencyScope,expectedDeployment:dependency});
    }
    writeFileSync(resolve(staging,'runtime/deployment-manifest.json'),manifestBytes,{mode:0o600});
    writeFileSync(resolve(staging,'workflow.plan'),plan);writeFileSync(resolve(staging,'step-dod.json'),steps);
    writeFileSync(resolve(staging,'run-definition.json'),JSON.stringify(snapshot,null,2));
    assertDeploymentAdmission(o.deploymentRoot);
    if(!readFileSync(manifestPath).equals(originalManifest))throw Error('冻结期间部署声明发生变化');
    if(canonical(await loadControlAuthority(manifest.source_commit))!==canonical(controlAuthority))throw Error('CONTROL_ACCEPTANCE_TASK_CHANGED');
    mkdirSync(dirname(o.runDir),{recursive:true}); renameSync(staging,o.runDir);
  } finally {rmSync(staging,{recursive:true,force:true});}
  return snapshot;
}
