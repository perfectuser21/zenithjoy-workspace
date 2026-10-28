import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {digest} from '../runtime-definition.mjs';
import {processObserverDigest} from '../qualification-maintenance-processes.mjs';
const api=await import('../qualification-maintenance-domain.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
const old='353b910f11ce3852b2ef69c8ead5c37e97850b4a';
function fixture() {
 const now=Date.now(),run='original_upload_failure',runDir='/Users/u/.local/share/zenithjoy/phone-candidate-runs/'+'b'.repeat(40)+'/ledger/douyin_video_processing-'+run;
 const main={pid:200,ppid:199,pgid:200,start_identity:'1700000000:1000'};
 const natives=Array.from({length:7},(_,i)=>({pid:300+i,pgid:300+i,start_identity:'1700000001:'+i,processes:[{pid:300+i,pgid:300+i,start_identity:'1700000001:'+i}]}));
 const original={frozen:{deployment:{target:'xian-m4',source_commit:old,files:[]},run_identity:{tag:run,serial:'SERIAL'}},launch_result:{expected_run_dir:runDir,process_identity:main,started_at_ms:1700000000001},native_records:natives,
  recording:{record_started_stdout:'record_started pid=400 path=record'},tracked:[{pid:200,pgid:200,start_identity:main.start_identity},...natives.flatMap(n=>n.processes)],pid_only:[{pid:199,origin:'launch_parent'},{pid:400,origin:'capture_client'}]};
 const epoch={maintenance_task_id:'11111111-1111-4111-8111-111111111111',intent_id:'22222222-2222-4222-8222-222222222222',candidate_sha:'c'.repeat(40),guard_pid:500,guard_start_identity:'1700000100:1',guard_script_path:'/candidate/runtime/qualification-maintenance-host.py',guard_script_sha256:'d'.repeat(64)};
 const self={pid:500,uid:501,ppid:1,pgid:500,start_identity:epoch.guard_start_identity,classification:'observer',executable:'/usr/bin/python3',argv_sha256:'a'.repeat(64),program:{kind:'script',script:{realpath:epoch.guard_script_path,sha256:epoch.guard_script_sha256}}};
 const census={protocol:'qualification-process-census-v1',host:'xian-m4',uid:501,observer_pid:500,observer_sha256:processObserverDigest,finished_at_ms:now,
  enumerated:[self],final_enumerated:[self],observations:[self],absent:[],unknown:[],tracked:original.tracked.map(p=>({pid:p.pid,expected_start_identity:p.start_identity,state:'absent',reason:'ESRCH'})),pid_only:original.pid_only.map(p=>({...p,state:'absent',reason:'ESRCH'}))};
 const commander={status:'verified_inactive',domain:'exact_original_commander_owner',observed_at_ms:now,returned_turns:5,mmv_rpc:{status:'observed',source_commit:old,run_tag:run,run_id:'douyin_video_processing-'+run+'__a1',observer_sha256:'f'.repeat(64),observed_at_ms:now,matches:[],unknown:[],enumeration_sha256:'a'.repeat(64),final_enumeration_sha256:'b'.repeat(64)}};
 const observation={protocol:'qualification-original-domain-v1',collector_sha256:api?.DOMAIN_COLLECTOR_SHA256,epoch_sha256:digest(epoch),scope_sha256:null,census,roles:{500:{state:'observed',kernel:self,argv_sha256:self.argv_sha256,executable:{sha256:'e'.repeat(64),uid:501}}},listeners:{exit_code:0,rows:[]},finished_at_ms:now};
 return {original,epoch,commander,observation};
}
function ready(f) {assert.equal(typeof api?.originalExecutionScope,'function');f.observation.scope_sha256=digest(api.originalExecutionScope(f.original,501));return f;}
test('仅证明原run闭包，不把完整kernel空余进程叫全OS已停止',()=>{
 const f=ready(fixture()),r=api.evaluateOriginalExecutionDomain(f);
 assert.equal(r.status,'verified');assert.equal(r.domain,'fixed_353_original_execution');assert.equal(r.os_full_stop,false);
});
for(const [name,change]of [
 ['旧birth仍活',f=>f.observation.census.tracked[0].state='alive'],
 ['删掉一个历史birth',f=>f.observation.census.tracked.pop()],
 ['无birth捕获PID仍活',f=>f.observation.census.pid_only[1].state='alive'],
 ['伪装终止但非ESRCH',f=>f.observation.census.pid_only[0].reason='UNKNOWN'],
 ['未归属detached解释器',f=>{const r={pid:700,uid:501,ppid:1,pgid:700,start_identity:'1700000200:1',classification:'unknown_detached',executable:'/usr/bin/python3'};for(const k of ['enumerated','final_enumerated','observations'])f.observation.census[k].push(r);}],
 ['旧353MMV RPC活跃',f=>f.commander.mmv_rpc.matches.push({pid:800})],
 ['MMV未知没有覆盖',f=>f.commander.mmv_rpc.unknown.push({pid:800})],
 ['Commander只是静态无active描述',f=>f.commander.status='unknown'],
 ['观察不是当前guard',f=>f.epoch.guard_pid=501],
 ['截掉原件tracked',f=>f.original.tracked.pop()],
 ['观察太旧',f=>f.observation.census.finished_at_ms=1],
 ['不同collector源码',f=>f.observation.collector_sha256='0'.repeat(64)],
 ['只写reused却无新birth',f=>{f.observation.census.tracked[0].state='reused';}],
 ['terminal没有原birth核验',f=>{f.observation.census.tracked[0].state='terminal';}],
])test(name+'必须BLOCK',()=>{const f=ready(fixture());change(f);assert.equal(api.evaluateOriginalExecutionDomain(f).status,'blocked');});
test('collector派生参数形状严格拒额外命令和读取形状伪装，不输出原argv',()=>{
 assert.equal(typeof api?.DOMAIN_COLLECTOR_BASE64,'string');
 const code="import base64,json,sys;ns={};exec(base64.b64decode(sys.argv[1]),ns);print(json.dumps([ns['argument_shape'](x) for x in json.load(sys.stdin)]))";
 const argv=[['adb','-L','tcp:5037','server','nodaemon'],['adb','-s','SERIAL','exec-out','screencap','-p'],['adb','-s','SERIAL','shell','input','tap','1','2'],['ssh','-N','-L','5221:localhost:5221','us-vps'],['ssh','-N','us-vps','touch /tmp/bad'],['sleep','1'],['sleep','1;evil']];
 const r=spawnSync('python3',['-I','-c',code,api.DOMAIN_COLLECTOR_BASE64],{input:JSON.stringify(argv),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const values=JSON.parse(r.stdout);assert.deepEqual(values.map(x=>x.kind),['adb_server','adb_read','unknown','ssh_forward','unknown','sleep','unknown']);
 assert.ok(values.every(v=>!Object.hasOwn(v,'argv')));
});
