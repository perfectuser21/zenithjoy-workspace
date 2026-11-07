// Observer transport is constructed before bridge.wake; it never owns worker tools.
import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createOfficialAgentControlFactory} from './official-agent-control.mjs';import {createOfficialCommanderExecute} from './official-commander-sdk.mjs';
import {createBoundedCommanderOwner} from './commander-bounded-owner.mjs';import {openClawCommander} from './activity-commander.mjs';import {canonical} from './runtime-definition.mjs';
import {workflowCommanderSession} from './commander-owner-state.mjs';
import * as nativePhoneDomain from './native-phone-runtime.mjs';
const fail=()=>Error('RUNNER_OFFICIAL_COMMANDER_UNAVAILABLE');
const preparations=new WeakMap(),closures=new WeakMap();
const identity=value=>canonical(['run_id','task_id','binding_id','source_commit','workflow_key'].map(key=>value?.[key]??null));
export const runnerCommanderClosureKnown=(value,scope)=>closures.get(value)===identity(scope);
export function runnerCommanderPreparation(error,scope){const facts=preparations.get(error);return facts?.identity===identity(scope)?{unavailable:facts.unavailable,closed:facts.closed}:null;}

export async function createRunnerOfficialCommander({runtimeRoot,runDir,source,request,factories={},directoryName='commander-raw'}={}){
 const q=structuredClone(request);
 if(q?.execution_transport!=='raw-model-v1'||q.mode!=='execute'||q.source_commit!==source?.commit||!Number.isSafeInteger(q.worker_deadline_ms)||q.worker_deadline_ms>=q.receipt_deadline_ms||q.receipt_deadline_ms>=q.deadline_ms)throw fail();
 const path='config/collection-phone-hosts.json',bindings=source.files.filter(item=>item.path===path),bytes=readFileSync(join(runtimeRoot,path));
 if(bindings.length!==1||createHash('sha256').update(bytes).digest('hex')!==bindings[0].sha256)throw fail();
 const pins=JSON.parse(bytes).hosts.filter(row=>row.target===q.broker_host).map(row=>row.executables?.python);
 if(!pins.length||pins.some(pin=>!pin||canonical(pin)!==canonical(pins[0])))throw fail();
 if(!['commander-raw','commander-scoring','commander-mark_leads','commander-preflight','commander-collect_videos','commander-cleanup','commander-dedup','commander-qualification','commander-collection'].includes(directoryName))throw fail();
 const directory=join(runDir,directoryName);mkdirSync(directory,{mode:0o700});
 const callerDirectory=join(directory,'caller'),sdkDirectory=join(directory,'sdk');mkdirSync(callerDirectory,{mode:0o700});mkdirSync(sdkDirectory,{mode:0o700});
 const scope={run_id:q.run_id,task_id:q.task_id,binding_id:q.binding_id,source_commit:q.source_commit,activity:q.activity_key};
 const control=await (factories.createControl||createOfficialAgentControlFactory({runtimeRoot,source}))({request:q,scope,directory:callerDirectory});
 let sdk,owner,closing,queue=Promise.resolve();const jobs=new Set();
 const drainError=code=>Object.assign(Error(code),{code});
 const waitJobs=async({deadlineMs=q.worker_deadline_ms,signal,onDrained}={})=>{
  const deadline=Math.min(q.worker_deadline_ms,deadlineMs);
  if(!Number.isSafeInteger(deadline))throw drainError('RUNNER_OBSERVER_DRAIN_DEADLINE');
  while(jobs.size){
   onDrained?.();
   if(signal?.aborted)throw drainError('RUNNER_OBSERVER_DRAIN_ABORTED');
   if(Date.now()>=deadline)throw drainError('RUNNER_OBSERVER_DRAIN_DEADLINE');
   let timer,abort;
   try{await Promise.race([Promise.allSettled([...jobs].map(job=>job.done)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(drainError('RUNNER_OBSERVER_DRAIN_DEADLINE')),Math.max(1,deadline-Date.now()));abort=()=>reject(drainError('RUNNER_OBSERVER_DRAIN_ABORTED'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  if(signal?.aborted)throw drainError('RUNNER_OBSERVER_DRAIN_ABORTED');
  if(Date.now()>=deadline)throw drainError('RUNNER_OBSERVER_DRAIN_DEADLINE');
 };
 const close=()=>closing??=(async()=>{
  let sdkFacts=null,controlFacts=null,ownerFacts=null,failed=false;
  try{sdk?.seal();sdkFacts=sdk?await sdk.close():null;}catch{failed=true;}
  try{control.seal(q);await control.close();controlFacts=control.snapshot();}catch{failed=true;}
  try{ownerFacts=owner?await owner.close():null;}catch{failed=true;}
  // Queued calls are revoked by closing; their complete reservation tails
  // remain owned until returned. Never infer closure merely from SDK idle.
  if(jobs.size){let timer;try{const returned=await Promise.race([Promise.allSettled([...jobs].map(job=>job.done)).then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),Math.max(0,q.deadline_ms-Date.now()));})]);if(!returned)failed=true;}finally{clearTimeout(timer);}}
  let known=false;try{known=!failed&&(!sdk||sdk.verifySealedExecution(sdkFacts)===true)&&control.verifySealedExecution(controlFacts,{request:q})===true&&(!owner||ownerFacts?.execution_stopped===true&&ownerFacts.execution_unknown!==true);}catch{known=false;}
  const facts=Object.freeze({domain:'runner-official-observer/v1',execution_stopped:known,execution_unknown:!known,sdk:sdkFacts,control:controlFacts,owner:ownerFacts});if(known)closures.set(facts,identity(q));return facts;
 })();
 const dispatchSafety=()=>{try{const values=[sdk,control,owner].map(domain=>domain.snapshot()),pending=values.reduce((sum,value)=>sum+value.pending,0)+jobs.size,unknown=values.some(value=>value.execution_unknown===true);return {safe:!closing&&!unknown&&pending===0,pending,execution_unknown:unknown};}catch{return {safe:false,pending:null,execution_unknown:true};}};
 try{
  if(await control.authorizeParentContext(q)!==true)throw fail();
  sdk=(factories.createSdk||createOfficialCommanderExecute)({control,request:q,source,runtimeRoot,directory:sdkDirectory});
  owner=(factories.createOwner||createBoundedCommanderOwner)({runtimeRoot,source,python:structuredClone(pins[0]),deadlineMs:q.worker_deadline_ms,cleanupDeadlineMs:q.deadline_ms});
  return Object.freeze({commander:receipt=>{
   let fixedReceipt;try{fixedReceipt=structuredClone(receipt);}catch{return Promise.reject(fail());}
   // Register synchronously, including queued work, before any caller can
   // sample readiness. All calls share the same owner/SDK execution lane.
   const job={};jobs.add(job);
   const running=queue.then(async()=>{
   if(closing)throw fail();
   for(const key of ['run_id','task_id','binding_id','source_commit','workflow_key'])if(q[key]!=null&&fixedReceipt[key]!==q[key])throw fail();
   if(fixedReceipt.commander_role!=='observer')throw fail();
   // Do not launch a queued turn after the preceding owned operation tainted
   // any domain. The current queue job itself is not domain execution.
   if([sdk,control,owner].some(domain=>domain.snapshot?.().execution_unknown===true))throw drainError('RUNNER_OBSERVER_EXECUTION_UNKNOWN');
   const timeoutMs=Math.min(60000,Math.floor((q.worker_deadline_ms-Date.now())/1000)*1000);
   if(timeoutMs<1000)throw fail();
   // Owner calibration and its fresh check consume this same AV window. Only
   // tighten our own generated command immediately before the SDK's unchanged
   // scope/deadline checks; foreign commands still reach those checks intact.
   const execute=(command,args,options)=>{
    let params;try{params=JSON.parse(args?.[8]);}catch{return sdk.execute(command,args,options);}
    if(command!=='openclaw'||!Array.isArray(args)||args.length!==9||canonical(args.slice(0,6))!==canonical(['gateway','call','agent','--expect-final','--json','--timeout'])||args[7]!=='--params'||!params||Object.keys(params).sort().join(',')!=='agentId,idempotencyKey,message,modelRun,sessionKey,thinking,timeout'||params.agentId!=='work-commander'||params.sessionKey!==workflowCommanderSession({...q,commander_role:'observer'})||params.thinking!=='low'||params.modelRun!==true||typeof params.message!=='string'||Buffer.byteLength(params.message)>1024*1024||!/^[-a-f0-9]{36}$/.test(params.idempotencyKey||'')||params.timeout!==timeoutMs/1000||args[6]!==String(timeoutMs+5000)||canonical(options)!==canonical({timeout:timeoutMs+5000,maxBuffer:1024*1024}))return sdk.execute(command,args,options);
    const seconds=Math.min(params.timeout,Math.floor((q.worker_deadline_ms-Date.now())/1000));
    if(seconds<1)throw fail();
    const bounded=[...args];bounded[6]=String(seconds*1000+5000);bounded[8]=JSON.stringify({...params,timeout:seconds});
    return sdk.execute(command,bounded,{timeout:seconds*1000+5000,maxBuffer:1024*1024});
   };
   return openClawCommander({timeoutMs,execute,reserveOwner:owner.reserveOwner})(fixedReceipt);
   });job.done=running.finally(()=>jobs.delete(job));queue=job.done.catch(()=>{});return job.done;
  },waitForIdle:async options=>{await waitJobs(options);return dispatchSafety().safe;},dispatchSafety,canDispatchWorker:()=>dispatchSafety().safe,close});
 }catch(cause){const closed=await close();const error=fail();const unavailable=cause?.code==='OFFICIAL_CONTROL_READ';if(!unavailable)error.code='RUNNER_OFFICIAL_COMMANDER_AUTHORITY_INVALID';preparations.set(error,{identity:identity(q),closed:runnerCommanderClosureKnown(closed,q),unavailable});throw error;}
}


// Ordinary 103 uses one workflow session and one outer Commander bridge budget.
// Each AV nevertheless gets its own immutable request, Caller, SDK and bounded owner domain.
async function createRunnerActivityCommander({runtimeRoot,runDir,source,activities,prepareRequest,workflowDeadlineMs,createObserver=createRunnerOfficialCommander,nativePhoneRuntime}={},policy){
 const deny=()=>Object.assign(Error(policy.error),{executionStopped:false});
 if(activities?.map(a=>a.key).join(',')!==policy.keys.join(',')||typeof prepareRequest!=='function'||!Number.isSafeInteger(workflowDeadlineMs)||Date.now()>=workflowDeadlineMs)throw deny();
 const fixedActivities=structuredClone(activities),entries=[],jobs=new Set();let current,closing,invalid=false,transition=Promise.resolve();
 const prepare=(activity,input)=>policy.phone?structuredClone(prepareRequest(activity,input)):prepareRequest(activity,input);
 const first=prepare(fixedActivities[0]),fixedIdentity=identity(first);
 if(!policy.accept(first))throw deny();
 const metadataKeys=['profile','serial','broker_host','workflow_definition_version_id','release_id','observation_id','runtime_snapshot_sha256','line','run_tag'];
 const metadata=q=>canonical(metadataKeys.map(key=>q?.[key]??null)),fixedMetadata=metadata(first);
 const active=()=>{if(closing||invalid||Date.now()>=workflowDeadlineMs)throw deny();};
 async function allocate(activity,request){active();if(identity(request)!==fixedIdentity||policy.phone&&metadata(request)!==fixedMetadata||request.activity_key!==activity.key||request.deadline_ms>workflowDeadlineMs)throw deny();let observer;try{observer=await createObserver({runtimeRoot,runDir,source,request,directoryName:'commander-'+activity.key});}catch(error){invalid=true;throw error;}const entry={activity:activity.key,request,observer,closed:false};entries.push(entry);current=entry;return entry;}
 // Before wake there is a real AV-authorized observer, never an unavailable placeholder.
 await allocate(fixedActivities[0],first);
 function selectActivity(activity,input={}){
  const selected=fixedActivities.find(a=>a.key===activity?.key);if(!selected||policy.phone&&Object.keys(activity).some(key=>key!=='key'&&canonical(activity[key])!==canonical(selected[key])))return Promise.reject(deny());
  const next=transition.then(async()=>{active();if(current.activity===selected.key)return;
   const adjacent=policy.keys.indexOf(selected.key)===policy.keys.indexOf(current.activity)+1;
   const cleanupTransition=policy.phone&&selected.key==='cleanup'&&!adjacent;
   if(entries.some(e=>e.activity===selected.key)||!adjacent&&(!cleanupTransition||nativePhoneDomain.isNativePhoneRuntime(nativePhoneRuntime)!==true))throw deny();
   const previous=current;if(await previous.observer.waitForIdle({deadlineMs:Math.min(previous.request.worker_deadline_ms,input.deadline_ms??Infinity),signal:input.signal})!==true)throw deny();
   const proof=await previous.observer.close();previous.closed=true;previous.proof=proof;if(!runnerCommanderClosureKnown(proof,first)){invalid=true;throw deny();}
   active();try{const request=prepare(selected,input);
    if(cleanupTransition&&(typeof nativePhoneDomain.authorizeNativePhoneCleanupTransition!=='function'||await nativePhoneDomain.authorizeNativePhoneCleanupTransition(nativePhoneRuntime,{request})!==true))throw deny();
    return await allocate(selected,request);
   }catch(error){if(cleanupTransition){invalid=true;throw deny();}throw error;}
  });transition=next.catch(()=>{});return next;
 }
 function dispatchSafety(){const f=current?.observer.dispatchSafety?.();return{safe:!closing&&!invalid&&jobs.size===0&&f?.safe===true,pending:jobs.size+(f?.pending??0),execution_unknown:invalid||f?.execution_unknown===true};}
 async function waitForIdle(options={}){await transition;const deadline=Math.min(workflowDeadlineMs,options.deadlineMs??workflowDeadlineMs);let timer,abort;try{await Promise.race([Promise.allSettled([...jobs].map(j=>j.done)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(deny()),Math.max(0,deadline-Date.now()));abort=()=>reject(deny());options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();})]);}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}if(Date.now()>=deadline||options.signal?.aborted)throw deny();if(await current.observer.waitForIdle({...options,deadlineMs:deadline})!==true)return false;return dispatchSafety().safe;}
 const commander=receipt=>{const fixed=structuredClone(receipt),job={};jobs.add(job);const running=(async()=>{active();if(identity(fixed)!==fixedIdentity||policy.phone&&metadataKeys.some(key=>Object.hasOwn(fixed,key)&&canonical(fixed[key])!==canonical(first[key])))throw deny();if(fixed.activity!=null)await selectActivity({key:fixed.activity});else if(!['wake','sleep'].includes(fixed.phase))throw deny();const entry=current,decision=await entry.observer.commander(fixed);if(entry!==current)throw deny();return decision;})();job.done=running.finally(()=>jobs.delete(job));return job.done;};
 const close=()=>closing??=(async()=>{let known=!invalid,timer;try{const returned=await Promise.race([Promise.allSettled([...jobs].map(j=>j.done)).then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),Math.max(0,workflowDeadlineMs-Date.now()));})]);if(!returned)known=false;}finally{clearTimeout(timer);}await transition;for(const entry of entries){if(!entry.closed)try{entry.proof=await entry.observer.close();entry.closed=true;}catch{known=false;}if(!runnerCommanderClosureKnown(entry.proof,first))known=false;}const facts=Object.freeze({domain:policy.domain,execution_stopped:known,execution_unknown:!known,activities:entries.map(e=>({activity:e.activity,evidence:e.proof}))});if(known)closures.set(facts,fixedIdentity);return facts;})();
 return Object.freeze({commander,selectActivity,waitForIdle,dispatchSafety,canDispatchWorker:()=>dispatchSafety().safe,close});
}

// Both adapters retain the same private Caller/SDK closure verifier and one
// outer bridge session/budget. The observer cannot authorize a business route.
export function createRunnerScoringCommander(options){
 return createRunnerActivityCommander(options,{keys:['scoring','mark_leads'],error:'SCORING_OBSERVER_SCOPE_UNVERIFIED',domain:'runner-scoring-observer/v1',accept:q=>q.workflow_key==='douyin_comment_scoring'&&(q.profile===undefined||q.profile==='mmv-scoring')&&(q.serial===undefined||q.serial==='none')});
}
export function createRunnerPhoneCommander(options){
 const keys=options?.activities?.map(a=>a.key).join(',');
 const workflow=keys==='preflight,collect_videos,cleanup'?'douyin_video_discovery':keys==='preflight,dedup,qualification,collection,cleanup'?'douyin_video_processing':null;
 if(!workflow)return Promise.reject(Object.assign(Error('PHONE_OBSERVER_SCOPE_UNVERIFIED'),{executionStopped:false}));
 return createRunnerActivityCommander(options,{keys:keys.split(','),phone:true,error:'PHONE_OBSERVER_SCOPE_UNVERIFIED',domain:'runner-phone-observer/v1',accept:q=>workflow!==null&&q.workflow_key===workflow&&typeof q.profile==='string'&&q.profile.length>0&&q.profile!=='none'&&typeof q.serial==='string'&&q.serial.length>0&&q.serial!=='none'});
}
