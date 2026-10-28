import test from 'node:test';
import * as awaitImportChildProcess from 'node:child_process';
import * as awaitImportDomain from '../qualification-maintenance-domain.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {evaluateOriginalExecutionDomain,DOMAIN_COLLECTOR_SHA256} from '../qualification-maintenance-domain.mjs';
import {digest} from '../runtime-definition.mjs';
const api=await import('../qualification-maintenance-adb-recovery.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
const archived=()=>JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/qualification-adb-recovery-attempt4.json.gz',import.meta.url))));
function input() {
 const f=archived(),t=f.recovery_task,r=t.result.adb_service_recovery;
 const authorization={original_task_id:r.original_task_id,original_actor:r.original_claimed_by,original_claimed_at:r.original_claimed_at,
  project_id:t.project_id,root_task_id:t.parent_task_id,serial:f.original.frozen.run_identity.serial,
  recovery_task_id:t.id};
 // New collector packet fields, derived from actual 367 config metadata + 014e system job readback.
 // Original capture remains immutable in the compressed fixture; this is not a fresh device proof.
 f.observation.service_policy={path:'/Users/jinnuoshengyuan/.config/zenithjoy/adb-service.json',realpath:'/Users/jinnuoshengyuan/.config/zenithjoy/adb-service.json',uid:501,mode:0o600,
  sha256:r.config_sha256['/Users/jinnuoshengyuan/.config/zenithjoy/adb-service.json']};
 Object.assign(f.observation.roles['14896'].launchd,{domain:'system',target_name:'system/com.zenithjoy.adb-host',system_pid:14896,system_argv_sha256:r.launchd.argv_sha256});
 f.observation.collector_sha256=DOMAIN_COLLECTOR_SHA256;
 return {...f,serviceRecovery:{authorization,task:t}};
}
function replay(f){const now=Date.now;Date.now=()=>f.observation.finished_at_ms;try{return evaluateOriginalExecutionDomain(f);}finally{Date.now=now;}}
test('actual attempt4 without a formal recovery ref keeps the exact two unknown effectors',()=>{
 const f=archived();f.observation.collector_sha256=DOMAIN_COLLECTOR_SHA256;
 const r=replay(f);assert.equal(r.status,'blocked');assert.deepEqual(r.blocked_pids,[14896,14898]);
});
test('actual recovered 699 native epoch is accepted only with the completed same-root Ops and fresh system/config packet',()=>{
 const f=input(),r=replay(f);assert.equal(r.status,'verified',JSON.stringify(r));assert.equal(r.os_full_stop,false);
});
test('official read is by the delegated recovery Task id; absent ref preserves old behavior without API calls',async()=>{
 assert.equal(typeof api?.readAdbServiceRecovery,'function');let calls=[];
 const f=input(),a=f.serviceRecovery.authorization;
 const authority={...a,scope:{original_task_id:a.original_task_id,serial:a.serial,original_evidence:{adb_host_recovery_task_id:a.recovery_task_id}}};
 const actual=await api.readAdbServiceRecovery(authority,{request:async p=>{calls.push(p);return f.recovery_task;}});
 assert.equal(actual.task.id,a.recovery_task_id);assert.deepEqual(calls,['/tasks/'+a.recovery_task_id]);
 calls=[];authority.scope.original_evidence={};assert.equal(await api.readAdbServiceRecovery(authority,{request:async()=>{calls.push(1);}}),null);assert.deepEqual(calls,[]);
});
for(const[name,change]of[
 ['not completed',f=>f.serviceRecovery.task.status='in_progress'],
 ['wrong Project',f=>f.serviceRecovery.task.project_id='00000000-0000-4000-8000-000000000000'],
 ['wrong root',f=>f.serviceRecovery.task.parent_task_id='00000000-0000-4000-8000-000000000000'],
 ['wrong original owner',f=>f.serviceRecovery.task.result.adb_service_recovery.original_claimed_by='foreign'],
 ['changed original epoch',f=>f.serviceRecovery.task.result.adb_service_recovery.original_claimed_at='2026-10-28T00:00:00Z'],
 ['unrelated scope',f=>f.serviceRecovery.task.payload.recovery_scope.original_owner_task='00000000-0000-4000-8000-000000000000'],
 ['different source',f=>f.serviceRecovery.task.result.adb_service_recovery.service_source_commit='a'.repeat(40)],
 ['more than one signal',f=>f.serviceRecovery.task.result.adb_service_recovery.signal.count=2],
 ['unconfirmed old server',f=>f.serviceRecovery.task.result.adb_service_recovery.old_server_absent_observed=false],
 ['changed config receipt',f=>f.serviceRecovery.task.result.adb_service_recovery.config_unchanged_observed=false],
 ['foreign execution actor',f=>f.serviceRecovery.task.result.adb_service_recovery.execution_actor='foreign'],
 ['new native birth mismatch',f=>f.serviceRecovery.task.result.adb_service_recovery.new_supervisor.start_identity='1793167349:18872'],
 ['new child birth mismatch',f=>f.serviceRecovery.task.result.adb_service_recovery.new_server.start_identity='1793167349:114353'],
 ['wrong binary',f=>f.observation.roles['14898'].executable.sha256='0'.repeat(64)],
 ['changed config bytes',f=>f.observation.service_policy.sha256='0'.repeat(64)],
 ['config alias',f=>f.observation.service_policy.path='/tmp/config-alias'],
 ['wrong config owner',f=>f.observation.service_policy.uid=0],
 ['wrong config mode',f=>f.observation.service_policy.mode=0o644],
 ['missing config observation',f=>delete f.observation.service_policy],
 ['gui same label',f=>f.observation.roles['14896'].launchd.domain='gui/501'],
 ['different system PID',f=>f.observation.roles['14896'].launchd.system_pid=26044],
 ['changed root plist',f=>f.observation.roles['14896'].launchd.plist.sha256='0'.repeat(64)],
 ['plist alias',f=>f.observation.roles['14896'].launchd.plist.path='/tmp/plist-alias'],
 ['untrusted plist owner',f=>f.observation.roles['14896'].launchd.plist.uid=501],
 ['different ProgramArguments',f=>f.observation.roles['14896'].launchd.argv_sha256='0'.repeat(64)],
 ['unknown identity',f=>f.observation.roles['14896'].state='unknown'],
 ['wrong service source file',f=>f.observation.roles['14896'].files[0].sha256='0'.repeat(64)],
 ['wrong child parent',f=>f.observation.roles['14898'].kernel.ppid=1],
 ['extra listener',f=>f.observation.listeners.rows.push({pid:42,address:'127.0.0.1:5037'})],
 ['native coverage missing',f=>f.observation.census.observations=f.observation.census.observations.filter(p=>p.pid!==14898)],
 ['other late root',f=>{const p=f.observation.census.observations.find(p=>p.pid===26142);p.start_ms=f.original.launch_result.started_at_ms+1;}],
])test(name+' is still BLOCK',()=>{assert.equal(replay((f=>{change(f);return f;})(input())).status,'blocked');});

test('the real effects orchestrator consumes the official recovery record instead of ignoring it',async()=>{
 const {collectMaintenanceEffects}=await import('../qualification-maintenance-effects.mjs');
 const f=input(),saved=[];let reads=0;
 const now=Date.now;Date.now=()=>f.observation.finished_at_ms;
 try {
  const r=await collectMaintenanceEffects({scope:{serial:f.original.frozen.run_identity.serial},epoch:f.epoch,contract_sha256:'a'.repeat(64),candidate:{},
   readOriginal:async()=>f.original,readCommander:async()=>structuredClone(f.commander),readMmv:async()=>f.commander.mmv_rpc,
   readDevice:async()=>f.device,readAdbRecovery:async()=>{reads++;return f.serviceRecovery;},readDomain:async()=>f.observation,
   retainEvidence:x=>{saved.push(x);return digest(x);},retainReceipt:()=>{}});
  assert.equal(r.status,'verified',JSON.stringify(r));assert.equal(reads,1);
  assert.equal(saved[0].adb_service_recovery.task.id,f.recovery_task.id);
 }finally{Date.now=now;}
});
test('recovery reader binding carries the real authority Project and root into the runtime',async()=>{
 const {authorityFixture}=await import('./helpers/qualification-maintenance-fixture.mjs');
 const {authorizeMaintenance}=await import('../qualification-maintenance-authority.mjs');const f=authorityFixture();
 const a=authorizeMaintenance(f);assert.equal(a.project_id,f.maintenanceTask.project_id);assert.equal(a.root_task_id,f.originalTask.parent_task_id);
});
test('the exact collector proves actual system job argv, rejects gui/name/PID lookalikes, and exposes safe config mode',()=>{
 const {spawnSync}=awaitImportChildProcess;
 const m=awaitImportDomain;
 const f=input(),a=f.system_binding_metadata;
 const argv=['/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/bin/python3.14',f.recovery_task.result.adb_service_recovery.launchd.target.path,'run','--config',f.observation.service_policy.path];
 const stdout='system/com.zenithjoy.adb-host = {\n\tpid = 14896\n\targuments = {\n'+argv.map(v=>'\t\t'+v).join('\n')+'\n\t}\n}\n';
 const code="import base64,json,sys;ns={};exec(base64.b64decode(sys.argv[1]),ns);from types import SimpleNamespace\na=json.load(sys.stdin);valid=ns['system_service_binding'](SimpleNamespace(returncode=0,stdout=a['stdout']),a['argv'],14896);print(json.dumps(valid))";
 const r=spawnSync('python3',['-B','-I','-c',code,m.DOMAIN_COLLECTOR_BASE64],{input:JSON.stringify({stdout,argv}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{domain:'system',target_name:'system/com.zenithjoy.adb-host',system_pid:14896,system_argv_sha256:a.system_job.arguments_sha256});
 for(const changed of [stdout.replace('system/','gui/501/'),stdout.replace('pid = 14896','pid = 26044'),stdout.replace('\n\t\trun\n','\n\t\tstatus\n')]) {
  const q=spawnSync('python3',['-B','-I','-c',code,m.DOMAIN_COLLECTOR_BASE64],{input:JSON.stringify({stdout:changed,argv}),encoding:'utf8'});assert.notEqual(q.status,0);
 }
});

for(const [name,pid]of[['supervisor',14896],['server',14898]])test(name+' cannot append arguments while retaining the same source target',()=>{
 const f=input(),r=f.observation.census.observations.find(p=>p.pid===pid);r.argv_sha256='e'.repeat(64);f.observation.roles[String(pid)].argv_sha256=r.argv_sha256;
 assert.equal(replay(f).status,'blocked');
});
test('system binding cannot claim the same PID with different real ProgramArguments',()=>{
 const f=input();f.observation.roles['14896'].launchd.system_argv_sha256='e'.repeat(64);assert.equal(replay(f).status,'blocked');
});

test('new config metadata is optional for old-age roles; unreadable data becomes None, never a fabricated certificate',()=>{
 const code="import base64,json,sys,tempfile;from pathlib import Path;ns={};exec(base64.b64decode(sys.argv[1]),ns)\nwith tempfile.TemporaryDirectory() as d:\n assert ns['read_service_policy'](Path(d),True) is None\n assert ns['read_service_policy'](Path(d),False) is None\n print('OPTIONAL_POLICY_UNKNOWN')";
 const r=awaitImportChildProcess.spawnSync('python3',['-B','-I','-c',code,awaitImportDomain.DOMAIN_COLLECTOR_BASE64],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/OPTIONAL_POLICY_UNKNOWN/);
});
