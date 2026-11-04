// 业务适配只转换输入、结果和读回；执行顺序、恢复次数与路由来自同一公共Runner。
import {runActivityContract} from './common-runner/activity-runtime.js';
import {createCommanderBridge} from './common-runner/runner-commander-bridge.js';
import {collectionEvidenceProof,collectionReturnedEvidence,collectionCleanupEvidence} from './collection-phone-scope.mjs';
import {discoveryCleanupEvidence,discoveryFiniteStopEvidence} from './discovery-phone-scope.mjs';

const safeError=error=>String(error?.message||error).replace(/Bearer\s+[^\s"']+/gi,'Bearer ***').replace(/(?:api[_-]?key|token|password)\s*[=:]\s*[^\s"']+/gi,'凭据=***').slice(0,400);
const captureFailure=evidence=>/\b(?:RECORD_AUDIO_STRATEGY_UNSUPPORTED|RECORD_AUDIO_CAPTURE_UNAVAILABLE|RECORD_AUDIO_TRACK_UNVERIFIED|RECORD_CAPTURE_STRATEGY_UNVERIFIED|RECORD_CAPTURE_SILENT|RECORD_AUDIO_DECODE_UNVERIFIED)\b/.test(JSON.stringify(evidence));
const statusOf=value=>value===undefined||value==='completed'||value==='done'?'completed':value==='empty'?'empty':value==='retry'?'retry':value==='skipped'?'skipped':['partial','paused'].includes(value)?'partial':value==='failed'?'failed':'needs_review';
const defaults={done:'next',retry:'retry',failed:'stop',empty:'next',partial:'stop',needs_review:'pause'};

export async function runWorkflow({activities,context={},handlers={},executeAgent,commander,record=async()=>{},verify,recover,quarantine,signal,terminationUnverified=()=>false}){
 const agentPrimary=context.execution_mode==='agent';
 const primaryError=context.execution_mode!==undefined&&!['code','agent'].includes(context.execution_mode)?'AGENT_EXECUTION_MODE_INVALID'
  :agentPrimary&&!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(context.workflow_key)?'AGENT_PRIMARY_WORKFLOW_UNSUPPORTED'
  :agentPrimary&&typeof executeAgent!=='function'?'AGENT_PRIMARY_EXECUTOR_UNAVAILABLE'
  :agentPrimary&&typeof verify!=='function'?'AGENT_INDEPENDENT_VERIFY_UNAVAILABLE':null;
 const routes=context.workflow_routes||(context.require_routing?{needs_review:'pause'}:defaults);
 const routingMissing=context.require_routing&&!Object.keys(defaults).every(k=>typeof routes[k]==='string');
 const run_tag=context.run_id||'leadgen-run',byKey=new Map(activities.map(a=>[a.key,a]));
 const native=new Map(),commanderStatuses=new Map();let unsafe=false,resourceUnsafe=false,lastEvidence;
 const scope=key=>({run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:key});
 const returned=(key,evidence)=>discoveryCleanupEvidence(evidence,scope(key))||collectionCleanupEvidence(evidence,scope(key));
 const progress=key=>({completed_activity_keys:[...native].filter(([,e])=>['completed','skipped'].includes(e.status)).map(([k])=>k),remaining_activity_keys:activities.slice(activities.findIndex(a=>a.key===key)+1).map(a=>a.key)});
 const bridge=createCommanderBridge({run_id:run_tag,brief:context.brief||{purpose:context.workflow_key},rules:context.rules||[],budget:context.commander_budget||{},skill:context.commander_skill,
  transport:typeof commander==='function'?async request=>{
   const activity=byKey.get(request.activity),brief=activity?{purpose:activity.promise||activity.name||activity.key,done_criteria:activity.postconditions||[],boundaries:{preconditions:activity.preconditions||[],resources:activity.resources||[],budget:activity.budget,idempotency:activity.idempotency,failure:activity.failure,side_effects:activity.side_effects||[]}}:request.brief;
   const observation=structuredClone({...context,...request,activity:request.activity,phase:request.phase,evidence:request.event,workflow_progress:request.activity?progress(request.activity):undefined,brief,rules:[...(request.rules||[]),...(activity?[{activity:activity.key,version:activity.version,preconditions:activity.preconditions||[],idempotency:activity.idempotency,side_effects:activity.side_effects||[]}]:[])],...(activity?{activity_contract:activity}:{}),commander_role:'observer'});
   await record({...context,activity:request.activity,phase:'commander_context',request:structuredClone(observation)});return commander(observation);
  }:undefined,
  onEvent:async e=>{if(e.activity&&['COMMANDER_EXCHANGE','COMMANDER_UNAVAILABLE'].includes(e.event_type))commanderStatuses.set(e.activity,e.event_type==='COMMANDER_UNAVAILABLE'?'unavailable':'available');return record({...context,...e,commander_phase:e.phase,phase:e.event_type==='COMMANDER_EXCHANGE'?'commander_exchange':e.event_type==='COMMANDER_UNAVAILABLE'?'commander_unavailable':'commander_event',commander_status:e.event_type==='COMMANDER_UNAVAILABLE'?'unavailable':bridge.status});}});
 function standard(activity,evidence){
  if(agentPrimary&&evidence.resource_unverified===true)resourceUnsafe=true;
  if(evidence.result?.external_effect==='unknown')evidence.external_effect='unknown';
  native.set(activity.key,evidence);lastEvidence={key:activity.key,evidence};
  const phoneProof=collectionEvidenceProof(evidence,scope(activity.key)),cleanupProof=discoveryCleanupEvidence(evidence,scope(activity.key))||collectionCleanupEvidence(evidence,scope(activity.key));
  const unknown=!phoneProof&&!cleanupProof&&(evidence.execution_stopped===false||evidence.result?.execution_stopped===false||(evidence.execution_stopped!==true&&/\b(?:EXECUTION_OUTPUT_LIMIT|EXECUTION_DEADLINE|RECORD_CAPTURE_EXIT_UNVERIFIED)\b/.test(JSON.stringify(evidence))));
  if(unknown){unsafe=true;evidence.execution_stopped=false;}
  return {schema_version:1,run_tag,status:evidence.status==='skipped'?'completed':evidence.status,outputs:{},metrics:{},evidence:[],adapter_result:evidence,
   ...(unknown?{execution_stopped:false}:{}),...(evidence.external_effect==='unknown'?{external_effect:'unknown'}:{}),
   ...(['completed','skipped','empty'].includes(evidence.status)?{}:{failure_class:evidence.status==='needs_review'?'needs_human':evidence.status==='retry'?'retryable':'fatal'})};
 }
 const executeActivity=async(a,input,opts)=>{
  const activity=byKey.get(a.key);let evidence;
  try{
   if(primaryError)throw Error(primaryError);
   if(agentPrimary){
    const result=await executeAgent(activity,{context,guidance:input.commander_guidance||[],signal:opts.signal,onEvent:opts.onAgentEvent});
    if(!result||typeof result.execution_stopped!=='boolean')throw Object.assign(Error('AGENT_PRIMARY_RECEIPT_INVALID'),{executionStopped:false});
    evidence={...result,status:statusOf(result.status),attempt:input.attempt};
   }else{
    if(typeof handlers[activity.key]!=='function')throw Error(`活动缺实现: ${activity.key}`);
    const result=await handlers[activity.key]({guidance:input.commander_guidance||[],signal:opts.signal,onEvent:opts.onAgentEvent});evidence={status:statusOf(result?.status),attempt:input.attempt,result};
   }
  }
  catch(error){evidence={status:'failed',attempt:input.attempt,error:safeError(error),...(error.activityResult?{result:error.activityResult}:{}),...(typeof error.executionStopped==='boolean'?{execution_stopped:error.executionStopped}:{}),...(error.externalEffect==='unknown'?{external_effect:'unknown'}:{}),...(error.operationId?{operation_id:error.operationId}:{})};}
  const result=standard(activity,evidence);
  await record({...context,activity:activity.key,phase:'execution',evidence:structuredClone(evidence)});
  return result;
 };
 const contract={workflow:context.workflow_key||'leadgen',on_status:routes,activities:activities.map((a,index)=>({key:a.key,order:index+1,budget:{max_duration_s:a.budget?.max_duration_s||3600,heartbeat_s:Math.min(a.budget?.heartbeat_s||30,a.budget?.max_duration_s||3600)},
  failure:{empty_ok:[],retryable:['code_retry'],fatal:['code_failed'],needs_human:{cases:['review']}},
  runtime:{protocol:'json-stdio-v1',phase:a.runtime?.phase==='finalize'||(context.always_run||['cleanup']).includes(a.key)?'finalize':'source',entry:'leadgen-runner-adapter.mjs',executor_kind:agentPrimary?'agent':a.executor_kind||a.execution?.primary_kind||'code',max_attempts:!agentPrimary&&a.retry_safe===true?2:1,retry_safe:!agentPrimary&&a.retry_safe===true,recovery_safe:!agentPrimary&&!!recover&&a.key!=='cleanup',on_status:a.on_status||a.runtime?.on_status||routes}}))};
 await bridge.wake();let receipt;
 try{
  receipt=await runActivityContract(contract,{run_tag},{signal,commander:bridge,executeActivity,
   checkActivity:async(a,result,{phase})=>{
    if(phase==='start')return {verdict:primaryError||routingMissing?'unknown':'pass',...(primaryError?{reason:primaryError}:routingMissing?{reason:'workflow_status_routes_missing'}:{})};
    const evidence=result.adapter_result,activity=byKey.get(a.key);
    if(result.execution_stopped===false)return {verdict:'unknown',reason:'execution_termination_unknown'};
    if(agentPrimary&&evidence.resource_unverified===true)return {verdict:'unknown',reason:'resource_lease_unverified'};
    if(agentPrimary){
     if(!['completed','empty','partial','skipped'].includes(evidence.status)||!evidence.result)return {verdict:'fail',reason:'agent_execution_failed'};
     evidence.verification=await verify(activity,evidence);
     await record({...context,activity:a.key,phase:'verification',evidence:structuredClone(evidence)});
     return {verdict:evidence.verification?.verified===true?'pass':'fail',verification:evidence.verification};
    }
    const partial=evidence.status==='partial'&&(a.key==='collection'&&evidence.result?.sampling_receipts?.length>0||a.key==='collect_videos'&&discoveryFiniteStopEvidence(evidence,scope(a.key)));
    if(evidence.status==='skipped'||evidence.status!=='completed'&&captureFailure(evidence)||evidence.status==='partial'&&!partial&&discoveryCleanupEvidence(evidence,scope(a.key)))return {verdict:'pass'};
    if(['failed','partial'].includes(evidence.status)&&recover&&!partial)return {verdict:'fail',reason:'code_execution_failed'};
    if(typeof verify!=='function'||evidence.status!=='completed'&&!partial)return {verdict:'pass'};
    evidence.verification=await verify(activity,evidence);
    await record({...context,activity:a.key,phase:'verification',evidence:structuredClone(evidence)});
    return {verdict:evidence.verification?.verified===true?'pass':'fail',verification:evidence.verification};
   },
   recoverActivity:!agentPrimary&&recover?async(a,input,{failure,guidance,...opts})=>{
    const activity=byKey.get(a.key);let original=failure.adapter_result||native.get(a.key);
    if(captureFailure(original)||discoveryCleanupEvidence(original,scope(a.key))||collectionCleanupEvidence(original,scope(a.key))&&!collectionReturnedEvidence(original,scope(a.key)))throw Object.assign(Error('SKILL_HANDOFF_POLICY_BLOCKED'),{executionStopped:true});
    if(original.verification?.verified===false)original={...original,status:'failed'};
    let candidate;try{candidate=await recover({activity,failure:original,context:{...context,workflow_progress:progress(a.key)},execute:()=>handlers[a.key](),guidance,recovery_mode:input.recovery_mode,runner_managed:true,signal:opts.signal,onAgentEvent:opts.onAgentEvent});}catch(error){if(error.executionStopped!==true){unsafe=true;error.executionStopped=false;}throw error;}
    if(original.external_effect==='unknown')candidate={...candidate,external_effect:'unknown'};
    if(!candidate||!['completed','failed','partial'].includes(candidate.status)||typeof candidate.execution_stopped!=='boolean')throw Error('SKILL_RECOVERY_RECEIPT_INVALID');
    candidate.code_failure=original;await record({...context,activity:a.key,phase:'skill_execution',evidence:structuredClone(candidate),code_failure:structuredClone(original)});
    return standard(activity,candidate);
   }:undefined,
   isExecutionUnknown:result=>result.execution_stopped===false,
   canFinalize:current=>{if(resourceUnsafe)return false;const failed=current.event_failures?.length||current.activities.some(a=>a.key!=='cleanup'&&!['completed','skipped'].includes(a.status));if(lastEvidence&&!returned(lastEvidence.key,lastEvidence.evidence)&&(current.execution_unknown||failed&&terminationUnverified()))unsafe=true;return !unsafe;},
   onEvent:async event=>record({...context,...event,event,phase:event.event_type==='ACTIVITY_STARTED'?'start':'runner_event'})
  });
 }finally{await bridge.sleep();}
 const results=activities.map(activity=>{
  const row=receipt.activities.find(r=>r.key===activity.key),attempt=row?.attempts?.at(-1),actual=attempt?.adapter_result||native.get(activity.key);
  if(!row||!actual)return {activity:activity.key,status:'blocked',reason:primaryError||(resourceUnsafe?'资源租约未验证，保留隔离':unsafe?'原执行终止未知，保留资源':'前序活动未通过'),...(resourceUnsafe?{resource_unverified:true}:{}),...(row?{checks:row.checks}:{} )};
  const status=row.status==='completed'&&actual.status==='skipped'?'skipped':row.status;
  return {activity:activity.key,...actual,status,attempts:row.attempts,checks:row.checks,...(attempt?.execution_stopped===false?{execution_stopped:false}:{}),...(attempt?.recovery&&attempt.reason_code?{skill_error:attempt.reason_code}:{}),commander_status:commanderStatuses.get(activity.key)||bridge.status,commander_interventions:row.commander_interventions||0,rescued:row.rescued===true,validator_verdict:row.validator_verdict?.verdict||'unknown',code_failures:row.code_failures||0,skill_rescues:row.skill_rescues||0,...(actual.code_failure?{code_failure:actual.code_failure}:row.attempts.length>1?{code_failure:row.attempts[0].adapter_result}:{})};
 });
 let resource_quarantine;
 if(unsafe||resourceUnsafe||receipt.execution_unknown){
  try{resource_quarantine=quarantine?await quarantine():{verified:false,reason:'persistent quarantine adapter unavailable'};}catch(error){resource_quarantine={verified:false,reason:safeError(error)};}
  await record({...context,phase:'resource_quarantine',evidence:resource_quarantine});
 }
 const finalStatus=unsafe||resourceUnsafe?(agentPrimary?'needs_review':'failed'):receipt.status==='failed'&&results.some(r=>r.status==='partial')?'partial':receipt.status;
 return {status:finalStatus,results,...(resourceUnsafe?{resource_unverified:true}:{}),...(resource_quarantine?{resource_quarantine}:{}),metrics:receipt.metrics};
}
export async function runActivity({activity,context,execute,...options}){
 const result=await runWorkflow({...options,activities:[activity],context,handlers:{[activity.key]:execute},recover:options.recover?({failure,guidance})=>options.recover(failure,guidance):undefined});
 return result.results[0];
}
