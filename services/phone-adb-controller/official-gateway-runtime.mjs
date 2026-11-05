// Audited raw-model source policy. File pins do not attest a process's loaded memory.
import {openSync,closeSync,fstatSync,readFileSync,lstatSync,constants,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const fail=()=>Error('OFFICIAL_CONTROL_GATEWAY_RUNTIME'),sha=b=>createHash('sha256').update(b).digest('hex');
const requiredPaths=["dist/src-D2gvuSyP.mjs","dist/agent-request-preflight-D_oWg-ft.mjs","dist/attempt-execution.runtime-fpzJbrUc.mjs","dist/embedded-agent-DsCaQmKI.mjs","dist/attempt-tool-construction-plan-BizPvV2W.mjs","dist/agent-turn-service-DTertIom.mjs","dist/tool-surface-bridge-CgDvORRC.mjs","dist/agent-job-COe8i8Fi.mjs","dist/agent-command-DUhFGJSr.mjs","dist/run-entry-D1FBcMwF.mjs","dist/agent-run-terminal-reply-DV0cZr9u.mjs","dist/agent-run-terminal-outcome-BGbjspLO.mjs","dist/agent-run-terminal-outcome-merge-DXNYLPhQ.mjs","dist/agent-dedupe-HXQNHjQs.mjs","dist/internal-session-effects-BuEs9zWI.mjs","dist/internal-session-key-BOMXCQVf.mjs","dist/agent-id-D1-Q6vR4.mjs","dist/result-BQGgYouL.mjs"];
function read(path){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022)||![0,process.getuid()].includes(st.uid)||st.size>16*1024*1024)throw fail();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=fstatSync(fd),bytes=readFileSync(fd),z=fstatSync(fd);if(a.dev!==st.dev||a.ino!==st.ino||z.dev!==a.dev||z.ino!==a.ino||z.size!==a.size||z.mtimeMs!==a.mtimeMs)throw fail();return bytes;}finally{closeSync(fd);}}
export function readOfficialGatewayPolicy({runtimeRoot,source}){
 try{
  if(!isAbsolute(runtimeRoot||'')||!/^[a-f0-9]{40}$/.test(source?.commit||'')||!Array.isArray(source.files))throw fail();
  for(const name of ['official-gateway-runtime.mjs','official-gateway-runtime.json']){
   const entries=source.files.filter(e=>e.path===name);if(entries.length!==1||!/^[a-f0-9]{64}$/.test(entries[0].sha256)||sha(read(join(runtimeRoot,name)))!==entries[0].sha256)throw fail();
   if(name.endsWith('.mjs')&&sha(read(fileURLToPath(import.meta.url)))!==entries[0].sha256)throw fail();
  }
  const bytes=read(join(runtimeRoot,'official-gateway-runtime.json')),policy=JSON.parse(bytes);
  if(Object.keys(policy).sort().join(',')!=='agent_config_path,files,gateway_version,package_root,schema_version,session_identity,terminal_policy'||policy.schema_version!==3||policy.terminal_policy!=='direct-final-plus-run-wait/v1'||policy.session_identity!=='internal-session-effects-run/v1'||policy.gateway_version!=='2026.9.8'||!isAbsolute(policy.package_root)||realpathSync(policy.package_root)!==policy.package_root||!Array.isArray(policy.files)||policy.files.length!==18)throw fail();
  const root=lstatSync(policy.package_root);if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o022)||![0,process.getuid()].includes(root.uid)||JSON.parse(read(join(policy.package_root,'package.json'))).version!==policy.gateway_version)throw fail();
  if(!isAbsolute(policy.agent_config_path||'')||realpathSync(policy.agent_config_path)!==policy.agent_config_path)throw fail();
  const cs=lstatSync(policy.agent_config_path);if(cs.uid!==process.getuid()||(cs.mode&0o777)!==0o600)throw fail();
  const config=JSON.parse(read(policy.agent_config_path)),projection={};for(const agent of ['skill-factory','work-commander']){const m=config.agents?.entries?.[agent]?.model;if(!m||m.primary!=='openai/gpt-6.1-sol'||!Array.isArray(m.fallbacks)||m.fallbacks.length)throw fail();projection[agent]={primary:m.primary,fallbacks:[]};}
  if(policy.files.some(f=>!requiredPaths.includes(f.path)))throw fail();
  const seen=new Set();for(const f of policy.files){if(Object.keys(f).sort().join(',')!=='path,sha256'||!/^dist\/[A-Za-z0-9_.-]+\.mjs$/.test(f.path)||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||sha(read(join(policy.package_root,f.path)))!==f.sha256)throw fail();seen.add(f.path);}
  return Object.freeze({source_policy_verified:true,model_policy_sha256:sha(JSON.stringify(projection)),gateway_version:policy.gateway_version,terminal_policy:policy.terminal_policy,session_identity:policy.session_identity,descriptor_sha256:sha(bytes),verified_files:18,loaded_process_attested:false,trust_assumption:'Gateway hello version and audited installed distribution source; loaded process memory is not attested'});
 }catch{throw fail();}
}

export function verifyOfficialGatewayRuntime({runtimeRoot,source,gatewayVersion}){
 const policy=readOfficialGatewayPolicy({runtimeRoot,source});if(gatewayVersion!==policy.gateway_version)throw fail();return policy;
}
const enumValue=(value,allowed)=>allowed.includes(value)?value:null;
const identifier=value=>({present:typeof value==='string'&&value.length>0,sha256:typeof value==='string'?sha(value):null});
const kind=value=>value===null?'null':Array.isArray(value)?'array':enumValue(typeof value,['undefined','boolean','number','string','object'])??'other';
const field=(value,key)=>({present:value!=null&&Object.hasOwn(Object(value),key),type:kind(value?.[key]),is_true:value?.[key]===true,is_false:value?.[key]===false});
export function projectOfficialResponse(method,value,runId,{expectedSessionId,sourceSessionId,sourceSessionKey,dispatchedAt,receivedAt=Date.now()}={}){
 const meta=(value?.result??value)?.meta,am=meta?.agentMeta,r=method==='agent'?am?.terminalReceipt:value?.terminalReceipt;
 return {schema_version:3,evidence_only:true,method,source_session_id:identifier(sourceSessionId),source_route_key:identifier(sourceSessionKey),run_id_matches:value?.runId===runId,status:enumValue(value?.status,['ok','error','aborted','timeout','accepted']),ended_at:Number.isFinite(value?.endedAt)?value.endedAt:null,ended_at_valid:Number.isFinite(value?.endedAt)&&value.endedAt>0&&value.endedAt<=receivedAt,ended_at_lower_matches:Number.isFinite(value?.endedAt)&&Number.isFinite(dispatchedAt)&&value.endedAt>=dispatchedAt,ended_at_upper_matches:Number.isFinite(value?.endedAt)&&value.endedAt<=receivedAt,stop_reason:enumValue(value?.stopReason,['stop','error','aborted','timeout','length','tool_calls','end_turn','superseded','restart']),liveness_state:enumValue(value?.livenessState,['working','paused','idle','done']),
  agent_meta:{present:!!am,session_id:identifier(am?.sessionId),session_id_matches_receipt:typeof am?.sessionId==='string'&&am.sessionId===r?.sessionId,provider_matches:am?.provider==='openai',model_matches:am?.model==='gpt-6.1-sol',agent_harness_id_present:typeof am?.agentHarnessId==='string',agent_harness_id_matches:am?.agentHarnessId==='openclaw'},
  direct_flags:Object.fromEntries(['aborted','yielded','replayInvalid','pendingError','timeoutPhase','error'].map(key=>[key,field(meta,key)])),wait_flags:Object.fromEntries(['aborted','yielded','replayInvalid','pendingError','timeoutPhase','error'].map(key=>[key,field(value,key)])),
  receipt:{declared:method==='agent'?am!=null&&Object.hasOwn(Object(am),'terminalReceipt'):value!=null&&Object.hasOwn(Object(value),'terminalReceipt'),present:r!=null,type:kind(r),run_id_matches:r?.runId===runId,session_id:identifier(r?.sessionId),expected_session_id_present:typeof expectedSessionId==='string',expected_session_id_matches:typeof expectedSessionId==='string'&&r?.sessionId===expectedSessionId,turn_id:identifier(r?.turnId),requested_present:!!r?.requested,requested_provider_matches:r?.requested?.provider==='openai',requested_model_matches:r?.requested?.model==='gpt-6.1-sol',effective_present:!!r?.effective,effective_provider_matches:r?.effective?.provider==='openai',effective_model_matches:r?.effective?.model==='gpt-6.1-sol',successful_tool_names_array:Array.isArray(r?.successfulToolNames),successful_tool_names_empty:Array.isArray(r?.successfulToolNames)&&r.successfulToolNames.length===0,rerouted_present:r!=null&&Object.hasOwn(Object(r),'rerouted'),rerouted_type:kind(r?.rerouted),rerouted_true:r?.rerouted===true,rerouted_false:r?.rerouted===false}};
}
/** Pure evidence facts only. Neither these facts nor a diagnostic JSON is a stop/intent capability. */
export function officialSuccessEvidenceFailures({policy,agent,wait,expected,dispatchedAt,receivedAt}){
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),id=value=>typeof value==='string'&&value.trim().length>0&&value.length<=250&&!/[\r\n]/.test(value),meta=agent?.result?.meta,am=meta?.agentMeta,r=am?.terminalReceipt;
 const abnormal=(value,key)=>value!=null&&Object.hasOwn(Object(value),key)&&value[key]!==false,failures=[];const check=(reason,ok)=>{if(!ok)failures.push(reason);};
 check('policy',policy==='direct-final-plus-run-wait/v1');check('expected_identity',object(expected)&&id(expected.runId));check('local_time_bounds',Number.isFinite(dispatchedAt)&&Number.isFinite(receivedAt)&&receivedAt>=dispatchedAt);
 check('direct_final_run_status',object(agent)&&agent.runId===expected?.runId&&agent.status==='ok');check('direct_producer_receipt',object(meta)&&object(am)&&object(r)&&r.runId===expected?.runId&&id(r.sessionId)&&id(r.turnId));check('direct_session_binding',typeof am?.sessionId==='string'&&am.sessionId===r?.sessionId&&(expected?.sessionId===undefined||r?.sessionId===expected.sessionId));
 check('direct_model_harness',am?.provider==='openai'&&am?.model==='gpt-6.1-sol'&&am?.agentHarnessId==='openclaw');check('receipt_requested_effective',r?.requested?.provider==='openai'&&r?.requested?.model==='gpt-6.1-sol'&&r?.effective?.provider==='openai'&&r?.effective?.model==='gpt-6.1-sol');check('receipt_no_tools',Array.isArray(r?.successfulToolNames)&&r.successfulToolNames.length===0);check('receipt_no_reroute',r?.rerouted===false);
 check('direct_payload',Array.isArray(agent?.result?.payloads)&&!agent.result.payloads.some(p=>p?.isError===true));check('direct_no_abnormal_flags',object(meta)&&!['aborted','yielded','pendingError','replayInvalid'].some(key=>abnormal(meta,key))&&meta.timeoutPhase==null&&meta.error==null&&(meta.stopReason===undefined||meta.stopReason==='stop'));
 check('wait_run_status',object(wait)&&wait.runId===expected?.runId&&wait.status==='ok');check('wait_time_bounds',Number.isFinite(wait?.endedAt)&&wait.endedAt>=dispatchedAt&&wait.endedAt<=receivedAt);check('wait_no_abnormal_flags',object(wait)&&!['pendingError','yielded','aborted','replayInvalid'].some(key=>abnormal(wait,key))&&wait.error==null&&wait.timeoutPhase==null&&(wait.stopReason===undefined||wait.stopReason==='stop')&&wait.livenessState!=='paused');
 check('wait_receipt_absent_or_equal',object(wait)&&(!Object.hasOwn(wait,'terminalReceipt')||object(wait.terminalReceipt)&&JSON.stringify(canonicalValue(wait.terminalReceipt))===JSON.stringify(canonicalValue(r))));return failures;
}
export function validateOfficialSuccessEvidence(input){
 const failures=officialSuccessEvidenceFailures(input);if(failures.length)throw Object.assign(Error('OFFICIAL_CONTROL_SUCCESS_TERMINAL'),{validation_failures:failures});const r=input.agent.result.meta.agentMeta.terminalReceipt;
 return Object.freeze({evidence_only:true,terminal_policy:input.policy,official_run_id:input.expected.runId,session_id:r.sessionId,turn_id:r.turnId,provider:input.agent.result.meta.agentMeta.provider,model:input.agent.result.meta.agentMeta.model,ended_at:input.wait.endedAt,wait_receipt:Object.hasOwn(input.wait,'terminalReceipt')?'matching':'absent'});
}
function canonicalValue(value){return Array.isArray(value)?value.map(canonicalValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalValue(value[k])])):value;}

// Mirrors the audited pure official identity function; never derives an expectation from a response.
export function deriveOfficialExecutionIdentity({sessionIdentity,agentId,runId}={}){
 if(sessionIdentity!=='internal-session-effects-run/v1'||!['skill-factory','work-commander'].includes(agentId)||typeof runId!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(runId))throw fail();
 const suffix=(runId.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,48)||'run')+'-'+sha(runId).slice(0,16);
 return Object.freeze({sessionId:'internal-session-effects-'+suffix,sessionKey:'agent:'+agentId+':internal-session-effects:'+suffix});
}
