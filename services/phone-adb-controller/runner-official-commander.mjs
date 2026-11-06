// Observer transport is constructed before bridge.wake; it never owns worker tools.
import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createOfficialAgentControlFactory} from './official-agent-control.mjs';import {createOfficialCommanderExecute} from './official-commander-sdk.mjs';
import {createBoundedCommanderOwner} from './commander-bounded-owner.mjs';import {openClawCommander} from './activity-commander.mjs';import {canonical} from './runtime-definition.mjs';
const fail=()=>Error('RUNNER_OFFICIAL_COMMANDER_UNAVAILABLE');
const preparations=new WeakMap(),closures=new WeakMap();
const identity=value=>canonical(['run_id','task_id','binding_id','source_commit','workflow_key'].map(key=>value?.[key]??null));
export const runnerCommanderClosureKnown=(value,scope)=>closures.get(value)===identity(scope);
export function runnerCommanderPreparation(error,scope){const facts=preparations.get(error);return facts?.identity===identity(scope)?{unavailable:facts.unavailable,closed:facts.closed}:null;}

export async function createRunnerOfficialCommander({runtimeRoot,runDir,source,request,factories={}}={}){
 const q=structuredClone(request);
 if(q?.execution_transport!=='raw-model-v1'||q.mode!=='execute'||q.source_commit!==source?.commit||!Number.isSafeInteger(q.worker_deadline_ms)||q.worker_deadline_ms>=q.receipt_deadline_ms||q.receipt_deadline_ms>=q.deadline_ms)throw fail();
 const path='config/collection-phone-hosts.json',bindings=source.files.filter(item=>item.path===path),bytes=readFileSync(join(runtimeRoot,path));
 if(bindings.length!==1||createHash('sha256').update(bytes).digest('hex')!==bindings[0].sha256)throw fail();
 const pins=JSON.parse(bytes).hosts.filter(row=>row.target===q.broker_host).map(row=>row.executables?.python);
 if(!pins.length||pins.some(pin=>!pin||canonical(pin)!==canonical(pins[0])))throw fail();
 const directory=join(runDir,'commander-raw');mkdirSync(directory,{mode:0o700});
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
   return openClawCommander({timeoutMs,execute:sdk.execute,reserveOwner:owner.reserveOwner})(fixedReceipt);
   });job.done=running.finally(()=>jobs.delete(job));queue=job.done.catch(()=>{});return job.done;
  },waitForIdle:async options=>{await waitJobs(options);return dispatchSafety().safe;},dispatchSafety,canDispatchWorker:()=>dispatchSafety().safe,close});
 }catch(cause){const closed=await close();const error=fail();const unavailable=cause?.code==='OFFICIAL_CONTROL_READ';if(!unavailable)error.code='RUNNER_OFFICIAL_COMMANDER_AUTHORITY_INVALID';preparations.set(error,{identity:identity(q),closed:runnerCommanderClosureKnown(closed,q),unavailable});throw error;}
}
