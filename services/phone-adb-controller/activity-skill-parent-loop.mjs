// Restricted model intent loop. Official identities and permits come from the
// Code caller; activity results and verdicts never come from model text.
import {mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createActivitySkillBrokerClient} from './activity-skill-broker-client.mjs';
import {canonical,methodAllowsExecutionTransport} from './runtime-definition.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const stoppedModelScopes=new WeakMap();
export const rawModelScopeStopped=(proof,scope)=>Boolean(proof&&scope&&stoppedModelScopes.get(proof)===canonical(scope));
const boundScope=(scope,q)=>object(scope)&&scope.execution_transport==='raw-model-v1'&&scope.max_turns===q.max_turns&&scope.agent_nonce===q.nonce
 &&['task_id','binding_id','run_id','source_commit','deadline_ms','worker_deadline_ms','receipt_deadline_ms','profile','serial','line','source_run','limit','comment_limit'].every(key=>scope[key]===q[key])
 &&scope.run===q.run_tag&&scope.workflow===q.workflow_key&&scope.activity===q.activity_key&&scope.snapshot_sha256===q.runtime_snapshot_sha256
 &&canonical(scope.control_scope??null)===canonical(q.control_scope??null)&&canonical(scope.control_claim??null)===canonical(q.control_claim??null);
const immutable=value=>{
 if(object(value)||Array.isArray(value)){for(const item of Object.values(value))immutable(item);Object.freeze(value);}
 return value;
};
const code=error=>/^(?:SKILL_PRIMARY_|PARENT_BROKER_)[A-Z0-9_]+$/.test(error?.message||'')?error.message:'PARENT_LOOP_TOOL_FAILED';
const failureCodes=new Set(['PARENT_LOOP_ABORTED','PARENT_LOOP_DEADLINE','PARENT_LOOP_OBSERVER_UNVERIFIED','RUNNER_OBSERVER_DRAIN_DEADLINE','RUNNER_OBSERVER_DRAIN_ABORTED','RUNNER_OBSERVER_EXECUTION_UNKNOWN']);
const safeFailure=error=>failureCodes.has(error?.code)?error.code:failureCodes.has(error?.message)?error.message:'PARENT_LOOP_UNCLASSIFIED';
function intent(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('PARENT_LOOP_INTENT_INVALID');
 let value;try{value=JSON.parse(text);}catch{throw Error('PARENT_LOOP_INTENT_INVALID');}
 const keys={finish:['type'],inspect:['type','question','progress','error'],phone:['type','command','args'],business:['type','operation','input']};
 if(!object(value)||!Object.hasOwn(keys,value.type)||Object.keys(value).some(key=>!keys[value.type].includes(key)))throw Error('PARENT_LOOP_INTENT_INVALID');
 if(value.type==='phone'&&(typeof value.command!=='string'||!Array.isArray(value.args)||value.args.length>8||value.args.some(arg=>typeof arg!=='string'||arg.length>1000||/[\0\r\n]/.test(arg))))throw Error('PARENT_LOOP_INTENT_INVALID');
 if(value.type==='business'&&(typeof value.operation!=='string'||!object(value.input)))throw Error('PARENT_LOOP_INTENT_INVALID');
 if(value.type==='inspect'&&(Object.keys(value).length>2||Object.entries(value).some(([key,item])=>key!=='type'&&(typeof item!=='string'||item.length>16000))))throw Error('PARENT_LOOP_INTENT_INVALID');
 const {type,...body}=value;return {op:type,body};
}
function bounded(promise,deadline,signal){
 return new Promise((resolve,reject)=>{
  let timer,finished=false;
  const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>done(Error('PARENT_LOOP_ABORTED'));
  timer=setTimeout(()=>done(Error('PARENT_LOOP_DEADLINE')),Math.max(1,deadline-Date.now()));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  Promise.resolve(promise).then(value=>done(null,value),error=>done(error));
 });
}
export async function runActivitySkillParentLoop({request,scope,broker,control,signal,canReadback=()=>false,startIndex=0,readOnlyContinuation=false,brokerRequest,beforeTurn}={}){
 const q=immutable(JSON.parse(JSON.stringify(request??null)));
 if(q?.mode!=='execute'||q.execution_transport!=='raw-model-v1'||q.transport_generation!==undefined
  ||!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(q.workflow_key)
  ||!Number.isInteger(q.max_turns)||q.max_turns<1||q.max_turns>64
  ||!methodAllowsExecutionTransport(q.method?.text,q.execution_transport)
  ||!Number.isSafeInteger(q.worker_deadline_ms)||!Number.isSafeInteger(q.receipt_deadline_ms)||!Number.isSafeInteger(q.deadline_ms)
  ||q.worker_deadline_ms>=q.receipt_deadline_ms||q.receipt_deadline_ms>=q.deadline_ms)throw Error('PARENT_LOOP_REQUEST_INVALID');
 if(!broker||['readParentContext','isParentContextCurrent','getResult','seal'].some(key=>typeof broker[key]!=='function')
  ||!control||['request','verifyTurnReceipt','verifyStopReceipt','authorizeIntent','consumeIntentPermit','seal','close','snapshot','verifySealedExecution'].some(key=>typeof control[key]!=='function'))throw Error('PARENT_LOOP_DEPENDENCY_UNAVAILABLE');
 if(!Number.isSafeInteger(startIndex)||startIndex<0||startIndex>=q.max_turns||readOnlyContinuation!==false&&readOnlyContinuation!==true||startIndex!==0&&!readOnlyContinuation)throw Error('PARENT_LOOP_CONTINUATION_INVALID');
 const deliveryRequest=brokerRequest?immutable(JSON.parse(JSON.stringify(brokerRequest))):q;
 if(canonical({...deliveryRequest,broker_request_path:q.broker_request_path})!==canonical(q))throw Error('PARENT_LOOP_BROKER_SCOPE_INVALID');
 const directory=join(dirname(deliveryRequest.broker_request_path),'parent-loop');
 try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('PARENT_LOOP_ALREADY_STARTED');throw error;}
 const directoryParent=openSync(dirname(directory),constants.O_RDONLY);try{fsyncSync(directoryParent);}finally{closeSync(directoryParent);}
 const record=(name,value)=>{
  const fd=openSync(join(directory,name+'.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}
  const parent=openSync(directory,constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}
 };
 let permit=null,currentIndex=null,reason='turn_limit',turnCount=0,officialStopped=true,modelUnknown=false,controlSeal,failureCode;
 const client=createActivitySkillBrokerClient({request:deliveryRequest,requestPath:deliveryRequest.broker_request_path,canReadback,
  authorize:(fixed,{op,body})=>control.consumeIntentPermit(permit,{request:q,index:currentIndex,op,body})});
 const history=[],runIds=new Set();
 const active=()=>{if(signal?.aborted)throw Error('PARENT_LOOP_ABORTED');if(Date.now()>=q.worker_deadline_ms)throw Error('PARENT_LOOP_DEADLINE');};
 try{
  for(let index=startIndex;index<Math.min(q.max_turns,readOnlyContinuation?startIndex+1:q.max_turns);index++){
   active();
   const drain=async phase=>{let waited=false;if(beforeTurn&&await bounded(Promise.resolve().then(()=>beforeTurn({deadlineMs:q.worker_deadline_ms,signal,index,phase,onDrained:()=>{waited=true;}})),q.worker_deadline_ms,signal)!==true)throw Error('PARENT_LOOP_OBSERVER_UNVERIFIED');active();return waited;};
   await drain('before_context');
   let context;const guidance=[];
   do{
    context=await bounded(broker.readParentContext(),q.worker_deadline_ms,signal);active();
    if(Array.isArray(context.commander_guidance))guidance.push(...context.commander_guidance);
    await drain('before_dispatch');
    // Pending work may have already finished while the context read awaited.
    // Check the original private snapshot after drain, then synchronously
    // build/dispatch. Refresh reads only, never replay a tool or reset budget.
   }while(!broker.isParentContextCurrent(context));
   if(guidance.length)context={...context,commander_guidance:guidance};
   if(context.commander_abort===true){reason='commander_aborted';break;}
   const input={protocol:'leadgen-parent-turn/v1',index,context,history:structuredClone(history)};
   if(Buffer.byteLength(JSON.stringify(input))>256*1024){reason='input_limit';break;}
   record(`turn-${index}-request`,{request_sha256:hash(JSON.stringify(q)),input});
   currentIndex=index;officialStopped=false;turnCount++;
   let receipt,verified;
   try{
    active();receipt=await bounded(control.request({kind:'official_agent_turn',request:q,turn:{index,input}}),q.worker_deadline_ms,signal);
    verified=control.verifyTurnReceipt(receipt,{request:q,index});
    if(!object(verified)||typeof verified.official_run_id!=='string'||runIds.has(verified.official_run_id))throw Error('PARENT_LOOP_OFFICIAL_RECEIPT_INVALID');
    runIds.add(verified.official_run_id);officialStopped=true;
   }catch{
    reason='official_turn_unverified';modelUnknown=true;client.seal();broker.seal();
    try{
     const stopped=await bounded(control.request({kind:'official_agent_stop',request:q,turn_index:index}),q.receipt_deadline_ms);
     const stopFacts=control.verifyStopReceipt(stopped,{request:q,index});
     if(!object(stopFacts))throw Error('PARENT_LOOP_OFFICIAL_STOP_INVALID');
     officialStopped=true;
     record(`turn-${index}-stop`,{verified:true});
    }catch{record(`turn-${index}-stop`,{verified:false});}
    break;
   }
   record(`turn-${index}-receipt`,verified);active();
   if(verified.status!=='ok'){reason='official_turn_failed';break;}
   let selected;
   try{selected=intent(verified.text);}catch{
    history.push({error:'PARENT_LOOP_INTENT_INVALID'});record(`turn-${index}-feedback`,history.at(-1));continue;
   }
   record(`turn-${index}-intent`,selected);
   if(selected.op==='finish'){reason='agent_finished';break;}
   if(readOnlyContinuation&&selected.op!=='inspect'){reason='read_only_intent_rejected';break;}
   permit=control.authorizeIntent(receipt,{request:q,index,op:selected.op,body:selected.body});
   let exchange;
   try{exchange={intent:selected,response:await client.call(selected.op,selected.body)};}
   catch(error){exchange={intent:selected,error:code(error)};}
   finally{permit=null;}
   history.push(exchange);record(`turn-${index}-tool`,exchange);
   if(client.snapshot().execution_unknown){reason='tool_delivery_unknown';break;}
  }
 }catch(error){
  reason=error?.message==='PARENT_LOOP_ABORTED'?'runner_aborted':error?.message==='PARENT_LOOP_DEADLINE'?'worker_deadline':'parent_loop_failed';
  failureCode=safeFailure(error);record('loop-failure',{reason,failure_code:failureCode});
 }finally{
  permit=null;client.seal();broker.seal();
  try{
   control.seal(q);
   await bounded(control.close(),q.receipt_deadline_ms);
   controlSeal=control.snapshot();
   if(control.verifySealedExecution(controlSeal,{request:q})!==true)throw Error('PARENT_LOOP_CONTROL_SEAL_UNVERIFIED');
  }catch{officialStopped=false;modelUnknown=true;reason='official_control_seal_failed';record('seal-failure',{reason});}
 }
 const actual=broker.getResult();
 record('loop-close',{domain:'raw-model-turns-v1',reason,official_execution_stopped:officialStopped,model_execution_unknown:modelUnknown,sealed:actual.sealed,pending:actual.pending,active:actual.active});
 let modelStopProof=null;
 if(officialStopped&&!modelUnknown&&!client.snapshot().execution_unknown&&actual.sealed===true&&actual.pending===0&&actual.active===0&&!actual.execution_unknown&&boundScope(scope,q)){
  modelStopProof=Object.freeze({domain:'raw-model-turns-v1'});stoppedModelScopes.set(modelStopProof,canonical(scope));
 }
 return {reason,...(failureCode?{failure_code:failureCode}:{}),turn_count:turnCount,official_execution_stopped:officialStopped,model_execution_unknown:modelUnknown,
  broker_execution_unknown:actual.execution_unknown===true||client.snapshot().execution_unknown,
  model_stop_proof:modelStopProof,activity_result:actual.result};
}
