// Canonical public 101 Code preflight. No agent transport or second Runner.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {publicDomainAuthority,publicDomainScopeMatches} from './public-domain-authority.mjs';
import {readFrozen} from './runtime-definition.mjs';
import {startPublicCodePreflightIO} from './public-code-preflight-io.mjs';
import {startPreflightLocalLeaves} from './preflight-local-leaves.mjs';
import {createPreflightPhoneDriver} from './preflight-phone-driver.mjs';
import {captureCleanupReadback,verifyCleanupReadback} from './discovery-cleanup-readback.mjs';
import {collectionCleanupEvidence} from './collection-phone-scope.mjs';
import {discoveryCleanupEvidence} from './discovery-phone-scope.mjs';
const fail=reason=>Error('PUBLIC_CODE_PREFLIGHT_'+reason);
export function createPublicCodePreflight({root,env,state,lease,onLocked=()=>{}}={}){
 const dir=env?.WFR_RUN_DIR,formal=dir&&publicDomainAuthority(dir);
 if(!formal||!['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW)||!publicDomainScopeMatches(dir,{run:env.WFR_TAG,run_id:state?.run_id,task_id:state?.task_id,source_commit:state?.source_commit,profile:env.P,serial:env.SERIAL}))throw fail('ADMISSION');
 const frozen=readFrozen(dir),spec=frozen.discovery_phone_scope||frozen.collection_phone_scope,epoch=randomUUID();
 if(frozen.execution_mode!=='code'||!frozen.preflight_profile||!spec||!lease)throw fail('FROZEN');
 const sourceFiles=Object.fromEntries(Object.entries(frozen.files).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
 const rootLock=join(env.HOME,'.local/share/zenithjoy/phone-locks');let owned=false,unsafe=false,current=null,desktopProof=null,acquireAttempted=false;
 const resourceUnknown=error=>{unsafe=true;state.executionUnknown=true;state.nativeStopUnproven=true;return Object.assign(error,{executionStopped:false,externalEffect:'unknown',resourceUnknown:true});};
 const lock=async(local,operation)=>{
  if(operation==='acquire')acquireAttempted=true;
  try{
  const path=join(spec.evidence_root,`${env.WFR_TAG}-lock-${operation}.json`);
  const r=JSON.parse(await local.run('lock',JSON.stringify({root:rootLock,serial:env.SERIAL,operation,owner:env.WFR_TAG,epoch,receipt:{path,run:env.WFR_TAG,profile:env.P,serial:env.SERIAL}})));
  if(r.owner!==env.WFR_TAG||r.epoch!==epoch||r.readback_owner!==(operation==='release'?'none':env.WFR_TAG))throw fail('LOCAL_LOCK');
  if(operation==='acquire'){owned=true;onLocked(true);}if(operation==='release'){owned=false;onLocked(false);}return r;
  }catch(error){throw resourceUnknown(error);}
 };
 const releaseCentral=async()=>{try{return await lease.release();}catch(error){throw resourceUnknown(error);}};
 const assertLocal=()=>{try{if(!owned||readFileSync(join(rootLock,env.SERIAL+'.lock','owner'),'utf8').trim()!==env.WFR_TAG||readFileSync(join(rootLock,env.SERIAL+'.lock','preflight_epoch'),'utf8').trim()!==epoch)throw fail('OWNER_CHANGED');}catch(error){throw resourceUnknown(error);}};
 const perform=async(purpose,signal,body)=>{
  if(unsafe||current||state.executionUnknown)throw fail('PREVIOUS_UNKNOWN');
  const deadline=Math.min(state.budgetDeadline,purpose==='cleanup'?formal.cleanup_deadline_ms:formal.deadline_ms);
  if(!Number.isSafeInteger(deadline)||deadline<=Date.now()+10000)throw fail('BUDGET');
  // Reserve protocol closure inside the original Activity budget, never 120s per shell tree.
  let io,driver,result,error;const workerDeadlineMs=deadline-10000;
  try{
   current={purpose};io=await startPublicCodePreflightIO({root,env,frozen,state,lease,purpose,workerDeadlineMs,receiptDeadlineMs:deadline,signal,prepareLocal:local=>lock(local,purpose==='preflight'?'acquire':'refresh'),assertLocal});
   driver=createPreflightPhoneDriver({adb:io.adb,local:io.local,evidenceRoot:spec.evidence_root,owner:env.WFR_TAG,profile:env.P,serial:env.SERIAL,...frozen.preflight_profile,expectedAccount:spec.expected_account,deadlineMs:workerDeadlineMs,assertResources:async()=>{await io.assertResources();if(owned){if(readFileSync(join(rootLock,env.SERIAL+'.lock','owner'),'utf8').trim()!==env.WFR_TAG||readFileSync(join(rootLock,env.SERIAL+'.lock','preflight_epoch'),'utf8').trim()!==epoch)throw fail('OWNER_CHANGED');}},purpose,signal});
   result=await body({io,driver});
  }catch(e){error=e;}
  finally{
   driver?.seal();let stopped=error?.executionStopped===true;
   if(io)try{const proof=await io.close();stopped=proof.execution_stopped;writeFileSync(join(io.directory,'activity-close.json'),JSON.stringify({purpose,epoch,...proof}),{mode:0o600});}catch{stopped=false;}
   else if(!error)stopped=true;
   current=null;
   if(!stopped||unsafe){unsafe=true;state.nativeStopUnproven=true;state.executionUnknown=true;error=Object.assign(error||fail('STOP_UNKNOWN'),{executionStopped:false,externalEffect:'unknown'});}
   else if(error)error.executionStopped=true;
  }
  if(error)throw error;return result;
 };
 return {
  async preflight({signal}={}){
   if(state.company_config?.expected_sender!==spec.expected_account)throw fail('COMPANY_ACCOUNT');
   return perform('preflight',signal,async({io,driver})=>{
    await driver.run('preflight');await driver.run('wake');await driver.run('unlock');await driver.run('open-app');
    const output=await driver.run('account-current',env.WFR_TAG+'-account'),id=output.match(/^douyin_id=(.+)$/m)?.[1]?.trim();
    if(id!==spec.expected_account)throw fail('ACCOUNT');state.account=id;
    return {device_verified:true,lock_acquired:true,call_state_idle:true,account_verified:true,douyin_id:id,central_lock_task_id:state.task_id,central_lock_run_id:state.run_id};
   });
  },
  async cleanup({signal}={}){
   if(unsafe||state.executionUnknown)throw Object.assign(fail('PREVIOUS_UNKNOWN'),{executionStopped:false,externalEffect:'unknown'});
   // A new native domain cannot launder an earlier generic process UNKNOWN.
   if(state.nativeStopUnproven){
    const scope={run_id:state.run_id,task_id:state.task_id,source_commit:state.source_commit};
    if(!collectionCleanupEvidence(state.collectionReturnedEvidence,{...scope,activity:'collection'})&&!discoveryCleanupEvidence(state.discoveryCleanupEvidence,{...scope,activity:'collect_videos'}))throw Object.assign(fail('PREVIOUS_UNKNOWN'),{executionStopped:false,externalEffect:'unknown'});
   }
   if(!owned){const released=lease.attempted?await releaseCentral():false;return {status:'skipped',no_lock:true,central_lock_released:Number(released)};}
   const result=await perform('cleanup',signal,async({io,driver})=>{
    const close_stdout=await driver.run('close-app'),desktop_stdout=await driver.run('return-safe-desktop'),evidenceId=`${env.WFR_TAG}-${env.WFR_ATTEMPT}-cleanup-desktop`;
    const pngFile=(await driver.run('snapshot-evidence',evidenceId)).trim(),xmlFile=(await driver.run('ui-evidence',evidenceId)).trim();
    const launcher=desktop_stdout.match(/^launcher=(.+)$/m)?.[1],xml=readFileSync(xmlFile,'utf8'),png=readFileSync(pngFile);
    const packages=JSON.parse(await io.desktop(launcher,xml));
    // Desktop parsing is a fixed nofork leaf; bind it to the exact original bundle.
    desktopProof={close_stdout,desktop_stdout,launcher,xml,png,packages};
    const nativeOptions=this.desktopVerificationOptions(),scope={run:env.WFR_TAG,run_id:state.run_id,task_id:state.task_id,source_commit:state.source_commit,profile:env.P,serial:env.SERIAL};
    const proof=captureCleanupReadback({runDir:dir,evidenceRoot:spec.evidence_root,scope,close_stdout,desktop_stdout,pngFile,xmlFile,evidenceId,nativeOptions});
    if(!verifyCleanupReadback({runDir:dir,scope,digest:proof.digest,nativeOptions}))throw fail('DESKTOP_READBACK');
    return {close_app:true,close_app_attempts:1,safe_desktop:true,safe_desktop_visible:1,failures:[],central_lock_task_id:state.task_id,central_lock_run_id:state.run_id,cleanup_readback_verified:1,cleanup_readback_digest:proof.digest};
   });
   // The complete phone producer must close BEFORE releasing either resource.
   const directory=join(dir,'public-code-preflight','release-'+randomUUID());mkdirSync(directory,{mode:0o700});
   const local=await startPreflightLocalLeaves({root,directory,sourceFiles,python:spec.executables.python,deadlineMs:state.budgetDeadline,env});
   try{await lock(local,'release');}finally{if((await local.close()).execution_stopped!==true){unsafe=true;state.nativeStopUnproven=true;state.executionUnknown=true;throw Object.assign(fail('RELEASE_UNKNOWN'),{executionStopped:false,externalEffect:'unknown'});}}
   const centralReleased=await releaseCentral();return {...result,lock_released:1,no_lock:true,central_lock_released:Number(centralReleased)};
  },
  desktopVerificationOptions(){return {readDesktopPackages:b=>{const p=desktopProof;if(!p||['close_stdout','desktop_stdout','launcher','xml'].some(k=>b[k]!==p[k])||!b.png.equals(p.png))throw fail('DESKTOP_PROOF');return [...p.packages];}};},
  async quarantine(){
   if(!owned&&!acquireAttempted)return {verified:!unsafe,not_owned:true,physical_actions:0};
   const directory=join(dir,'public-code-preflight','quarantine-'+randomUUID());mkdirSync(directory,{mode:0o700});
   const local=await startPreflightLocalLeaves({root,directory,sourceFiles,python:spec.executables.python,deadlineMs:Date.now()+20000,env});
   try{const r=await lock(local,'quarantine');return {verified:r.lock==='quarantined'&&r.review_required===true,physical_actions:0};}finally{if((await local.close()).execution_stopped!==true)throw fail('QUARANTINE_UNKNOWN');}
  },
 };
}
