import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {startActivityBroker} from './activity-skill-broker.mjs';
import {digest as contractDigest} from './runtime-definition.mjs';
import {safeExecutionDiagnostic,verifiedNativeNotStartedProof} from './leadgen-client.mjs';
import {isCaptureContractFailure} from './activity-commander.mjs';
import {collectionEvidenceProof,consumeCollectionPhoneProof,collectionReturnedEvidence} from './collection-phone-scope.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const noLaunch=message=>{const e=Error(message);e.executionStopped=true;throw e;};
// Child prose is diagnostic only. It never satisfies the Activity result contract.
export function skillBlockedDiagnostic(receipt,request,env){
 if(receipt?.execution_stopped!==true||receipt?.status!=='ok')return null;
 let reply;try{reply=JSON.parse(receipt.terminal?.terminalReply?.text);}catch{return null;}
 if(reply?.result!=='blocked'||reply.run_id!==request.run_id||(reply.activity_key||reply.activity)!==request.activity_key||reply.source_commit!==request.source_commit||reply.runtime_snapshot_sha256!==request.runtime_snapshot_sha256)return null;
 const reason=[reply.earliest_error?.reason,reply.blocked_reason].filter(x=>typeof x==='string').join('; ');
 if(!reason)return null;
 return {status:'blocked',reason:safeExecutionDiagnostic(reason,env).slice(0,1500)};
}
export function classifyActivityFailure(activity,failure,{collectionSemantic=false}={}){
 const nativeStopped=failure.execution_stopped===true&&failure.external_effect==='unknown'&&typeof failure.operation_id==='string';
 const text=nativeStopped?JSON.stringify(failure).replace(/EXECUTION_DEADLINE|EXECUTION_OUTPUT_LIMIT/g,''):JSON.stringify(failure);
 if(isCaptureContractFailure(failure))return 'blocked';
 if(/SOURCE_|BINDING_|CONTRACT_|COMPANY_|ACCOUNT_|未授权|暂停|日发送上限|锁.*(不符|未知|失败)|LOCK_|鉴权|权限|AUTH_|PERMISSION_|EACCES|EPERM|EXECUTION_DEADLINE|预算|截止|配额/.test(text))return 'blocked';
 if(activity.key==='collection'&&failure.status==='partial'&&!collectionSemantic)return 'blocked';
 if(activity.key==='send_dm')return 'readback_only';
 if(failure.status==='partial'&&!failure.result?.failures?.length)return 'blocked';
 return 'repair';
}
export function frozenMethod(frozen,slot,runDir){
 const entries=frozen.activities.filter(a=>a.reference.slot_key===slot);
 if(entries.length!==1)throw Error('SKILL_ACTIVITY_BINDING_INVALID');
 const a=entries[0],bindings=a.version.payload.implementation_bindings||[];
 const methods=bindings.filter(b=>b.kind==='skill');
 if(methods.length!==1)throw Error('SKILL_METHOD_BINDING_INVALID');
 const b=methods[0],prefix='services/phone-adb-controller/';
 if(!b.path?.startsWith(prefix+'skills/')||b.path.includes('..'))throw Error('SKILL_METHOD_PATH_INVALID');
 const path='runtime/'+b.path.slice(prefix.length),text=readFileSync(join(runDir,path),'utf8');
 if(hash(text)!==frozen.files[path])throw Error('SKILL_METHOD_BYTES_MISMATCH');
 const front=text.match(/^---\n([\s\S]*?)\n---/),name=front?.[1].match(/^name:\s*(\S+)$/m)?.[1],version=front?.[1].match(/^  version:\s*(\S+)$/m)?.[1],ref=front?.[1].match(/^  activity_ref:\s*(\S+)$/m)?.[1];
 if(name!==b.name||!/^\d+\.\d+\.\d+$/.test(version||'')||version!==b.version||ref!==a.version.payload.definition_key)throw Error('SKILL_METHOD_VERSION_MISMATCH');
 const supportPath='runtime/skills/leadgen-activity-execution.md',support=readFileSync(join(runDir,supportPath),'utf8');
 if(hash(support)!==frozen.files[supportPath])throw Error('SKILL_SUPPORT_BYTES_MISMATCH');
 const contract=a.version.payload.contract;
 if(!contract||typeof contract!=='object'||Array.isArray(contract)||a.version.contract_sha256&&a.version.contract_sha256!==contractDigest(contract))throw Error('SKILL_ACTIVITY_CONTRACT_INVALID');
 return {name,version,path,activity_ref:ref,activity_version_id:a.version.id,reference_id:a.reference.reference_id,sha256:hash(text),text,support:{sha256:hash(support),text:support},
  contract:{activity_version_id:a.version.id,definition_key:a.version.payload.definition_key,sha256:contractDigest(contract),payload:structuredClone(contract)}};
}
export function createActivityRecovery({runDir,frozen,binding,env,handlers,rpc,verify}){
 return async({activity,failure,execute})=>{
  const directory=join(runDir,'skill-handoff',activity.key);
  if(existsSync(directory)){const error=Error('SKILL_HANDOFF_ALREADY_REQUESTED_TERMINATION_UNVERIFIED');error.executionStopped=false;throw error;}
  const phoneProof=collectionEvidenceProof(failure,{run_id:binding.run_id,task_id:binding.task_id??null,source_commit:frozen.deployment.source_commit,activity:activity.key});
  const phoneAuthorized=!!phoneProof&&consumeCollectionPhoneProof(phoneProof,{task_id:binding.task_id??null,run_id:binding.run_id,attempt:env.WFR_ATTEMPT,source_commit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL,activity:activity.key,owner:env.WFR_TAG,target:frozen.deployment.target,deadline_ms:handlers.state.budgetDeadline,snapshot_sha256:frozen.snapshot_sha256,binding_id:binding.id});
  const returned=activity.key==='collection'&&failure.status==='failed'&&failure.verification?.verified===false
    &&collectionReturnedEvidence(failure,{run_id:binding.run_id,task_id:binding.task_id??null,source_commit:frozen.deployment.source_commit,activity:activity.key});
  const native=handlers.state.nativeStopProof;
  const nativeStopVerified=failure.execution_stopped===true&&failure.external_effect==='unknown'
    &&/\bEXECUTION_START_FAILED\b/.test(failure.error||'')
    &&verifiedNativeNotStartedProof(native,{runDir,operationId:failure.operation_id,runId:binding.run_id,taskId:binding.task_id,profile:env.P,serial:env.SERIAL,owner:env.WFR_TAG,sourceCommit:frozen.deployment.source_commit,activity:activity.key});
  if(handlers.state.executionUnknown||!phoneAuthorized&&!returned&&((handlers.state.nativeStopUnproven||native||failure.operation_id)&&!nativeStopVerified||failure.execution_stopped===false||(/\b(?:EXECUTION_OUTPUT_LIMIT|EXECUTION_DEADLINE|RECORD_CAPTURE_EXIT_UNVERIFIED)\b/.test(JSON.stringify(failure))&&!nativeStopVerified))){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;throw e;}
  const classified=classifyActivityFailure(activity,failure,{collectionSemantic:phoneAuthorized});
  const mode=returned&&classified!=='blocked'?'readback_only':classified;
  if(handlers.state.qualificationClaimUnknown)noLaunch('SKILL_HANDOFF_CLAIM_RECEIPT_UNKNOWN');
  if(mode==='blocked')noLaunch(activity.key==='collection'&&failure.status==='partial'?'SKILL_COLLECTION_PARTIAL_READBACK_REQUIRED':'SKILL_HANDOFF_POLICY_BLOCKED');
  const deadline=handlers.state.budgetDeadline;
  if(!Number.isSafeInteger(deadline)||deadline-Date.now()<10000)noLaunch('SKILL_HANDOFF_NO_REMAINING_BUDGET');
  let method;try{method=frozenMethod(frozen,activity.key,runDir);}catch(error){noLaunch(error.message);}
  const entry=frozen.activities.find(a=>a.reference.slot_key===activity.key),policy=entry.version.payload.contract?.agent_recovery;
  if(policy!=null&&(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==1||policy.max_additional_turns!==1))noLaunch('SKILL_AGENT_RECOVERY_POLICY_INVALID');
  mkdirSync(directory,{recursive:true,mode:0o700});
  let request={protocol:'leadgen-activity-v1',run_id:binding.run_id,task_id:binding.task_id||null,binding_id:binding.id,activity_key:activity.key,
   ...(policy?{transport_generation:0}:{}),nonce:randomBytes(24).toString('hex'),deadline_ms:deadline,source_commit:frozen.deployment.source_commit,workflow_definition_version_id:frozen.workflow_version.id,
   runtime_snapshot_sha256:frozen.snapshot_sha256,release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,mode,method,broker_host:frozen.deployment.target,broker_request_path:join(directory,'broker-request.json'),broker_tool_path:join(runDir,'runtime','activity-skill-tool.mjs'),
   failure:{status:failure.status,attempt:failure.attempt,error:safeExecutionDiagnostic(failure.error||'',env),result_status:failure.result?.status||null,failures:(failure.result?.failures||[]).slice(0,4).map(f=>safeExecutionDiagnostic(JSON.stringify(f),env))}};
  const closeReadback=returned?await handlers.beginCollectionReadback(failure):undefined;
  try{await handlers.handoffHeartbeat?.(activity);}catch(error){await closeReadback?.();noLaunch('SKILL_HANDOFF_RESOURCE_UNVERIFIED: '+error.message);}
  let heartbeatError=null,heartbeatBusy=false,heartbeatJob=Promise.resolve();
  let broker;try{broker=await startActivityBroker({directory,request,isBlockedError:error=>classifyActivityFailure(activity,{status:'failed',error:String(error.message)})==='blocked',inspect:handlers.handoffContext,resume:execute,phone:handlers.handoffPhone,
   authorize:async q=> !heartbeatError&&q.transport_generation===request.transport_generation&&(await rpc({kind:'activity_skill_authority',request},{timeoutMs:10000})).authorized===true});}catch(error){await closeReadback?.();throw error;}
  const heartbeat=setInterval(()=>{if(heartbeatBusy||heartbeatError)return;heartbeatBusy=true;heartbeatJob=Promise.resolve().then(()=>handlers.handoffHeartbeat?.(activity)).catch(error=>{heartbeatError=error;}).finally(()=>{heartbeatBusy=false;});},60000);heartbeat.unref();
  let stopped=false,nativeUnknown=false;
  const nativeKnown=()=>{const actual=broker.getResult();nativeUnknown||=!!(handlers.state.executionUnknown||actual.execution_unknown||actual.result?.execution_stopped===false);if(nativeUnknown)stopped=false;return !nativeUnknown;};
  try{
   let receipt,actual,verificationFailed=false;
   for(let generation=0;generation<=(policy?1:0);generation++){
    if(!nativeKnown())break;
    stopped=false;
    const reply=await rpc({kind:'activity_skill',request},{timeoutMs:Math.max(1,deadline-Date.now())});receipt=reply.result;
    writeFileSync(join(directory,`agent-receipt${generation?'-turn-1':''}.json`),JSON.stringify(receipt),{flag:'wx',mode:0o600});
    actual=broker.getResult();stopped=receipt?.execution_stopped===true&&actual.active===0&&nativeKnown();
    const newlyBlocked=actual.blocked_error||actual.result?.status==='paused'||actual.result&&classifyActivityFailure(activity,{status:actual.result.status??'failed',result:actual.result})==='blocked';
    verificationFailed=false;
    if(policy&&!newlyBlocked&&stopped&&receipt.status==='ok'&&actual.result){
     if(typeof verify!=='function')noLaunch('SKILL_INDEPENDENT_VERIFY_UNAVAILABLE');
     const verdict=await verify(activity,{status:'completed',result:actual.result,execution_stopped:true,skill_receipt:receipt});
     writeFileSync(join(directory,`verification-turn-${generation}.json`),JSON.stringify(verdict),{flag:'wx',mode:0o600});verificationFailed=verdict?.verified!==true;
    }
    const failed=['error','failed','timeout','aborted'].includes(receipt?.status)&&receipt.owner_execution_stopped===true&&receipt.child_execution_stopped===true&&receipt.terminal?.runId===receipt.child_run_id&&Number.isFinite(receipt.terminal?.endedAt);
    if(!nativeKnown()||newlyBlocked||!policy||mode!=='repair'||generation!==0||!stopped||!(failed||verificationFailed&&receipt.owner_execution_stopped===true&&receipt.child_execution_stopped===true)||heartbeatError||deadline-Date.now()<10000)break;
    try{await handlers.handoffHeartbeat?.(activity);}catch(error){heartbeatError=error;break;}
    if(!nativeKnown()||heartbeatError||deadline-Date.now()<10000)break;
    request=broker.advanceTurn(verificationFailed?'verification_failed':'agent_failed');
   }
   clearInterval(heartbeat);await heartbeatJob;nativeKnown();
   if(!stopped)return {status:'failed',execution_stopped:false,reason:'Skill或原操作终止未知',skill_receipt:receipt};
   if(heartbeatError)return {status:'failed',execution_stopped:true,reason:'Skill执行期间原资源续期未验证',skill_receipt:receipt};
   if(returned)return {status:'failed',execution_stopped:true,reason:'原独立验收未通过；只读接手不重做已提交业务',recovery_outcome:'verification_readback_only',skill_receipt:receipt};
   if(receipt.status!=='ok'||!actual.reserved||!actual.result||verificationFailed){
    const blocked=skillBlockedDiagnostic(receipt,request,env);
    return {status:'partial',execution_stopped:true,reason:blocked?'Skill接手后阻断: '+blocked.reason:'Skill未交付当前Activity实际执行结果',recovery_outcome:blocked?'skill_blocked':'skill_result_missing',skill_receipt:receipt};
   }
   const result=actual.result;
   return {status:['failed','partial','paused'].includes(result.status)?'partial':'completed',result,execution_stopped:true,skill_receipt:receipt};
  }catch(error){error.executionStopped=stopped&&nativeKnown()&&error.executionStopped!==false;throw error;}
  finally{clearInterval(heartbeat);await heartbeatJob;try{await broker.close();}finally{await closeReadback?.();}}
 };
}
