// 新schema2每个phone IO的唯一fresh fence准入；不继承maintenance中央owner。
import {join,dirname,resolve} from 'node:path';import {userInfo} from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';
import {lstatSync,readdirSync,realpathSync,mkdirSync,constants,openSync,fstatSync,readFileSync,writeSync,fsyncSync,closeSync} from 'node:fs';import {randomUUID,createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {readBrain,reviewSource} from './device-epoch-fence-review.mjs';
import {admissionFailure,epochErrorCode,projectEpochDiagnostic} from './epoch-admission-diagnostic.mjs';
import {bytes,recordBytes,readPrivatePolicy,validateEpochRecord,freezeFenceReference,epochTransportSerial,isYueshengCleanEpoch,readYueshengEpochCompletion,isCloudExistingEpoch,readCloudExistingEpochCompletion} from './device-epoch-fence-reference.mjs';
export {freezeFenceReference};
import {readFrozen,digest,canonical,validateAgentInput} from './runtime-definition.mjs';
import {publicDomainTaskProjectionMatches,readPublicCodePreflightLock} from './public-domain-authority.mjs';
import {standaloneIdentityProjection,standaloneScope,standaloneTaskProjectionMatches,standaloneExecutionContextProjection,standaloneExecutionContextMatches,readStandaloneHostProof,standaloneHostProofPaths,standaloneLocalLockQuarantined} from './standalone-skill-authority.mjs';
import {epochSourceCompatibilityReference,epochCompatibilityRecordScope,verifyEpochSourceCompatibility,compatibilityReviewProjection,isCloudEpochSourceCompatibility,verifyCloudEpochSuccessorDeployment,verifyCloudEpochSuccessorProjection} from './epoch-source-compatibility.mjs';
import {hostOperation,parseDeviceInventory} from './device-epoch-fence-transport.mjs';
import {runDiagnostic,readDiagnosticProof} from './device-epoch-fence-diagnostics.mjs';
import {openFastAdbDaemonObservation} from './fast-adb-daemon-observation.mjs';
const here=dirname(fileURLToPath(import.meta.url)),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});},same=(a,b)=>canonical(a)===canonical(b),phone=f=>f.discovery_phone_scope??f.collection_phone_scope,identity=f=>f.standalone_skill??f.public_domain;
function preserveVerifierDiagnostic(runDir,frozen,error){
 const descriptors=[];
 try{
  const privateDirectory=path=>{
   need(resolve(path)===path&&realpathSync(path)===path,'EPOCH_DIAGNOSTIC_PATH');
   for(let p=path;;p=dirname(p)){need(!lstatSync(p).isSymbolicLink(),'EPOCH_DIAGNOSTIC_PATH');if(dirname(p)===p)break;}
   const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);descriptors.push(fd);
   const s=fstatSync(fd),actual=lstatSync(path);need(s.isDirectory()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700&&s.dev===actual.dev&&s.ino===actual.ino,'EPOCH_DIAGNOSTIC_DIRECTORY');return fd;
  };
  let directoryFd=privateDirectory(runDir);
  const path=join(runDir,'run-definition.json'),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);descriptors.push(fd);
  const s=fstatSync(fd);need(s.isFile()&&s.uid===process.getuid()&&s.nlink===1&&(s.mode&0o777)===0o600&&s.size<=4*1024*1024,'EPOCH_DIAGNOSTIC_FROZEN');
  const value=JSON.parse(readFileSync(fd,'utf8')),after=fstatSync(fd),named=lstatSync(path),{snapshot_sha256,...body}=value,p=identity(value),source=value.deployment?.source_commit;
  need(s.dev===named.dev&&s.ino===named.ino&&s.size===after.size&&s.mtimeMs===after.mtimeMs&&s.ctimeMs===after.ctimeMs
   &&same(value,frozen)&&digest(body)===snapshot_sha256&&/^[a-f0-9]{64}$/.test(snapshot_sha256||'')&&uuid.test(p?.run_id||'')&&uuid.test(p?.task_id||'')
   &&['workflow-domain/v1','codex-exec-v1'].includes(p.protocol)&&/^[a-f0-9]{40}$/.test(source||'')&&phone(value)?.source_commit===source,'EPOCH_DIAGNOSTIC_BINDING');
  const proof={protocol:'epoch-verifier-diagnostic/v1',producer:'node',attempt_id:randomUUID(),observed_at:new Date().toISOString(),pid:process.pid,
   run_id:p.run_id,task_id:p.task_id,source_commit:source,snapshot_sha256,finite_error_code:epochErrorCode(error)??null,
   epoch_diagnostic:projectEpochDiagnostic(error)??projectEpochDiagnostic(admissionFailure(error,'unknown'))};
  const raw=Buffer.from(JSON.stringify(proof)+'\n');need(raw.length<=4096,'EPOCH_DIAGNOSTIC_LIMIT');
  let directory=runDir;
  for(const name of ['epoch-fence-admission','diagnostics']){const next=join(directory,name);try{mkdirSync(next,{mode:0o700});fsyncSync(directoryFd);}catch(e){if(e.code!=='EEXIST')throw e;}directoryFd=privateDirectory(next);directory=next;}
  const names=readdirSync(directory);need(names.every(n=>/^(?:[0-2][0-9]|3[01])\.json$/.test(n)),'EPOCH_DIAGNOSTIC_QUOTA');
  for(let slot=0;slot<32;slot++){
   let out;try{out=openSync(join(directory,String(slot).padStart(2,'0')+'.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(e){if(e.code==='EEXIST')continue;throw e;}descriptors.push(out);
   const info=fstatSync(out);need(info.isFile()&&info.nlink===1&&info.uid===process.getuid()&&(info.mode&0o777)===0o600,'EPOCH_DIAGNOSTIC_FILE');
   let offset=0;while(offset<raw.length){const count=writeSync(out,raw,offset,raw.length-offset);need(count>0,'EPOCH_DIAGNOSTIC_WRITE');offset+=count;}
   fsyncSync(out);fsyncSync(directoryFd);break;
  }
 }catch{}
 finally{for(const fd of descriptors.reverse())try{closeSync(fd);}catch{}}
}
export function readBoundAdbDaemon(expected,{run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin',LANG:'C',LC_ALL:'C',TZ:'UTC'},timeout:3000,stdio:['ignore','pipe','pipe']}),readBytes=bytes}={}){
 const port=expected?.endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/)?.[1];need(port&&Number.isSafeInteger(expected.pid)&&expected.pid>0&&expected.uid===process.getuid(),'EPOCH_DAEMON_SCOPE');
 // expected PID是record固定事实，不每frame扫描全系统listener；PID复用/被别PID占port均拒。
 const raw=run('/usr/sbin/lsof',['-nP','-a','-p',String(expected.pid),'-iTCP:'+port,'-sTCP:LISTEN','-Fpun']),pids=[...raw.matchAll(/^p([1-9]\d*)$/gm)].map(m=>Number(m[1])),uids=[...raw.matchAll(/^u([0-9]+)$/gm)].map(m=>Number(m[1]));need(pids.length===1&&pids[0]===expected.pid&&uids.length===1&&uids[0]===expected.uid&&raw.split('\n').includes('n127.0.0.1:'+port),'EPOCH_DAEMON_LISTENER');
 for(const [path,hash]of Object.entries(expected.source_files||{}))need(sha(readBytes(path))===hash,'EPOCH_DAEMON_SOURCE');
 const start=run('/bin/ps',['-p',String(expected.pid),'-o','lstart=']).trim(),command=run('/bin/ps',['-p',String(expected.pid),'-o','command=']).trim(),images=run('/usr/sbin/lsof',['-a','-p',String(expected.pid),'-d','txt','-Fn']);need(start===expected.start_identity&&command===expected.command&&images.split('\n').includes('n'+expected.executable)&&sha(readBytes(expected.executable))===expected.executable_sha256&&sha(readBytes(expected.policy_path))===expected.policy_sha256,'EPOCH_DAEMON_IDENTITY');return structuredClone(expected);
}
export function businessAuthorityProjection(value){
 const task=value.task,c=task?.result?.common_runner,b=value.binding,r=value.taskRun,l=value.central;
 return {task:{id:task?.id,status:task?.status,claimed_by:task?.claimed_by,claimed_at:task?.claimed_at,common_runner:c&&Object.fromEntries(['run_id','task_id','machine_id','profile_sha256','run_binding','mode'].map(k=>[k,c[k]])),...(task?.payload?.execution_mode==='standalone-skill'||task?.result?.codex_skill_direct?{standalone_payload:{execution_mode:task.payload?.execution_mode,scope:task.payload?.scope,skill:task.payload?.skill},codex_skill_direct:standaloneIdentityProjection(task.result?.codex_skill_direct)}:{})},binding:b&&{...Object.fromEntries(['id','run_id','source_kind','workflow_id','workflow_definition_version_id','attempt_key','task_run_id','release_id','observation_id'].map(k=>[k,b[k]])),runtime_snapshot_sha256:b.payload?.runtime_snapshot_sha256},links:value.links&&{task_id:value.links.task_id,task_run_id:value.links.task_run_id},task_run:r&&{...Object.fromEntries(['id','task_id','run_id','status','ended_at'].map(k=>[k,r[k]])),...(task?.payload?.execution_mode==='standalone-skill'||task?.result?.codex_skill_direct?{context:standaloneExecutionContextProjection(r.context)}:{})},central:l&&{device_name:l.device_name,locked_by:l.locked_by},...(value.compatibilityReview?{compatibility_review:compatibilityReviewProjection(value.compatibilityReview),compatibility_development:value.compatibilityDevelopment&&{id:value.compatibilityDevelopment.id,task_type:value.compatibilityDevelopment.task_type}}:{})};
}
export function verifyEpochFacts(f){
 const {record:r,frozen,task,binding:b,links,taskRun,central:c}=f,spec=phone(frozen),p=identity(frozen);validateEpochRecord(r,epochCompatibilityRecordScope(frozen));
 const standalone=frozen.standalone_skill!==undefined,scope=standalone?standaloneScope(frozen):null;
 const officialChild=frozen.execution_mode==='agent'&&frozen.primary_host==='official-child-v1'&&frozen.execution_transport===undefined&&frozen.max_turns===undefined;
 if(officialChild){const input=validateAgentInput(frozen.agent_input);need(input.task_id===p?.task_id&&input.workflow_key===frozen.workflow_version?.payload?.key&&input.run_tag===frozen.run_identity?.tag&&input.profile===spec.profile&&input.serial===spec.serial,'EPOCH_AGENT_INPUT');}
 need((standalone?p?.protocol==='codex-exec-v1':(frozen.execution_mode==='code'||officialChild)&&p?.protocol==='workflow-domain/v1')&&uuid.test(p.task_id||'')&&uuid.test(p.run_id||'')&&same(r.resource.company,p.company),'EPOCH_BUSINESS_COMPANY');
 need(b?.source_kind==='internal'&&b.id===p.run_binding.run_binding_id&&b.run_id===p.run_id&&b.workflow_id===p.run_binding.workflow_id&&b.workflow_definition_version_id===p.run_binding.workflow_definition_version_id&&b.attempt_key===p.run_binding.attempt_key&&b.release_id===frozen.release?.id&&b.observation_id===frozen.deployment.observation_id&&links?.task_id===p.task_id&&links.task_run_id===b.task_run_id,'EPOCH_BUSINESS_BINDING');
 need((!standalone||p.task_run_id===b.task_run_id&&standaloneExecutionContextMatches(taskRun?.context,p,scope))&&taskRun?.id===b.task_run_id&&taskRun.run_id===p.run_id&&taskRun.task_id===p.task_id&&taskRun.status==='running'&&taskRun.ended_at===null,'EPOCH_BUSINESS_TASK_RUN');
 const runtimeFiles=Object.fromEntries(Object.entries(frozen.files).filter(([name])=>name.startsWith('runtime/')).map(([name,hash])=>[name.slice(8),hash]));need(b.payload?.runtime_snapshot_sha256===digest(runtimeFiles),'EPOCH_RUNTIME_SNAPSHOT');
 const authority={identity:p,binding:{id:b.id,run_id:p.run_id,task_id:p.task_id,workflow_id:b.workflow_id,workflow_definition_version_id:b.workflow_definition_version_id,attempt_key:b.attempt_key,activities:p.run_binding.activities}};need(standalone?standaloneTaskProjectionMatches(task,p,scope):publicDomainTaskProjectionMatches(task,authority),'EPOCH_BUSINESS_TASK');
 need(c?.device_name===spec.serial&&c.locked_by===p.task_id&&c.expired!==true&&Date.parse(c.expires_at)>Date.now()+1000&&typeof c.lease_version==='string'&&/^[1-9][0-9]{0,9}$/.test(c.lease_version),'EPOCH_BUSINESS_CENTRAL');
 const transportSerial=epochTransportSerial(r.resource);
 need(same(f.oldDaemon,r.old_route)&&same(f.newDaemon,r.new_route)&&Array.isArray(f.oldInventory)
  &&!f.oldInventory.some(d=>d.serial===spec.serial||d.serial===transportSerial)
  &&f.newInventory?.length===1&&f.newInventory[0].serial===transportSerial&&f.newInventory[0].state==='device','EPOCH_LIVE_ROUTES');
 if(r.resource.adb_serial!==undefined)need(f.newHardwareSerial===spec.serial,'EPOCH_DEVICE_IDENTITY');
 const sourceCompatibility=frozen.epoch_source_compatibility;
 need(f.policySha256===r.new_route.policy_sha256&&f.policySha256===spec.policy_binding?.policy_sha256&&(sourceCompatibility?verifyEpochSourceCompatibility({frozen,record:r,recordSha256:f.recordSha256,source:f.source,reviewTask:f.compatibilityReview,developmentTask:f.compatibilityDevelopment}):same(f.source,r.runtime_source)&&f.source.commit===frozen.deployment.source_commit),'EPOCH_SOURCE_POLICY');
 const clean=isYueshengCleanEpoch(r);
 if(isCloudExistingEpoch(r)){
  const migration=r.cloud_migration,environment='staging:'+frozen.deployment.source_commit;
  const compatibility=frozen.epoch_source_compatibility,successor=isCloudEpochSourceCompatibility(compatibility);
  need(!standalone&&frozen.discovery_phone_scope===spec&&frozen.deployment.target==='mmv'
   &&frozen.release?.target==='mmv'&&frozen.release.environment===environment&&frozen.deployment.environment===environment
   &&frozen.deployment.release_id===frozen.release.id
   &&frozen.workflow_version?.id===p.run_binding.workflow_definition_version_id
   &&frozen.workflow_version.payload?.key==='douyin_video_discovery'
   &&frozen.run_identity.capability==='douyin_video_discovery'&&p.machine_id==='us-mac-m4'
   &&(!compatibility||successor)&&f.originalTask?.id===r.original.task_id&&f.originalTask?.status==='blocked'
   &&f.originalTask.result?.execution_stopped!==true,'EPOCH_CLOUD_AUTHORITY');
  need(f.cloudCompletion?.completion_sha256===migration.completion_sha256,'EPOCH_CLOUD_AUTHORITY');
  if(successor){
   need(task.result?.common_runner?.mode==='formal'&&f.cloudCompletion.manifest_sha256===compatibility.receipt.original.manifest_sha256,'EPOCH_CLOUD_AUTHORITY');
   if(f.compatibilityReleaseProjection)verifyCloudEpochSuccessorProjection(frozen,f.compatibilityReleaseProjection);
   else verifyCloudEpochSuccessorDeployment(frozen,f.compatibilityRelease);
  }else need(/^[a-f0-9]{64}$/.test(frozen.release?.manifest_sha256??'')&&f.cloudCompletion.manifest_sha256===frozen.release.manifest_sha256
   &&migration.release_id===frozen.release?.id&&migration.observation_id===frozen.deployment.observation_id,'EPOCH_CLOUD_AUTHORITY');
  need(f.cloudHardwareSerialSha256===migration.hardware_serial_sha256&&f.cloudBootIdSha256===migration.boot_id_sha256,'EPOCH_DEVICE_IDENTITY');
 }else if(clean){
  const originalReleaseMatches = r.migration.release_id === frozen.release?.id
    && r.migration.observation_id === frozen.deployment.observation_id;
  // The source check above verifies any compatibility proof against this standalone task and candidate.
  need(f.cleanCompletionSha256===r.migration.completion_sha256&&(sourceCompatibility?standalone:originalReleaseMatches)
   &&(!standalone||r.resource.line===scope.line),'EPOCH_CLEAN_AUTHORITY');
 }else need(f.archive&&r.original_quarantine&&f.archive.dev===r.original_quarantine.dev&&f.archive.ino===r.original_quarantine.ino
  &&same(f.archive.fields,r.original_quarantine.fields),'EPOCH_LOCAL_HANDOFF');
 need(f.activeOwner===frozen.run_identity.tag+'\n'&&f.activeQuarantined===false,'EPOCH_LOCAL_HANDOFF');
 return {protocol:'device-epoch-fence-admission/v1',authorized:true,epoch_id:r.epoch_id,task_id:p.task_id,run_id:p.run_id,source_commit:f.source.commit,instance_id:r.new_route.instance_id,endpoint:r.new_route.endpoint,serial:spec.serial,...(r.resource.adb_serial===undefined?{}:{adb_serial:transportSerial}),old_route_absent:true,original_execution_stopped:false,android_internal:'not_attested'};
}

export async function readCloud101BusinessFacts({frozen,record,readBudget,read=readBrain}){
 const ref=epochSourceCompatibilityReference(frozen);
 need(isCloudEpochSourceCompatibility(ref)&&isCloudExistingEpoch(record),'EPOCH_CLOUD_AUTHORITY');
 const p=identity(frozen),spec=phone(frozen),release=ref.receipt;
 need(uuid.test(p?.task_id||'')&&uuid.test(p?.run_id||'')&&uuid.test(p.run_binding?.run_binding_id||'')
  &&/^[a-f0-9]{64}$/.test(p.profile_sha256??'')&&uuid.test(record.original?.task_id||''),'EPOCH_CLOUD_AUTHORITY');
 const query=new URLSearchParams({
  task_id:p.task_id,binding_id:p.run_binding.run_binding_id,release_id:release.release_id,
  observation_id:release.observation_id,device_name:spec.serial,profile:spec.profile,
  profile_sha256:p.profile_sha256,source_commit:frozen.deployment.source_commit,
  original_task_id:record.original.task_id,review_task_id:ref.review_task_id,
 });
 const snapshot=await read('/api/brain/cloud-101-admission/'+p.run_id+'?'+query,readBudget);
 need(snapshot?.protocol==='cloud-101-admission-snapshot/v1','EPOCH_CLOUD_AUTHORITY');
 const {task,binding,links,taskRun,central,originalTask,compatibilityDevelopment,compatibilityRelease,compatibilityReview}=snapshot??{};
 verifyCloudEpochSuccessorProjection(frozen,compatibilityRelease);
 need(compatibilityReview?.id===ref.review_task_id
  &&compatibilityReview.result?.epoch_source_compatibility_sha256===ref.receipt_sha256,'EPOCH_SOURCE_COMPATIBILITY');
 return {
  task,binding,links,taskRun,central,originalTask,compatibilityDevelopment,compatibilityReleaseProjection:compatibilityRelease,
  compatibilityReview:{...compatibilityReview,result:{...compatibilityReview.result,epoch_source_compatibility:ref.receipt}},
 };
}
function archiveSnapshot(record){const path=record.original_quarantine.archive_path,s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(path)===path&&s.uid===process.getuid()&&![...readdirSync(path)].some(n=>!['owner','pid','acquired_at','standalone_review_required','standalone_quarantined'].includes(n)),'EPOCH_ARCHIVE');const names=Object.keys(record.original_quarantine.fields),fields=Object.fromEntries(names.map(n=>[n,bytes(join(path,n)).toString()]));need(same(readdirSync(path).sort(),names.sort())&&(!Object.hasOwn(fields,'standalone_quarantined')||fields.standalone_quarantined===fields.owner),'EPOCH_ARCHIVE');return {dev:s.dev,ino:s.ino,fields};}
export async function readEpochDeviceIdentity({query, scope, directory, readBudget, readAuthority, managedCloud = false}) {
  // The diagnostic rechecks daemon authority after both ADB sockets close.
  const wireBudgetMs = managedCloud ? 15_000 : 5_000;
  const timeoutMs = readBudget ? Math.min(wireBudgetMs, readBudget.deadlineMs - Date.now()) : wireBudgetMs;
  need(timeoutMs > 0, 'EPOCH_ADMISSION_DEADLINE');
  const result = await runDiagnostic({query, scope, directory, timeoutMs, readAuthority});
  need(result.wire_complete, 'EPOCH_DEVICE_IDENTITY');
  const proof = readDiagnosticProof(result);
  need(proof.stderr.length === 0, 'EPOCH_DEVICE_IDENTITY');
  return proof.stdout.toString('utf8').replace(/\r?\n$/, '');
}

export function readEpochLocalHandoff({runDirectory,lockPath,frozen,record,standaloneHost}){
 if(isCloudExistingEpoch(record)&&isCloudEpochSourceCompatibility(frozen.epoch_source_compatibility)){
  try{return {activeOwner:readPublicCodePreflightLock({runDirectory,lockPath,frozen}),activeQuarantined:false};}
  catch{need(false,'EPOCH_LOCAL_HANDOFF');}
 }
 const names=readdirSync(lockPath);
 const marker=standaloneHost&&names.includes('standalone_review_required')?bytes(join(lockPath,'standalone_review_required')).toString():undefined;
 return {activeOwner:bytes(join(lockPath,'owner')).toString(),activeQuarantined:standaloneLocalLockQuarantined(frozen,names,marker)};
}

export async function canAuthorizeNativeFrame({root,env,frozen,readBudget,includeCurrentAuthority=false}={}){
 let stage='scope';
 let daemonObservation;
 try{
 const spec=phone(frozen);if(spec?.policy?.schema_version===1)return {applicable:false};need(spec?.policy?.schema_version===2&&root===here&&realpathSync(root)===root&&typeof env?.WFR_RUN_DIR==='string'&&resolve(env.WFR_RUN_DIR)===env.WFR_RUN_DIR,'EPOCH_ADMISSION_SCOPE');
 stage='frozen';const current=readFrozen(env.WFR_RUN_DIR);need(same(current,frozen),'EPOCH_FROZEN_DRIFT');stage='record';const ref=spec.policy_binding?.epoch_fence;need(ref?.protocol==='device-epoch-fence-reference/v1'&&uuid.test(ref.epoch_id||'')&&ref.path===join(userInfo().homedir,'.local/share/zenithjoy/device-epoch-fences',spec.serial,ref.epoch_id+'.json'),'EPOCH_FROZEN_REFERENCE');const raw=recordBytes(ref.path);need(sha(raw)===ref.sha256,'EPOCH_RECORD_DIGEST');const record=validateEpochRecord(JSON.parse(raw),epochCompatibilityRecordScope(frozen));need(record.epoch_id===ref.epoch_id,'EPOCH_REFERENCE_ID');
 const clean=isYueshengCleanEpoch(record),cloud=isCloudExistingEpoch(record);
 const cleanCompletionSha256=clean?readYueshengEpochCompletion(record):undefined;
 const cloudCompletion=cloud?readCloudExistingEpochCompletion(record):undefined;
 stage='policy';const policyRaw=readPrivatePolicy(spec.policy_binding.policy_path);need(same(JSON.parse(policyRaw),spec.policy)&&spec.policy_binding.policy_path===record.new_route.policy_path,'EPOCH_POLICY_PATH');
 stage='scope';const p=identity(frozen);need(env.WF_BRAIN_TASK_ID===p.task_id&&env.WFR_RUN_ID===p.run_id&&env.SERIAL===spec.serial,'EPOCH_ENV_BINDING');
 const standaloneHost=frozen.standalone_skill?readStandaloneHostProof({frozen,runDirectory:env.WFR_RUN_DIR}):null;
 const compatibilityRef=epochSourceCompatibilityReference(frozen);
 const transportSerial=epochTransportSerial(record.resource);
 const cloudSuccessor=isCloudEpochSourceCompatibility(compatibilityRef);
 const readBusiness=async()=>{
  if(cloudSuccessor)return readCloud101BusinessFacts({frozen,record,readBudget});
  const [tv,definition,reconciliation,locks,review,original]=await Promise.all([
   readBrain('/api/brain/tasks/'+p.task_id,readBudget),readBrain('/api/brain/runs/'+p.run_id+'/definition',readBudget),
   readBrain('/api/brain/runs/'+p.run_id+'/reconciliation',readBudget),readBrain('/api/brain/device-locks',readBudget),
   compatibilityRef?readBrain('/api/brain/tasks/'+compatibilityRef.review_task_id,readBudget):undefined,
   cloud?readBrain('/api/brain/tasks/'+record.original.task_id,readBudget):undefined
  ]);
  const rows=locks.locks?.filter(r=>r.device_name===spec.serial);need(locks.success===true&&rows?.length===1,'EPOCH_CENTRAL_INVENTORY');
  const compatibilityReview=review?.task??review;let compatibilityDevelopment;
  if(compatibilityRef){
   const developmentId=compatibilityReview?.payload?.development_task_id;
   need(uuid.test(developmentId||'')&&developmentId!==p.task_id,'EPOCH_SOURCE_COMPATIBILITY');
   const dev=await readBrain('/api/brain/tasks/'+developmentId,readBudget);compatibilityDevelopment=dev.task??dev;
  }
  return {task:tv.task??tv,binding:definition.binding,links:reconciliation.links,taskRun:reconciliation.task_run,central:rows[0],
   ...(compatibilityRef?{compatibilityReview,compatibilityDevelopment}:{}),...(cloud?{originalTask:original?.task??original}:{})};
 };
 stage='initial_business';const initial=await readBusiness();
 stage='source';const source=reviewSource({includeCloudIssuer:cloud});if(compatibilityRef)verifyEpochSourceCompatibility({frozen,record,recordSha256:sha(raw),source,reviewTask:initial.compatibilityReview,developmentTask:initial.compatibilityDevelopment});
 stage='initial_old_daemon';
 let readDaemon=readBoundAdbDaemon;
 if(cloudSuccessor){
  daemonObservation=openFastAdbDaemonObservation({python:spec.executables.python,frozen,deadlineMs:readBudget?.deadlineMs});
  readDaemon=daemonObservation.read;
 }
 if(clean){
  const bindingRoot=join(userInfo().homedir,'.local/share/zenithjoy/phone-candidates',record.runtime_source.commit,'runtime');
  for(const [name,hash] of Object.entries(record.migration.binding_sha256))need(sha(bytes(join(bindingRoot,name)))===hash,'EPOCH_SOURCE_POLICY');
  const bindingModule=pathToFileURL(join(bindingRoot,'device-epoch-fence-yuesheng-host-reads.mjs')).href;
  const {createYueshengDaemonBinding}=await import(bindingModule);
  const {bindDaemon}=await createYueshengDaemonBinding({sourceCommit:record.runtime_source.commit});
  readDaemon=async route=>({...route,daemon_binding:await bindDaemon(route.daemon_binding)});
 }
 const oldDaemon=await readDaemon(record.old_route);
 stage='initial_new_daemon';const newDaemon=await readDaemon(record.new_route),activeLock=join(userInfo().homedir,'.local/share/zenithjoy/phone-locks',spec.serial+'.lock');
 stage='evidence_root';const evidenceRoot=join(env.WFR_RUN_DIR,'epoch-fence-admission');try{mkdirSync(evidenceRoot,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const rs=lstatSync(evidenceRoot);need(rs.isDirectory()&&!rs.isSymbolicLink()&&realpathSync(evidenceRoot)===evidenceRoot&&(rs.mode&0o777)===0o700&&rs.uid===process.getuid(),'EPOCH_EVIDENCE_ROOT');const directory=join(evidenceRoot,randomUUID());mkdirSync(directory,{mode:0o700});
 async function inventory(route,label){const out=join(directory,label);mkdirSync(out,{mode:0o700});const scope={endpoint:route.endpoint,serial:spec.serial};const result=await hostOperation({operation:'inventory',scope,directory:out,readAuthority:async()=>{await readDaemon(route);return {scope,authorized_action:'inventory',lease_until:initial.central.expires_at};}});need(result.wire_complete,'EPOCH_HOST_INVENTORY');return parseDeviceInventory(result.response);}
 stage='new_inventory';const newInventory=await inventory(record.new_route,'new');
 stage='old_inventory';let oldInventory=await inventory(record.old_route,'old');
 let newHardwareSerial,cloudHardwareSerialSha256,cloudBootIdSha256;
 if(record.resource.adb_serial!==undefined||cloud){
  stage='hardware_serial';
  need(newInventory.length===1&&newInventory[0].serial===transportSerial&&newInventory[0].state==='device'
   &&!oldInventory.some(row=>row.serial===spec.serial||row.serial===transportSerial),'EPOCH_LIVE_ROUTES');
  const scope={endpoint:record.new_route.endpoint,serial:transportSerial,maintenance_task_id:p.task_id};
  const readDeviceIdentity=async(query,label)=>{
   const out=join(directory,label);mkdirSync(out,{mode:0o700});
   return readEpochDeviceIdentity({query,scope,directory:out,readBudget,managedCloud:clean || cloud,readAuthority:async()=>{
    await readDaemon(record.new_route);
    need(initial.central.locked_by===p.task_id&&initial.central.expired!==true,'EPOCH_BUSINESS_CENTRAL');
    return {scope,lease_until:initial.central.expires_at};
   }});
  };
  newHardwareSerial=await readDeviceIdentity('hardware_serial','hardware-serial');
  if(cloud){
   const hardwareSerial=newHardwareSerial.trim(),bootId=(await readDeviceIdentity('boot_id','boot-id')).trim();
   need(/^[A-Za-z0-9_.:-]{1,256}$/.test(hardwareSerial)&&uuid.test(bootId),'EPOCH_DEVICE_IDENTITY');
   cloudHardwareSerialSha256=sha(hardwareSerial);cloudBootIdSha256=sha(bootId);
   stage='old_inventory';oldInventory=await inventory(record.old_route,'old-after-device-identity');
  }
 }

 stage='fresh_business';const fresh=await readBusiness();
 stage='business_drift';need(same(businessAuthorityProjection(initial),businessAuthorityProjection(fresh)),'EPOCH_BUSINESS_DRIFT');
 // 最终逐frame fresh身份读回，无跨frame缓存；旧serial重现由本次host原件直接拒绝。
 stage='final_old_daemon';await readDaemon(record.old_route);
 stage='final_new_daemon';await readDaemon(record.new_route);
 if(daemonObservation){await daemonObservation.close(true);daemonObservation=undefined;}
 stage='final_record_policy';need(sha(recordBytes(ref.path))===ref.sha256&&sha(readPrivatePolicy(spec.policy_binding.policy_path))===sha(policyRaw),'EPOCH_ADMISSION_DRIFT');
 if(clean)need(readYueshengEpochCompletion(record)===cleanCompletionSha256,'EPOCH_ADMISSION_DRIFT');
 if(cloud)need(same(readCloudExistingEpochCompletion(record),cloudCompletion),'EPOCH_ADMISSION_DRIFT');
 stage='final_facts';
 if(standaloneHost)need(same(standaloneHost,readStandaloneHostProof({frozen,runDirectory:env.WFR_RUN_DIR})),'EPOCH_STANDALONE_IDENTITY');
 const local=readEpochLocalHandoff({runDirectory:env.WFR_RUN_DIR,lockPath:activeLock,frozen,record,standaloneHost});
 const proof=verifyEpochFacts({record,recordSha256:sha(raw),frozen,...fresh,oldDaemon,newDaemon,oldInventory,newInventory,newHardwareSerial,policySha256:sha(policyRaw),source,...(clean?{cleanCompletionSha256}:cloud?{cloudCompletion,cloudHardwareSerialSha256,cloudBootIdSha256}:{archive:archiveSnapshot(record)}),...local});
 if(readBudget!==undefined)need(Number.isSafeInteger(readBudget.deadlineMs)&&Date.now()<readBudget.deadlineMs,'EPOCH_ADMISSION_DEADLINE');
 if(cloudSuccessor&&includeCurrentAuthority)return {...proof,currentAuthority:{task:fresh.task,central:fresh.central}};
 return proof;
 }catch(error){throw admissionFailure(error,stage);}
 finally{if(daemonObservation)await daemonObservation.close(false);}
}
export async function main(args){
 const hasDeadline=args.length===5&&args[3]==='--read-deadline-ms'&&/^[1-9]\d{0,15}$/.test(args[4]);
 need((args.length===3||hasDeadline)&&args[0]==='verify-epoch'&&args[1]==='--run-dir'&&resolve(args[2])===args[2],'EPOCH_CLI_USAGE');
 const runDir=args[2];let frozen;
 try{
  frozen=readFrozen(runDir);const spec=phone(frozen);let readBudget;
  const standalone=frozen.standalone_skill?.protocol==='codex-exec-v1';
  need(!hasDeadline||standalone,'EPOCH_ADMISSION_DEADLINE');
  if(standalone){
   let phaseDeadline=frozen.standalone_skill.deadline_ms;
   const {proof_path:proofPath}=standaloneHostProofPaths(frozen);let marker;
   try{marker=recordBytes(proofPath.replace(/\.json$/,'.cleanup'));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(marker!==undefined){
    need(marker.equals(Buffer.from(sha(recordBytes(proofPath))+'\n')),'EPOCH_ADMISSION_DEADLINE');
    phaseDeadline=frozen.standalone_skill.cleanup_deadline_ms;
   }
   const now=Date.now(),deadlineMs=hasDeadline?Number(args[4]):Math.min(phaseDeadline,now+45000);
   need(Number.isSafeInteger(deadlineMs)&&deadlineMs>now&&deadlineMs<=phaseDeadline&&deadlineMs<=now+45000,'EPOCH_ADMISSION_DEADLINE');
   readBudget={deadlineMs};
  }
  const result=await canAuthorizeNativeFrame({root:here,frozen,readBudget,env:{WFR_RUN_DIR:runDir,WF_BRAIN_TASK_ID:identity(frozen)?.task_id,WFR_RUN_ID:identity(frozen)?.run_id,SERIAL:spec?.serial}});
  need(result.authorized===true,'EPOCH_CLI_NOT_APPLICABLE');return result;
 }
 catch(error){if(frozen)preserveVerifierDiagnostic(runDir,frozen,error);throw error;}
}
