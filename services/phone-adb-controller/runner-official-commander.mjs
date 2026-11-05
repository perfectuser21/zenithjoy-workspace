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
 let sdk,owner,closing;
 const close=()=>closing??=(async()=>{
  let sdkFacts=null,controlFacts=null,ownerFacts=null,failed=false;
  try{sdk?.seal();sdkFacts=sdk?await sdk.close():null;}catch{failed=true;}
  try{control.seal(q);await control.close();controlFacts=control.snapshot();}catch{failed=true;}
  try{ownerFacts=owner?await owner.close():null;}catch{failed=true;}
  let known=false;try{known=!failed&&(!sdk||sdk.verifySealedExecution(sdkFacts)===true)&&control.verifySealedExecution(controlFacts,{request:q})===true&&(!owner||ownerFacts?.execution_stopped===true&&ownerFacts.execution_unknown!==true);}catch{known=false;}
  const facts=Object.freeze({domain:'runner-official-observer/v1',execution_stopped:known,execution_unknown:!known,sdk:sdkFacts,control:controlFacts,owner:ownerFacts});if(known)closures.set(facts,identity(q));return facts;
 })();
 const dispatchSafety=()=>{try{const values=[sdk,control,owner].map(domain=>domain.snapshot()),pending=values.reduce((sum,value)=>sum+value.pending,0),unknown=values.some(value=>value.execution_unknown===true);return {safe:!closing&&!unknown&&pending===0,pending,execution_unknown:unknown};}catch{return {safe:false,pending:null,execution_unknown:true};}};
 try{
  if(await control.authorizeParentContext(q)!==true)throw fail();
  sdk=(factories.createSdk||createOfficialCommanderExecute)({control,request:q,source,runtimeRoot,directory:sdkDirectory});
  owner=(factories.createOwner||createBoundedCommanderOwner)({runtimeRoot,source,python:structuredClone(pins[0]),deadlineMs:q.worker_deadline_ms,cleanupDeadlineMs:q.deadline_ms});
  return Object.freeze({commander:async receipt=>{
   if(closing)throw fail();
   for(const key of ['run_id','task_id','binding_id','source_commit','workflow_key'])if(q[key]!=null&&receipt[key]!==q[key])throw fail();
   if(receipt.commander_role!=='observer')throw fail();
   const timeoutMs=Math.min(60000,Math.floor((q.worker_deadline_ms-Date.now())/1000)*1000);
   if(timeoutMs<1000)throw fail();
   return openClawCommander({timeoutMs,execute:sdk.execute,reserveOwner:owner.reserveOwner})(receipt);
  },dispatchSafety,canDispatchWorker:()=>dispatchSafety().safe,close});
 }catch(cause){const closed=await close();const error=fail();const unavailable=cause?.code==='OFFICIAL_CONTROL_READ';if(!unavailable)error.code='RUNNER_OFFICIAL_COMMANDER_AUTHORITY_INVALID';preparations.set(error,{identity:identity(q),closed:runnerCommanderClosureKnown(closed,q),unavailable});throw error;}
}
