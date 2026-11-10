import {createPhoneEpochGuard} from './phone-epoch-admission.mjs';
// Code-only ingress: same reviewed ROM, shell-v2 and nofork leaves as native
// phone execution. This never promotes observed PID trees to stop authority.
import {mkdirSync,readFileSync,lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {publicDomainAuthority,publicDomainScopeMatches} from './public-domain-authority.mjs';
import {readFrozen,canonical} from './runtime-definition.mjs';
import {createNativePhoneAdbRead,createNativePhoneEvidenceRead} from './native-phone-adb-read.mjs';
import {createNativePhoneSourceIssuer,readNativePhoneCommandSource} from './native-phone-command-source.mjs';
import {createNativePhoneCommandObserver} from './adb-shell-v2.mjs';
import {createNativePhonePreflightAdapter} from './native-phone-preflight-adapter.mjs';
import {startPreflightNativeDomain,preflightDomainClosure} from './preflight-native-domain.mjs';
import {freezePreflightProfile} from './preflight-control-scope.mjs';
import {freezePublicPreflightRoute} from './public-preflight-route.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=reason=>Error('PUBLIC_CODE_PREFLIGHT_'+reason);
export async function startPublicCodePreflightIO({root,env,frozen,state,lease,purpose,workerDeadlineMs,receiptDeadlineMs,signal,prepareLocal,assertLocal}){
 const epochGuard=createPhoneEpochGuard({root,env,frozen,state,deadlineMs:workerDeadlineMs});
 const formal=publicDomainAuthority(env.WFR_RUN_DIR),spec=frozen.discovery_phone_scope||frozen.collection_phone_scope,profile=frozen.preflight_profile;
 if(!formal||!spec||!profile||!['preflight','cleanup'].includes(purpose)||!publicDomainScopeMatches(env.WFR_RUN_DIR,{run:env.WFR_TAG,run_id:state.run_id,task_id:state.task_id,source_commit:state.source_commit,profile:env.P,serial:env.SERIAL})
  ||frozen.execution_mode!=='code'||!['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW)||typeof prepareLocal!=='function'||typeof assertLocal!=='function'||!Number.isSafeInteger(workerDeadlineMs)||workerDeadlineMs>=receiptDeadlineMs||workerDeadlineMs>Date.now()+300000)throw fail('SCOPE');
 const source={commit:frozen.deployment.source_commit,files:Object.entries(frozen.files).filter(([p])=>p.startsWith('runtime/')&&!p.startsWith('runtime/_dependencies/')).map(([p,sha256])=>({path:p.slice(8),sha256}))};
 let sealed=false,unknown=false,pending=0,local,issuer,adapter,sequence=0,nativeBootstrapAttempted=false,localAdmitted=false;const observers=[],readers=[],authorizations=new Set();
 const directory=join(env.WFR_RUN_DIR,'public-code-preflight',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
 const stable=()=>{
  if(realpathSync(root)!==realpathSync(join(env.WFR_RUN_DIR,'runtime'))||readFrozen(env.WFR_RUN_DIR).snapshot_sha256!==frozen.snapshot_sha256||canonical(freezePreflightProfile({env}))!==canonical(profile))throw fail('SOURCE');
  for(const f of source.files){const path=join(root,f.path),s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||hash(readFileSync(path))!==f.sha256)throw fail('SOURCE');}
  const route=freezePublicPreflightRoute({root,files:Object.fromEntries(source.files.map(f=>[f.path,f.sha256])),scope:spec});
  if(canonical(route)!==canonical(frozen.public_preflight_route||null))throw fail('ROUTE_SOURCE');
 };
 const active=()=>{if(sealed||unknown||signal?.aborted||Date.now()>=workerDeadlineMs)throw fail('CLOSED');stable();if(localAdmitted)assertLocal();};
 const authorize=async()=>{
  active();const job=(async()=>{const task=await lease.verifyTask({workflowKey:env.WF_BRAIN_WORKFLOW,companyLine:env.LEADGEN_LINE,sourceCommit:state.source_commit,runTag:env.WFR_TAG});await lease.verifyHeld();active();if(localAdmitted&&epochGuard)await epochGuard();active();return task;})();
  authorizations.add(job);try{return await job;}finally{authorizations.delete(job);}
 };
 const close=async()=>{
  sealed=true;adapter?.seal();for(const o of observers)o.seal();for(const r of readers)r.seal();
  let stopped=!unknown&&(!nativeBootstrapAttempted||Boolean(local));for(const o of observers)try{const p=await o.close();stopped=!p.unknown&&!p.pending&&!p.open_sockets&&stopped;}catch{stopped=false;}
  for(const r of readers)try{stopped=(await r.close()).channel_stopped===true&&stopped;}catch{stopped=false;}
  if(issuer)try{await issuer.close();}catch{stopped=false;}
  if(local)try{await local.close();stopped=Boolean(preflightDomainClosure(local))&&stopped;}catch{stopped=false;}
  await Promise.allSettled([...authorizations]);
  signal?.removeEventListener('abort',abort);
  return {protocol:'public-code-preflight-io/v1',execution_stopped:stopped&&pending===0&&authorizations.size===0,pending,remote_android_services:'not_attested',directory};
 };
 const abort=()=>{for(const o of observers)o.seal();for(const r of readers)r.seal();adapter?.seal();};
 signal?.addEventListener('abort',abort,{once:true});
 try{
  const task=await authorize();if(typeof task.claimed_at!=='string'||!Number.isFinite(Date.parse(task.claimed_at))||typeof task.claimed_by!=='string')throw fail('CLAIM');
  const base={task_id:state.task_id,binding_id:formal.binding.id,run_id:state.run_id,source_commit:source.commit,profile:env.P,serial:env.SERIAL,epoch:0,endpoint:spec.policy.endpoint,claim:{claimed_at:task.claimed_at,claimed_by:task.claimed_by},worker_deadline_ms:workerDeadlineMs,cleanup_deadline_ms:receiptDeadlineMs};
  const readScope={...base,protocol:'native-phone-adb-read/v1'},commandScope={...base,protocol:'adb-shell-v2-observation/v1'};
  const authority=scope=>async()=>{const current=await authorize();if(current.claimed_by!==base.claim.claimed_by||current.claimed_at!==base.claim.claimed_at)throw fail('CLAIM_CHANGED');return {scope,claimed_by:current.claimed_by,claimed_at:current.claimed_at,lease_until:new Date(receiptDeadlineMs).toISOString()};};
  const sub=name=>{const p=join(directory,name);mkdirSync(p,{mode:0o700});return p;};
  nativeBootstrapAttempted=true;local=await startPreflightNativeDomain({root,directory:sub('local'),sourceFiles:Object.fromEntries(source.files.map(f=>[f.path,f.sha256])),python:spec.executables.python,policy:spec.policy,serial:env.SERIAL,workerDeadlineMs,receiptDeadlineMs,env,assertAdmission:authorize});
  await prepareLocal({run:(...args)=>local.local(...args)});localAdmitted=true;active();
  const reader=createNativePhoneAdbRead({runtimeRoot:root,source,directory:sub('source'),scope:readScope,readAuthority:authority(readScope),freshFrameAdmission:Boolean(epochGuard)});readers.push(reader);
  const context={profile:env.P,serial:env.SERIAL,package:'com.ss.android.ugc.aweme',width:profile.width,height:profile.height,keywords:[],evidenceRoot:spec.evidence_root,run:env.WFR_TAG};
  issuer=createNativePhoneSourceIssuer({runtimeRoot:root,source,scope:readScope,context,reader});const commandSource=await issuer.prepare();active();
  const command=async(operation,args)=>{
   await authorize();const observer=createNativePhoneCommandObserver({runtimeRoot:root,source,directory:sub('command-'+sequence++),scope:commandScope,readAuthority:authority(commandScope),commandSource,operation,args,context});observers.push(observer);pending++;
   try{const cap=await observer.observeDump();return observer.readReviewedCommandReceipt(cap,{scope:commandScope});}
   catch(error){unknown=true;throw error;}finally{pending--;const p=await observer.close();if(p.unknown||p.pending||p.open_sockets)unknown=true;}
  };
  const readEvidence=async path=>{
   await authorize();const reader=createNativePhoneEvidenceRead({runtimeRoot:root,source,directory:sub('evidence-'+readers.length),scope:readScope,readAuthority:authority(readScope),commandSource});readers.push(reader);pending++;
   try{const cap=await reader.read(path);return reader.readReceipt(cap,{scope:readScope}).bytes;}catch(error){unknown=true;throw error;}finally{pending--;if((await reader.close()).channel_stopped!==true)unknown=true;}
  };
  adapter=createNativePhonePreflightAdapter({context:{...context,owner:env.WFR_TAG,purpose,deadlineMs:workerDeadlineMs},io:{command,readEvidence},hostAdb:(...args)=>local.adb(...args)});
  const sdk=await command('sdk',[]),review=readNativePhoneCommandSource(commandSource);
  if(sdk.code!==0||sdk.stdout.toString().replaceAll('\r','').trim()!==String(review.device_sdk))throw fail('SDK_SCOPE');
  const route=freezePublicPreflightRoute({root,files:Object.fromEntries(source.files.map(f=>[f.path,f.sha256])),scope:spec});
  if(canonical(route)!==canonical(frozen.public_preflight_route||null))throw fail('ROUTE_SOURCE');
  await local.local('route',JSON.stringify({config:route?.policy_path||env.ZJ_ADB_HOST_CONFIG||join(env.HOME,'.config/zenithjoy/adb-service.json'),policy:spec.policy,serial:env.SERIAL}));
  return {adb:(...args)=>adapter.adb(...args),local:{run:(...args)=>local.local(...args)},desktop:(launcher,xml)=>local.desktop(launcher,xml),assertResources:authorize,close,directory};
 }catch(error){const proof=await close();writeFileSync(join(directory,'startup-close.json'),JSON.stringify(proof),{mode:0o600});throw Object.assign(error,{executionStopped:proof.execution_stopped});}
}
