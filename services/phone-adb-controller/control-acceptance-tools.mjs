// A deliberately empty business/physical capability set, selected only by the
// central Task's explicit control-acceptance scope. This is not a scoring worker.
import {openSync,closeSync,writeFileSync,fsyncSync,lstatSync,constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {skillLaunchDidNotStart} from './activity-skill-executor.mjs';
import {rawModelScopeStopped} from './activity-skill-parent-loop.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const handlersBrand=new WeakSet();
const fail=reason=>{throw Error('CONTROL_ACCEPTANCE_'+reason);};
export function validateControlScope(value){
 if(!object(value)||Object.keys(value).sort().join(',')!=='activity_key,allowed_intents,protocol'
  ||value.protocol!=='runner-control-acceptance/v1'||value.activity_key!=='scoring'
  ||JSON.stringify(value.allowed_intents)!=='["inspect","finish"]')fail('SCOPE_INVALID');
 return structuredClone(value);
}
function claim(value){
 if(!object(value)||Object.keys(value).sort().join(',')!=='claimed_at,claimed_by'||typeof value.claimed_by!=='string'||!value.claimed_by
  ||/[\0\r\n]/.test(value.claimed_by)||typeof value.claimed_at!=='string'||!Number.isFinite(Date.parse(value.claimed_at)))fail('CLAIM_INVALID');
 return structuredClone(value);
}
export function controlAcceptanceFromTask({task,input,sourceCommit}){
 const payload=task?.payload,scope=payload?.scope;
 if(object(payload)&&(Object.hasOwn(payload,'control_scope')||Object.hasOwn(payload,'control_claim'))||object(scope)&&Object.hasOwn(scope,'control_claim'))fail('SHADOW_AUTHORITY');
 if(!object(scope)||!Object.hasOwn(scope,'control_scope')){if(Object.hasOwn(task?.result||{},'control_scope'))fail('RESULT_IS_NOT_AUTHORITY');if(input?.profile==='none')fail('SCOPE_REQUIRED');return null;}
 const selected=validateControlScope(scope.control_scope);
 if(task.id!==input.task_id||task.status!=='in_progress'||payload.source_commit!==sourceCommit||payload.workflow_key!==input.workflow_key||payload.run_tag!==input.run_tag
  ||payload.profile!==input.profile||payload.company_line!==input.line||payload.device_serial!=null||input.workflow_key!=='douyin_comment_scoring'
  ||input.profile!=='mmv-scoring'||input.serial!=='none'||input.source_run!==null||input.limit!==1||input.execution_transport!=='raw-model-v1'
  ||scope.limit!==1||scope.score_limit!==1||scope.send!==0||scope.source_run!==null||scope.run_max_seconds!==input.run_max_seconds
  ||scope.execution_transport!==input.execution_transport||scope.max_turns!==input.max_turns)fail('TASK_AUTHORITY_INVALID');
 return {control_scope:selected,control_claim:claim({claimed_by:task.claimed_by,claimed_at:task.claimed_at})};
}
export function validateFrozenControlAcceptance(frozen){
 if(!Object.hasOwn(frozen,'control_scope')&&!Object.hasOwn(frozen,'control_claim'))return null;
 const selected=validateControlScope(frozen.control_scope),held=claim(frozen.control_claim),input=frozen.agent_input;
 if(frozen.execution_mode!=='agent'||frozen.execution_transport!=='raw-model-v1'||frozen.workflow_version?.payload?.key!=='douyin_comment_scoring'
  ||input?.workflow_key!=='douyin_comment_scoring'||input.execution_transport!==frozen.execution_transport||input.max_turns!==frozen.max_turns
  ||input.profile!=='mmv-scoring'||input.serial!=='none'||input.source_run!==null||input.limit!==1||!Number.isInteger(frozen.max_turns)||frozen.max_turns<1||frozen.max_turns>64)fail('FROZEN_INVALID');
 return {control_scope:selected,control_claim:held};
}
export const isControlAcceptanceHandlers=value=>handlersBrand.has(value);
export function createControlAcceptanceHandlers({runDir,frozen,binding}){
 const authority=validateFrozenControlAcceptance(frozen);if(!authority)fail('SCOPE_REQUIRED');
 const stat=lstatSync(runDir);if(!isAbsolute(runDir)||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)fail('DIRECTORY_INVALID');
 const state={nativeStopUnproven:false,executionUnknown:false};
 const handlers={state,agentNativeState:()=>({native_stop_unproven:false,execution_unknown:false}),
  agentSupportsNativeScope:activity=>activity.key===authority.control_scope.activity_key,
  async createAgentTools(activity,provided){
   const scope=structuredClone(provided),input=frozen.agent_input;
   if(activity.key!=='scoring'||scope.activity!=='scoring'||scope.workflow!==input.workflow_key||scope.task_id!==input.task_id||binding.task_id!=null&&binding.task_id!==input.task_id
    ||scope.binding_id!==binding.id||scope.run_id!==binding.run_id||scope.source_commit!==frozen.deployment.source_commit||scope.snapshot_sha256!==frozen.snapshot_sha256
    ||scope.profile!=='mmv-scoring'||scope.serial!=='none'||scope.execution_transport!=='raw-model-v1'||scope.max_turns!==frozen.max_turns||!/^[a-f0-9]{48}$/.test(scope.agent_nonce||''))fail('SCOPE_IDENTITY');
   let result=null,forbidden=0;
   const denied=async()=>{forbidden++;fail('OPERATION_FORBIDDEN');};
   return {prepare:async()=>({}),inspect:async()=>({control_scope:structuredClone(authority.control_scope),allowed_intents:['inspect','finish'],phone_capabilities:[],business_capabilities:[],pending_write_readbacks:[],
     purpose:'本轮仅验收Runner与Commander控制回路，不执行103业务；先显式inspect报告观察，再按Commander指导finish。',business_pass:false}),
    phone:denied,business:denied,canReadback:()=>false,
    async settle(proof){
     if(proof?.execution_stopped!==true||!rawModelScopeStopped(proof.raw_model_proof,scope))fail('MODEL_STOP_UNVERIFIED');
     result={status:'needs_review',control_scope:structuredClone(authority.control_scope),business_pass:false,physical_actions:0,pg_connections:0,forbidden_operations:forbidden};
     const fd=openSync(join(runDir,'control-acceptance-scoring.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
     try{writeFileSync(fd,JSON.stringify(result));fsyncSync(fd);}finally{closeSync(fd);}
     const parent=openSync(runDir,constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}
     return structuredClone(result);
    },getResult:()=>result&&structuredClone(result),
    closeNativeScope:async proof=>({domain:'control-acceptance-no-native/v1',execution_stopped:rawModelScopeStopped(proof?.raw_model_proof,scope)||skillLaunchDidNotStart(proof,scope),physical_actions:0,pg_connections:0})};
  },quarantineResources:async()=>({verified:true,not_applicable:true,physical_actions:0,pg_connections:0})};
 handlersBrand.add(handlers);return handlers;
}
