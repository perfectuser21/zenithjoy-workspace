// Primary Skill execution owns an independent capability; Code recovery remains separate.
import {publicDomainAuthority} from './public-domain-authority.mjs';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {frozenMethod} from './activity-skill-recovery.mjs';
import {assertExecutionMode,assertExecutionTransport,assertAgentInput,canonical,methodAllowsExecutionTransport} from './runtime-definition.mjs';
import {safeExecutionDiagnostic} from './leadgen-client.mjs';
import {startPrimaryActivityBroker} from './activity-skill-primary-broker.mjs';
import {runActivitySkillParentLoop,rawModelScopeStopped} from './activity-skill-parent-loop.mjs';

const notLaunched=new WeakMap(),officialStoppedScopes=new WeakMap(),rawRecoveryStates=new WeakMap(),failedRawChecks=new WeakMap();
export function certifyRawCheckFailure(evidence,verification){
 const state=rawRecoveryStates.get(evidence?.raw_continuation);
 if(!state||!state.ready||state.used||evidence.execution_stopped!==true||verification?.verified!==false||Date.now()>=state.request.worker_deadline_ms)return null;
 const proof=Object.freeze({kind:'code-judge-failure/v1'});failedRawChecks.set(proof,{state,verification:structuredClone(verification)});return proof;
}
export const skillLaunchDidNotStart=(proof,scope)=>Boolean(proof&&scope&&notLaunched.get(proof)===canonical(scope));
export const skillOfficialExecutionStopped=(proof,scope)=>Boolean(proof&&scope&&officialStoppedScopes.get(proof)?.scope===canonical(scope));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const noLaunch=message=>Object.assign(Error(message),{executionStopped:true});
const officialStopped=receipt=>receipt?.execution_stopped===true&&receipt.owner_execution_stopped===true
 &&receipt.child_execution_stopped===true&&uuid.test(receipt.child_run_id||'')
 &&receipt.terminal?.runId===receipt.child_run_id&&Number.isFinite(receipt.terminal?.endedAt)
 &&['ok','error','aborted','timeout'].includes(receipt.terminal?.status);
const nativeUnknown=actual=>actual.sealed!==true||actual.pending!==0||actual.active!==0||actual.execution_unknown||actual.result?.execution_stopped===false||actual.result?.external_effect==='unknown';
const uncertainty=(actual,receipt,request)=>{
 const allowed=new Set(['business_commit_unknown','native_execution_unknown','event_delivery_unknown','abort_stop_unknown','inflight_at_seal']);
 const reasons=new Set((actual.unknown_reasons||[]).filter(reason=>allowed.has(reason)));
 const sourceMatches=receipt?.source_commit===request.source_commit;
 if(!sourceMatches||receipt?.owner_execution_stopped!==true)reasons.add('official_owner_unknown');
 if(!sourceMatches||receipt?.child_execution_stopped!==true)reasons.add('official_child_unknown');
 if(!officialStopped(receipt))reasons.add('official_execution_unverified');
 if(receipt?.source_commit!==request.source_commit)reasons.add('official_source_mismatch');
 if(actual.result?.execution_stopped===false)reasons.add('native_execution_unknown');
 if(actual.result?.external_effect==='unknown'&&!reasons.has('business_commit_unknown'))reasons.add('server_result_unknown');
 return {unknown_reasons:[...reasons],owner_execution_stopped:sourceMatches&&receipt?.owner_execution_stopped===true,child_execution_stopped:sourceMatches&&receipt?.child_execution_stopped===true};
};

export function createActivitySkillExecutor({runDir,frozen,binding,env,rpc,createTools,createOfficialControl,deadlineFor,beforeRawTurn,supportsNativeScope=()=>false,nativeState=()=>({})}){
 if(assertExecutionMode(frozen,env)!=='agent')throw noLaunch('AGENT_PRIMARY_EXECUTION_MODE_REQUIRED');
 assertAgentInput(frozen,env);
 if(typeof createTools!=='function'||typeof rpc!=='function'||typeof deadlineFor!=='function')throw noLaunch('AGENT_PRIMARY_DEPENDENCY_UNAVAILABLE');
 const plan=(activity,{context={},runnerDeadline,guidance=[]}={})=>{
  const fixed=assertAgentInput(frozen,env),transport=assertExecutionTransport(frozen,env),taskId=fixed.task_id,directory=join(runDir,'skill-primary',activity.key);
  if(context.task_id!=null&&context.task_id!==taskId||binding.task_id!=null&&binding.task_id!==taskId||!uuid.test(taskId||'')||!uuid.test(binding.id||''))throw noLaunch('AGENT_PRIMARY_TASK_BINDING_REQUIRED');
  const method=frozenMethod(frozen,activity.key,runDir),outerDeadline=Math.min(deadlineFor(activity),runnerDeadline??Infinity);
  const available=Math.floor(outerDeadline-Date.now()),checkReserve=Math.min(10000,Math.floor(available/10)),stopReserve=Math.min(48000,Math.floor(available/5)),ownerReserve=Math.min(10000,Math.floor(available/10));
  if(!Number.isSafeInteger(outerDeadline)||available<100)throw noLaunch('AGENT_PRIMARY_DEADLINE_EXHAUSTED');
  const deadline=outerDeadline-checkReserve,receiptDeadline=deadline-stopReserve,workerDeadline=receiptDeadline-ownerReserve,rpcDeadline=deadline-Math.floor(stopReserve/2);
  const front=method.text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  const metadata=front?.match(/^metadata:\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1]||'';
  const declarations=[...metadata.matchAll(/^  primary_execution: *(\S+) *$/gm)];
  if((front?.match(/^metadata:$/gm)||[]).length!==1||declarations.length!==1||declarations[0][1]!=='agent-v1')throw noLaunch('AGENT_PRIMARY_METHOD_UNSUPPORTED');
  if(transport&&(!methodAllowsExecutionTransport(method.text,transport.execution_transport)||typeof createOfficialControl!=='function'))throw noLaunch('AGENT_PRIMARY_RAW_TRANSPORT_UNAVAILABLE');
  if(!Number.isSafeInteger(deadline)||deadline<=Date.now())throw noLaunch('AGENT_PRIMARY_DEADLINE_EXHAUSTED');
  const rawNonce=transport?randomBytes(24).toString('hex'):null;
  const scope={workflow:fixed.workflow_key,activity:activity.key,run:fixed.run_tag,run_id:binding.run_id,task_id:taskId,
   binding_id:binding.id,source_commit:frozen.deployment.source_commit,snapshot_sha256:frozen.snapshot_sha256,
   profile:fixed.profile,serial:fixed.serial,line:fixed.line,source_run:fixed.source_run,
   limit:fixed.limit,comment_limit:fixed.comment_limit,discovery_filters:structuredClone(fixed.discovery_filters),collection_budget_s:fixed.collection_budget_s,
   run_start_ts:fixed.run_start_ts,run_max_seconds:fixed.run_max_seconds,deadline_ms:deadline,worker_deadline_ms:workerDeadline,receipt_deadline_ms:receiptDeadline,
   ...(transport?{...transport,agent_nonce:rawNonce}:{}),...(frozen.control_scope?{control_scope:structuredClone(frozen.control_scope),control_claim:structuredClone(frozen.control_claim)}:{})};
  const publicAuthority=frozen.public_domain?publicDomainAuthority(runDir):null;
  if(frozen.public_domain&&(!publicAuthority||publicAuthority.identity.run_id!==binding.run_id||publicAuthority.binding.id!==binding.id))throw noLaunch('AGENT_PRIMARY_PUBLIC_AUTHORITY');
  const request={protocol:'leadgen-activity-v1',mode:'execute',...(frozen.primary_host?{primary_host:frozen.primary_host}:{}),...(publicAuthority?{public_domain:{identity:structuredClone(publicAuthority.identity),run_binding:structuredClone(publicAuthority.identity.run_binding),runtime_snapshot_sha256:frozen.public_domain.runtime_snapshot_sha256,local_snapshot_sha256:frozen.snapshot_sha256}}:{}),run_id:binding.run_id,task_id:taskId,binding_id:binding.id,
   workflow_key:scope.workflow,run_tag:scope.run,profile:scope.profile,serial:scope.serial,line:scope.line,
   source_run:fixed.source_run,limit:fixed.limit,comment_limit:fixed.comment_limit,run_max_seconds:fixed.run_max_seconds,
   discovery_filters:structuredClone(fixed.discovery_filters),discovery_input:structuredClone(frozen.discovery_input||null),
   activity_key:activity.key,nonce:rawNonce||randomBytes(24).toString('hex'),deadline_ms:deadline,worker_deadline_ms:workerDeadline,receipt_deadline_ms:receiptDeadline,source_commit:scope.source_commit,...(transport||{}),
   ...(frozen.control_scope?{control_scope:structuredClone(frozen.control_scope),control_claim:structuredClone(frozen.control_claim)}:{}),
   workflow_definition_version_id:frozen.workflow_version.id,runtime_snapshot_sha256:frozen.snapshot_sha256,
   release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,method,broker_host:frozen.deployment.target,
   broker_request_path:join(directory,'broker-request.json'),broker_tool_path:join(runDir,'runtime','activity-skill-tool.mjs'),
   commander_guidance:Array.isArray(guidance)?guidance.filter(value=>typeof value==='string').map(value=>safeExecutionDiagnostic(value,env).slice(0,16000)).slice(0,4):[]};
  return {scope,request,directory,deadline,workerDeadline,receiptDeadline,rpcDeadline,available,transport};
 };
 const execute=async(activity,{context={},guidance=[],signal,deadline_ms:runnerDeadline,onEvent=async()=>({action:'none'})}={})=>{
  if(assertExecutionMode(frozen,env)!=='agent')throw noLaunch('AGENT_PRIMARY_EXECUTION_MODE_REQUIRED');
  const fixed=assertAgentInput(frozen,env);
  const transport=assertExecutionTransport(frozen,env);
  const directory=join(runDir,'skill-primary',activity.key);
  if(existsSync(directory))throw Object.assign(Error('SKILL_PRIMARY_ALREADY_REQUESTED_TERMINATION_UNVERIFIED'),{executionStopped:false});
  const known=nativeState();if(known.native_stop_unproven===true||known.execution_unknown===true)return {status:'needs_review',not_started:true,execution_stopped:false,reason:'AGENT_PRIMARY_PREVIOUS_NATIVE_UNVERIFIED',resource_unverified:true};
  if(signal?.aborted)throw noLaunch('AGENT_PRIMARY_CANCELLED_BEFORE_START');
  const taskId=fixed.task_id;
  if(context.task_id!=null&&context.task_id!==taskId||binding.task_id!=null&&binding.task_id!==taskId||!uuid.test(taskId||'')||!uuid.test(binding.id||''))throw noLaunch('AGENT_PRIMARY_TASK_BINDING_REQUIRED');
  if(await supportsNativeScope(activity)!==true)return {status:'needs_review',not_started:true,execution_stopped:true,reason:'AGENT_PRIMARY_NATIVE_DOMAIN_UNSUPPORTED'};
  const {scope,request,deadline,workerDeadline,receiptDeadline,rpcDeadline,available}=plan(activity,{context,runnerDeadline,guidance});
  const tools=await createTools(activity,scope);
  if(!tools||['inspect','phone','business','getResult','prepare','settle'].some(key=>typeof tools[key]!=='function')
    ||activity.key==='cleanup'&&typeof tools.release!=='function'||transport&&typeof tools.closeNativeScope!=='function')throw noLaunch('AGENT_PRIMARY_TOOLS_UNAVAILABLE');
  mkdirSync(directory,{recursive:true,mode:0o700});
  writeFileSync(join(directory,'launch-intent.json'),JSON.stringify({scope,request}),{flag:'wx',mode:0o600});
  let broker,receipt,caughtError,dispatched=false,stopped=false,lastProgress=Date.now(),heartbeatError=null,rawControl,rawProof,rawLastIndex=null,rawControlKnown=false,rawState;
  let heartbeat,stall,heartbeatJob=Promise.resolve(),stallJob=Promise.resolve(),abortJob=Promise.resolve(),heartbeatBusy=false,stallBusy=false;
  const stop=async reason=>{
   if(transport){
    if(rawLastIndex===null)return {execution_stopped:!dispatched};
    try{const value=await rawControl.request({kind:'official_agent_stop',request,turn_index:rawLastIndex});return {execution_stopped:object(rawControl.verifyStopReceipt(value,{request,index:rawLastIndex}))};}
    catch{return {execution_stopped:false};}
   }
   try{return (await rpc({kind:'activity_skill_stop',request,reason},{timeoutMs:Math.max(1,Math.min(48000,deadline-Date.now()))})).result;}
   catch{return {execution_stopped:false};}
  };
  const abort=()=>{if(dispatched)abortJob=Promise.resolve(broker?.abort('runner_cancelled')).catch(()=>{});};
  try{
   if(transport){
    rawControl=await createOfficialControl({request,scope,directory});
    if(!rawControl||['authorizeParentContext','authorizeBrokerDelivery','seal','close','snapshot','verifySealedExecution'].some(key=>typeof rawControl[key]!=='function')
      ||await rawControl.authorizeParentContext(request)!==true)throw noLaunch('AGENT_PRIMARY_RAW_AUTHORITY_UNVERIFIED');
   }
   if(transport&&typeof tools.bindOfficialAuthority==='function')await tools.bindOfficialAuthority({request,control:rawControl,scope,directory});
   const preparation=await tools.prepare();
   if(activity.key==='cleanup'&&preparation?.native_cleanup_not_required===true){
    const proof=Object.freeze({agent_not_launched:true,execution_stopped:true});notLaunched.set(proof,canonical(scope));
    if(typeof tools.closeNativeScope!=='function'||(await tools.closeNativeScope(proof))?.execution_stopped!==true)throw Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED');
    await tools.settle(proof);await tools.release(proof);const result=tools.getResult();
    if(result?.execution_stopped===false)throw Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED');
    return {status:'partial',not_started:true,execution_stopped:true,result,reason:'未启动清理Worker，仅收回本人资源；原验收条件仍需复核'};
   }
   if(signal?.aborted||Date.now()>=workerDeadline)throw Error('AGENT_PRIMARY_DEADLINE_EXHAUSTED_BEFORE_DISPATCH');
   broker=await startPrimaryActivityBroker({directory,request,inspect:tools.inspect,phone:tools.phone,business:tools.business,
    isReadOnlyBusinessOperation:(operation,input)=>tools.canReadback?.(operation,input)===true,
    getActivityResult:tools.getResult,onEvent:async event=>{if(event.type==='progress')lastProgress=Date.now();return onEvent(event);},onAbort:stop,
    authorize:async(_incoming,delivery)=>!heartbeatError&&(transport?await rawControl.authorizeBrokerDelivery(request,delivery)===true:(await rpc({kind:'activity_skill_authority',request},{timeoutMs:Math.max(1,Math.min(10000,deadline-Date.now()))})).authorized===true),
    ...(frozen.primary_host==='official-child-v1'?{authorizeAfter:async()=>!heartbeatError&&(await rpc({kind:'activity_skill_authority',request},{timeoutMs:Math.max(1,Math.min(10000,deadline-Date.now()))})).authorized===true}:{}),
    ...(transport?{authorizeParentContext:async q=>!heartbeatError&&await rawControl.authorizeParentContext(q)===true}:{})});
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   if(typeof tools.heartbeat==='function'){
    heartbeat=setInterval(()=>{if(heartbeatBusy||heartbeatError)return;heartbeatBusy=true;heartbeatJob=Promise.resolve().then(()=>tools.heartbeat()).catch(error=>{heartbeatError=error;return broker.abort('resource_heartbeat_unverified');}).finally(()=>{heartbeatBusy=false;});},60000);heartbeat.unref();
   }
   const stallMs=Math.max(1000,Number(activity.budget?.stall_s||Math.min(30,available/5000))*1000);
   stall=setInterval(()=>{
    if(stallBusy||Date.now()-lastProgress<stallMs)return;stallBusy=true;
    stallJob=Promise.resolve().then(async()=>{await broker.report({type:'stall',elapsed_ms:Date.now()-lastProgress});})
     .catch(async error=>{heartbeatError=error;await broker.abort('event_sink_failed');}).finally(()=>{lastProgress=Date.now();stallBusy=false;});
   },Math.min(1000,stallMs));stall.unref();
   if(signal?.aborted||Date.now()>=workerDeadline)throw Error('AGENT_PRIMARY_DEADLINE_EXHAUSTED_BEFORE_DISPATCH');
   if(transport){
    // Compose a separate facade: the official Caller has frozen own methods,
    // so a Proxy get trap cannot replace request or return bound replacements.
    const control=Object.freeze(Object.fromEntries(Reflect.ownKeys(rawControl).map(key=>{
     const value=Reflect.get(rawControl,key,rawControl);
     return [key,typeof value==='function'?(...args)=>{const message=args[0];if(key==='request'&&message?.kind==='official_agent_turn'){dispatched=true;rawLastIndex=message.turn.index;}return Reflect.apply(value,rawControl,args);}:value];
    })));
    const beforeTurn=async options=>{
     let owned;do{owned=stallJob;if(stallBusy)options.onDrained?.();await owned;}while(owned!==stallJob);
     if(heartbeatError)return false;
     return beforeRawTurn?beforeRawTurn(options):true;
    };
    const raw=await runActivitySkillParentLoop({request,scope,broker,control,signal,beforeTurn,canReadback:(operation,input)=>tools.canReadback?.(operation,input)===true});
    rawProof=raw.model_stop_proof;rawControlKnown=rawControl.verifySealedExecution(rawControl.snapshot(),{request})===true;
    receipt={execution_transport:transport.execution_transport,source_commit:request.source_commit,reason:raw.reason,...(raw.failure_code?{failure_code:raw.failure_code}:{}),turn_count:raw.turn_count,
     official_execution_stopped:raw.official_execution_stopped,model_execution_unknown:raw.model_execution_unknown,broker_execution_unknown:raw.broker_execution_unknown};
    writeFileSync(join(directory,'raw-agent-receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});
    signal?.removeEventListener('abort',abort);clearInterval(heartbeat);clearInterval(stall);await heartbeatJob;await stallJob;await abortJob;
    let actual=broker.getResult();
    if(!rawModelScopeStopped(rawProof,scope)||!rawControlKnown||nativeUnknown(actual)||heartbeatError)return {status:'needs_review',execution_stopped:false,reason:'raw模型域、资源或原生停止未全部验证',skill_receipt:receipt,
     ...(heartbeatError?{resource_unverified:true,resource_unknown_reasons:['heartbeat_unverified']}:{})};
    stopped=true; // Finally still requires the independent native close proof.
    const proof={execution_stopped:true,raw_model_proof:rawProof};
    await tools.settle(proof);actual=broker.getResult();
    if(nativeUnknown(actual))return {status:'needs_review',execution_stopped:false,reason:'raw模型已停，原生或业务结果仍未知',skill_receipt:receipt};
    if(activity.key==='cleanup')await tools.release(proof);
    actual=broker.getResult();
    if(nativeUnknown(actual))return {status:'needs_review',execution_stopped:false,reason:'raw收尾资源或业务结果未知',skill_receipt:receipt};
    stopped=true;
    if(actual.commander_aborted)return {status:'needs_review',execution_stopped:true,reason:'Commander请求中止，等待复核',skill_receipt:receipt,commander_status:actual.commander_status};
    if(raw.reason!=='agent_finished'||!object(actual.result))return {status:'partial',execution_stopped:true,reason:'raw Agent未交付可独立验收的完整工具结果',skill_receipt:receipt,commander_status:actual.commander_status};
    const ticket=Object.freeze({kind:'raw-readonly-continuation/v1'});
    rawState={request:structuredClone(request),scope:structuredClone(scope),control:rawControl,directory,snapshot:rawControl.snapshot(),usedCount:raw.turn_count,result:structuredClone(actual.result),ready:false,used:false};
    rawRecoveryStates.set(ticket,rawState);
    return {status:['failed','partial','paused','needs_review'].includes(actual.result.status)?'partial':actual.result.status==='empty'?'empty':'completed',execution_stopped:true,result:actual.result,skill_receipt:receipt,commander_status:actual.commander_status,raw_continuation:ticket};
   }
   dispatched=true;receipt=(await rpc({kind:'activity_skill',request},{timeoutMs:Math.max(1,rpcDeadline-Date.now())})).result;
   // Revoke the capability synchronously before any await can admit a late
   // authorized call. A live request includes its Commander/log/reply tail.
   const sealed=broker.seal();
   signal?.removeEventListener('abort',abort);clearInterval(heartbeat);clearInterval(stall);
   writeFileSync(join(directory,'broker-seal.json'),JSON.stringify(sealed),{flag:'wx',mode:0o600});
   writeFileSync(join(directory,'agent-receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});
   broker.confirmAbortStopped(receipt);
   await heartbeatJob;await stallJob;await abortJob;
   let actual=broker.getResult();
   stopped=sealed.sealed===true&&sealed.pending===0&&sealed.active===0&&!sealed.execution_unknown
    &&officialStopped(receipt)&&receipt.source_commit===request.source_commit&&!nativeUnknown(actual);
   const resourceFailure=heartbeatError?{resource_unverified:true,resource_unknown_reasons:['heartbeat_unverified']}:{};
   if(!stopped)return {status:'failed',execution_stopped:false,reason:'Skill、原生操作或业务提交结果未知',...uncertainty(actual,receipt,request),...resourceFailure,commander_status:actual.commander_status,skill_receipt:receipt};
   if(heartbeatError)return {status:'failed',execution_stopped:true,reason:'Skill执行期间资源续期未验证',...uncertainty(actual,receipt,request),...resourceFailure,commander_status:actual.commander_status,skill_receipt:receipt};
   await tools.settle({execution_stopped:true,receipt});
   actual=broker.getResult();
   if(nativeUnknown(actual)){stopped=false;return {status:'failed',execution_stopped:false,reason:'Skill封闭原生操作终止未知',...uncertainty(actual,receipt,request),skill_receipt:receipt};}
   if(activity.key==='cleanup')await tools.release({execution_stopped:true,receipt});
   actual=broker.getResult();
   if(nativeUnknown(actual)){stopped=false;return {status:'failed',execution_stopped:false,reason:'Skill收尾原生操作终止未知',...uncertainty(actual,receipt,request),skill_receipt:receipt};}
   if(actual.commander_aborted)return {status:'failed',execution_stopped:true,reason:'Commander请求中止，等待复核',commander_status:actual.commander_status,skill_receipt:receipt};
   if(receipt.status!=='ok'||!object(actual.result))return {status:'partial',execution_stopped:true,reason:'Skill未交付当前Activity持久工具结果',commander_status:actual.commander_status,skill_receipt:receipt};
   return {status:['failed','partial','paused','needs_review'].includes(actual.result.status)?'partial':actual.result.status==='empty'?'empty':'completed',
    execution_stopped:true,result:actual.result,commander_status:actual.commander_status,skill_receipt:receipt};
  }catch(error){
   caughtError=error;
   const sealed=broker?.seal();
   if(!transport&&broker&&dispatched&&!stopped){
    // A child-only stop acknowledgement never proves that its parent returned.
    error.executionStopped=false;
    const stopReceipt=await stop('execution_failed');
    try{writeFileSync(join(directory,'failure-stop-receipt.json'),JSON.stringify({sealed,receipt:stopReceipt}),{flag:'wx',mode:0o600});}
    catch{error.stopRecordingFailure=true;}
   }else error.executionStopped=stopped&&error.executionStopped!==false;
   throw error;
  }
  finally{
   signal?.removeEventListener('abort',abort);clearInterval(heartbeat);clearInterval(stall);await heartbeatJob;await stallJob;await abortJob;
   if(broker)await broker.close();
   if(rawControl){try{rawControl.seal(request);await rawControl.close();rawControlKnown=rawControl.verifySealedExecution(rawControl.snapshot(),{request})===true;}catch{rawControlKnown=false;}}
   if(typeof tools.closeNativeScope==='function'){
    try{
     let proof=transport?{execution_stopped:rawControlKnown&&rawModelScopeStopped(rawProof,scope),raw_model_proof:rawProof}:{execution_stopped:officialStopped(receipt)&&receipt?.source_commit===scope.source_commit,receipt};
     if(!dispatched&&(!transport||!rawControl||rawControlKnown)){proof=Object.freeze({agent_not_launched:true});notLaunched.set(proof,canonical(scope));}
     else if(!transport&&frozen.primary_host==='official-child-v1'&&broker&&officialStopped(receipt)&&receipt.source_commit===scope.source_commit
      &&!nativeUnknown(broker.getResult())&&caughtError?.executionStopped!==false&&caughtError?.externalEffect!=='unknown'){
      proof=Object.freeze({execution_stopped:true});officialStoppedScopes.set(proof,{scope:canonical(scope),nonce:request.nonce,child_run_id:receipt.child_run_id});
     }
     const closed=await tools.closeNativeScope(proof);if(closed?.execution_stopped!==true)throw Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED');if(caughtError&&!dispatched)caughtError.executionStopped=true;if(rawState&&rawControlKnown)rawState.ready=true;
    }
    catch{
     if(caughtError)caughtError.executionStopped=false;
     // Preserve an already-failed official-child unknown receipt, including its
     // business readback evidence. This never certifies physical closure.
     else if(transport||frozen.primary_host!=='official-child-v1'||!dispatched||stopped)throw Object.assign(Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED'),{executionStopped:false});
    }
   }
  }
 };
 execute.recoverAfterCheck=async(activity,{failureProof,guidance=[],signal,onEvent=async()=>({action:'none'})}={})=>{
  const certified=failedRawChecks.get(failureProof),state=certified?.state;
  if(!state||!state.ready||state.used||state.request.activity_key!==activity.key||state.usedCount>=state.request.max_turns||Date.now()>=state.request.worker_deadline_ms
    ||state.control.verifySealedExecution(state.snapshot,{request:state.request})!==true||typeof state.control.createReadOnlyContinuation!=='function')throw noLaunch('RAW_READONLY_RECOVERY_UNAVAILABLE');
  state.used=true;failedRawChecks.delete(failureProof);
  const directory=join(state.directory,'code-check-recovery');mkdirSync(directory,{mode:0o700});
  writeFileSync(join(directory,'judge-failure.json'),JSON.stringify({verification:certified.verification,guidance,original_turns:state.usedCount}),{flag:'wx',mode:0o600});
  const control=await state.control.createReadOnlyContinuation({request:state.request,snapshot:state.snapshot,startIndex:state.usedCount});
  const request={...state.request,broker_request_path:join(directory,'broker-request.json')};let broker;
  try{
   broker=await startPrimaryActivityBroker({directory,request,inspect:async()=>({read_only_recovery:true,failed_check:structuredClone(certified.verification),commander_guidance:guidance,previous_result:structuredClone(state.result),phone_capabilities:[],business_capabilities:[],pending_write_readbacks:[]}),
    phone:async()=>{throw Error('RAW_RECOVERY_READ_ONLY');},business:async()=>{throw Error('RAW_RECOVERY_READ_ONLY');},getActivityResult:()=>structuredClone(state.result),
    authorizeParentContext:async()=>await control.authorizeParentContext(state.request)===true,authorize:async(_q,delivery)=>delivery.op==='inspect'&&await control.authorizeBrokerDelivery(state.request,delivery)===true,onEvent,
    onAbort:async()=>{try{const value=await control.request({kind:'official_agent_stop',request:state.request,turn_index:state.usedCount});return {execution_stopped:!!control.verifyStopReceipt(value,{request:state.request,index:state.usedCount})};}catch{return {execution_stopped:false};}}});
   const raw=await runActivitySkillParentLoop({request:state.request,brokerRequest:request,scope:state.scope,broker,control,signal,beforeTurn:beforeRawTurn,startIndex:state.usedCount,readOnlyContinuation:true});
   const stopped=rawModelScopeStopped(raw.model_stop_proof,state.scope)&&control.verifySealedExecution(control.snapshot(),{request:state.request})===true;
   return {status:'partial',execution_stopped:stopped,result:structuredClone(state.result),recovery_read_only:true,reason:stopped?'一次只读恢复已结束，仍由Code第二次检查':'只读恢复终态未知',skill_receipt:{execution_transport:'raw-model-v1',turn_count:raw.turn_count,total_turn_count:state.usedCount+raw.turn_count,reason:raw.reason}};
  }finally{if(broker)await broker.close();control.seal(state.request);await control.close();}
 };
 execute.prepareObserverRequest=(activity,{deadline_ms,context}={})=>{
  if(!assertExecutionTransport(frozen,env))throw noLaunch('RAW_OBSERVER_TRANSPORT_REQUIRED');
  return structuredClone(plan(activity,{context,runnerDeadline:deadline_ms}).request);
 };
 return execute;
}
