// Resume receipts bind a held supervisor's actual birth; they never start a daemon.
import {lstatSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {canonical,digest,readPrivatePolicy,recordBytes} from './device-epoch-fence-reference.mjs';
import {persistStartupReceipt,reviewSource} from './device-epoch-fence-review.mjs';
const need=(ok,code)=>{if(!ok)throw Object.assign(Error('RESUME_STARTUP_'+code),{code:'RESUME_STARTUP_'+code});};
const same=(a,b)=>canonical(a)===canonical(b),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),commit=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const identityKeys=['argv_sha256','executable','executable_sha256','kernel_start','pid','uid'];
const authKeys=['key_path','key_sha256','public_key_sha256','ref_path','ref_sha256'];
const intentKeys=['action','auth_ref_sha256','endpoint','guard_identity_sha256','instance_id','issued_at','prior_pending_sha256','prior_stop_proof_sha256','protocol','resume_plan_sha256','resume_source_commit','task_id'];
const receiptKeys=['action','auth_ref_path','auth_ref_sha256','endpoint','expected_supervisor','expires_at','guard_identity','instance_id','issued_at','policy_sha256','prior_pending_sha256','prior_plan_sha256','prior_source_commit','protocol','registry_sha256','resume_plan_path','resume_plan_sha256','resume_source_commit','source_authority','start_intent_path','start_intent_sha256','task_id'];
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),expected);
const absolute=path=>typeof path==='string'&&resolve(path)===path;
function birth(value){
 need(keys(value,identityKeys)&&Number.isSafeInteger(value.pid)&&value.pid>1&&value.uid===process.getuid()
  &&Array.isArray(value.kernel_start)&&value.kernel_start.length===2&&Number.isSafeInteger(value.kernel_start[0])&&value.kernel_start[0]>0&&Number.isSafeInteger(value.kernel_start[1])&&value.kernel_start[1]>=0&&value.kernel_start[1]<1000000
  &&absolute(value.executable)&&hash(value.executable_sha256)&&hash(value.argv_sha256),'BIRTH');return structuredClone(value);
}
function json(path,{record=false}={}){const raw=record?recordBytes(path):readPrivatePolicy(path);need(raw.length<=1024*1024,'FILE_SIZE');return {value:JSON.parse(raw),sha256:digest(raw)};}
const clock=now=>now===undefined?Date.now:typeof now==='function'?now:()=>now;
async function dependencies(options){
 const inspect=options.inspectAuthority??(await import('./device-epoch-fence-resume-authority.mjs')).inspectResumeAuthority;
 const read=options.readProcessIdentity??(await import('./device-epoch-fence-resume-process.mjs')).readResumeProcessIdentity;
 const source=options.source??reviewSource;
 need(typeof inspect==='function'&&typeof read==='function'&&typeof source==='function','DEPENDENCIES');return {inspect,read,source,time:clock(options.now)};
}
function currentSource(source){const value=source();need(value&&typeof value.then!=='function'&&commit(value.commit)&&Array.isArray(value.files)&&value.files.length>0,'SOURCE');return value;}
function actualBirth(read,expected,plan,kind,phase){
 const value=read(expected.pid,{plan,kind,phase});need(value&&typeof value.then!=='function','SYNC_KERNEL');
 const projected=Object.fromEntries(identityKeys.map(key=>[key,value[key]]));birth(projected);need(same(projected,expected),'BIRTH_DRIFT');
 if(kind==='supervisor')need(phase==='builder'?value.ppid===process.pid:expected.pid===process.ppid,'SUPERVISOR_RELATION');
 return projected;
}
function scope(authority,planPath,source){
 const p=authority?.plan,auth=authority?.auth?.auth,i=authority?.instance,raw=json(planPath).value;
 need(p?.protocol==='device-epoch-fence-resume-plan/v1'&&same(raw,p)&&uuid.test(p.task_id||'')&&hash(p.plan_sha256)
  &&absolute(p.execution_directory)&&realpathSync(p.execution_directory)===p.execution_directory,'PLAN');
 const {plan_sha256,...planBody}=p;need(digest(planBody)===plan_sha256,'PLAN_DIGEST');
 const dir=lstatSync(p.execution_directory);need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid()&&(dir.mode&0o777)===0o700,'DIRECTORY');
 need(same(authority.source,p.source_authority)&&same(currentSource(source),p.source_authority)&&commit(p.source_authority.commit)
  &&commit(p.prior?.prior_source?.commit)&&hash(p.prior.prior_plan_sha256)&&hash(p.prior.prior_pending_sha256),'SOURCE_SCOPE');
 need(keys(auth,authKeys)&&same(auth,p.auth)&&absolute(auth.ref_path)&&absolute(auth.key_path)&&[auth.ref_sha256,auth.key_sha256,auth.public_key_sha256].every(hash),'AUTH_SCOPE');
 need(i&&same(i,p.new_instance)&&/^[a-z][a-z0-9-]{2,63}$/.test(i.instance_id||'')&&i.endpoint==='tcp:127.0.0.1:5042'&&[i.registry_sha256,i.policy_sha256].every(hash),'INSTANCE');
 const proof=authority.stopProof;need(proof&&hash(proof.sha256)&&dirname(proof.path)===p.execution_directory,'STOP_PROOF');
 const actualProof=json(proof.path,{record:true});need(actualProof.sha256===proof.sha256&&same(actualProof.value,proof.proof),'STOP_PROOF_DRIFT');
 need(authority.review?.original_execution_stopped===false,'HISTORICAL_UNKNOWN');
 return {plan:p,auth,instance:i};
}
function intent(path,authority,guard,now){
 const p=authority.plan,i=authority.instance;need(absolute(path)&&dirname(path)===p.execution_directory,'INTENT_PATH');const result=json(path,{record:true}),v=result.value;
 need(keys(v,intentKeys)&&v.protocol==='device-epoch-fence-resume-start-intent/v1'&&v.action==='start_private_supervisor'
  &&v.task_id===p.task_id&&v.resume_plan_sha256===p.plan_sha256&&v.prior_pending_sha256===p.prior.prior_pending_sha256&&v.resume_source_commit===p.source_authority.commit
  &&v.auth_ref_sha256===authority.auth.auth.ref_sha256&&v.instance_id===i.instance_id&&v.endpoint===i.endpoint
  &&v.guard_identity_sha256===digest(guard)&&v.prior_stop_proof_sha256===authority.stopProof.sha256,'INTENT_SCOPE');
 const at=Date.parse(v.issued_at);need(Number.isFinite(at)&&at<=now&&now-at<=120000,'INTENT_EXPIRED');return result;
}
function lease(authority,now){const end=Date.parse(authority.plan.central?.expires_at??authority.review?.central_readback?.expires_at);need(Number.isFinite(end)&&end>now,'LEASE');return end;}
function sameAuthority(a,b){need(same(a,b),'AUTHORITY_DRIFT');}
export async function createResumeStartupReceipt(options={}){
 const {receiptPath,planPath,startIntentPath}=options;need([receiptPath,planPath,startIntentPath].every(absolute),'ARGUMENTS');const supervisor=birth(options.reservedSupervisor),guard=birth(options.guardIdentity),d=await dependencies(options);
 const inspect=()=>d.inspect({planPath,phase:'startup',guardIdentity:guard});const first=await inspect(),fixed=scope(first,planPath,d.source),before=intent(startIntentPath,first,guard,d.time());
 need(dirname(receiptPath)===fixed.plan.execution_directory,'RECEIPT_PATH');actualBirth(d.read,supervisor,fixed.plan,'supervisor','builder');actualBirth(d.read,guard,fixed.plan,'guard','builder');
 const fresh=await inspect();sameAuthority(first,fresh);scope(fresh,planPath,d.source);const now=d.time(),last=intent(startIntentPath,fresh,guard,now);need(last.sha256===before.sha256,'INTENT_DRIFT');
 actualBirth(d.read,supervisor,fresh.plan,'supervisor','builder');actualBirth(d.read,guard,fresh.plan,'guard','builder');const expires=Math.min(now+120000,lease(fresh,now));
 const p=fresh.plan,i=fresh.instance,receipt={protocol:'device-epoch-fence-resume-startup/v1',action:'start_private_server',task_id:p.task_id,resume_plan_path:planPath,resume_plan_sha256:p.plan_sha256,prior_source_commit:p.prior.prior_source.commit,prior_plan_sha256:p.prior.prior_plan_sha256,prior_pending_sha256:p.prior.prior_pending_sha256,resume_source_commit:p.source_authority.commit,auth_ref_path:fresh.auth.auth.ref_path,auth_ref_sha256:fresh.auth.auth.ref_sha256,instance_id:i.instance_id,endpoint:i.endpoint,registry_sha256:i.registry_sha256,policy_sha256:i.policy_sha256,issued_at:new Date(now).toISOString(),expires_at:new Date(expires).toISOString(),expected_supervisor:supervisor,guard_identity:guard,start_intent_path:startIntentPath,start_intent_sha256:last.sha256,source_authority:structuredClone(p.source_authority)};
 persistStartupReceipt(receiptPath,receipt);return {receipt,path:receiptPath,sha256:digest(recordBytes(receiptPath))};
}
export async function verifyResumeStartupReceipt(options={}){
 const {receiptPath,instanceId,registrySha256,sourceCommit,policySha256}=options;need(absolute(receiptPath)&&commit(sourceCommit)&&[registrySha256,policySha256].every(hash),'ARGUMENTS');const d=await dependencies(options);
 const load=()=>{const value=options.load?options.load(receiptPath):json(receiptPath,{record:true}).value;need(value&&typeof value.then!=='function','SYNC_RECEIPT');return value;};
 const r=load(),supervisor=birth(r.expected_supervisor),guard=birth(r.guard_identity);
 need(keys(r,receiptKeys)&&r.protocol==='device-epoch-fence-resume-startup/v1'&&r.action==='start_private_server'&&absolute(r.resume_plan_path)
  &&r.instance_id===instanceId&&r.registry_sha256===registrySha256&&r.policy_sha256===policySha256&&r.resume_source_commit===sourceCommit,'RECEIPT');
 const validTime=()=>{const at=Date.parse(r.issued_at),end=Date.parse(r.expires_at),now=d.time();need(Number.isFinite(at)&&Number.isFinite(end)&&at<=now&&end>now&&end>at&&end-at<=120000,'RECEIPT_EXPIRED');};validTime();
 const inspect=()=>d.inspect({planPath:r.resume_plan_path,phase:'startup',guardIdentity:guard});const initial=await inspect();scope(initial,r.resume_plan_path,d.source);
 const bind=a=>{const p=a.plan,i=a.instance;need(dirname(receiptPath)===p.execution_directory&&r.task_id===p.task_id&&r.resume_plan_sha256===p.plan_sha256
  &&r.prior_source_commit===p.prior.prior_source.commit&&r.prior_plan_sha256===p.prior.prior_plan_sha256&&r.prior_pending_sha256===p.prior.prior_pending_sha256
  &&r.auth_ref_path===a.auth.auth.ref_path&&r.auth_ref_sha256===a.auth.auth.ref_sha256&&r.instance_id===i.instance_id&&r.endpoint===i.endpoint&&r.registry_sha256===i.registry_sha256&&r.policy_sha256===i.policy_sha256
  &&same(r.source_authority,p.source_authority)&&r.resume_source_commit===p.source_authority.commit,'RECEIPT_BINDING');const v=intent(r.start_intent_path,a,guard,d.time());need(v.sha256===r.start_intent_sha256,'INTENT_DRIFT');need(Date.parse(r.expires_at)<=lease(a,d.time()),'LEASE_DRIFT');};
 bind(initial);actualBirth(d.read,supervisor,initial.plan,'supervisor','verify');actualBirth(d.read,guard,initial.plan,'guard','verify');
 const fresh=await inspect();sameAuthority(initial,fresh);scope(fresh,r.resume_plan_path,d.source);bind(fresh);need(same(load(),r),'RECEIPT_DRIFT');
 actualBirth(d.read,supervisor,fresh.plan,'supervisor','verify');actualBirth(d.read,guard,fresh.plan,'guard','verify');validTime();
 return {protocol:'device-epoch-fence-startup-verification/v2',authorized:true,action:'start_private_server',instance_id:instanceId,endpoint:r.endpoint,source_commit:sourceCommit,registry_sha256:registrySha256,policy_sha256:policySha256,resume_plan_sha256:r.resume_plan_sha256,prior_pending_sha256:r.prior_pending_sha256,auth_ref_sha256:r.auth_ref_sha256,auth:structuredClone(fresh.auth.auth)};
}
