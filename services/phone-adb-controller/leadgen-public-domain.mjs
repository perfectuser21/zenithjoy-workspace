// Public Worker owns the only Activity loop, Commander, ordering and final state.
// This factory supplies original Code business primitives and independent readback.
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preparePublicDomainSnapshot,hash} from './public-domain-snapshot.mjs';
import {validatePublicDomainIdentity,publicDomainRunId} from './public-domain-authority.mjs';
import {publicDomainStepChecks} from './public-domain-step-checks.mjs';
export {validatePublicDomainIdentity,publicDomainRunId};
const fail=s=>{throw Error('PUBLIC_DOMAIN_'+s);};
const workflows=new Set(['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring']);
const statusOf=v=>v===undefined||v==='done'||v==='completed'?'completed':v==='skipped'?'completed':['partial','paused'].includes(v)?'partial':v==='empty'?'empty':v==='failed'?'failed':'needs_review';
export async function createWorkflowDomain({identity,profile,runDirectory,signal,recordEvidence=async()=>{},deadline_ms,cleanup_deadline_ms}){
 const cfg=profile?.domain_adapter?.config;
 if(!workflows.has(cfg?.workflow_key))fail('WORKFLOW');
 if(!Number.isSafeInteger(deadline_ms)||deadline_ms<=Date.now()||!Number.isSafeInteger(cleanup_deadline_ms)||cleanup_deadline_ms<=deadline_ms)fail('DEADLINE');
 validatePublicDomainIdentity(identity);
 const frozenRun=preparePublicDomainSnapshot({identity,profile,runDirectory,deadline_ms,cleanup_deadline_ms});
 const {env,runtime,dir,snapshot,privateWrite}=frozenRun;
 const load=name=>import(pathToFileURL(join(runtime,name)).href);
 const definitions=await load('runtime-definition.mjs');
 const executionMode=cfg.execution_mode??'code';
 if(executionMode==='agent'){
  snapshot.agent_input=definitions.agentInput(env);
  const pg=await load('public-domain-pg.mjs');
  snapshot.native_claim=(await pg.readPublicDomainClaim({identity:{...identity,run_binding:identity.run_binding},env})).claim;
  if(cfg.workflow_key==='douyin_comment_scoring'){
   snapshot.scoring_pg=snapshot.public_pg;
   snapshot.scoring_control_scope=(await load('native-scoring-control.mjs')).freezeScoringControlScope({root:runtime,env});
  }else{
   snapshot.preflight_pg=snapshot.public_pg;
   snapshot.preflight_control_scope=(await load('preflight-control-scope.mjs')).freezePreflightControlScope({root:runtime,env,runtimeTransport:snapshot.runtime_transport});
  }
 }
 snapshot.discovery_input=definitions.discoveryInput(env)||undefined;
 snapshot.sampling_input=definitions.commentSamplingInput(env)||undefined;
 snapshot.snapshot_sha256=definitions.digest(snapshot);
 privateWrite(join(dir,'run-definition.json'),JSON.stringify(snapshot));
 const frozen=definitions.readFrozen(dir);
 const authority=await load('public-domain-authority.mjs');
 const unregister=authority.registerPublicDomainAuthority({runDirectory:dir,identity,deadline_ms,cleanup_deadline_ms,...(executionMode==='agent'?{snapshot_authority:{local_snapshot_sha256:frozen.snapshot_sha256,runtime_snapshot_sha256:frozen.public_domain.runtime_snapshot_sha256}}:{}),business_scope:{run:env.WFR_TAG,run_id:identity.run_id,task_id:identity.task_id,source_commit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL,attempt:env.WFR_ATTEMPT}});
 let handlers,closed=false,active=false,unsafe=false,last;
 const records=[],checks=new Map(),outcomes=new Map(),activities=new Map(frozen.activities.map(a=>[a.reference.slot_key,{...a.version.payload.contract,key:a.reference.slot_key}]));
 const proofScope=key=>({run_id:identity.run_id,task_id:identity.task_id,source_commit:frozen.deployment.source_commit,activity:key});
 const collection=await load('collection-phone-scope.mjs'),discovery=await load('discovery-phone-scope.mjs');
 const proofFor=(key,e)=>collection.collectionEvidenceProof(e,proofScope(key))||collection.collectionReturnedEvidence(e,proofScope(key))||collection.collectionCleanupEvidence(e,proofScope(key))||discovery.discoveryCleanupEvidence(e,proofScope(key));
 const evidenceFile=(kind,key,value)=>{
  const path=join(dir,`public-${kind}-${key}.json`);writeFileSync(path,JSON.stringify(value),{mode:0o600});return {path,sha256:hash(readFileSync(path))};
 };
 const verdict=(acceptance,value,evidence)=>({verdict:value,acceptance_ref:acceptance?.ref,evidence:[evidence]});
 try{
  const {createRpc}=await load('leadgen-client.mjs');
  const rpc=createRpc({frozen,local:true,runContext:{run:env.WFR_TAG,run_id:identity.run_id,profile:env.P,line:env.LEADGEN_LINE},environment:env});
  const {loadPublicDomainPg}=await load('public-domain-pg.mjs');
  // Before any phone/model/queue action, prove the frozen offline PG closure can load.
  const source=(await load('leadgen-client.mjs')).rpcSource(frozen);
  const probe=loadPublicDomainPg({runtimeRoot:runtime,input:{source},env});await probe.end();
  const workflow=await load('leadgen-workflow.mjs'),binding=authority.readPublicDomainBinding(dir);
  let preflightRuntime;
  if(executionMode==='agent'){
   await (await load('native-task-lease.mjs')).issuePublicNativeTaskLease({runDir:dir,frozen,env});
   if(cfg.workflow_key!=='douyin_comment_scoring')preflightRuntime=(await load('preflight-phone-scope.mjs')).createPreflightRuntime({root:runtime,env,frozen,binding,taskId:identity.task_id});
   handlers=workflow.createWorkflowHandlers({root:runtime,env,rpc,frozen,binding,sourceCommit:frozen.deployment.source_commit,taskId:identity.task_id,preflightRuntime});
   if(handlers.prepareNativeScoring)await handlers.prepareNativeScoring();
   if(handlers.prepareNativePhone)await handlers.prepareNativePhone();
  }else handlers=workflow.createHandlers({root:runtime,env,rpc,sourceCommit:frozen.deployment.source_commit,taskId:identity.task_id});
  const {verifyWorkflowActivity,invokeNativeActivity}=workflow;
  const executeAgent=executionMode==='agent'?workflow.createWorkflowExecution({runDir:dir,frozen,binding,env,handlers,rpc,activities:[...activities.values()],taskId:identity.task_id}).executeAgent:null;
  const setActivity=a=>{
   if(closed||!activities.has(a.key))fail('ACTIVITY');
   const cleanup=a.runtime?.phase==='finalize'||a.key==='cleanup',end=cleanup?cleanup_deadline_ms:deadline_ms;
   if(Date.now()>=end||!cleanup&&signal?.aborted)fail('DEADLINE');
   handlers.state.currentActivity=a.key;handlers.state.budgetDeadline=Math.min(end,Math.floor(Date.now()+a.budget.max_duration_s*1000));
  };
  return {
   async onEvent(event){
    if(event.event_type==='COMMANDER_EXCHANGE')records.push({activity:event.activity,phase:'commander_exchange',commander_status:'available',public_commander_event:structuredClone(event)});
   },
   async prepareInput(a,value){setActivity(a);return value;},
   async executeActivity(a,input,options={}){
    setActivity(a);if(active)fail('CONCURRENT_ACTIVITY');active=true;
    let evidence;
    try{
     if(unsafe||handlers.state.executionUnknown)fail('EXECUTION_UNKNOWN');
     const args={guidance:input.commander_guidance||[],signal:options.signal,onEvent:options.onAgentEvent,context:{task_id:identity.task_id},deadline_ms:handlers.state.budgetDeadline};
     if(executeAgent){const raw=await executeAgent(activities.get(a.key),args);evidence={...raw,status:statusOf(raw?.status),attempt:input.attempt};}
     else {const raw=await invokeNativeActivity(()=>handlers[a.key](args),handlers.state);evidence={status:statusOf(raw?.status),attempt:input.attempt,result:raw};}
    }catch(error){
     evidence={status:'failed',attempt:input.attempt,error_code:/^[A-Z_]+$/.test(error.message||'')?error.message:'PUBLIC_DOMAIN_ACTIVITY_FAILED',...(error.activityResult?{result:error.activityResult}:{}),...(typeof error.executionStopped==='boolean'?{execution_stopped:error.executionStopped}:{}),...(error.externalEffect==='unknown'?{external_effect:'unknown'}:{})};
    }finally{active=false;}
    const proven=proofFor(a.key,evidence);
    if(!proven&&(evidence.execution_stopped===false||evidence.result?.execution_stopped===false||handlers.state.executionUnknown)){unsafe=true;evidence.execution_stopped=false;}
    last={key:a.key,evidence};outcomes.set(a.key,evidence);
    const recorded=evidenceFile('execution',a.key,evidence);await recordEvidence({event_type:'ACTIVITY_AGENT_EVENT',activity:a.key,event:{kind:'business_execution',evidence:recorded}});
    return {schema_version:1,run_tag:input.run_tag,status:evidence.status,outputs:{[a.key]:JSON.parse(JSON.stringify(evidence.result||{}))},metrics:{},evidence:[recorded],adapter_result:evidence,
     ...(unsafe?{execution_stopped:false}:{}),...(!['completed','empty'].includes(evidence.status)?{failure_class:evidence.status==='needs_review'?'needs_human':'fatal'}:{})};
   },
   async checkActivity(a,result,options={}){
    if(options.phase==='start'){
     const good=!unsafe&&!closed&&!handlers.state.executionUnknown&&Date.now()<(a.runtime?.phase==='finalize'?cleanup_deadline_ms:deadline_ms);
     const proof=evidenceFile('precondition',a.key,{source_verified:true,run_id:identity.run_id,task_id:identity.task_id,binding_id:identity.run_binding.run_binding_id,observed_at:new Date().toISOString(),ready:good});
     return verdict(options.acceptance,good?'pass':'unknown',proof);
    }
    const e=result?.adapter_result;
    if(!e||result.execution_stopped===false||unsafe)return verdict(options.acceptance,'unknown',evidenceFile('verification',a.key,{verified:false,reason:'execution_unknown'}));
    const finite=e.status==='partial'&&(a.key==='collection'&&e.result?.sampling_receipts?.length||a.key==='collect_videos'&&discovery.discoveryFiniteStopEvidence(e,proofScope(a.key)));
    let checked={verified:false};
    if(e.status==='completed'||e.status==='empty'||finite)checked=await verifyWorkflowActivity({root:runtime,runDir:dir,frozen,env,binding:authority.readPublicDomainBinding(dir),rpc,handlers,preflightRuntime,records,executionMode},activities.get(a.key),e,{deadline_ms:handlers.state.budgetDeadline,signal:options.signal});
    if(cfg.workflow_key==='douyin_video_processing'&&frozen.sampling_input&&checked.verified===true){const facts=await load('runtime-receipts.mjs');const binding=authority.readPublicDomainBinding(dir);if(a.key==='qualification')checked.qualification_identity_v1=facts.qualificationIdentityEvidence({dir,frozen,binding});if(a.key==='collection')checked.sampling_admission_v1=facts.samplingAdmissionEvidence({dir,artifact:e,frozen,binding});}
    checks.set(a.key,checked);const proof=evidenceFile('verification',a.key,checked);await recordEvidence({event_type:'ACTIVITY_AGENT_EVENT',activity:a.key,event:{kind:'business_readback',evidence:proof}});
    return {...verdict(options.acceptance,checked.verified===true?'pass':'fail',proof),step_checks:publicDomainStepChecks({frozen,executionSlot:a.key,checked,evidence:proof}),...(checked.sampling_admission_v1?{sampling_admission_v1:checked.sampling_admission_v1}:{}),...(checked.qualification_identity_v1?{qualification_identity_v1:checked.qualification_identity_v1}:{})};
   },
   async canFinalize(receipt){
    const failed=(receipt?.activities||[]).some(row=>!['completed','skipped'].includes(row.status));
    if(!(last&&proofFor(last.key,last.evidence))&&(receipt?.execution_unknown||failed&&handlers.state.nativeStopUnproven))unsafe=true;
    if(active||handlers.state.executionUnknown)return false;
    if(!unsafe)return true;
    return Boolean(last&&proofFor(last.key,last.evidence));
   },
   async validateWorkflow(_profile,receipt,options={}){
    const keys=options.scope==='cleanup'?profile.contract.activities.filter(a=>a.runtime.phase==='finalize').map(a=>a.key):[...activities.keys()];
    const passed=!unsafe&&!handlers.state.executionUnknown&&keys.every(key=>checks.get(key)?.verified===true)&&(!keys.includes('cleanup')||outcomes.get('cleanup')?.result?.no_lock===true);
    return verdict(options.acceptance,passed?'pass':'fail',evidenceFile('aggregate',options.scope||'workflow',{run_id:identity.run_id,task_id:identity.task_id,scope:options.scope,checks:keys.map(key=>({key,verified:checks.get(key)?.verified===true})),execution_unknown:unsafe||Boolean(handlers.state.executionUnknown),verified:passed}));
   },
   async close(){
    if(closed)return {execution_stopped:!unsafe&&!active&&!handlers.state.executionUnknown};closed=true;
    const stopped=!active&&!unsafe&&!handlers.state.executionUnknown;
    if(!stopped)await handlers.quarantineResources();
    const result={protocol:'workflow-domain/v1',run_id:identity.run_id,task_id:identity.task_id,workflow_key:cfg.workflow_key,profile:env.P,source_commit:frozen.deployment.source_commit,profile_sha256:identity.profile_sha256,...(frozen.sampling_input?{sampling_input:frozen.sampling_input,sampling_admission_v1:checks.get('collection')?.sampling_admission_v1,qualification_identity_v1:checks.get('qualification')?.qualification_identity_v1}:{}),execution_stopped:stopped,status:stopped&&[...activities.keys()].every(k=>checks.get(k)?.verified===true)?'validated':'failed',results:[...outcomes].map(([activity,e])=>({activity,status:e.status,verification:checks.get(activity)||{verified:false}}))};
    evidenceFile('result','workflow',result);unregister();return {execution_stopped:stopped};
   },
  };
 }catch(error){unregister();throw error;}
}
