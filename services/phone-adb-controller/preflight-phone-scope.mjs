// Parent-only preflight resource issuer. Serialized data is never cleanup authority.
import {readFileSync,lstatSync,realpathSync,appendFileSync,mkdirSync} from 'node:fs';import {join,resolve} from 'node:path';import {userInfo} from 'node:os';import {createHash,randomUUID} from 'node:crypto';
import {skillLaunchDidNotStart} from './activity-skill-executor.mjs';
import {readFrozen} from './runtime-definition.mjs';import {readBinding} from './runtime-binding.mjs';import {rpcSource} from './leadgen-client.mjs';import {createPreflightMetadata} from './preflight-metadata.mjs';import {createPreflightPoolFactory} from './preflight-control-scope.mjs';import {startPreflightNativeDomain,preflightDomainClosure} from './preflight-native-domain.mjs';import {assertPreflightPng,createPreflightPhoneDriver} from './preflight-phone-driver.mjs';import {startPreflightLocalLeaves} from './preflight-local-leaves.mjs';
const runtimes=new WeakSet(),records=new WeakMap(),hash=b=>createHash('sha256').update(b).digest('hex');
export const isPreflightRuntime=value=>runtimes.has(value);
const fail=reason=>{throw Object.assign(Error('PREFLIGHT_SCOPE_'+reason),{executionStopped:false});};
function profileFacts(env){
 const path=env.DOUYIN_PHONE_REGISTRY||join(userInfo().homedir,'.config/openclaw/douyin-phone-profiles.tsv'),st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022)||st.size>1024*1024)fail('PROFILE');const bytes=readFileSync(path);let columns,rows=[];
 for(const line of bytes.toString('utf8').split(/\r?\n/)){const row=line.split('\t');if(['profile','#profile'].includes(row[0])){columns=Object.fromEntries(row.map((name,i)=>[name.replace(/^#/,''),i]));continue;}if(!line.trim()||line.startsWith('#'))continue;if(row[0]===env.P)rows.push(row);}
 if(rows.length!==1)fail('PROFILE');const row=rows[0],value=name=>row[columns?.[name]]?.trim()||'',serial=columns?value('serial'):row[1],model=columns?value('model'):row[2],width=columns?value('width')||value('screen_w'):String(Number(row[3])+1),height=columns?value('height')||value('screen_h'):String(Number(row[4])+1);
 if(serial!==env.SERIAL||!model||columns&&value('enabled')==='false'||![width,height].every(v=>/^\d+$/.test(v)&&Number(v)>0))fail('PROFILE');return {path,sha256:hash(bytes),model,width:Number(width),height:Number(height)};
}
function official(proof,source){const r=proof?.receipt;return proof?.execution_stopped===true&&r?.source_commit===source&&r.execution_stopped===true&&r.owner_execution_stopped===true&&r.child_execution_stopped===true&&r.terminal?.runId===r.child_run_id&&Number.isFinite(r.terminal?.endedAt);}
export function createPreflightRuntime({root,env,frozen,binding,taskId}){
 const createPool=createPreflightPoolFactory({runtimeRoot:root,frozen,env}),fixed=frozen.agent_input;
 const metadata=createPreflightMetadata({directory:env.WFR_RUN_DIR,source:rpcSource(frozen),scope:{workflow:fixed.workflow_key,run:fixed.run_tag,line:fixed.line,profile:fixed.profile,serial:fixed.serial,source_run:fixed.source_run,limit:fixed.limit,sources:frozen.discovery_input?.sources},createPool});
 let current,previous;
 const runtime={metadata,supports:()=>false,nativeState:()=>({execution_unknown:metadata.snapshot().unknown||Boolean(current&&records.get(current)?.unknown)}),
  async prepare(scope,ctx){
   if(!['preflight','cleanup'].includes(scope.activity))fail('ACTIVITY');
   const spec=frozen.discovery_phone_scope||frozen.collection_phone_scope,identity={task_id:taskId,run_id:binding.run_id,binding_id:binding.id,source_commit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL,owner:env.WFR_TAG};
   if(!spec||spec.version!==1||scope.task_id!==taskId||scope.binding_id!==binding.id||scope.run_id!==binding.run_id||ctx.state.source_commit!==identity.source_commit||ctx.state.task_id!==taskId)fail('IDENTITY');
   for(const k of ['task_id','run_id','source_commit','profile','serial'])if(spec[k]!==identity[k])fail('IDENTITY');
   if(ctx.state.company_config?.expected_sender!==spec.expected_account)fail('EXPECTED_ACCOUNT');
   if(realpathSync(root)!==realpathSync(join(env.WFR_RUN_DIR,'runtime')))fail('ROOT');
   const sourceFiles=Object.fromEntries(Object.entries(frozen.files).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
   const stable=()=>{if(readFrozen(env.WFR_RUN_DIR).snapshot_sha256!==frozen.snapshot_sha256||readBinding(env.WFR_RUN_DIR,env.WFR_ATTEMPT,frozen).id!==binding.id||Object.entries(sourceFiles).some(([p,h])=>{const file=join(root,p),s=lstatSync(file);return !s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||hash(readFileSync(file))!==h;}))fail('SOURCE');};stable();
   if(binding.task_id===null){if(typeof ctx.verifyPhoneAssociation!=='function')fail('TASK_ASSOCIATION');await ctx.verifyPhoneAssociation({frozen,binding,scope:spec});}else if(binding.task_id!==taskId)fail('TASK_ASSOCIATION');
   const prior=previous&&records.get(previous);if(scope.activity==='cleanup'&&(metadata.snapshot().unknown||!prior||!prior.closed||!(prior.official||prior.noLaunch)||!preflightDomainClosure(prior.domain)||prior.used))fail('CLEANUP_AUTHORITY');if(scope.activity==='cleanup')prior.used=true;
   const profile=profileFacts(env),directory=join(env.WFR_RUN_DIR,'preflight-native-scopes',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
   const r={identity,scope:structuredClone(scope),ctx,spec,sourceFiles,profile,epoch:prior?.epoch||randomUUID(),owned:scope.activity==='cleanup'?prior.owned:false,closed:false,official:false,unknown:false,physicalSequence:0,desktopCapability:null};
   const assertResources=async()=>{stable();if(hash(readFileSync(profile.path))!==profile.sha256||ctx.state.executionUnknown||ctx.state.nativeStopUnproven)fail('RESOURCE_UNKNOWN');await ctx.assertResources(scope);if(r.owned){const lock=join(userInfo().homedir,'.local/share/zenithjoy/phone-locks',env.SERIAL+'.lock');if(readFileSync(join(lock,'owner'),'utf8').trim()!==identity.owner||readFileSync(join(lock,'preflight_epoch'),'utf8').trim()!==r.epoch)fail('LOCAL_OWNER');}};
   await assertResources();const domain=await startPreflightNativeDomain({root,directory,sourceFiles,python:spec.executables.python,policy:spec.policy,serial:env.SERIAL,workerDeadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms,env});r.domain=domain;
   const localRoot=join(userInfo().homedir,'.local/share/zenithjoy/phone-locks');
   const lock=async operation=>{await assertResources();const kind=operation==='acquire'?'acquire':operation==='release'?'release':'refresh',path=join(spec.evidence_root,`${identity.owner}-lock-${kind}.json`);const result=JSON.parse(await domain.local('lock',JSON.stringify({root:localRoot,serial:env.SERIAL,operation,owner:identity.owner,epoch:r.epoch,receipt:{path,run:identity.owner,profile:env.P,serial:env.SERIAL}})));if(result.owner!==identity.owner||result.epoch!==r.epoch||result.readback_owner!==identity.owner)fail('LOCAL_READBACK');appendFileSync(join(env.WFR_RUN_DIR,'preflight-lock-events.jsonl'),JSON.stringify({...identity,epoch:r.epoch,operation,result,at:new Date().toISOString()})+'\n',{mode:0o600});return result;};
   r.stable=stable;r.assertResources=assertResources;r.lockRoot=localRoot;r.lock=lock;const adb=async(...args)=>{await assertResources();r.physicalSequence++;r.desktopCapability=null;return domain.adb(...args);};
   r.driver=createPreflightPhoneDriver({adb,local:{run:(...args)=>domain.local(...args)},purpose:scope.activity,evidenceRoot:spec.evidence_root,owner:identity.owner,profile:env.P,serial:env.SERIAL,model:profile.model,expectedAccount:spec.expected_account,deadlineMs:scope.worker_deadline_ms,assertResources});
   const handle={identity,activity:scope.activity,async phone(command,...args){if(!r.owned)fail('NO_LOCAL_OWNER');return r.driver.run(command,...args);},async heartbeat(){await lock('refresh');return {renewed:true};},async close(proof,desktop){
     const noLaunch=skillLaunchDidNotStart(proof,scope),stopped=official(proof,identity.source_commit);r.official=stopped;r.noLaunch=noLaunch;
     try{
      if(stopped&&scope.activity==='cleanup'&&desktop){
       await assertResources();const {close_stdout,desktop_stdout,xml,png}=desktop;
       if(typeof xml!=='string'||!Buffer.isBuffer(png))fail('DESKTOP_INPUT');assertPreflightPng(png);
       const launcher=desktop_stdout?.split('\n').find(line=>line.startsWith('launcher='))?.slice(9);if(!/^\w+(?:\.\w+)+$/.test(launcher||''))fail('DESKTOP_LAUNCHER');
       const packages=JSON.parse(await domain.desktop(launcher,xml));if(!Array.isArray(packages)||packages.some(p=>typeof p!=='string'))fail('DESKTOP_PARSE');
       r.desktopCapability={sequence:r.physicalSequence,launcher,close_sha256:hash(close_stdout),desktop_sha256:hash(desktop_stdout),xml_sha256:hash(xml),png_sha256:hash(png),packages:Object.freeze(packages)};
      }
     }finally{if(!r.closed){r.driver.seal();r.proof=await domain.close();r.closed=true;if(!r.proof.execution_stopped)r.unknown=true;}}
     if(!stopped&&!noLaunch){r.unknown=true;fail('OFFICIAL_STOP');}return r.proof;
    },snapshot:()=>({closed:r.closed,official:r.official,owned:r.owned,epoch:r.epoch,unknown:r.unknown,facts:structuredClone(r.facts||{})})};r.handle=handle;records.set(handle,r);current=handle;
   if(scope.activity==='preflight'){
    previous=handle;const version=await adb('version');if(!/Android Debug Bridge version 1\.0\.41/.test(version))fail('ADB_VERSION');
    await domain.local('route',JSON.stringify({config:env.ZJ_ADB_HOST_CONFIG||join(userInfo().homedir,'.config/zenithjoy/adb-service.json'),policy:spec.policy,serial:env.SERIAL}));
    const inspected=await r.driver.run('preflight');if(!inspected.split('\n').includes('serial='+env.SERIAL))fail('DEVICE');await lock('acquire');r.owned=true;r.facts={device_verified:true,lock_acquired:true,call_state_idle:true};
   }
   return handle;
  },
  desktopVerificationOptions(){
   const r=records.get(current),cap=r?.desktopCapability;
   if(!r||!r.closed||!r.official||r.unknown||!preflightDomainClosure(r.domain)||!cap)fail('DESKTOP_AUTHORITY');
   return Object.freeze({readDesktopPackages:bundle=>{
    r.stable();if(current!==r.handle||r.physicalSequence!==cap.sequence||bundle.launcher!==cap.launcher||hash(bundle.close_stdout)!==cap.close_sha256||hash(bundle.desktop_stdout)!==cap.desktop_sha256||hash(bundle.xml)!==cap.xml_sha256||hash(bundle.png)!==cap.png_sha256)fail('DESKTOP_BINDING');return [...cap.packages];
   }});
  },
  async release(){
   const r=records.get(current);runtime.desktopVerificationOptions();
   if(r.released||!r.owned||Date.now()>=r.scope.receipt_deadline_ms)fail('RELEASE_AUTHORITY');await r.assertResources();
   const local=await startPreflightLocalLeaves({root,directory:join(env.WFR_RUN_DIR,'preflight-native-scopes'),sourceFiles:r.sourceFiles,python:r.spec.executables.python,deadlineMs:r.scope.receipt_deadline_ms,env});
   try{
    const path=join(r.spec.evidence_root,`${r.identity.owner}-lock-release.json`),result=JSON.parse(await local.run('lock',JSON.stringify({root:r.lockRoot,serial:env.SERIAL,operation:'release',owner:r.identity.owner,epoch:r.epoch,receipt:{path,run:r.identity.owner,profile:env.P,serial:env.SERIAL}})));
    if(result.lock!=='released'||result.owner!==r.identity.owner||result.epoch!==r.epoch||result.readback_owner!=='none'||result.readback_epoch!=='none')fail('RELEASE_READBACK');
    appendFileSync(join(env.WFR_RUN_DIR,'preflight-lock-events.jsonl'),JSON.stringify({...r.identity,epoch:r.epoch,operation:'release',result,at:new Date().toISOString()})+'\n',{mode:0o600});r.owned=false;r.released=true;
   }catch(error){r.unknown=true;throw error;}finally{const proof=await local.close();if(proof.execution_stopped!==true){r.unknown=true;fail('RELEASE_NATIVE_UNKNOWN');}}
   return {lock_released:1,no_lock:true};
  },current:()=>current};
 runtimes.add(runtime);return Object.freeze(runtime);
}
