// Code-owned tool lifecycle for official children. This executes primitives,
// never an Activity handler, Workflow loop, model reply or caller-supplied shell.
import {realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {canonical,readFrozen} from './runtime-definition.mjs';
import {publicDomainAuthority} from './public-domain-authority.mjs';
import {verifyPublicDomainTask} from './public-domain-pg.mjs';
import {createPhoneEpochGuard} from './phone-epoch-admission.mjs';
import {createOfficialCliClosure,isOfficialCliInvocationNotStarted,isOfficialCliOperationStopped,isOfficialCliOuterReturned} from './official-cli-closure.mjs';
import {createOfficialRecordingProducer} from './official-recording-producer.mjs';
import {skillLaunchDidNotStart,skillOfficialExecutionStopped} from './activity-skill-executor.mjs';
import {fetchBrainAuthorityGet} from './brain-authority-get.mjs';
const instances=new WeakSet(),returned=new WeakMap(),notStarted=new WeakMap();
const key=({command,args,receipt,root,frozen})=>canonical({command,args,receipt,root,snapshot_sha256:frozen.snapshot_sha256});
export const isOfficialChildPrimitives=v=>instances.has(v);
export const officialChildOperationReturned=(result,context)=>returned.get(result)===key(context);
export const officialChildInvocationNotStarted=(error,context)=>notStarted.get(error)===key(context);
const fail=()=>Object.assign(Error('OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED'),{executionStopped:false,externalEffect:'unknown'});
export function createOfficialChildPrimitives({root,env,frozen,binding,taskId,state}){
 if(!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(frozen.agent_input?.workflow_key)||realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||frozen.primary_host!=='official-child-v1'||frozen.execution_mode!=='agent'||frozen.execution_transport!==undefined||taskId!==frozen.agent_input.task_id)throw fail();
 const files=Object.fromEntries(Object.entries(frozen.files).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
 const spec=frozen.discovery_phone_scope||frozen.collection_phone_scope,scoring=frozen.agent_input.workflow_key==='douyin_comment_scoring';
 const slots=scoring?['scoring','mark_leads']:frozen.agent_input.workflow_key==='douyin_video_discovery'?['preflight','collect_videos','cleanup']:['preflight','dedup','qualification','collection','cleanup'];
 let current,unknown=false,closed=false;const activities=new Map();
 const stable=()=>{const a=publicDomainAuthority(env.WFR_RUN_DIR);if(closed||unknown||!a||a.binding.id!==binding.id||a.identity.task_id!==taskId||a.snapshot_authority?.local_snapshot_sha256!==frozen.snapshot_sha256||canonical(readFrozen(env.WFR_RUN_DIR))!==canonical(frozen))throw fail();};
 const authorize=async({phase,resourceOnly})=>{
  stable();const observed=await verifyPublicDomainTask({runtimeRoot:root,env});stable();
  if(canonical(observed.claim)!==canonical(frozen.native_claim))throw fail();
  // prepare checks no physical effect. Central acquisition belongs to the
  // original preflight tools before their first local-lock/phone operation.
  if(phase!=='prepare'&&!scoring){
   const response=await fetchBrainAuthorityGet(new URL('/api/brain/device-locks',env.BRAIN_URL),{headers:{Authorization:'Bearer '+env.BRAIN_INTERNAL_TOKEN},timeoutMs:8000});
   if(!response.ok)throw fail();const rows=await response.json(),locks=rows.locks?.filter(r=>r.device_name===env.SERIAL);
   if(rows.success!==true||locks?.length!==1||locks[0].locked_by!==taskId||!Number.isFinite(Date.parse(locks[0].expires_at))||Date.parse(locks[0].expires_at)<=Date.now()+1000)throw fail();stable();
  }
  if(!resourceOnly){const proof=await createPhoneEpochGuard({root,env,frozen,state,deadlineMs:current.scope.worker_deadline_ms})();stable();if(proof?.authorized!==true)throw fail();return proof;}
  return {authorized:true};
 };
 async function begin(scope){
  stable();if(current||activities.has(scope.activity)||!slots.includes(scope.activity)||scope.task_id!==taskId||scope.run_id!==binding.run_id||scope.binding_id!==binding.id||scope.snapshot_sha256!==frozen.snapshot_sha256)throw fail();
  const entry={scope:structuredClone(scope),pending:0,unknown:false,done:false};activities.set(scope.activity,entry);current=entry;
  if(!scoring){entry.cli=createOfficialCliClosure({root,env,frozen,binding,taskId,scope,assertAdmission:authorize});await entry.cli.prepare();}
  if(scope.activity==='qualification')entry.recording=createOfficialRecordingProducer({sourceRoot:root,files,python:spec.executables.python,evidenceRoot:spec.evidence_root,scope:{runDir:env.WFR_RUN_DIR,runId:binding.run_id,taskId,sourceCommit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL,owner:env.WFR_TAG,activity:scope.activity,snapshotSha256:frozen.snapshot_sha256,bindingId:binding.id,deadlineMs:scope.deadline_ms,workerDeadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms}});
  await authorize({phase:'prepare',resourceOnly:true});return true;
 }
 async function execute(command,args,options={}){
  const entry=current;if(!entry||entry.done||!entry.cli)throw fail();stable();
  const originalReceipt=options.receipt,receipt=originalReceipt||{runDir:env.WFR_RUN_DIR,operationId:randomUUID(),runId:binding.run_id,taskId,profile:env.P,serial:env.SERIAL,sourceCommit:frozen.deployment.source_commit,owner:env.WFR_TAG,activity:entry.scope.activity};
  let plan;
  try{plan=entry.cli.plan(command,args,{receipt});}
  catch(error){
   if(!unknown&&!entry.unknown&&!state.executionUnknown&&isOfficialCliInvocationNotStarted(error,{command,args,receipt,root,frozen})){
    notStarted.set(error,key({command,args,receipt:originalReceipt,root,frozen}));throw error;
   }
   unknown=true;entry.unknown=true;state.executionUnknown=true;throw Object.assign(error,{executionStopped:false,externalEffect:'unknown'});
  }
  let ticket;entry.pending++;
  try{
   if(plan.kind==='recording-outer-only'){
    if(!entry.recording)throw fail();const offset=plan.args.indexOf(plan.operation),argv=plan.args.slice(offset+1),evidenceId=argv[0];
    const videoId=plan.operation==='record-start'?argv[2]:entry.recording.snapshot().recordings.find(r=>r.evidence_id===evidenceId)?.video_id;
    ticket=entry.recording.before({operationId:receipt.operationId,command:plan.operation,evidenceId,videoId,argv});
   }
   const result=await entry.cli.execute(command,args,{...options,receipt,env:{...options.env,...ticket?.env}});
   const context={command,args,receipt,root,frozen};
   if(ticket){if(!isOfficialCliOuterReturned(result,context))throw fail();await entry.recording.after(ticket,{executionStopped:true});if(entry.recording.snapshot().unknown)throw fail();}
   else if(!isOfficialCliOperationStopped(result,context))throw fail();
   // Known owned-active capture is tracked separately. It is not a stopped
   // capture proof and does not prevent the following authorized record-stop.
   returned.set(result,key({command,args,receipt:originalReceipt,root,frozen}));return result;
  }catch(error){unknown=true;entry.unknown=true;state.executionUnknown=true;throw Object.assign(error,{executionStopped:false,externalEffect:'unknown'});}finally{entry.pending--;}
 }
 async function finish(activity){
  const entry=current;if(!entry||entry.scope.activity!==activity||entry.pending)throw fail();
  let stopped=true;
  if(entry.recording){const proof=await entry.recording.close();stopped=entry.recording.verifyStopped(proof)&&stopped;}
  if(entry.cli)stopped=(await entry.cli.close()).execution_stopped===true&&stopped;
  entry.done=true;current=null;if(!stopped||entry.unknown){unknown=true;state.executionUnknown=true;throw fail();}return {execution_stopped:true};
 }
 function wrapTools(activity,scope,tools){
  stable();const entry=activities.get(activity.key);
  if(!entry||current!==entry||canonical(entry.scope)!==canonical(scope))throw fail();
  return {...tools,closeNativeScope:async proof=>{
    stable();if(entry.pending||entry.unknown||current&&current!==entry)throw fail();
    if(entry.done){const state=entry.cli?.snapshot();if(state&&(!state.sealed||state.pending||state.unknown))throw fail();return {execution_stopped:true};}
    // This closes physical producers only. A failed resource intent and its
    // unknown business outcome remain durable and cannot be replayed.
    if(!skillLaunchDidNotStart(proof,entry.scope)&&!skillOfficialExecutionStopped(proof,entry.scope))throw fail();
    if(typeof tools.closeNativeScope==='function'&&(await tools.closeNativeScope(proof))?.execution_stopped!==true)throw fail();
    return finish(activity.key);
   }};
 }
 const snapshot=()=>({execution_unknown:unknown||[...activities.values()].some(e=>e.unknown||e.recording?.snapshot().unknown),pending:[...activities.values()].reduce((n,e)=>n+e.pending,0),active:Boolean(current)});
 const runtime={begin,execute,finish,wrapTools,snapshot,async quarantine(){const proofs=[];for(const entry of [...activities.values()].reverse())if(entry.cli)try{proofs.push(await entry.cli.quarantine());}catch{proofs.push({verified:false,physical_actions:0});}return {verified:scoring||proofs.some(p=>p.verified===true),physical_actions:0,...(scoring?{not_applicable:true}:{}),proofs};},supports:activity=>{stable();return !current&&slots.includes(activity.key)&&(scoring||spec?.policy?.schema_version===2)&&!activities.has(activity.key);},async close(){try{const a=publicDomainAuthority(env.WFR_RUN_DIR);if(!a||a.binding.id!==binding.id||canonical(readFrozen(env.WFR_RUN_DIR))!==canonical(frozen))unknown=true;for(const entry of activities.values()){if(entry.recording){const proof=await entry.recording.close();if(!entry.recording.verifyStopped(proof))unknown=true;}if(entry.cli&&(await entry.cli.close()).execution_stopped!==true)unknown=true;}}catch{unknown=true;}const s=snapshot();closed=true;return {execution_stopped:!s.execution_unknown&&!s.pending&&!s.active};}};instances.add(runtime);return Object.freeze(runtime);
}
