// Parent-only preflight resource issuer. Serialized data is never cleanup authority.
import {readFileSync,lstatSync,realpathSync,appendFileSync,mkdirSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';import {join,resolve} from 'node:path';import {userInfo} from 'node:os';import {createHash,randomUUID} from 'node:crypto';
import {isNativePhoneRuntime} from './native-phone-runtime.mjs';
import {skillLaunchDidNotStart} from './activity-skill-executor.mjs';
import {rawModelScopeStopped} from './activity-skill-parent-loop.mjs';
import {readFrozen,canonical} from './runtime-definition.mjs';import {readBinding} from './runtime-binding.mjs';import {rpcSource} from './leadgen-client.mjs';import {createPreflightMetadata} from './preflight-metadata.mjs';import {createPreflightPoolFactory,assertPreflightProfile} from './preflight-control-scope.mjs';import {startPreflightNativeDomain,preflightDomainClosure} from './preflight-native-domain.mjs';import {assertPreflightPng,createPreflightPhoneDriver} from './preflight-phone-driver.mjs';import {startPreflightLocalLeaves} from './preflight-local-leaves.mjs';
const phoneProviders=new WeakMap();
export function attachNativePhoneRuntime(runtime,provider){if(!runtimes.has(runtime)||!isNativePhoneRuntime(provider)||phoneProviders.has(runtime))fail('PHONE_PROVIDER');phoneProviders.set(runtime,provider);}
const runtimes=new WeakSet(),records=new WeakMap(),handoffIssuers=new WeakMap(),handoffs=new WeakMap(),hash=b=>createHash('sha256').update(b).digest('hex');
export const isPreflightRuntime=value=>runtimes.has(value);
const fail=reason=>{throw Object.assign(Error('PREFLIGHT_SCOPE_'+reason),{executionStopped:false});};
function official(proof,source){const r=proof?.receipt;return proof?.execution_stopped===true&&r?.source_commit===source&&r.execution_stopped===true&&r.owner_execution_stopped===true&&r.child_execution_stopped===true&&r.terminal?.runId===r.child_run_id&&Number.isFinite(r.terminal?.endedAt);}
// Read-only ownership facts. This capability does not grant a new phone action,
// budget, model permission or any remote execution-stop assertion.
export function issuePreflightPhoneHandoff(runtime,scope){const issuer=handoffIssuers.get(runtime);if(!issuer)fail('HANDOFF_RUNTIME');return issuer(scope);}
export function readPreflightPhoneHandoff(capability,{runtime,scope}={}){const r=handoffs.get(capability);if(!r||r.runtime!==runtime||r.scope!==canonical(scope))fail('HANDOFF_BRAND');return r.read();}
// The handoff only reports the original preflight ownership. Each later AV
// still needs its own frozen B authority, budget and worker-stop lifecycle.
function phoneHandoffActivity(scope,frozen){
 if(scope?.workflow!==frozen.agent_input.workflow_key)return false;
 if(scope.workflow==='douyin_video_discovery')return Boolean(frozen.discovery_phone_scope)&&scope.activity==='collect_videos';
 return scope.workflow==='douyin_video_processing'&&Boolean(frozen.collection_phone_scope)&&['qualification','collection'].includes(scope.activity);
}
function ownershipBytes(path,max=4096){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=fstatSync(fd);if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o777)!==0o600||before.nlink!==1||before.size>max)fail('HANDOFF_OWNER');const bytes=Buffer.alloc(before.size+1);let n=0,k;while(n<bytes.length&&(k=readSync(fd,bytes,n,bytes.length-n,null))>0)n+=k;const after=fstatSync(fd),current=lstatSync(path);if(current.isSymbolicLink()||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]||before[key]!==current[key])||n!==before.size)fail('HANDOFF_OWNER');return bytes.subarray(0,n);}finally{closeSync(fd);}
}
export function createPreflightRuntime({root,env,frozen,binding,taskId,poolFactory}){
 assertPreflightProfile({env,frozen});
 const createPool=poolFactory||createPreflightPoolFactory({runtimeRoot:root,frozen,env}),fixed=frozen.agent_input;
 const metadata=createPreflightMetadata({directory:env.WFR_RUN_DIR,source:rpcSource(frozen),scope:{workflow:fixed.workflow_key,run:fixed.run_tag,line:fixed.line,profile:fixed.profile,serial:fixed.serial,source_run:fixed.source_run,limit:fixed.limit,sources:frozen.discovery_input?.sources},createPool});
 let current,previous,bootstrapUnknown=false;
 async function releaseOwned(r){
   const local=await startPreflightLocalLeaves({root,directory:join(env.WFR_RUN_DIR,'preflight-native-scopes'),sourceFiles:r.sourceFiles,python:r.spec.executables.python,deadlineMs:r.scope.receipt_deadline_ms,env});
   try{
    const path=join(r.spec.evidence_root,`${r.identity.owner}-lock-release.json`),result=JSON.parse(await local.run('lock',JSON.stringify({root:r.lockRoot,serial:env.SERIAL,operation:'release',owner:r.identity.owner,epoch:r.epoch,receipt:{path,run:r.identity.owner,profile:env.P,serial:env.SERIAL}})));
    if(result.lock!=='released'||result.owner!==r.identity.owner||result.epoch!==r.epoch||result.readback_owner!=='none'||result.readback_epoch!=='none')fail('RELEASE_READBACK');
    appendFileSync(join(env.WFR_RUN_DIR,'preflight-lock-events.jsonl'),JSON.stringify({...r.identity,epoch:r.epoch,operation:'release',result,at:new Date().toISOString()})+'\n',{mode:0o600});r.owned=false;r.released=true;
   }catch(error){r.unknown=true;throw error;}finally{const proof=await local.close();if(proof.execution_stopped!==true){r.unknown=true;fail('RELEASE_NATIVE_UNKNOWN');}}
 }
 const runtime={metadata,supports:activity=>phoneProviders.get(runtime)?.supports(activity)===true,nativeState:()=>({execution_unknown:bootstrapUnknown||metadata.snapshot().unknown||Boolean(current&&records.get(current)?.unknown)}),
  async closeUnstarted(scope,proof){
   if(current||previous||bootstrapUnknown||!skillLaunchDidNotStart(proof,scope)||scope.activity!=='preflight'||scope.task_id!==taskId||scope.binding_id!==binding.id||scope.run_id!==binding.run_id||scope.source_commit!==frozen.deployment.source_commit||scope.profile!==env.P||scope.serial!==env.SERIAL)fail('NO_START_AUTHORITY');
   const stopped=await metadata.close();if(stopped.execution_stopped!==true||stopped.pending!==0||metadata.snapshot().unknown)fail('NO_START_METADATA_UNKNOWN');
   const identity=Object.freeze({task_id:taskId,run_id:binding.run_id,binding_id:binding.id,source_commit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL,owner:env.WFR_TAG});
   const r={identity,scope:structuredClone(scope),closed:true,noLaunch:true,official:false,unknown:false,owned:false,acquireAttempted:false,released:false,zeroLocal:true,spec:frozen.discovery_phone_scope||frozen.collection_phone_scope};
   const handle=Object.freeze({snapshot:()=>({closed:true,owned:false,unknown:false,resource_only_cleanup:true}),close:async next=>{if(!skillLaunchDidNotStart(next,scope))fail('NO_START_AUTHORITY');return {execution_stopped:true,physical_actions:0};}});records.set(handle,r);previous=handle;
   return {domain:'parent-preflight-no-start/v1',execution_stopped:true,physical_actions:0};
  },
  zeroLocalStart(scope){const r=previous&&records.get(previous);return Boolean(r?.zeroLocal&&r.closed&&r.noLaunch&&!r.unknown&&!r.owned&&!r.acquireAttempted&&!bootstrapUnknown&&!metadata.snapshot().unknown&&['task_id','run_id','binding_id','source_commit','profile','serial'].every(k=>scope[k]===r.identity[k]));},
  async prepare(scope,ctx){
   if(!['preflight','cleanup'].includes(scope.activity))fail('ACTIVITY');
   if(['execution_transport','max_turns','agent_nonce'].some(key=>Object.hasOwn(scope,key))||Object.hasOwn(frozen,'execution_transport')){
    if(scope.execution_transport!=='raw-model-v1'||frozen.execution_transport!==scope.execution_transport||frozen.agent_input.execution_transport!==scope.execution_transport
      ||!Number.isInteger(scope.max_turns)||scope.max_turns<1||scope.max_turns>64||frozen.max_turns!==scope.max_turns||frozen.agent_input.max_turns!==scope.max_turns||!/^[a-f0-9]{48}$/.test(scope.agent_nonce||''))fail('RAW_TRANSPORT');
   }
   const spec=frozen.discovery_phone_scope||frozen.collection_phone_scope,identity={task_id:taskId,run_id:binding.run_id,binding_id:binding.id,source_commit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL,owner:env.WFR_TAG};Object.freeze(identity);
   if(!spec||spec.version!==1||scope.task_id!==taskId||scope.binding_id!==binding.id||scope.run_id!==binding.run_id||ctx.state.source_commit!==identity.source_commit||ctx.state.task_id!==taskId)fail('IDENTITY');
   for(const k of ['task_id','run_id','source_commit','profile','serial'])if(spec[k]!==identity[k]||scope[k]!==identity[k])fail('IDENTITY');
   if(scope.workflow!==fixed.workflow_key||scope.run!==identity.owner)fail('IDENTITY');
   const prior=previous&&records.get(previous);
   if(ctx.state.company_config?.expected_sender!==spec.expected_account&&!(scope.activity==='cleanup'&&runtime.zeroLocalStart(scope)))fail('EXPECTED_ACCOUNT');
   if(realpathSync(root)!==realpathSync(join(env.WFR_RUN_DIR,'runtime')))fail('ROOT');
   const sourceFiles=Object.fromEntries(Object.entries(frozen.files).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
   const stable=()=>{if(readFrozen(env.WFR_RUN_DIR).snapshot_sha256!==frozen.snapshot_sha256||readBinding(env.WFR_RUN_DIR,env.WFR_ATTEMPT,frozen).id!==binding.id||Object.entries(sourceFiles).some(([p,h])=>{const file=join(root,p),s=lstatSync(file);return !s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||hash(readFileSync(file))!==h;}))fail('SOURCE');};stable();
   if(binding.task_id===null){if(typeof ctx.verifyPhoneAssociation!=='function')fail('TASK_ASSOCIATION');await ctx.verifyPhoneAssociation({frozen,binding,scope:spec});}else if(binding.task_id!==taskId)fail('TASK_ASSOCIATION');
   if(scope.activity==='cleanup'&&(metadata.snapshot().unknown||!prior||!prior.closed||!(prior.official||prior.noLaunch)||!(preflightDomainClosure(prior.domain)||prior.zeroLocal===true)||prior.used))fail('CLEANUP_AUTHORITY');if(scope.activity==='cleanup')prior.used=true;
   if(scope.activity==='cleanup'&&(prior.noLaunch||!prior.owned&&!prior.acquireAttempted)){
    const r={identity,scope,ctx,prior,resourceOnlyCleanup:true,zeroLocal:prior.zeroLocal===true,closed:false,noLaunch:false,unknown:false,released:false,owned:prior.owned,epoch:prior.epoch,spec:prior.spec,sourceFiles:prior.sourceFiles,lockRoot:prior.lockRoot,stable:prior.stable,assertResources:prior.assertResources};
    const handle={identity,activity:'cleanup',phone:async()=>fail('NO_LOCAL_RESOURCE'),heartbeat:async()=>({renewed:false,physical_actions:0,resource_only_cleanup:true}),async close(proof){if(!skillLaunchDidNotStart(proof,scope)){r.unknown=true;fail('NO_LAUNCH_AUTHORITY');}r.closed=true;r.noLaunch=true;return {domain:'parent-preflight-no-local-actions-v1',execution_stopped:true,physical_cleanup_required:false};},snapshot:()=>({closed:r.closed,official:false,owned:r.owned,unknown:r.unknown,resource_only_cleanup:true,facts:{physical_cleanup_not_required:true}})};
    r.handle=handle;records.set(handle,r);current=handle;return handle;
   }
   const profile=assertPreflightProfile({env,frozen}),directory=join(env.WFR_RUN_DIR,'preflight-native-scopes',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
   const r={identity,scope:structuredClone(scope),ctx,spec,sourceFiles,profile,epoch:prior?.epoch||randomUUID(),owned:scope.activity==='cleanup'?prior.owned:false,closed:false,official:false,unknown:false,physicalSequence:0,desktopCapability:null};
   const assertResources=async()=>{stable();assertPreflightProfile({env,frozen});if(hash(readFileSync(profile.path))!==profile.sha256||ctx.state.executionUnknown||ctx.state.nativeStopUnproven)fail('RESOURCE_UNKNOWN');await ctx.assertResources(scope);if(r.owned){const lock=join(userInfo().homedir,'.local/share/zenithjoy/phone-locks',env.SERIAL+'.lock');if(readFileSync(join(lock,'owner'),'utf8').trim()!==identity.owner||readFileSync(join(lock,'preflight_epoch'),'utf8').trim()!==r.epoch)fail('LOCAL_OWNER');}};
   await assertResources();let domain;try{domain=await startPreflightNativeDomain({root,directory,sourceFiles,python:spec.executables.python,policy:spec.policy,serial:env.SERIAL,workerDeadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms,env});}catch(error){bootstrapUnknown=true;throw error;}r.domain=domain;
   const localRoot=join(userInfo().homedir,'.local/share/zenithjoy/phone-locks');
   const lock=async operation=>{await assertResources();const kind=operation==='acquire'?'acquire':operation==='release'?'release':'refresh',path=join(spec.evidence_root,`${identity.owner}-lock-${kind}.json`);const result=JSON.parse(await domain.local('lock',JSON.stringify({root:localRoot,serial:env.SERIAL,operation,owner:identity.owner,epoch:r.epoch,receipt:{path,run:identity.owner,profile:env.P,serial:env.SERIAL}})));if(result.owner!==identity.owner||result.epoch!==r.epoch||result.readback_owner!==identity.owner)fail('LOCAL_READBACK');appendFileSync(join(env.WFR_RUN_DIR,'preflight-lock-events.jsonl'),JSON.stringify({...identity,epoch:r.epoch,operation,result,at:new Date().toISOString()})+'\n',{mode:0o600});return result;};
   let physicalAdb=(...args)=>domain.adb(...args);r.stable=stable;r.assertResources=assertResources;r.lockRoot=localRoot;r.lock=lock;const adb=async(...args)=>{await assertResources();r.physicalSequence++;r.desktopCapability=null;return physicalAdb(...args);};
   r.driver=createPreflightPhoneDriver({adb,local:{run:(...args)=>domain.local(...args)},purpose:scope.activity,evidenceRoot:spec.evidence_root,owner:identity.owner,profile:env.P,serial:env.SERIAL,model:profile.model,width:profile.width,height:profile.height,expectedAccount:spec.expected_account,deadlineMs:scope.worker_deadline_ms,assertResources});
   const handle={identity,activity:scope.activity,async phone(command,...args){if(!r.owned)fail('NO_LOCAL_OWNER');if(!['foreground','window','status','ui-evidence','snapshot-evidence'].includes(command))r.accountEvidence=null;const output=await r.driver.run(command,...args);if(command==='account-current'){const path=output.split('\n').find(line=>line.startsWith('profile_xml='))?.slice(12);if(path!==join(spec.evidence_root,args[0]+'-profile.xml'))fail('ACCOUNT_EVIDENCE');const bytes=ownershipBytes(path,4*1024*1024);r.accountEvidence={path,sha256:hash(bytes),account:spec.expected_account};}return output;},async heartbeat(){await lock('refresh');return {renewed:true};},async close(proof,desktop){
     const noLaunch=skillLaunchDidNotStart(proof,scope),stopped=scope.execution_transport==='raw-model-v1'
      ?proof?.execution_stopped===true&&rawModelScopeStopped(proof.raw_model_proof,scope):official(proof,identity.source_commit);r.official=stopped;r.noLaunch=noLaunch;
     try{
      if(stopped&&scope.activity==='cleanup'&&desktop){
       await assertResources();const {close_stdout,desktop_stdout,xml,png}=desktop;
       if(typeof xml!=='string'||!Buffer.isBuffer(png))fail('DESKTOP_INPUT');assertPreflightPng(png,{width:profile.width,height:profile.height});
       const launcher=desktop_stdout?.split('\n').find(line=>line.startsWith('launcher='))?.slice(9);if(!/^\w+(?:\.\w+)+$/.test(launcher||''))fail('DESKTOP_LAUNCHER');
       const packages=JSON.parse(await domain.desktop(launcher,xml));if(!Array.isArray(packages)||packages.some(p=>typeof p!=='string'))fail('DESKTOP_PARSE');
       r.desktopCapability={sequence:r.physicalSequence,launcher,close_sha256:hash(close_stdout),desktop_sha256:hash(desktop_stdout),xml_sha256:hash(xml),png_sha256:hash(png),packages:Object.freeze(packages)};
      }
     }finally{if(!r.closed){
      r.driver.seal();let control;try{control=await metadata.close();}catch{r.unknown=true;}r.proof=await domain.close();r.closed=true;
      if(!r.proof.execution_stopped||control?.execution_stopped!==true||control.pending!==0||r.acquireAttempted&&!r.owned)r.unknown=true;
      appendFileSync(join(env.WFR_RUN_DIR,'preflight-native-domain-close.jsonl'),JSON.stringify({...identity,epoch:r.epoch,activity:scope.activity,physical_sequence:r.physicalSequence,physical:r.proof,control,official_stopped:r.official,agent_not_launched:r.noLaunch,resource_unknown:r.unknown,at:new Date().toISOString()})+'\n',{mode:0o600});
     }}
     if(!stopped&&!noLaunch){r.unknown=true;fail('OFFICIAL_STOP');}return r.proof;
    },snapshot:()=>({closed:r.closed,official:r.official,owned:r.owned,epoch:r.epoch,unknown:r.unknown,facts:structuredClone(r.facts||{})})};r.handle=handle;records.set(handle,r);current=handle;
   if(scope.activity==='preflight'){
    previous=handle;r.acquireAttempted=true;await lock('acquire');r.owned=true;const version=await adb('version');if(!/Android Debug Bridge version 1\.0\.41/.test(version))fail('ADB_VERSION');
    await domain.local('route',JSON.stringify({config:env.ZJ_ADB_HOST_CONFIG||join(userInfo().homedir,'.config/zenithjoy/adb-service.json'),policy:spec.policy,serial:env.SERIAL}));
    if(phoneProviders.has(runtime))physicalAdb=await phoneProviders.get(runtime).preparePreflight(scope,{assertResources,hostAdb:(...args)=>domain.adb(...args)});
    const inspected=await r.driver.run('preflight');if(!inspected.split('\n').includes('serial='+env.SERIAL))fail('DEVICE');r.facts={device_verified:true,lock_acquired:true,call_state_idle:true};
   }
   if(scope.activity==='cleanup'&&phoneProviders.has(runtime))physicalAdb=await phoneProviders.get(runtime).preparePreflight(scope,{assertResources,hostAdb:(...args)=>domain.adb(...args)});
   return handle;
  },
  async refreshOwned(scope){
   const r=previous&&records.get(previous);if(!r?.owned||!r.closed||!r.official||r.unknown||r.released||!(phoneHandoffActivity(scope,frozen)||scope.workflow===frozen.agent_input.workflow_key&&scope.workflow==='douyin_video_processing'&&scope.activity==='dedup'&&frozen.collection_phone_scope)||Date.now()>=scope.worker_deadline_ms||['task_id','run_id','binding_id','source_commit','profile','serial'].some(k=>scope[k]!==r.identity[k]))fail('REFRESH_AUTHORITY');
   r.stable();const local=await startPreflightLocalLeaves({root,directory:join(env.WFR_RUN_DIR,'preflight-native-scopes'),sourceFiles:r.sourceFiles,python:r.spec.executables.python,deadlineMs:scope.worker_deadline_ms,env});let result;
   try{const path=join(r.spec.evidence_root,`${r.identity.owner}-lock-refresh.json`);result=JSON.parse(await local.run('lock',JSON.stringify({root:r.lockRoot,serial:env.SERIAL,operation:'refresh',owner:r.identity.owner,epoch:r.epoch,receipt:{path,run:r.identity.owner,profile:env.P,serial:env.SERIAL}})));if(result.lock!=='refreshed'||result.owner!==r.identity.owner||result.epoch!==r.epoch||result.readback_owner!==r.identity.owner)fail('REFRESH_READBACK');}
   finally{if((await local.close()).execution_stopped!==true){r.unknown=true;fail('REFRESH_UNKNOWN');}}
   return {renewed:true};
  },
  canFinalizeNoLocal(scope){
   const p=previous&&records.get(previous);return Boolean(!bootstrapUnknown&&!metadata.snapshot().unknown&&p?.closed&&(p.official||p.noLaunch)&&!p.unknown&&(p.noLaunch&&p.owned||!p.owned&&!p.acquireAttempted)&&(preflightDomainClosure(p.domain)||p.zeroLocal===true)&&['task_id','run_id','binding_id','source_commit','profile','serial'].every(k=>scope[k]===p.identity[k]));
  },
  desktopVerificationOptions(){
   const r=records.get(current),cap=r?.desktopCapability;
   if(!r||!r.closed||!r.official||r.unknown||!preflightDomainClosure(r.domain)||!cap)fail('DESKTOP_AUTHORITY');
   return Object.freeze({readDesktopPackages:bundle=>{
    r.stable();if(current!==r.handle||r.physicalSequence!==cap.sequence||bundle.launcher!==cap.launcher||hash(bundle.close_stdout)!==cap.close_sha256||hash(bundle.desktop_stdout)!==cap.desktop_sha256||hash(bundle.xml)!==cap.xml_sha256||hash(bundle.png)!==cap.png_sha256)fail('DESKTOP_BINDING');return [...cap.packages];
   }});
  },
  async quarantine(){
   const r=records.get(current);if(!r)return {verified:false,not_owned:true,physical_actions:0};if(r.resourceOnlyCleanup&&!r.owned||r.released||!r.owned&&!r.acquireAttempted)return {verified:!bootstrapUnknown,not_owned:true,physical_actions:0};
   r.stable();const deadline=Date.now()+20000; // Existing protective quarantine window; never reopens business/phone admission.
   const local=await startPreflightLocalLeaves({root,directory:join(env.WFR_RUN_DIR,'preflight-native-scopes'),sourceFiles:r.sourceFiles,python:r.spec.executables.python,deadlineMs:deadline,env});let result;
   try{const path=join(r.spec.evidence_root,`${r.identity.owner}-lock-quarantine.json`);result=JSON.parse(await local.run('lock',JSON.stringify({root:r.lockRoot,serial:env.SERIAL,operation:'quarantine',owner:r.identity.owner,epoch:r.epoch,receipt:{path,run:r.identity.owner,profile:env.P,serial:env.SERIAL}})));appendFileSync(join(env.WFR_RUN_DIR,'preflight-lock-events.jsonl'),JSON.stringify({...r.identity,epoch:r.epoch,operation:'quarantine',authority_domain:'local-resource-protection-only',result,at:new Date().toISOString()})+'\n',{mode:0o600});}
   finally{const proof=await local.close();if(proof.execution_stopped!==true)fail('QUARANTINE_NATIVE_UNKNOWN');}
   return {verified:result.lock==='quarantined'&&result.review_required===true&&result.readback_owner===r.identity.owner&&result.readback_epoch===r.epoch,physical_actions:0};
  },
  async release(){
   const r=records.get(current);
   if(r?.resourceOnlyCleanup){
    if(r.released||!r.closed||!r.noLaunch||r.unknown||Date.now()>=r.scope.receipt_deadline_ms||!runtime.canFinalizeNoLocal(r.scope))fail('RELEASE_AUTHORITY');
    if(r.owned){await r.assertResources();await releaseOwned(r);return {local_resources_released:1,physical_cleanup_not_required:true,lock_released:1,no_lock:true};}
    r.released=true;appendFileSync(join(env.WFR_RUN_DIR,'preflight-lock-events.jsonl'),JSON.stringify({...r.identity,operation:'not_acquired_no_local_release',physical_actions:0,observed_at:new Date().toISOString()})+'\n',{mode:0o600});return {local_resources_released:1,physical_cleanup_not_required:true,lock_released:0,no_lock:false};
   }
   runtime.desktopVerificationOptions();
   if(r.released||!r.owned||Date.now()>=r.scope.receipt_deadline_ms)fail('RELEASE_AUTHORITY');await r.assertResources();
   await releaseOwned(r);
   return {lock_released:1,no_lock:true};
  },current:()=>current};
 handoffIssuers.set(runtime,inputScope=>{
  const scope=structuredClone(inputScope);
  const r=previous&&records.get(previous);
  const read=()=>{
   if(!r||current!==r.handle||r.closed!==true||r.official!==true||r.unknown||!r.owned||r.released||bootstrapUnknown||metadata.snapshot().unknown||!preflightDomainClosure(r.domain)||r.ctx.state.executionUnknown||r.ctx.state.nativeStopUnproven)fail('HANDOFF_RESOURCE');
   if(!phoneHandoffActivity(scope,frozen)||scope.execution_transport!=='raw-model-v1'||frozen.execution_transport!=='raw-model-v1'||scope.snapshot_sha256!==frozen.snapshot_sha256||!Number.isSafeInteger(scope.worker_deadline_ms)||!Number.isSafeInteger(scope.receipt_deadline_ms)||!Number.isSafeInteger(scope.deadline_ms)||scope.worker_deadline_ms>=scope.receipt_deadline_ms||scope.receipt_deadline_ms>=scope.deadline_ms||Date.now()>=scope.worker_deadline_ms||!/^[a-f0-9]{48}$/.test(scope.agent_nonce||'')||['task_id','run_id','binding_id','source_commit','profile','serial'].some(k=>scope[k]!==r.identity[k])||scope.run!==r.identity.owner)fail('HANDOFF_SCOPE');
   r.stable();assertPreflightProfile({env,frozen});
   if(!r.accountEvidence||r.ctx.state.account!==r.spec.expected_account||r.accountEvidence.account!==r.spec.expected_account||hash(ownershipBytes(r.accountEvidence.path,4*1024*1024))!==r.accountEvidence.sha256)fail('HANDOFF_ACCOUNT');
   const directory=join(r.lockRoot,env.SERIAL+'.lock'),st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||realpathSync(directory)!==resolve(directory))fail('HANDOFF_OWNER');
   for(const [name,value]of [['owner',r.identity.owner],['preflight_epoch',r.epoch],['standalone_review_required',r.identity.owner],['preflight_proof_required',r.epoch]])if(ownershipBytes(join(directory,name)).toString().trim()!==value)fail('HANDOFF_OWNER');
   return Object.freeze({...r.identity,epoch:r.epoch,account:r.accountEvidence.account,account_evidence:{path:r.accountEvidence.path,sha256:r.accountEvidence.sha256},lock_root:r.lockRoot});
  };
  read();r.handoffIssued??=new Set();if(r.handoffIssued.has(scope.activity))fail('HANDOFF_REPLAY');r.handoffIssued.add(scope.activity);
  const cap=Object.freeze({});handoffs.set(cap,{runtime,scope:canonical(scope),read});return cap;
 });
 runtimes.add(runtime);return Object.freeze(runtime);
}
