import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {startActivityBroker} from './activity-skill-broker.mjs';
import {safeExecutionDiagnostic} from './leadgen-client.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const noLaunch=message=>{const e=Error(message);e.executionStopped=true;throw e;};
export function classifyActivityFailure(activity,failure){
 const text=JSON.stringify(failure);
 if(/SOURCE_|BINDING_|CONTRACT_|COMPANY_|ACCOUNT_|未授权|暂停|日发送上限|锁.*(不符|未知|失败)|LOCK_|鉴权|AUTH_|EXECUTION_DEADLINE|预算|截止|配额/.test(text))return 'blocked';
 if(activity.key==='collection'&&failure.status==='partial')return 'blocked';
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
 return {name,version,path,activity_ref:ref,activity_version_id:a.version.id,reference_id:a.reference.reference_id,sha256:hash(text),text,support:{sha256:hash(support),text:support}};
}
export function createActivityRecovery({runDir,frozen,binding,env,handlers,rpc}){
 return async({activity,failure,execute})=>{
  const directory=join(runDir,'skill-handoff',activity.key);
  if(existsSync(directory)){const error=Error('SKILL_HANDOFF_ALREADY_REQUESTED_TERMINATION_UNVERIFIED');error.executionStopped=false;throw error;}
  const mode=classifyActivityFailure(activity,failure);
  if(handlers.state.qualificationClaimUnknown)noLaunch('SKILL_HANDOFF_CLAIM_RECEIPT_UNKNOWN');
  if(mode==='blocked')noLaunch(activity.key==='collection'&&failure.status==='partial'?'SKILL_COLLECTION_PARTIAL_READBACK_REQUIRED':'SKILL_HANDOFF_POLICY_BLOCKED');
  const deadline=handlers.state.budgetDeadline;
  if(!Number.isSafeInteger(deadline)||deadline-Date.now()<10000)noLaunch('SKILL_HANDOFF_NO_REMAINING_BUDGET');
  let method;try{method=frozenMethod(frozen,activity.key,runDir);}catch(error){noLaunch(error.message);}
  mkdirSync(directory,{recursive:true,mode:0o700});
  const request={protocol:'leadgen-activity-v1',run_id:binding.run_id,task_id:binding.task_id||null,binding_id:binding.id,activity_key:activity.key,
   nonce:randomBytes(24).toString('hex'),deadline_ms:deadline,source_commit:frozen.deployment.source_commit,workflow_definition_version_id:frozen.workflow_version.id,
   runtime_snapshot_sha256:frozen.snapshot_sha256,release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,mode,method,broker_host:frozen.deployment.target,broker_request_path:join(directory,'broker-request.json'),broker_tool_path:join(runDir,'runtime','activity-skill-tool.mjs'),
   failure:{status:failure.status,attempt:failure.attempt,error:safeExecutionDiagnostic(failure.error||'',env),result_status:failure.result?.status||null,failures:(failure.result?.failures||[]).slice(0,4).map(f=>safeExecutionDiagnostic(JSON.stringify(f),env))}};
  try{await handlers.handoffHeartbeat?.(activity);}catch(error){noLaunch('SKILL_HANDOFF_RESOURCE_UNVERIFIED: '+error.message);}
  let heartbeatError=null,heartbeatBusy=false,heartbeatJob=Promise.resolve();
  const broker=await startActivityBroker({directory,request,inspect:handlers.handoffContext,resume:execute,phone:handlers.handoffPhone,
   authorize:async()=> !heartbeatError&&(await rpc({kind:'activity_skill_authority',request},{timeoutMs:10000})).authorized===true});
  const heartbeat=setInterval(()=>{if(heartbeatBusy||heartbeatError)return;heartbeatBusy=true;heartbeatJob=Promise.resolve().then(()=>handlers.handoffHeartbeat?.(activity)).catch(error=>{heartbeatError=error;}).finally(()=>{heartbeatBusy=false;});},60000);heartbeat.unref();
  let stopped=false;
  try{
   const reply=await rpc({kind:'activity_skill',request},{timeoutMs:Math.max(1,deadline-Date.now())});
   clearInterval(heartbeat);await heartbeatJob;
   const receipt=reply.result;
   writeFileSync(join(directory,'agent-receipt.json'),JSON.stringify(receipt),{mode:0o600});
   const actual=broker.getResult();stopped=receipt?.execution_stopped===true&&actual.active===0;
   if(!stopped)return {status:'failed',execution_stopped:false,reason:'Skill或原操作终止未知',skill_receipt:receipt};
   if(heartbeatError)return {status:'failed',execution_stopped:true,reason:'Skill执行期间原资源续期未验证',skill_receipt:receipt};
   if(receipt.status!=='ok'||!actual.reserved||!actual.result)return {status:'partial',execution_stopped:true,reason:'Skill未交付当前Activity实际执行结果',skill_receipt:receipt};
   const result=actual.result;
   return {status:['failed','partial','paused'].includes(result.status)?'partial':'completed',result,execution_stopped:true,skill_receipt:receipt};
  }catch(error){error.executionStopped=stopped;throw error;}
  finally{clearInterval(heartbeat);await heartbeatJob;await broker.close();}
 };
}
