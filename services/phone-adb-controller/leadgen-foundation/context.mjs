import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const need=(v,code)=>{if(!v)throw Error('LEADGEN_'+code);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function protectedBytes(file){
 need(typeof file==='string'&&path.isAbsolute(file)&&fs.realpathSync(file)===file,'CONFIG_PATH');
 const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o077)===0,'CONFIG_PERMISSIONS');
 return fs.readFileSync(file);
}
const BUSINESS={
 '101':['keyword','search_filters','max_candidates'],
 '102':['scope','input_provenance','producer_key','comment_limit','qualification_coverage_seconds'],
 '103':['scope'],
 '104':['scope'],
};
const FORBIDDEN=new Set(['task_id','tasks','actor','root_task_id','runtime_root','runtimeRoot','credentials','source_commit','context','verification','phone_controller','node','python','command','env','environment','authorization_asset','cleanup_owner','central_owner','local_owner']);
function safeBusiness(x){
 if(!object(x)&&!Array.isArray(x))return;
 for(const [k,v]of Object.entries(x)){need(!FORBIDDEN.has(k),'INPUT_AUTHORITY');safeBusiness(v);}
}
export function readHostConfiguration(environment){
 const bytes=protectedBytes(environment.LEADGEN_HOST_CONFIG);
 need(/^[a-f0-9]{64}$/.test(environment.LEADGEN_HOST_CONFIG_SHA256??'')&&hash(bytes)===environment.LEADGEN_HOST_CONFIG_SHA256,'CONFIG_DIGEST');
 const config=JSON.parse(bytes);need(config.schema==='leadgen-host-config/v1'&&object(config.bindings),'CONFIG_SCHEMA');
 need(/^[a-zA-Z0-9_.-]{1,100}$/.test(config.machine_id??'')&&config.machine_id===environment.LEADGEN_MACHINE_ID,'MACHINE_MISMATCH');
 return {config,configuration_sha256:hash(bytes)};
}
export function buildContext({workflow,run,environment=process.env,hostRoot}){
 need(Object.hasOwn(BUSINESS,workflow)&&UUID.test(run?.task_id??'')&&UUID.test(run?.run_id??'')&&run.input?.run_tag===run.run_id,'RUN_IDENTITY');
 need(Number.isSafeInteger(run.deadline_ms)&&Number.isSafeInteger(run.cleanup_deadline_ms)&&run.cleanup_deadline_ms>run.deadline_ms,'RUN_DEADLINE');
 const input=run.input;need(object(input)&&Object.keys(input).every(k=>['run_tag','binding_key','business'].includes(k)),'INPUT_FIELDS');
 need(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(input.binding_key??''),'BINDING_KEY');
 need(object(input.business)&&Object.keys(input.business).every(k=>BUSINESS[workflow].includes(k)),'INPUT_BUSINESS');safeBusiness(input.business);
 const {config,configuration_sha256}=readHostConfiguration(environment),binding=config.bindings[input.binding_key];
 need(object(binding)&&binding.allowed_workflows?.includes(workflow)&&object(binding.context),'BINDING_MISSING');
 const c=structuredClone(binding.context);
 need(!Object.keys(c).some(k=>['tasks','task_id','run_id','run_tag','root_task_id','actor','local_owner','central_owner','business_deadline_ms','cleanup_deadline_ms','assigned_workflow','skills_root'].includes(k)),'BINDING_OLD_IDENTITY');
 need(object(c.verification)&&!Object.keys(c.verification).some(k=>['101','102','103','104','proof_manifest_path','artifact_checker'].includes(k)),'BINDING_OLD_SCOPE');
 need(!c.verification.native?.cleanup_owner,'BINDING_OLD_IDENTITY');
 need(path.isAbsolute(hostRoot),'HOST_PATH');
 Object.assign(c,{assigned_workflow:workflow,root_task_id:run.task_id,actor:'foundation:'+config.machine_id,
  tasks:{[workflow]:{task_id:run.task_id,run_id:run.run_id,run_tag:run.run_id}},run_tag:run.run_id,
  local_owner:'wf'+workflow+'-'+run.run_id,central_owner:run.task_id,business_deadline_ms:run.deadline_ms,cleanup_deadline_ms:run.cleanup_deadline_ms,
  skills_root:path.join(hostRoot,'services/phone-adb-controller/skills'),run_max_seconds:Math.floor((binding.timeout_ms??2400000)/1000)});
 c.verification.native={...c.verification.native,cleanup_owner:run.task_id};
 c.verification.proof_manifest_path=path.join(path.dirname(hostRoot),'proof.json');
 if(workflow==='101'){
  need(typeof input.business.keyword==='string'&&input.business.keyword.trim()&&object(input.business.search_filters)&&Number.isSafeInteger(input.business.max_candidates)&&input.business.max_candidates>0,'INPUT_101');
  Object.assign(c,input.business);c.verification['101']={output_scope:'persisted_run',output_limit:c.max_candidates};
 }else{
  need(object(input.business.scope),'INPUT_SCOPE');c.verification[workflow]=structuredClone(input.business.scope);
  for(const key of BUSINESS[workflow].filter(k=>!['scope','producer_key'].includes(k)))if(input.business[key]!==undefined){
   if(key==='input_provenance')c.verification[key]=structuredClone(input.business[key]);else c[key]=input.business[key];
  }
  if(workflow==='102'){
   const key=input.business.producer_key;need(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(key??''),'PRODUCER_KEY');
   const producer=binding.producers?.[key],scope=c.verification['102'];need(object(producer)&&producer.workflow==='101','PRODUCER_BINDING');
   need(Array.isArray(scope.video_ids)&&scope.video_ids.length===1&&object(scope.upstream)&&Object.keys(scope.upstream).length===1
    &&scope.video_ids.every(id=>scope.upstream[id]?.run===producer.run_tag&&Object.keys(scope.upstream[id]).every(k=>k==='run')),'PRODUCER_SCOPE');
   for(const id of scope.video_ids)scope.upstream[id]={run:producer.run_tag,run_id:producer.run_id};
   c.input_provenance={producer:structuredClone(producer)};
  }
  if(workflow==='103'){
   const s=c.verification['103'];need(s.input_mode==='committed_partial_ids'&&Array.isArray(s.comment_ids)&&s.comment_ids.length===1&&UUID.test(s.comment_ids[0])
    &&object(s.sources)&&Object.keys(s.sources).length===1&&typeof s.sources[s.comment_ids[0]]==='string'&&s.sources[s.comment_ids[0]]!==run.run_id,'INPUT_103_SINGLE');
   c.max_candidates=c.comment_limit=1;
  }
 }
 if(workflow==='104'){
  const asset=c.authorization_asset;need(asset&&/^[a-f0-9]{64}$/.test(asset.sha256??''),'AUTHORIZATION_REQUIRED');
  const bytes=protectedBytes(asset.path);need(hash(bytes)===asset.sha256,'AUTHORIZATION_DIGEST');
  const approval=JSON.parse(bytes);need(approval.schema==='run-send-authorization/v1'&&approval.root_task_id===run.task_id,'AUTHORIZATION_TASK');
 }
 return {context:c,configuration_sha256,binding_sha256:hash(canonical(binding)),input_sha256:hash(canonical(input)),machine_id:config.machine_id};
}
