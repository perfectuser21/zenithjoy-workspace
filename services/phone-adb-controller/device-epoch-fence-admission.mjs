// 新schema2每个phone IO的唯一fresh fence准入；不继承maintenance中央owner。
import {join,dirname,resolve} from 'node:path';import {userInfo} from 'node:os';import {fileURLToPath} from 'node:url';
import {lstatSync,readdirSync,realpathSync,mkdirSync} from 'node:fs';import {randomUUID,createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {readBrain,reviewSource} from './device-epoch-fence-review.mjs';
import {admissionFailure} from './epoch-admission-diagnostic.mjs';
import {bytes,recordBytes,readPrivatePolicy,validateEpochRecord,freezeFenceReference} from './device-epoch-fence-reference.mjs';
export {freezeFenceReference};
import {readFrozen,digest,canonical,validateAgentInput} from './runtime-definition.mjs';
import {publicDomainTaskProjectionMatches} from './public-domain-authority.mjs';
import {hostOperation,parseDeviceInventory} from './device-epoch-fence-transport.mjs';
const here=dirname(fileURLToPath(import.meta.url)),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});},same=(a,b)=>canonical(a)===canonical(b),phone=f=>f.discovery_phone_scope??f.collection_phone_scope;
export function readBoundAdbDaemon(expected,{run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin',LANG:'C',LC_ALL:'C',TZ:'UTC'},timeout:3000,stdio:['ignore','pipe','pipe']}),readBytes=bytes}={}){
 const port=expected?.endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/)?.[1];need(port&&Number.isSafeInteger(expected.pid)&&expected.pid>0&&expected.uid===process.getuid(),'EPOCH_DAEMON_SCOPE');
 // expected PID是record固定事实，不每frame扫描全系统listener；PID复用/被别PID占port均拒。
 const raw=run('/usr/sbin/lsof',['-nP','-a','-p',String(expected.pid),'-iTCP:'+port,'-sTCP:LISTEN','-Fpun']),pids=[...raw.matchAll(/^p([1-9]\d*)$/gm)].map(m=>Number(m[1])),uids=[...raw.matchAll(/^u([0-9]+)$/gm)].map(m=>Number(m[1]));need(pids.length===1&&pids[0]===expected.pid&&uids.length===1&&uids[0]===expected.uid&&raw.split('\n').includes('n127.0.0.1:'+port),'EPOCH_DAEMON_LISTENER');
 for(const [path,hash]of Object.entries(expected.source_files||{}))need(sha(readBytes(path))===hash,'EPOCH_DAEMON_SOURCE');
 const start=run('/bin/ps',['-p',String(expected.pid),'-o','lstart=']).trim(),command=run('/bin/ps',['-p',String(expected.pid),'-o','command=']).trim(),images=run('/usr/sbin/lsof',['-a','-p',String(expected.pid),'-d','txt','-Fn']);need(start===expected.start_identity&&command===expected.command&&images.split('\n').includes('n'+expected.executable)&&sha(readBytes(expected.executable))===expected.executable_sha256&&sha(readBytes(expected.policy_path))===expected.policy_sha256,'EPOCH_DAEMON_IDENTITY');return structuredClone(expected);
}
export function businessAuthorityProjection(value){
 const task=value.task,c=task?.result?.common_runner,b=value.binding,r=value.taskRun,l=value.central;
 return {task:{id:task?.id,status:task?.status,claimed_by:task?.claimed_by,claimed_at:task?.claimed_at,common_runner:c&&Object.fromEntries(['run_id','task_id','machine_id','profile_sha256','run_binding'].map(k=>[k,c[k]]))},binding:b&&{...Object.fromEntries(['id','run_id','source_kind','workflow_id','workflow_definition_version_id','attempt_key','task_run_id','release_id','observation_id'].map(k=>[k,b[k]])),runtime_snapshot_sha256:b.payload?.runtime_snapshot_sha256},links:value.links&&{task_id:value.links.task_id,task_run_id:value.links.task_run_id},task_run:r&&Object.fromEntries(['id','task_id','run_id','status','ended_at'].map(k=>[k,r[k]])),central:l&&{device_name:l.device_name,locked_by:l.locked_by}};
}
export function verifyEpochFacts(f){
 const {record:r,frozen,task,binding:b,links,taskRun,central:c}=f,spec=phone(frozen),p=frozen.public_domain;validateEpochRecord(r,spec);
 const officialChild=frozen.execution_mode==='agent'&&frozen.primary_host==='official-child-v1'&&frozen.execution_transport===undefined&&frozen.max_turns===undefined;
 if(officialChild){const input=validateAgentInput(frozen.agent_input);need(input.task_id===p?.task_id&&input.workflow_key===frozen.workflow_version?.payload?.key&&input.run_tag===frozen.run_identity?.tag&&input.profile===spec.profile&&input.serial===spec.serial,'EPOCH_AGENT_INPUT');}
 need((frozen.execution_mode==='code'||officialChild)&&p?.protocol==='workflow-domain/v1'&&uuid.test(p.task_id||'')&&uuid.test(p.run_id||'')&&same(r.resource.company,p.company),'EPOCH_BUSINESS_COMPANY');
 need(b?.source_kind==='internal'&&b.id===p.run_binding.run_binding_id&&b.run_id===p.run_id&&b.workflow_id===p.run_binding.workflow_id&&b.workflow_definition_version_id===p.run_binding.workflow_definition_version_id&&b.attempt_key===p.run_binding.attempt_key&&b.release_id===frozen.release?.id&&b.observation_id===frozen.deployment.observation_id&&links?.task_id===p.task_id&&links.task_run_id===b.task_run_id,'EPOCH_BUSINESS_BINDING');
 need(taskRun?.id===b.task_run_id&&taskRun.run_id===p.run_id&&taskRun.task_id===p.task_id&&taskRun.status==='running'&&taskRun.ended_at===null,'EPOCH_BUSINESS_TASK_RUN');
 const runtimeFiles=Object.fromEntries(Object.entries(frozen.files).filter(([name])=>name.startsWith('runtime/')).map(([name,hash])=>[name.slice(8),hash]));need(b.payload?.runtime_snapshot_sha256===digest(runtimeFiles),'EPOCH_RUNTIME_SNAPSHOT');
 const authority={identity:p,binding:{id:b.id,run_id:p.run_id,task_id:p.task_id,workflow_id:b.workflow_id,workflow_definition_version_id:b.workflow_definition_version_id,attempt_key:b.attempt_key,activities:p.run_binding.activities}};need(publicDomainTaskProjectionMatches(task,authority),'EPOCH_BUSINESS_TASK');
 need(c?.device_name===spec.serial&&c.locked_by===p.task_id&&c.expired!==true&&Date.parse(c.expires_at)>Date.now()+1000&&typeof c.lease_version==='string'&&/^[1-9][0-9]{0,9}$/.test(c.lease_version),'EPOCH_BUSINESS_CENTRAL');
 need(same(f.oldDaemon,r.old_route)&&same(f.newDaemon,r.new_route)&&Array.isArray(f.oldInventory)&&!f.oldInventory.some(d=>d.serial===spec.serial)&&f.newInventory?.length===1&&f.newInventory[0].serial===spec.serial&&f.newInventory[0].state==='device','EPOCH_LIVE_ROUTES');
 need(f.policySha256===r.new_route.policy_sha256&&f.policySha256===spec.policy_binding?.policy_sha256&&same(f.source,r.runtime_source)&&f.source.commit===frozen.deployment.source_commit,'EPOCH_SOURCE_POLICY');
 need(f.archive?.dev===r.original_quarantine?.dev&&f.archive.ino===r.original_quarantine.ino&&same(f.archive.fields,r.original_quarantine.fields)&&f.activeOwner===frozen.run_identity.tag+'\n'&&f.activeQuarantined===false,'EPOCH_LOCAL_HANDOFF');
 return {protocol:'device-epoch-fence-admission/v1',authorized:true,epoch_id:r.epoch_id,task_id:p.task_id,run_id:p.run_id,source_commit:f.source.commit,instance_id:r.new_route.instance_id,endpoint:r.new_route.endpoint,serial:spec.serial,old_route_absent:true,original_execution_stopped:false,android_internal:'not_attested'};
}
function archiveSnapshot(record){const path=record.original_quarantine.archive_path,s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(path)===path&&s.uid===process.getuid()&&![...readdirSync(path)].some(n=>!['owner','pid','acquired_at','standalone_review_required'].includes(n)),'EPOCH_ARCHIVE');const fields=Object.fromEntries(Object.keys(record.original_quarantine.fields).map(n=>[n,bytes(join(path,n)).toString()]));return {dev:s.dev,ino:s.ino,fields};}
export async function canAuthorizeNativeFrame({root,env,frozen}={}){
 let stage='scope';
 try{
 const spec=phone(frozen);if(spec?.policy?.schema_version===1)return {applicable:false};need(spec?.policy?.schema_version===2&&root===here&&realpathSync(root)===root&&typeof env?.WFR_RUN_DIR==='string'&&resolve(env.WFR_RUN_DIR)===env.WFR_RUN_DIR,'EPOCH_ADMISSION_SCOPE');
 stage='frozen';const current=readFrozen(env.WFR_RUN_DIR);need(same(current,frozen),'EPOCH_FROZEN_DRIFT');stage='record';const ref=spec.policy_binding?.epoch_fence;need(ref?.protocol==='device-epoch-fence-reference/v1'&&uuid.test(ref.epoch_id||'')&&ref.path===join(userInfo().homedir,'.local/share/zenithjoy/device-epoch-fences',spec.serial,ref.epoch_id+'.json'),'EPOCH_FROZEN_REFERENCE');const raw=recordBytes(ref.path);need(sha(raw)===ref.sha256,'EPOCH_RECORD_DIGEST');const record=validateEpochRecord(JSON.parse(raw),spec);need(record.epoch_id===ref.epoch_id,'EPOCH_REFERENCE_ID');
 stage='policy';const policyRaw=readPrivatePolicy(spec.policy_binding.policy_path);need(same(JSON.parse(policyRaw),spec.policy)&&spec.policy_binding.policy_path===record.new_route.policy_path,'EPOCH_POLICY_PATH');
 stage='scope';const p=frozen.public_domain;need(env.WF_BRAIN_TASK_ID===p.task_id&&env.WFR_RUN_ID===p.run_id&&env.SERIAL===spec.serial,'EPOCH_ENV_BINDING');
 const readBusiness=async()=>{const [tv,definition,reconciliation,locks]=await Promise.all([readBrain('/api/brain/tasks/'+p.task_id),readBrain('/api/brain/runs/'+p.run_id+'/definition'),readBrain('/api/brain/runs/'+p.run_id+'/reconciliation'),readBrain('/api/brain/device-locks')]);const rows=locks.locks?.filter(r=>r.device_name===spec.serial);need(locks.success===true&&rows?.length===1,'EPOCH_CENTRAL_INVENTORY');return {task:tv.task??tv,binding:definition.binding,links:reconciliation.links,taskRun:reconciliation.task_run,central:rows[0]};};
 stage='initial_business';const initial=await readBusiness();
 stage='source';const source=reviewSource();
 stage='initial_old_daemon';const oldDaemon=readBoundAdbDaemon(record.old_route);
 stage='initial_new_daemon';const newDaemon=readBoundAdbDaemon(record.new_route),activeLock=join(userInfo().homedir,'.local/share/zenithjoy/phone-locks',spec.serial+'.lock');
 stage='evidence_root';const evidenceRoot=join(env.WFR_RUN_DIR,'epoch-fence-admission');try{mkdirSync(evidenceRoot,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const rs=lstatSync(evidenceRoot);need(rs.isDirectory()&&!rs.isSymbolicLink()&&realpathSync(evidenceRoot)===evidenceRoot&&(rs.mode&0o777)===0o700&&rs.uid===process.getuid(),'EPOCH_EVIDENCE_ROOT');const directory=join(evidenceRoot,randomUUID());mkdirSync(directory,{mode:0o700});
 async function inventory(route,label){const out=join(directory,label);mkdirSync(out,{mode:0o700});const scope={endpoint:route.endpoint,serial:spec.serial};const result=await hostOperation({operation:'inventory',scope,directory:out,readAuthority:async()=>{readBoundAdbDaemon(route);return {scope,authorized_action:'inventory',lease_until:initial.central.expires_at};}});need(result.wire_complete,'EPOCH_HOST_INVENTORY');return parseDeviceInventory(result.response);}
 stage='new_inventory';const newInventory=await inventory(record.new_route,'new');
 stage='old_inventory';const oldInventory=await inventory(record.old_route,'old');
 stage='fresh_business';const fresh=await readBusiness();
 stage='business_drift';need(same(businessAuthorityProjection(initial),businessAuthorityProjection(fresh)),'EPOCH_BUSINESS_DRIFT');
 // 最终逐frame fresh身份读回，无跨frame缓存；旧serial重现由本次host原件直接拒绝。
 stage='final_old_daemon';readBoundAdbDaemon(record.old_route);
 stage='final_new_daemon';readBoundAdbDaemon(record.new_route);
 stage='final_record_policy';need(sha(recordBytes(ref.path))===ref.sha256&&sha(readPrivatePolicy(spec.policy_binding.policy_path))===sha(policyRaw),'EPOCH_ADMISSION_DRIFT');
 stage='final_facts';return verifyEpochFacts({record,frozen,...fresh,oldDaemon,newDaemon,oldInventory,newInventory,policySha256:sha(policyRaw),source,archive:archiveSnapshot(record),activeOwner:bytes(join(activeLock,'owner')).toString(),activeQuarantined:readdirSync(activeLock).some(n=>['standalone_review_required','preflight_quarantined','preflight_proof_required','epoch_fence_lost'].includes(n))});
 }catch(error){throw admissionFailure(error,stage);}
}
export async function main(args){need(args.length===3&&args[0]==='verify-epoch'&&args[1]==='--run-dir'&&resolve(args[2])===args[2],'EPOCH_CLI_USAGE');const runDir=args[2],frozen=readFrozen(runDir),spec=phone(frozen),result=await canAuthorizeNativeFrame({root:here,frozen,env:{WFR_RUN_DIR:runDir,WF_BRAIN_TASK_ID:frozen.public_domain?.task_id,WFR_RUN_ID:frozen.public_domain?.run_id,SERIAL:spec?.serial}});need(result.authorized===true,'EPOCH_CLI_NOT_APPLICABLE');return result;}
