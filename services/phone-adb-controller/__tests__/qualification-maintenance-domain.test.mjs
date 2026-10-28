import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {digest} from '../runtime-definition.mjs';
import {processObserverDigest} from '../qualification-maintenance-processes.mjs';
import {mmvRpcObserverDigest} from '../qualification-maintenance-mmv.mjs';
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
 const commander={status:'verified_inactive',domain:'exact_original_commander_owner',observed_at_ms:now,returned_turns:5,mmv_rpc:{status:'verified_inactive',domain:'fixed353_mmv_rpc',source_commit:old,run_tag:run,run_id:'douyin_video_processing-'+run+'__a1',observer_sha256:mmvRpcObserverDigest,process_observer_sha256:processObserverDigest,observed_at_ms:now,completed_at_ms:now,matches:[],unknown:[],enumerated_sha256:'a'.repeat(64),final_enumerated_sha256:'b'.repeat(64),coverage_sha256:'c'.repeat(64)}};
 const observation={protocol:'qualification-original-domain-v1',collector_sha256:api?.DOMAIN_COLLECTOR_SHA256,epoch_sha256:digest(epoch),scope_sha256:null,census,roles:{500:{state:'observed',kernel:self,argv_sha256:self.argv_sha256,executable:{realpath:'/opt/homebrew/bin/python3',sha256:'e'.repeat(64),uid:501}}},listeners:{exit_code:0,rows:[]},finished_at_ms:now};
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
function addRole(f,row,detail) {
 const r={uid:501,ppid:1,pgid:row.pid,start_identity:'1699990000:'+row.pid,start_ms:1699990000000,argv_sha256:'a'.repeat(64),classification:'unknown_producer',...row};
 for(const key of ['enumerated','final_enumerated','observations'])f.observation.census[key].push(r);
 f.observation.roles[r.pid]={state:'observed',kernel:r,argv_sha256:r.argv_sha256,...detail};return r;
}
function wallRoles(f) {
 const hashes={'phone-wall-push.sh':'1','wall-lib.sh':'2','adb-managed-client.py':'3','adb-existing-route.py':'4','adb-host-service.py':'5'};
 f.original.frozen.deployment.files=Object.entries(hashes).map(([deployed_path,x])=>({deployed_path,content_sha256:x.repeat(64)}));
 const files=names=>names.map(name=>({path:'/Users/u/bin-harvest/'+name,realpath:'/Users/u/bin-harvest/'+name,sha256:hashes[name].repeat(64),uid:501}));
 addRole(f,{pid:600,executable:'/bin/bash',program:{kind:'script',script:files(['phone-wall-push.sh'])[0]}},{executable:{realpath:'/bin/bash',sha256:'b'.repeat(64),uid:0},files:files(['phone-wall-push.sh','wall-lib.sh','adb-managed-client.py','adb-existing-route.py']),launchd:{pid:600,label:'com.zenithjoy.phonewallpush',plist:{sha256:'c'.repeat(64),uid:501},argv_sha256:'a'.repeat(64)}});
 addRole(f,{pid:610,executable:'/opt/homebrew/bin/python3',program:{kind:'script',script:files(['adb-host-service.py'])[0]}},{executable:{realpath:'/opt/homebrew/bin/python3',sha256:'e'.repeat(64),uid:501},files:files(['adb-host-service.py','adb-existing-route.py']),launchd:{pid:610,label:'com.zenithjoy.adb-host',plist:{sha256:'c'.repeat(64),uid:0},argv_sha256:'a'.repeat(64)}});
 addRole(f,{pid:611,ppid:610,pgid:610,executable:'/opt/homebrew/bin/adb',program:{kind:'binary'}},{executable:{realpath:'/opt/homebrew/bin/adb',sha256:'7'.repeat(64),uid:501},shape:{kind:'adb_server'}});
 f.observation.listeners={exit_code:0,rows:[{pid:611,address:'127.0.0.1:5037'}]};return f;
}
test('launchd/source完整绑定的wall与唯一ADB可在原run域之外继续工作',()=>{
 const f=ready(wallRoles(fixture()));assert.equal(api.evaluateOriginalExecutionDomain(f).status,'verified');
});
test('已知只读inline也不能使用未绑定的恶意Python执行器',()=>{
 const f=fixture();addRole(f,{pid:700,executable:'/Users/u/bin/python-malicious',classification:'read_only_native_observer',program:{kind:'inline',code_sha256:'a6a8fab5ecc72f1f15e21cafeb27744488cf5495a52db735932d17d6d2aeebd2'}},{executable:{realpath:'/Users/u/bin/python-malicious',sha256:'9'.repeat(64),uid:501}});
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'blocked');
});
test('正确wall脚本不能把自定义恶意shell当系统bash排除',()=>{
 const f=wallRoles(fixture());f.observation.roles[600].executable={realpath:'/Users/u/bin/bash',sha256:'9'.repeat(64),uid:501};
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'blocked');
});
test('Perl只读包装若未核inner执行器字节仍须BLOCK',()=>{
 const f=wallRoles(fixture());addRole(f,{pid:620,ppid:600,pgid:600,executable:'/usr/bin/perl',program:{kind:'binary'}},{executable:{realpath:'/usr/bin/perl',sha256:'8'.repeat(64),uid:0},shape:{kind:'perl_adb_read',inner_path:'/tmp/adb'},inner_executable:{realpath:'/tmp/adb',sha256:'9'.repeat(64),uid:501}});
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'blocked');
});
test('已知bridge脚本也不能把未知Node镜像当旧常驻域排除',()=>{
 const f=fixture(),script={realpath:'/Users/u/repos/cecelia/codex-bridge.cjs',sha256:'77bd6c9b1bb396299d1447a48319dfc16ee0f22545f5e42b7944321ca8d9aa24',uid:501};
 addRole(f,{pid:650,executable:'/Users/u/bin/node',program:{kind:'script',script}},{executable:{realpath:'/Users/u/bin/node',uid:501,sha256:'9'.repeat(64)},files:[script],launchd:{pid:650,label:'com.perfect21.codex-bridge',plist:{sha256:'c'.repeat(64),uid:501},argv_sha256:'a'.repeat(64)}});
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'blocked');
});
test('与可信guard相同Python镜像的固定只读observer仍可排除',()=>{
 const f=fixture();addRole(f,{pid:700,executable:'/opt/homebrew/bin/python3',classification:'read_only_native_observer',program:{kind:'inline',code_sha256:'a6a8fab5ecc72f1f15e21cafeb27744488cf5495a52db735932d17d6d2aeebd2'}},{executable:{realpath:'/opt/homebrew/bin/python3',sha256:'e'.repeat(64),uid:501}});
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'verified');
});
test('Perl将exec实际已核ADB同镜像时保只读功能',()=>{
 const f=wallRoles(fixture());addRole(f,{pid:620,ppid:600,pgid:600,executable:'/usr/bin/perl',program:{kind:'binary'}},{executable:{realpath:'/usr/bin/perl',sha256:'8'.repeat(64),uid:0},shape:{kind:'perl_adb_read',inner_path:'/opt/homebrew/bin/adb'},inner_executable:{realpath:'/opt/homebrew/bin/adb',sha256:'7'.repeat(64),uid:501}});
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'verified');
});
test('现役Perl managed-client入口仅在脚本依赖和解析器入口均真绑定时排除',()=>{
 const f=wallRoles(fixture());f.observation.guard_entry_executable={realpath:'/opt/homebrew/bin/python3',sha256:'e'.repeat(64),uid:501};
 addRole(f,{pid:620,ppid:600,pgid:600,executable:'/usr/bin/perl',program:{kind:'binary'}},{executable:{realpath:'/usr/bin/perl',sha256:'8'.repeat(64),uid:0},shape:{kind:'perl_managed_read',inner_path:'/Users/u/bin-harvest/adb-managed-client.py'},inner_executable:{realpath:'/Users/u/bin-harvest/adb-managed-client.py',sha256:'3'.repeat(64),uid:501},inner_interpreter:{realpath:'/opt/homebrew/bin/python3',sha256:'e'.repeat(64),uid:501}});
 assert.equal(api.evaluateOriginalExecutionDomain(ready(f)).status,'verified');
 f.observation.roles[620].inner_interpreter={realpath:'/tmp/python3',sha256:'9'.repeat(64),uid:501};
 assert.equal(api.evaluateOriginalExecutionDomain(f).status,'blocked');
});
test('collector识别现役managed-client只读Perl参数且保inner路径供字节核验',()=>{
 const code="import base64,json,sys;ns={};exec(base64.b64decode(sys.argv[1]),ns);print(json.dumps(ns['argument_shape'](json.load(sys.stdin))))";
 const argv=['perl','-e','alarm shift; exec @ARGV','8','/Users/u/bin-harvest/adb-managed-client.py','-s','SERIAL','exec-out','screencap','-p'];
 const r=spawnSync('python3',['-I','-c',code,api.DOMAIN_COLLECTOR_BASE64],{input:JSON.stringify(argv),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const shape=JSON.parse(r.stdout);assert.equal(shape.kind,'perl_managed_read');assert.equal(shape.inner_path,'/Users/u/bin-harvest/adb-managed-client.py');
});
function ancestorFixture(mode) {
 const code=String.raw`import base64,hashlib,json,os,sys,tempfile,types
from pathlib import Path
ns={'__collector_sha256__':'fixture'};exec(base64.b64decode(sys.argv[1]),ns)
with tempfile.TemporaryDirectory(prefix='domain-boundary-') as root:
 guard=Path(root)/'qualification-maintenance-host.py';guard.write_text('# fixture guard source\n');sys.argv[0]=str(guard.resolve());sys.platform='darwin'
 own={'pid':os.getpid(),'uid':os.getuid(),'ppid':42,'pgid':os.getpid(),'start_identity':'1700000000:1','terminal':False}
 def kernel(pid):
  if pid==os.getpid():return own
  raise PermissionError('foreign UID kernel is unreadable')
 def load(module):
  module.kernel=kernel;module.args=lambda pid:(sys.executable,[sys.executable]);module.collect=lambda scope:{'observations':[],'enumerated':[{'pid':42,'uid':os.getuid()+(1 if sys.argv[2]=='foreign' else 0),'ppid':1,'pgid':42}],'final_enumerated':[]}
 ns['importlib'].util.spec_from_file_location=lambda *a:types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=load))
 ns['importlib'].util.module_from_spec=lambda *a:types.SimpleNamespace()
 ns['subprocess'].run=lambda args,**kw:types.SimpleNamespace(returncode=1 if 'print' in args or args[0].endswith('lsof') else 0,stdout='')
 context={'guard_pid':os.getpid(),'guard_start_identity':own['start_identity'],'guard_script_path':str(guard.resolve()),'guard_script_sha256':hashlib.sha256(guard.read_bytes()).hexdigest()}
 result=ns['collect_domain']({'uid':os.getuid()},context);print(json.dumps({'protocol':result['protocol'],'ancestors':result['ancestors']}))`;
 return spawnSync('python3',['-B','-I','-c',code,api.DOMAIN_COLLECTOR_BASE64,mode],{encoding:'utf8'});
}
test('实际collector在枚举已证父UID域外时不追kernel身份，权限不足不能扩成全OS要求',()=>{
 const r=ancestorFixture('foreign');
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{protocol:'qualification-original-domain-v1',ancestors:[]});
});
test('本UID父身份未知仍然拒绝，不能把祖先越域修复变成一概忽略',()=>{
 const r=ancestorFixture('same');assert.notEqual(r.status,0);assert.match(r.stderr,/PermissionError/);
});
test('真实部署plist的受限PATH-export/bare-tilde及Python版本名能派生精确脚本目标',()=>{
 const code=String.raw`import base64,json,sys,tempfile,plistlib
from pathlib import Path
ns={};exec(base64.b64decode(sys.argv[1]),ns)
with tempfile.TemporaryDirectory(prefix='launch-target-') as root:
 home=Path(root);(home/'bin-harvest').mkdir()
 for name in ['phone-wall-push.sh','log-stream-push.sh','host.py']:(home/'bin-harvest'/name).write_text('# source fixture\n')
 specs=[plistlib.loads(x.encode())['ProgramArguments'] for x in json.load(sys.stdin)]
 specs.append(['/opt/homebrew/Python',str(home/'bin-harvest/host.py'),'run'])
 print(json.dumps([Path(x['realpath']).name if x else None for x in [ns['exec_target'](args,home) for args in specs]]))`;
 const xml=['com.zenithjoy.phonewallpush.plist','com.zenithjoy.logstreampush.plist'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
 const r=spawnSync('python3',['-B','-I','-c',code,api.DOMAIN_COLLECTOR_BASE64],{input:JSON.stringify(xml),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),['phone-wall-push.sh','log-stream-push.sh','host.py']);
});
test('Node环境wrapper的$@只含脚本后参数，不能把wrapper自己当将执行的Node',()=>{
 const code=String.raw`import base64,hashlib,json,os,sys,tempfile,types,plistlib
from pathlib import Path
ns={'__collector_sha256__':'fixture'};exec(base64.b64decode(sys.argv[1]),ns)
with tempfile.TemporaryDirectory(prefix='node-wrapper-') as root:
 home=Path(root);guard=home/'qualification-maintenance-host.py';guard.write_text('# guard fixture\n');sys.argv[0]=str(guard.resolve());sys.platform='darwin';ns['Path'].home=staticmethod(lambda:home)
 wrapper=home/'.openclaw/service-env/ai.openclaw.node-env-wrapper.sh';wrapper.parent.mkdir(parents=True);wrapper.write_bytes(base64.b64decode('IyEvYmluL3NoCnNldCAtZXUKZW52X2ZpbGU9IiQxIgpzaGlmdAppZiBbIC1mICIkZW52X2ZpbGUiIF07IHRoZW4KICAuICIkZW52X2ZpbGUiCmZpCmV4ZWMgIiRAIgo='));environment=wrapper.parent/'ai.openclaw.node.env';environment.write_text('FIXTURE_ONLY=value\n')
 script=home/'openclaw/dist/index.js';script.parent.mkdir(parents=True);script.write_text('// fixture entry\n')
 args=['/bin/sh',str(wrapper),str(environment),sys.executable,str(script),'node','run'];plist=home/'Library/LaunchAgents/ai.openclaw.node.plist';plist.parent.mkdir(parents=True);plist.write_bytes(plistlib.dumps({'ProgramArguments':args}))
 own={'pid':os.getpid(),'uid':os.getuid(),'ppid':42,'pgid':os.getpid(),'start_identity':'1700000000:1','terminal':False};child={'pid':777,'uid':os.getuid(),'ppid':1,'pgid':777,'start_identity':'1700000000:2','terminal':False,'executable':sys.executable,'program':{'kind':'unclassified'}}
 def kernel(pid):return own if pid==os.getpid() else child
 def load(m):
  m.kernel=kernel;m.args=lambda pid:(sys.executable,[sys.executable] if pid==os.getpid() else ['openclaw-node'])
  m.collect=lambda scope:{'observations':[child],'enumerated':[{'pid':42,'uid':os.getuid()+1}],'final_enumerated':[]}
  m.describe_program=lambda *a:{'kind':'script','script':ns['file_info'](wrapper)}
 ns['importlib'].util.spec_from_file_location=lambda *a:types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=load));ns['importlib'].util.module_from_spec=lambda *a:types.SimpleNamespace()
 ns['subprocess'].run=lambda a,**kw:types.SimpleNamespace(returncode=0 if a==['/bin/launchctl','list'] else 1,stdout='777 0 ai.openclaw.node\n' if a==['/bin/launchctl','list'] else '')
 ctx={'guard_pid':os.getpid(),'guard_start_identity':own['start_identity'],'guard_script_path':str(guard.resolve()),'guard_script_sha256':hashlib.sha256(guard.read_bytes()).hexdigest()}
 scope={'uid':os.getuid(),'run_tag':'old','run_dir':'/old/run','runtime_root':'/old/run/runtime'}
 d=ns['collect_domain'](scope,ctx)['roles']['777']['launchd'];print(json.dumps({'target':d['wrapper_target']['realpath']==str(script.resolve()),'executable':d['wrapper_executable']['realpath']==str(Path(sys.executable).resolve())}))`;
 const r=spawnSync('python3',['-B','-I','-c',code,api.DOMAIN_COLLECTOR_BASE64],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{target:true,executable:true});
});

for (const suffix of [' >> /tmp/output',' `touch /tmp/unexpected`',' $(touch /tmp/unexpected)',' 2>/tmp/output']) test('受限launcher拒绝额外shell动作 '+suffix,()=>{
 const code=String.raw`import base64,json,sys
from pathlib import Path
ns={};exec(base64.b64decode(sys.argv[1]),ns)
ns['file_info']=lambda p:{'realpath':p}
print(json.dumps(ns['exec_target'](['/bin/bash','-lc','exec /trusted/phone-wall-push.sh'+sys.argv[2]],Path('/Users/u'))))`;
 const r=spawnSync('python3',['-B','-I','-c',code,api.DOMAIN_COLLECTOR_BASE64,suffix],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout),null);
});

test('真实无远端命令SSH的SOCKS和压缩转发参数可识别，命令与未知选项仍拒绝',()=>{
 const code="import base64,json,sys;ns={};exec(base64.b64decode(sys.argv[1]),ns);print(json.dumps([ns['argument_shape'](a) for a in json.load(sys.stdin)]))";
 const argv=[['/usr/bin/ssh','-D','127.0.0.1:1080','-N','relay'],['/usr/bin/ssh','-C','-N','-T','-o','HostName=relay.internal','-L','5221:localhost:5221','relay'],['ssh','-N','-D','1080','relay','touch /tmp/unexpected'],['ssh','-N','-D','$(unexpected)','relay'],['ssh','-N','-o','LocalCommand=unexpected','-D','1080','relay'],['ssh','-N','-o','ProxyCommand=unexpected','-L','5221:localhost:5221','relay']];
 const r=spawnSync('python3',['-B','-I','-c',code,api.DOMAIN_COLLECTOR_BASE64],{input:JSON.stringify(argv),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).map(x=>x.kind),['ssh_forward','ssh_forward','unknown','unknown','unknown','unknown']);
});

function existingWall(f) {
 const tuple={'phone-wall-push.sh':'e07fce1199ae6f7296fc04e794e784a23cff3f3560e5ba4a7c6de85a48c68bea','wall-lib.sh':'7c1147802aad15612514eb308581f435895885c237772adc44b36f40238ce7b7','adb-managed-client.py':'d1fc8d0dbe33137f7e05f40cb9f4388e53fd84ff8336eaf0d9533d059c7a8995','adb-existing-route.py':'f1cfd000f939c1bdc5729b2862290a7271846c4585dc52db0bbbe394e8a5556e'};
 wallRoles(f);for(const name of ['phone-wall-push.sh','wall-lib.sh'])f.original.frozen.deployment.files.find(x=>x.deployed_path===name).content_sha256=tuple[name];
 const d=f.observation.roles[600];d.files=Object.entries(tuple).map(([name,sha256])=>({path:'/Users/u/bin-harvest/'+name,realpath:'/Users/u/bin-harvest/'+name,sha256,uid:501}));d.kernel.program.script=d.files[0];
 f.observation.consumer_manifest={source_commit:'fa68c61c8a90b2414b0f4d74f7223d4dc742a5f7',identity:{path:'/Users/u/bin-harvest/deployment-manifest.json',realpath:'/Users/u/bin-harvest/deployment-manifest.json',sha256:'0a6679e7f27d945997fed693fc1f4f4ad99016f28671c743b0277be21476dd91',uid:501}};
 return f;
}
test('已接受旧wall完整四件tuple与实际installed-manifest绑定，不错用原353的新依赖',()=>{
 const f=ready(existingWall(fixture()));assert.equal(api.evaluateOriginalExecutionDomain(f).status,'verified');
});
for(const [name,change] of [['缺installedmanifest',f=>delete f.observation.consumer_manifest],['manifest字节不同',f=>f.observation.consumer_manifest.identity.sha256='0'.repeat(64)],['部署source不同',f=>f.observation.consumer_manifest.source_commit=old],['新旧依赖混配',f=>f.observation.roles[600].files[3].sha256='4'.repeat(64)]])test('旧wall '+name+'仍BLOCK',()=>{
 const f=ready(existingWall(fixture()));change(f);assert.equal(api.evaluateOriginalExecutionDomain(f).status,'blocked');
});

function systemSession(f) {
 const p={pid:690,uid:0,ppid:1,pgid:690};for(const k of ['enumerated','final_enumerated'])f.observation.census[k].push(p);
 addRole(f,{pid:700,ppid:690,pgid:690,executable:'/usr/libexec/sshd-session',program:{kind:'binary'}},{executable:{realpath:'/usr/libexec/sshd-session',sha256:'6'.repeat(64),uid:0},shape:{kind:'unknown'}});return f;
}
test('系统root入站broker派生的sshd-session本体在固定353外，子命令仍逐一核验',()=>{
 const f=ready(systemSession(fixture()));assert.equal(api.evaluateOriginalExecutionDomain(f).status,'verified');
 addRole(f,{pid:701,ppid:700,pgid:690,executable:'/bin/bash',program:{kind:'unclassified'}},{executable:{realpath:'/bin/bash',sha256:'b'.repeat(64),uid:0},shape:{kind:'unknown'}});
 assert.equal(api.evaluateOriginalExecutionDomain(f).status,'blocked');
});
for(const [name,change]of [['同UID父',f=>{for(const k of ['enumerated','final_enumerated'])f.observation.census[k].find(p=>p.pid===690).uid=501;}],['非系统镜像',f=>f.observation.roles[700].executable.realpath='/tmp/sshd-session'],['只有一轮root父证据',f=>f.observation.census.final_enumerated=f.observation.census.final_enumerated.filter(p=>p.pid!==690)]])test('system broker '+name+'仍拒绝',()=>{
 const f=ready(systemSession(fixture()));change(f);assert.equal(api.evaluateOriginalExecutionDomain(f).status,'blocked');
});

test('旧wall必须使用真实kernel元数据形状，program只在census行不在kernel',()=>{
 const f=ready(existingWall(fixture())),d=f.observation.roles[600];
 d.kernel={pid:d.kernel.pid,uid:d.kernel.uid,ppid:d.kernel.ppid,pgid:d.kernel.pgid,start_identity:d.kernel.start_identity};
 assert.equal(api.evaluateOriginalExecutionDomain(f).status,'verified');
});

for(const [name,change]of [['逻辑脚本目录不同',f=>{const r=f.observation.census.observations.find(p=>p.pid===600);r.program.script.path='/Users/u/alias/phone-wall-push.sh';}],['manifest链接别名',f=>f.observation.consumer_manifest.identity.path='/Users/u/alias/deployment-manifest.json'],['依赖链接别名',f=>f.observation.roles[600].files[1].path='/Users/u/alias/wall-lib.sh']])test('旧wall '+name+'不能冒实际加载闭包',()=>{
 const f=ready(existingWall(fixture()));change(f);assert.equal(api.evaluateOriginalExecutionDomain(f).status,'blocked');
});
