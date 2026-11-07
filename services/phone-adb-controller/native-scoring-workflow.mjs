// Public 103 parent integration. Worker JSON never selects a dependency or authority.
import{readFileSync,lstatSync,realpathSync,mkdirSync}from'node:fs';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{userInfo}from'node:os';import{createHash}from'node:crypto';
import{readNativeScoringActivity}from'./native-scoring-readback.mjs';
import{rawModelScopeStopped}from'./activity-skill-parent-loop.mjs';import{skillLaunchDidNotStart}from'./activity-skill-executor.mjs';
import{assertRuntimeHost}from'./runtime-host.mjs';
import{assertAgentInput,readFrozen}from'./runtime-definition.mjs';import{rpcSource}from'./leadgen-client.mjs';import{verifyRpcSource}from'./leadgen-rpc.mjs';
import{assertFrozenNativeTaskLease,assertNativeTaskAssociation}from'./native-task-lease.mjs';import{assertScoringControlScope,readScoringCredentials,createScoringPoolFactory}from'./native-scoring-control.mjs';
import{createNativeScoringRuntime}from'./native-scoring-runtime.mjs';import{startNativeScoringProducers}from'./native-scoring-producers.mjs';import{createNativeActivityAuthority,readNativeAuthorityProjection,nativeAuthorityProjectionMatches}from'./native-activity-authority.mjs';
const instances=new WeakSet(),sha=b=>createHash('sha256').update(b).digest('hex');const fail=code=>Error('NATIVE_103_'+code);const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort().map(k=>[k,x[k]])):x);
export const isNativeScoringWorkflow=value=>instances.has(value);
export const NATIVE_SCORING_FILES=Object.freeze(['native-scoring-workflow.mjs','native-scoring-runtime.mjs','native-scoring-producers.mjs','native-scoring-control.mjs','native-activity-authority.mjs','native-task-lease.mjs','native-scoring-readback.mjs']);
export function nativeScoringSource(frozen){const source=rpcSource(frozen);for(const path of NATIVE_SCORING_FILES){const sha256=frozen.files?.['runtime/'+path];if(!/^[a-f0-9]{64}$/.test(sha256||''))throw fail('SOURCE');const rows=source.files.filter(f=>f.path===path);if(rows.length>1||rows.length&&rows[0].sha256!==sha256)throw fail('SOURCE');if(!rows.length)source.files.push({path,sha256});}return source;}
export function createNativeScoringWorkflow({root,env,frozen,binding,runDir=env.WFR_RUN_DIR,createAuthorityControl,requestImpl,poolFactory}={}){
 let prepared=false,unsafe=false,judgeUnknown=false,source,input,spec,lease,core,makePool,active;const seen=new Set(),entries=[];
 function verify(){
  if(!prepared||readFrozen(runDir).snapshot_sha256!==frozen.snapshot_sha256||realpathSync(root)!==dirname(fileURLToPath(import.meta.url)))throw fail('SOURCE');
  if(assertRuntimeHost(frozen.release,frozen.deployment)!=='mmv'||env.WFR_HOSTKEY!=='mmv')throw fail('HOST');
  assertAgentInput(frozen,env);assertScoringControlScope({root,env,frozen});assertFrozenNativeTaskLease(frozen);verifyRpcSource(source,{base:root});
  for(const name of NATIVE_SCORING_FILES){const s=lstatSync(join(root,name)),f=source.files.filter(f=>f.path===name);if(f.length!==1||!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||sha(readFileSync(join(root,name)))!==f[0].sha256)throw fail('SOURCE');}
 }
 async function prepare(){
  if(prepared)return;try{
   if(frozen?.execution_mode!=='agent'||frozen.execution_transport!=='raw-model-v1'||env.WF_BRAIN_WORKFLOW!=='douyin_comment_scoring'||frozen.control_scope)throw fail('DEPENDENCY');
   input=assertAgentInput(frozen,env);if(input.profile!=='mmv-scoring'||input.serial!=='none'||!binding?.id||!binding.run_id)throw fail('DEPENDENCY');
   assertNativeTaskAssociation({frozen,binding,taskId:input.task_id,runDir,scope:{task_id:input.task_id,run_id:binding.run_id,source_commit:frozen.deployment.source_commit,profile:input.profile,serial:input.serial},host:env.WFR_HOSTKEY});
   source=nativeScoringSource(frozen);lease=assertFrozenNativeTaskLease(frozen);spec=assertScoringControlScope({root,env,frozen});makePool=createScoringPoolFactory({runtimeRoot:root,frozen,env});
   const directory=join(runDir,'native-103');mkdirSync(directory,{mode:0o700});const ledger=join(directory,'queue');mkdirSync(ledger,{mode:0o700});
   const scope={workflow:input.workflow_key,run:input.run_tag,run_id:binding.run_id,task_id:input.task_id,binding_id:binding.id,source_commit:source.commit,snapshot_sha256:frozen.snapshot_sha256,profile:input.profile,serial:input.serial,line:input.line,source_run:input.source_run,limit:input.limit,deadline_ms:lease.effective_deadline_ms,receipt_deadline_ms:lease.effective_deadline_ms};
   core=createNativeScoringRuntime({root,source,scope,directory:ledger,requireProjectedAuthority:true,assertAuthority:async()=>readClaim(active),createPool:async options=>poolFactory?poolFactory(options):makePool(options)});
   prepared=true;verify();await core.prepare();
  }catch(e){unsafe=true;prepared=false;if(/^NATIVE_103_/.test(e?.message))throw e;throw fail('SOURCE');}
 }
 async function readClaim(entry){if(!entry||entry.closed||unsafe)throw fail('AUTHORITY');verify();const cap=await entry.authority.readClaim(),projection=readNativeAuthorityProjection(cap,{request:entry.request,source});if(!nativeAuthorityProjectionMatches(projection,{source,scope:entry.scope}))throw fail('AUTHORITY');return projection;}
 async function bindOfficialAuthority({request,control,scope,directory}){
  verify();if(active||unsafe||judgeUnknown||seen.has(scope.activity)||!['scoring','mark_leads'].includes(scope.activity)||scope.activity==='mark_leads'&&!seen.has('scoring')||scope.deadline_ms>lease.effective_deadline_ms||request.source_commit!==source.commit||request.runtime_snapshot_sha256!==frozen.snapshot_sha256)throw fail('SCOPE');
  for(const[a,b]of [['workflow','workflow_key'],['activity','activity_key'],['run','run_tag'],['run_id','run_id'],['task_id','task_id'],['binding_id','binding_id'],['profile','profile'],['serial','serial'],['line','line'],['source_run','source_run'],['limit','limit']])if(scope[a]!==request[b])throw fail('SCOPE');
  if(typeof control?.snapshot!=='function'||typeof control.verifySealedExecution!=='function')throw fail('WORKER_CONTROL');
  const entry={scope:structuredClone(scope),request:structuredClone(request),workerControl:control,closed:false,unknown:false};active=entry;entries.push(entry);seen.add(scope.activity);
  try{
   entry.authority=createNativeActivityAuthority({runtimeRoot:root,source,request:entry.request,frozen,directory,...(createAuthorityControl?{createControl:createAuthorityControl}:{} )});await readClaim(entry);
   const producerDirectory=join(runDir,'native-103',scope.activity);mkdirSync(producerDirectory,{mode:0o700});const credentials=readScoringCredentials({root,env,frozen});
   entry.producer=await startNativeScoringProducers({root,source,scope:entry.scope,directory:producerDirectory,python:spec.python,deadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms,deferNative:true,brainCredential:()=>credentials.brainToken,assertAuthority:async()=>{await readClaim(entry);return true;},...(requestImpl?{requestImpl}:{})});
   await readClaim(entry);await entry.producer.prepareNative();
   entry.dependencies=await entry.producer.queueDependencies({...credentials,orderDirectory:join(userInfo().homedir,'.config/zenithjoy/outreach-order-locks')});core.bindDependencies(entry.dependencies);
  }catch(e){entry.unknown=true;unsafe=true;throw e;}
 }
 async function assertScope(scope){verify();for(const[k,v]of Object.entries({workflow:input.workflow_key,run:input.run_tag,run_id:binding.run_id,task_id:input.task_id,binding_id:binding.id,source_commit:source.commit,snapshot_sha256:frozen.snapshot_sha256,profile:input.profile,serial:input.serial,line:input.line,source_run:input.source_run,limit:input.limit}))if(scope[k]!==v)throw fail('SCOPE');if(active&&!active.closed)await readClaim(active);return true;}
 async function prepareActivity(scope){if(!active||active.scope.activity!==scope.activity)throw fail('SCOPE');const previous=entries.find(e=>e.scope.activity==='scoring'),emptyReadback=scope.activity==='mark_leads'&&previous?.stop?.execution_stopped===true&&previous.modelStopped&&previous.emptyReadback;await core.begin({...scope,deadline_ms:scope.worker_deadline_ms,authorized_request_sha256:sha(canonical(active.request))},emptyReadback?{emptyReadback}:{});active.begun=true;}
 async function emptyMarkResult(){if(!active||active.closed||!active.begun||active.scope.activity!=='mark_leads')throw fail('EMPTY_HANDOFF');verify();await readClaim(active);return core.emptyResult();}
 async function queue(op,fields){if(!active||active.closed||!active.begun)throw fail('SCOPE');return core.queue(op,fields);}
 async function closeActivity(proof){
  const entry=active;if(!entry)return {execution_stopped:!unsafe};entry.modelStopped=skillLaunchDidNotStart(proof,entry.scope)||proof?.execution_stopped===true&&rawModelScopeStopped(proof.raw_model_proof,entry.scope);try{entry.modelStopped ||= entry.workerControl.verifySealedExecution(entry.workerControl.snapshot(),{request:entry.request})===true;}catch{}entry.closed=true;
  try{await core.closeActivity();}catch{const state=core.snapshot();entry.unknown=state.execution_unknown||state.pending>0;}
  let producerStop=true,authorityStop=true;
  if(entry.producer)try{producerStop=(await entry.producer.close()).execution_stopped===true;}catch{producerStop=false;}
  if(entry.authority)try{const packet=await entry.authority.close();authorityStop=entry.authority.verifyStopped(packet);}catch{authorityStop=false;}
  const state=core.snapshot(),effect=entry.producer?.snapshot().external_effect==='unknown'||state.external_effect==='unknown';
  entry.unknown ||= !producerStop||!authorityStop||state.execution_unknown||state.pending>0;unsafe ||= entry.unknown||effect;active=null;
  entry.stop={domain:'native-103-activity/v1',activity:entry.scope.activity,execution_stopped:!entry.unknown,external_effect:effect?'unknown':'observed',authority_closed:authorityStop,producer_closed:producerStop};return structuredClone(entry.stop);
 }
 async function readbackChecks(activity,options={}){
  verify();const entry=entries.find(e=>e.scope.activity===activity);if(judgeUnknown||active||!entry?.closed||entry.stop?.execution_stopped!==true||!entry.modelStopped)throw fail('JUDGE_PREVIOUS_DOMAIN_UNVERIFIED');
  entry.readbacks=(entry.readbacks||0)+1;if(entry.readbacks>2)throw fail('JUDGE_BUDGET');const base=join(runDir,'native-103','readbacks');mkdirSync(base,{recursive:true,mode:0o700});const directory=join(base,activity+'-'+entry.readbacks);mkdirSync(directory,{mode:0o700});mkdirSync(join(directory,'producer'),{mode:0o700});
  const credentials=readScoringCredentials({root,env,frozen});let result;try{result=await readNativeScoringActivity({root,source,scope:entry.scope,request:entry.request,frozen,records:core.issuedReceipts(),directory,python:spec.python,credentials,createPool:opts=>poolFactory?poolFactory(opts):makePool(opts),createAuthorityControl,requestImpl,verify,previousEffect:core.snapshot().external_effect,deadlineMs:options.deadlineMs,signal:options.signal});}catch(error){judgeUnknown=true;throw error;}if(result.result?.code_native_readback?.execution_stopped!==true){judgeUnknown=true;throw Object.assign(fail('JUDGE_STOP_UNVERIFIED'),{judgeExecutionStopped:false});}if(activity==='scoring')entry.emptyReadback=result.result?.gate?.verdict==='pass'&&result.result.readbacks?.empty_scope?.verified===true?result:null;return result;
 }
 const api={prepare,bindOfficialAuthority,readbackChecks,assertScope,prepareActivity,queue,emptyMarkResult,closeActivity,source:()=>structuredClone(source),supports(activity){try{verify();return !unsafe&&!judgeUnknown&&!active&&!seen.has(activity?.key)&&['scoring','mark_leads'].includes(activity?.key)&&(activity.key==='scoring'||seen.has('scoring'));}catch{return false;}},nativeState:()=>({execution_unknown:unsafe||judgeUnknown||entries.some(e=>e.unknown),judge_execution_unknown:judgeUnknown,native_stop_unproven:entries.some(e=>e.unknown),external_effect:core?.snapshot().external_effect||'none'}),snapshot:()=>({prepared,unsafe,judge_execution_unknown:judgeUnknown,active:active?.scope.activity||null,core:core?.snapshot()||null})};instances.add(api);return Object.freeze(api);
}
