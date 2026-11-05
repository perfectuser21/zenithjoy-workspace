// Primary Skill execution owns an independent capability; Code recovery remains separate.
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {frozenMethod} from './activity-skill-recovery.mjs';
import {assertExecutionMode,assertAgentInput,canonical} from './runtime-definition.mjs';
import {safeExecutionDiagnostic} from './leadgen-client.mjs';
import {startPrimaryActivityBroker} from './activity-skill-primary-broker.mjs';

const notLaunched=new WeakMap();
export const skillLaunchDidNotStart=(proof,scope)=>Boolean(proof&&scope&&notLaunched.get(proof)===canonical(scope));
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

export function createActivitySkillExecutor({runDir,frozen,binding,env,rpc,createTools,deadlineFor,supportsNativeScope=()=>false,nativeState=()=>({})}){
 if(assertExecutionMode(frozen,env)!=='agent')throw noLaunch('AGENT_PRIMARY_EXECUTION_MODE_REQUIRED');
 assertAgentInput(frozen,env);
 if(typeof createTools!=='function'||typeof rpc!=='function'||typeof deadlineFor!=='function')throw noLaunch('AGENT_PRIMARY_DEPENDENCY_UNAVAILABLE');
 return async(activity,{context={},guidance=[],signal,deadline_ms:runnerDeadline,onEvent=async()=>({action:'none'})}={})=>{
  if(assertExecutionMode(frozen,env)!=='agent')throw noLaunch('AGENT_PRIMARY_EXECUTION_MODE_REQUIRED');
  const fixed=assertAgentInput(frozen,env);
  const directory=join(runDir,'skill-primary',activity.key);
  if(existsSync(directory))throw Object.assign(Error('SKILL_PRIMARY_ALREADY_REQUESTED_TERMINATION_UNVERIFIED'),{executionStopped:false});
  const known=nativeState();if(known.native_stop_unproven===true||known.execution_unknown===true)return {status:'needs_review',not_started:true,execution_stopped:false,reason:'AGENT_PRIMARY_PREVIOUS_NATIVE_UNVERIFIED',resource_unverified:true};
  if(signal?.aborted)throw noLaunch('AGENT_PRIMARY_CANCELLED_BEFORE_START');
  const taskId=fixed.task_id;
  if(context.task_id!=null&&context.task_id!==taskId||binding.task_id!=null&&binding.task_id!==taskId||!uuid.test(taskId||'')||!uuid.test(binding.id||''))throw noLaunch('AGENT_PRIMARY_TASK_BINDING_REQUIRED');
  if(await supportsNativeScope(activity)!==true)return {status:'needs_review',not_started:true,execution_stopped:true,reason:'AGENT_PRIMARY_NATIVE_DOMAIN_UNSUPPORTED'};
  const method=frozenMethod(frozen,activity.key,runDir),outerDeadline=Math.min(deadlineFor(activity),runnerDeadline??Infinity);
  const available=Math.floor(outerDeadline-Date.now()),checkReserve=Math.min(10000,Math.floor(available/10)),stopReserve=Math.min(48000,Math.floor(available/5)),ownerReserve=Math.min(10000,Math.floor(available/10));
  if(!Number.isSafeInteger(outerDeadline)||available<100)throw noLaunch('AGENT_PRIMARY_DEADLINE_EXHAUSTED');
  const deadline=outerDeadline-checkReserve,receiptDeadline=deadline-stopReserve,workerDeadline=receiptDeadline-ownerReserve,rpcDeadline=deadline-Math.floor(stopReserve/2);
  const front=method.text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  const metadata=front?.match(/^metadata:\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1]||'';
  const declarations=[...metadata.matchAll(/^  primary_execution: *(\S+) *$/gm)];
  if((front?.match(/^metadata:$/gm)||[]).length!==1||declarations.length!==1||declarations[0][1]!=='agent-v1')throw noLaunch('AGENT_PRIMARY_METHOD_UNSUPPORTED');
  if(!Number.isSafeInteger(deadline)||deadline<=Date.now())throw noLaunch('AGENT_PRIMARY_DEADLINE_EXHAUSTED');
  const scope={workflow:fixed.workflow_key,activity:activity.key,run:fixed.run_tag,run_id:binding.run_id,task_id:taskId,
   binding_id:binding.id,source_commit:frozen.deployment.source_commit,snapshot_sha256:frozen.snapshot_sha256,
   profile:fixed.profile,serial:fixed.serial,line:fixed.line,source_run:fixed.source_run,
   limit:fixed.limit,comment_limit:fixed.comment_limit,discovery_filters:structuredClone(fixed.discovery_filters),collection_budget_s:fixed.collection_budget_s,
   run_start_ts:fixed.run_start_ts,run_max_seconds:fixed.run_max_seconds,deadline_ms:deadline,worker_deadline_ms:workerDeadline,receipt_deadline_ms:receiptDeadline};
  const tools=await createTools(activity,scope);
  if(!tools||['inspect','phone','business','getResult','prepare','settle'].some(key=>typeof tools[key]!=='function')
    ||activity.key==='cleanup'&&typeof tools.release!=='function')throw noLaunch('AGENT_PRIMARY_TOOLS_UNAVAILABLE');
  // This durable directory reserves one launch, including an ambiguous RPC result.
  mkdirSync(directory,{recursive:true,mode:0o700});
  let request={protocol:'leadgen-activity-v1',mode:'execute',run_id:binding.run_id,task_id:taskId,binding_id:binding.id,
   workflow_key:scope.workflow,run_tag:scope.run,profile:scope.profile,serial:scope.serial,line:scope.line,
   source_run:fixed.source_run,limit:fixed.limit,comment_limit:fixed.comment_limit,run_max_seconds:fixed.run_max_seconds,
   discovery_filters:structuredClone(fixed.discovery_filters),discovery_input:structuredClone(frozen.discovery_input||null),
   activity_key:activity.key,nonce:randomBytes(24).toString('hex'),deadline_ms:deadline,worker_deadline_ms:workerDeadline,receipt_deadline_ms:receiptDeadline,source_commit:scope.source_commit,
   workflow_definition_version_id:frozen.workflow_version.id,runtime_snapshot_sha256:frozen.snapshot_sha256,
   release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,method,broker_host:frozen.deployment.target,
   broker_request_path:join(directory,'broker-request.json'),broker_tool_path:join(runDir,'runtime','activity-skill-tool.mjs'),
   commander_guidance:Array.isArray(guidance)?guidance.filter(value=>typeof value==='string').map(value=>safeExecutionDiagnostic(value,env).slice(0,16000)).slice(0,4):[]};
  writeFileSync(join(directory,'launch-intent.json'),JSON.stringify({scope,request}),{flag:'wx',mode:0o600});
  let broker,receipt,caughtError,dispatched=false,stopped=false,lastProgress=Date.now(),heartbeatError=null;
  let heartbeat,stall,heartbeatJob=Promise.resolve(),stallJob=Promise.resolve(),abortJob=Promise.resolve(),heartbeatBusy=false,stallBusy=false;
  const stop=async reason=>{
   try{return (await rpc({kind:'activity_skill_stop',request,reason},{timeoutMs:Math.max(1,Math.min(48000,deadline-Date.now()))})).result;}
   catch{return {execution_stopped:false};}
  };
  const abort=()=>{abortJob=Promise.resolve(broker?.abort('runner_cancelled')).catch(()=>{});};
  try{
   const preparation=await tools.prepare();
   if(activity.key==='cleanup'&&preparation?.native_cleanup_not_required===true){
    const proof=Object.freeze({agent_not_launched:true,execution_stopped:true});notLaunched.set(proof,canonical(scope));
    if(typeof tools.closeNativeScope!=='function'||(await tools.closeNativeScope(proof))?.execution_stopped!==true)throw Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED');
    await tools.settle(proof);await tools.release(proof);const result=tools.getResult();
    if(result?.execution_stopped===false)throw Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED');
    return {status:'partial',not_started:true,execution_stopped:true,result,reason:'未持有本地设备资源，未启动清理Worker；原验收条件仍需复核'};
   }
   broker=await startPrimaryActivityBroker({directory,request,inspect:tools.inspect,phone:tools.phone,business:tools.business,
    isReadOnlyBusinessOperation:(operation,input)=>tools.canReadback?.(operation,input)===true,
    getActivityResult:tools.getResult,onEvent:async event=>{if(event.type==='progress')lastProgress=Date.now();return onEvent(event);},onAbort:stop,
    authorize:async()=>!heartbeatError&&(await rpc({kind:'activity_skill_authority',request},{timeoutMs:Math.max(1,Math.min(10000,deadline-Date.now()))})).authorized===true});
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
   if(broker&&!stopped){
    const sealed=broker.seal();
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
   if(typeof tools.closeNativeScope==='function'){
    let proof={execution_stopped:officialStopped(receipt)&&receipt?.source_commit===scope.source_commit,receipt};
    if(!dispatched){proof=Object.freeze({agent_not_launched:true});notLaunched.set(proof,canonical(scope));}
    try{const closed=await tools.closeNativeScope(proof);if(closed?.execution_stopped!==true)throw Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED');if(caughtError&&!dispatched)caughtError.executionStopped=true;}
    catch{if(caughtError)caughtError.executionStopped=false;else throw Object.assign(Error('AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED'),{executionStopped:false});}
   }
  }
 };
}
