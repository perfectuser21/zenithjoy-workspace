// Frozen host wiring, not a business authorization decision.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const need=(v,k)=>{if(!v)throw Error('ACTIVITY_104_'+k);};
export const KEYS=['assigned_workflow','root_task_id','actor','source_commit','marker_source','runtime_root','transport','host','profile','serial','adb_serial','company_id','tenant_id','line','account','sender_id','local_owner','central_owner','tasks','business_deadline_ms','cleanup_deadline_ms','node','node_sha256','python','python_sha256','native_root','credentials','authorization_asset','verification','outreach_runtime','phone_controller','phone_controller_sha256','phone_registry','phone_registry_sha256','adb_host_config','adb_host_config_sha256'];
export const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function regular(p){need(typeof p==='string'&&path.isAbsolute(p),'SOURCE_PATH');const st=fs.lstatSync(p);need(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&!(st.mode&0o022),'SOURCE_FILE');return fs.readFileSync(p);}
export function asset(a){need(a&&/^[a-f0-9]{64}$/.test(a.sha256||''),'SOURCE_ASSET');const raw=regular(a.path);need(hash(raw)===a.sha256,'SOURCE_DIGEST');return raw;}
export function scope(c){return Object.fromEntries(KEYS.map(k=>[k,k==='sender_id'?c.sender_id??c.account:k==='marker_source'?c.marker_source??c.source_commit:c[k]]));}
export function validateAuthorization(c){
 const a=JSON.parse(asset(c.authorization_asset));
 need(a.schema==='run-send-authorization/v1'&&typeof a.decision_id==='string'&&a.decision_id.length>0&&a.root_task_id===c.root_task_id,'AUTHORIZATION_SCOPE');
 need(typeof a.message==='string'&&a.message.length>0&&a.message.length<=600&&!/[\r\n"&<>]/.test(a.message)&&hash(a.message)===a.message_sha256,'AUTHORIZATION_MESSAGE');
 need(a.max_new_recipients===1&&a.max_send_attempts===1&&Number.isSafeInteger(a.test_execution_daily_cap)&&a.test_execution_daily_cap>0&&a.company_policy_changed===false&&a.requires_current_pause_and_daily_count_readback===true,'AUTHORIZATION_LIMIT');return a;
}
export function validateScope(c){
 need((c.marker_source===undefined||c.marker_source===c.source_commit),'CONTEXT_MARKER_SOURCE');
 need(c?.assigned_workflow==='104'&&c.transport==='local'&&!c.recovery&&!c.recovery_of,'CONTEXT');
 for(const k of ['root_task_id','actor','host','profile','serial','adb_serial','company_id','tenant_id','line','account','local_owner','central_owner'])need(typeof c[k]==='string'&&c[k].length>0,'CONTEXT');
 need(/^[A-Za-z0-9_-]{1,120}$/.test(c.profile)&&/^[A-Za-z0-9_.:-]{1,160}$/.test(c.serial)&&/^[A-Za-z0-9_.:-]{1,160}$/.test(c.adb_serial),'CONTEXT_DEVICE');
 need((c.sender_id??c.account)===c.account&&/^[a-f0-9]{40}$/.test(c.source_commit||'')&&fs.realpathSync(c.runtime_root)===c.runtime_root,'CONTEXT');
 need(c.tasks?.['104']&&['task_id','run_id','run_tag'].every(k=>typeof c.tasks['104'][k]==='string'&&c.tasks['104'][k])&&c.central_owner===c.tasks['104'].task_id,'CONTEXT');
 need(Number.isSafeInteger(c.business_deadline_ms)&&c.cleanup_deadline_ms>c.business_deadline_ms,'CONTEXT');
 const s=c.verification?.['104'];need(s&&['record_id','comment_id','lead_id','target_douyin_id','profile_url','source_102_run','source_103_run'].every(k=>typeof s[k]==='string'&&s[k]),'CONTEXT_SCOPE');
 need(c.verification.pg?.deployment?.source_commit===c.source_commit&&Number.isSafeInteger(c.verification.policy_version)&&c.verification.policy_id,'CONTEXT_PG');
 need(c.credentials&&['database','feishu','brain'].every(k=>typeof c.credentials[k]==='string'&&path.isAbsolute(c.credentials[k]))&&Array.isArray(c.credentials.provider_env_files)&&c.credentials.provider_env_files.every(p=>typeof p==='string'&&path.isAbsolute(p)),'CONTEXT_CREDENTIAL_PATHS');
 for(const k of ['node','python','phone_controller','phone_registry','adb_host_config'])asset({path:c[k],sha256:c[k+'_sha256']});
 need(fs.realpathSync(c.phone_controller).startsWith(c.runtime_root+path.sep),'SOURCE_CONTROLLER');
 const r=c.outreach_runtime;need(r&&['state_directory','evidence_base','lock_root'].every(k=>typeof r[k]==='string'&&path.isAbsolute(r[k]))&&Array.isArray(r.account_bindings)&&r.account_bindings.length>0&&Array.isArray(r.history_assets),'CONTEXT_RUNTIME');
 need(r.account_bindings.every(b=>b&&typeof b.host==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(b.profile)&&/^[A-Za-z0-9_.:-]{1,160}$/.test(b.serial))&&r.account_bindings.filter(b=>b.host===c.host&&b.profile===c.profile&&b.serial===c.adb_serial).length===1&&new Set(r.account_bindings.map(b=>canonical(b))).size===r.account_bindings.length,'CONTEXT_BINDINGS');
 return validateAuthorization(c);
}
const EXPECTED_BINDING_SHA='ASSEMBLY_REPLACES_BINDING_SHA';
export function verify104Context(c){
 const file=new URL('./outreach-host-binding.json',import.meta.url);const bytes=regular(file.pathname);need(hash(bytes)===EXPECTED_BINDING_SHA,'CONTEXT_FROZEN');const frozen=JSON.parse(bytes);
 need(canonical(scope(c))===canonical(frozen),'CONTEXT_CHANGED');validateScope(c);return frozen;
}
export function verify104Runtime(c){
 const pins=c.verification.runtime_sha256;for(const n of ['leadgen-outreach-orders.js','line-routes.js','next-outreach-lib.js','leadgen-outreach-bridge.js','company-config-lib.js','leadgen-policy-review.js'])need(pins[n],'SOURCE_RUNTIME');
 for(const [n,digest]of Object.entries(pins)){need(n&&!path.isAbsolute(n)&&!n.split('/').includes('..'),'SOURCE_RUNTIME');asset({path:path.join(c.runtime_root,n),sha256:digest});}
}
