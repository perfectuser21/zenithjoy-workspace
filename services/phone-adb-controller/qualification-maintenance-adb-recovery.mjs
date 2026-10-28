// 原699宿主服务的受控恢复新epoch；正式Task记录与当前系统观察缺一不可。
import {digest} from './runtime-definition.mjs';
import {maintenanceBrainRequest} from './qualification-maintenance-brain.mjs';
const SOURCE='699515a58860668ee262363e4565fc7ba3aceea1';
const LABEL='com.zenithjoy.adb-host',PLIST='/Library/LaunchDaemons/'+LABEL+'.plist';
const need=v=>{if(!v)throw Error('MAINTENANCE_ADB_RECOVERY_UNPROVEN');};
const uuid=/^[a-f0-9-]{36}$/,sha=/^[a-f0-9]{64}$/;
const kernelKeys=['pid','uid','ppid','pgid','start_identity','start_ms'];
const sameKernel=(a,b)=>a&&b&&kernelKeys.every(k=>a[k]===b[k])&&a.terminal!==true&&b.terminal!==true;
const fileSame=(a,b,canonicalAdbAlias=false)=>a&&b&&['path','realpath','uid','sha256'].every(k=>a[k]===b[k])&&(canonicalAdbAlias||a.path===a.realpath)&&sha.test(a.sha256);
function kernel(p){need(p&&Number.isSafeInteger(p.pid)&&p.pid>1&&p.uid>0&&Number.isSafeInteger(p.ppid)&&p.ppid>0
 &&Number.isSafeInteger(p.pgid)&&p.pgid>1&&/^\d+:\d{1,6}$/.test(p.start_identity||'')&&Number.isFinite(p.start_ms)&&p.terminal===false);}
export function validateAdbServiceRecovery(value) {
 const a=value?.authorization,t=value?.task,r=t?.result?.adb_service_recovery,s=t?.payload?.recovery_scope;
 need(a&&uuid.test(a.recovery_task_id||'')&&t?.id===a.recovery_task_id&&t.status==='completed'&&t.claimed_by===null
  &&t.task_type==='data'&&t.domain==='operations'&&t.project_id===a.project_id&&uuid.test(a.project_id||'')
  &&t.parent_task_id===a.root_task_id&&uuid.test(a.root_task_id||'')
  &&t.payload.work_kind==='operations'&&t.payload.operational_mutation===true&&t.payload.read_only===false);
 need(r?.schema_version===1&&r.recovery_task_id===t.id&&r.original_task_id===a.original_task_id
  &&r.original_claimed_by===a.original_actor&&r.original_claimed_at===a.original_claimed_at
  &&Number.isFinite(Date.parse(a.original_claimed_at))&&r.host==='xian-m4'&&r.service_source_commit===SOURCE
  &&sha.test(r.new_supervisor_argv_sha256||'')&&sha.test(r.new_server_argv_sha256||'')
  &&r.execution_actor===t.payload.actor&&r.execution_actor===t.result.actor&&typeof r.execution_actor==='string'
  &&r.owner_preservation?.central_owner_preserved===true&&r.owner_preservation.original_claim_epoch_preserved===true);
 need(s?.host===r.host&&s.port===5037&&s.source_commit===SOURCE&&s.original_owner_task===a.original_task_id
  &&s.signal==='SIGTERM'&&s.signal_attempt_limit===1&&s.change_configuration===false&&s.send_dm===false&&s.business_write===false
  &&Array.isArray(s.allowed_serials)&&s.allowed_serials.includes(a.serial)&&new Set(s.allowed_serials).size===s.allowed_serials.length);
 for(const p of [r.old_supervisor,r.old_server,r.new_supervisor,r.new_server])kernel(p);
 need(s.original_supervisor_pid===r.old_supervisor.pid&&s.original_supervisor_birth===r.old_supervisor.start_identity
  &&s.original_server_pid===r.old_server.pid&&sameKernel(r.signal?.target,r.old_supervisor)
  &&r.signal.name==='SIGTERM'&&r.signal.count===1&&r.signal.sent_at_ms>=Date.parse(t.created_at)
  &&r.signal.sent_at_ms<=Date.parse(t.completed_at)&&r.old_supervisor.ppid===1&&r.new_supervisor.ppid===1
  &&r.old_server.ppid===r.old_supervisor.pid&&r.new_server.ppid===r.new_supervisor.pid
  &&r.new_server.pgid===r.new_supervisor.pgid&&r.new_supervisor.pgid===r.new_supervisor.pid
  &&[r.old_server,r.new_supervisor,r.new_server].every(p=>p.uid===r.old_supervisor.uid)
  &&r.new_supervisor.start_ms>r.signal.sent_at_ms&&r.new_server.start_ms>=r.new_supervisor.start_ms
  &&r.new_supervisor.start_identity!==r.old_supervisor.start_identity
  &&r.old_supervisor_absent_observed===true&&r.old_server_absent_observed===true&&r.config_unchanged_observed===true);
 need(r.launchd?.label===LABEL&&r.launchd.plist?.path===PLIST&&r.launchd.plist.realpath===PLIST&&r.launchd.plist.uid===0
  &&sha.test(r.launchd.plist.sha256||'')&&sha.test(r.launchd.argv_sha256||''));
 const target=r.launchd.target,home=target?.realpath?.match(new RegExp('^(/Users/[^/]+)/\\.local/share/zenithjoy/phone-candidates/'+SOURCE+'/runtime/adb-host-service\\.py$'))?.[1];
 need(home&&target.path===target.realpath&&target.uid===r.new_supervisor.uid&&sha.test(target.sha256||''));
 const config=home+'/.config/zenithjoy/adb-service.json';
 need(Object.keys(r.config_sha256||{}).sort().join(',')===[PLIST,config].sort().join(',')
  &&r.config_sha256[PLIST]===r.launchd.plist.sha256&&sha.test(r.config_sha256[config]||'')
  &&r.service_source_files?.['adb-host-service.py']===target.sha256&&sha.test(r.service_source_files?.['adb-existing-route.py']||'')
  &&r.before_adb_binary_sha256===r.adb_binary?.sha256&&sha.test(r.adb_binary.sha256||'')&&r.adb_binary.uid===r.new_server.uid
  &&r.adb_binary.path==='/opt/homebrew/bin/adb'&&r.adb_binary.realpath.startsWith('/opt/homebrew/Caskroom/android-platform-tools/')
  &&r.listeners?.['5037']?.exit_code===0&&digest(r.listeners['5037'].pids)===digest([r.new_server.pid])
  &&['5041','5042'].every(port=>r.listeners[port]?.exit_code===1&&r.listeners[port].pids?.length===0));
 need(Array.isArray(r.artifacts)&&r.artifacts.length>=2&&r.artifacts.every(f=>typeof f.name==='string'&&f.bytes>0&&sha.test(f.sha256||'')));
 return {receipt:r,config_path:config};
}
export async function readAdbServiceRecovery(authority,{request=maintenanceBrainRequest}={}) {
 const id=authority.scope?.original_evidence?.adb_host_recovery_task_id;
 if(id===undefined)return null;
 need(uuid.test(id||''));
 const authorization={original_task_id:authority.original_task_id,original_actor:authority.original_actor,
  original_claimed_at:authority.original_claimed_at,project_id:authority.project_id,root_task_id:authority.root_task_id,
  serial:authority.scope.serial,recovery_task_id:id};
 const value={authorization,task:await request('/tasks/'+id)};validateAdbServiceRecovery(value);return value;
}
export function recoveredAdbRoot({serviceRecovery,original,observation,row,detail}) {
 if(!serviceRecovery)return false;
 try {
  const{receipt:r,config_path}=validateAdbServiceRecovery(serviceRecovery),d=detail,c=observation.census;
  const child=c.observations.find(p=>p.pid===r.new_server.pid),cd=observation.roles[String(r.new_server.pid)];
  const policy=observation.service_policy;
  const expected=new Map(original.frozen.deployment.files.map(f=>[f.deployed_path,f.content_sha256]));
  need(sameKernel(row,r.new_supervisor)&&sameKernel(d.kernel,r.new_supervisor)&&row.uid===c.uid
   &&r.old_supervisor.start_ms<original.launch_result.started_at_ms&&r.new_supervisor.start_ms>original.launch_result.started_at_ms
   &&d.state==='observed'&&d.launchd?.domain==='system'&&d.launchd.target_name==='system/'+LABEL
   &&d.launchd.system_pid===row.pid&&d.launchd.pid===row.pid&&d.launchd.label===LABEL
   &&row.argv_sha256===r.new_supervisor_argv_sha256&&d.argv_sha256===r.new_supervisor_argv_sha256
   &&d.launchd.system_argv_sha256===r.launchd.argv_sha256&&d.launchd.argv_sha256===r.launchd.argv_sha256&&fileSame(d.launchd.plist,r.launchd.plist)
   &&fileSame(d.launchd.target,r.launchd.target)&&fileSame(row.program?.script,r.launchd.target)
   &&policy?.path===config_path&&policy.realpath===config_path&&policy.uid===c.uid&&policy.mode===0o600&&policy.sha256===r.config_sha256[config_path]);
  for(const[name,hash]of Object.entries(r.service_source_files))need(expected.get(name)===hash
   &&d.files.filter(f=>f.path===f.realpath&&f.realpath===r.launchd.target.realpath.replace('adb-host-service.py',name)&&f.uid===c.uid&&f.sha256===hash).length===1);
  need(sameKernel(child,r.new_server)&&cd?.state==='observed'&&sameKernel(cd.kernel,r.new_server)&&child.argv_sha256===cd.argv_sha256
   &&child.argv_sha256===r.new_server_argv_sha256
   &&fileSame(cd.executable,r.adb_binary,true)&&cd.shape?.kind==='adb_server'
   &&observation.listeners?.exit_code===0&&observation.listeners.rows.length>0
   &&observation.listeners.rows.every(x=>x.pid===child.pid&&['127.0.0.1:5037','[::1]:5037'].includes(x.address)));
  return true;
 }catch{return false;}
}
