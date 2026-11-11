// 独立 Codex 任务身份；不会注册旧 Runner 身份或授予手机资源。
import {digest,canonical,validateAgentInput} from './runtime-definition.mjs';
import {lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {userInfo} from 'node:os';
import {performance} from 'node:perf_hooks';
import {processIdentity} from './native-operation-receipt.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/;
const fields=['protocol','task_id','run_id','claimer','claimed_at','machine_id','profile_sha256','skill','scope_sha256','run_binding','task_run_id','company','approved_keywords'];
const fail=()=>{throw Object.assign(Error('EPOCH_STANDALONE_IDENTITY'),{code:'EPOCH_STANDALONE_IDENTITY'});};
export function standaloneIdentityProjection(identity){
 return identity&&Object.fromEntries(fields.map(key=>[key,identity[key]]));
}
export function validateStandaloneIdentity(identity){
 const b=identity?.run_binding,s=identity?.skill,c=identity?.company;
 if(identity?.protocol!=='codex-exec-v1'||![identity.task_id,identity.run_id,identity.task_run_id,b?.run_binding_id,b?.workflow_id,b?.workflow_definition_version_id].every(v=>uuid.test(v||''))
  ||![c?.company_id,c?.tenant_id].every(v=>uuid.test(v||''))||!Number.isSafeInteger(c?.version)||c.version<1||typeof c.policy_id!=='string'||!c.policy_id.trim()
  ||!Array.isArray(identity.approved_keywords)||identity.approved_keywords.some(v=>typeof v!=='string'||!v.length||v.length>80||v.trim()!==v||/[\r\n\0]/.test(v))||new Set(identity.approved_keywords).size!==identity.approved_keywords.length
  ||!hash.test(identity.profile_sha256||'')||!hash.test(identity.scope_sha256||'')||typeof identity.machine_id!=='string'||!identity.machine_id
  ||typeof identity.claimer!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(identity.claimer)||identity.claimer==='common-runner'
  ||typeof identity.claimed_at!=='string'||!Number.isFinite(Date.parse(identity.claimed_at))
  ||b.source_kind!==undefined&&b.source_kind!=='internal'||typeof b.attempt_key!=='string'||!b.attempt_key
  ||!b.activities||!Object.keys(b.activities).length
  ||typeof s?.name!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name)||typeof s.version!=='string'||!s.version
  ||!commit.test(s.source_commit||'')||!hash.test(s.sha256||'')||typeof s.path!=='string'||!s.path.split('/').every(v=>/^[A-Za-z0-9_.-]+$/.test(v)&&v!=='.'&&v!=='..'))fail();
 for(const [key,a]of Object.entries(b.activities))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||!['reference_id','activity_id','activity_definition_version_id'].every(k=>uuid.test(a?.[k]||'')))fail();
 return structuredClone(standaloneIdentityProjection(identity));
}
export function standaloneScope(frozen){
 const p=validateStandaloneIdentity(frozen.standalone_skill),input=validateAgentInput(frozen.agent_input),spec=frozen.discovery_phone_scope??frozen.collection_phone_scope,scoring=input.workflow_key==='douyin_comment_scoring';
 if(frozen.public_domain!==undefined||frozen.execution_mode!=='agent'||frozen.primary_host!=='codex-exec-v1'||frozen.execution_transport!==undefined||frozen.max_turns!==undefined
  ||input.workflow_key==='douyin_video_discovery'&&!p.approved_keywords.length
  ||input.execution_transport!==undefined||input.task_id!==p.task_id||input.workflow_key!==frozen.workflow_version?.payload?.key
  ||input.run_tag!==frozen.run_identity?.tag
  ||(scoring?(input.profile!=='mmv-scoring'||input.serial!=='none'||frozen.discovery_phone_scope!==undefined||frozen.collection_phone_scope!==undefined):(!spec||input.profile!==spec.profile||input.serial!==spec.serial))
  ||!commit.test(frozen.deployment?.source_commit||'')||frozen.files?.[p.skill.path]!==p.skill.sha256
  ||Date.now()>=(input.run_start_ts+input.run_max_seconds)*1000)fail();
 return {...input,approved_keywords:p.approved_keywords,source_commit:frozen.deployment.source_commit,expected_account:scoring?'none':spec.expected_account,company:p.company,machine_id:p.machine_id};
}
function scopeWithTaskId(requested,taskId){
 return requested&&typeof requested==='object'&&!Array.isArray(requested)?{...requested,...(!Object.hasOwn(requested,'task_id')?{task_id:taskId}:{})}:null;
}
export function standaloneExecutionContextProjection(context){
 return context&&Object.fromEntries(['source','executor_kind','executor','claimed_at','skill','scope'].map(key=>[key,context[key]]));
}
export function standaloneExecutionContextMatches(context,identity,scope){
 try{
  const p=validateStandaloneIdentity(identity);
  return context?.source==='standalone-skill'&&context.executor_kind==='codex-exec-v1'&&context.executor===p.claimer&&context.claimed_at===p.claimed_at
   &&canonical(context.skill)===canonical(p.skill)&&canonical(scopeWithTaskId(context.scope,p.task_id))===canonical(scope)&&digest(scope)===p.scope_sha256;
 }catch{return false;}
}
export function standaloneTaskProjectionMatches(task,identity,scope){
 try{
  const p=validateStandaloneIdentity(identity),c=validateStandaloneIdentity(task?.result?.codex_skill_direct),requested=task?.payload?.scope;
  // 建单时Task ID由Brain生成；仅这个字段可从实际Task派生。
  const taskScope=scopeWithTaskId(requested,task.id);
  return task.id===p.task_id&&task.status==='in_progress'&&task.claimed_by===p.claimer&&task.claimed_at===p.claimed_at
   &&task.payload?.execution_mode==='standalone-skill'&&canonical(taskScope)===canonical(scope)
   &&canonical(task.payload.skill)===canonical(p.skill)&&digest(scope)===p.scope_sha256&&canonical(c)===canonical(p);
 }catch{return false;}
}

function hostIdentityFields(frozen,runDirectory){
 const p=validateStandaloneIdentity(frozen?.standalone_skill),{snapshot_sha256,...body}=frozen;
 if(frozen.execution_mode!=='agent'||frozen.primary_host!=='codex-exec-v1'||frozen.public_domain!==undefined
  ||!commit.test(frozen.deployment?.source_commit||'')||!hash.test(snapshot_sha256||'')||digest(body)!==snapshot_sha256
  ||typeof runDirectory!=='string'||resolve(runDirectory)!==runDirectory||realpathSync(runDirectory)!==runDirectory)fail();
 return {protocol:'standalone-skill-host-proof/v1',task_id:p.task_id,run_id:p.run_id,task_run_id:p.task_run_id,run_binding_id:p.run_binding.run_binding_id,source_commit:frozen.deployment.source_commit,snapshot_sha256,run_directory:runDirectory};
}
export function standaloneHostProofPaths(frozen,{home=userInfo().homedir}={}){
 const p=validateStandaloneIdentity(frozen?.standalone_skill);
 if(typeof home!=='string'||resolve(home)!==home||realpathSync(home)!==home)fail();
 const directory=join(home,'.local/state/zenithjoy/standalone-skill-hosts');
 return {directory,proof_path:join(directory,p.run_id+'.json'),unknown_path:join(directory,p.run_id+'.unknown.json')};
}
function validHostProcess(p){return p&&Number.isSafeInteger(p.pid)&&p.pid>0&&p.uid===process.getuid()&&Number.isSafeInteger(p.ppid)&&p.ppid>=0&&Number.isSafeInteger(p.pgid)&&p.pgid>0&&typeof p.start_identity==='string'&&p.start_identity.length>0;}
export function createStandaloneHostProof(options){
 try{
  if(!options||Object.keys(options).sort().join(',')!=='frozen,runDirectory')fail();
  const fields=hostIdentityFields(options.frozen,options.runDirectory),process_identity=processIdentity(process.pid,performance.now()+2000);
  if(!validHostProcess(process_identity)||process_identity.pid!==process.pid)fail();
  return {...fields,process_identity};
 }catch{fail();}
}
export function readStandaloneHostProof({frozen,runDirectory,home=userInfo().homedir,inspectProcess=processIdentity}){
 let fd;
 try{
  const fields=hostIdentityFields(frozen,runDirectory),paths=standaloneHostProofPaths(frozen,{home});
  const noUnknown=()=>{try{lstatSync(paths.unknown_path);}catch(e){if(e.code==='ENOENT')return;throw e;}fail();};
  const privateDirectory=()=>{
   for(let p=paths.directory;;p=dirname(p)){if(lstatSync(p).isSymbolicLink())fail();if(dirname(p)===p)break;}
   const d=lstatSync(paths.directory);if(!d.isDirectory()||d.uid!==process.getuid()||(d.mode&0o777)!==0o700||realpathSync(paths.directory)!==paths.directory)fail();return d;
  };
  const directory=privateDirectory();noUnknown();
  fd=openSync(paths.proof_path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=fstatSync(fd);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o777)!==0o600||info.nlink!==1||info.size>65536)fail();
  const raw=readFileSync(fd,'utf8'),record=JSON.parse(raw),{process_identity,...actual}=record;
  if(canonical(actual)!==canonical(fields)||!validHostProcess(process_identity))fail();
  const observed=inspectProcess(process_identity.pid,performance.now()+2000);
  if(!validHostProcess(observed)||canonical(observed)!==canonical(process_identity))fail();
  const current=fstatSync(fd),named=lstatSync(paths.proof_path),currentDirectory=privateDirectory();
  if(realpathSync(paths.proof_path)!==paths.proof_path||named.dev!==info.dev||named.ino!==info.ino||named.nlink!==1||(named.mode&0o777)!==0o600
   ||current.dev!==info.dev||current.ino!==info.ino||current.size!==info.size||current.mtimeMs!==info.mtimeMs||current.ctimeMs!==info.ctimeMs
   ||currentDirectory.dev!==directory.dev||currentDirectory.ino!==directory.ino)fail();
  noUnknown();return structuredClone(record);
 }catch{fail();}finally{if(fd!==undefined)closeSync(fd);}
}
export function standaloneLocalLockQuarantined(frozen,names,marker){
 if(!Array.isArray(names)||names.some(n=>['standalone_quarantined','preflight_quarantined','preflight_proof_required','epoch_fence_lost'].includes(n)))return true;
 const standalone=frozen?.standalone_skill?.protocol==='codex-exec-v1'&&frozen.execution_mode==='agent'&&frozen.primary_host==='codex-exec-v1'&&frozen.public_domain===undefined;
 if(!standalone)return names.includes('standalone_review_required');
 return !names.includes('standalone_review_required')||typeof frozen.run_identity?.tag!=='string'||marker!==frozen.run_identity.tag+'\n';
}
