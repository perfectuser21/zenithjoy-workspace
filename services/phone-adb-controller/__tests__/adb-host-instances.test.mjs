import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const setup=`import os,json,tempfile,pathlib,hashlib,importlib.util,shutil,socket,stat\nSOURCE=pathlib.Path(${JSON.stringify(root)})\ndef load(root,name):\n spec=importlib.util.spec_from_file_location(name.replace('-','_'),root/(name+'.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod\ndef rejected(fn,code):\n try: fn()\n except (ValueError,RuntimeError,OSError) as e: assert code in str(e),str(e)\n else: raise AssertionError('expected '+code)\ndef fixture(d):\n r=pathlib.Path(d).resolve();(r/'config').mkdir();binary=r/'adb';binary.write_text('fixture fixed adb bytes');binary.chmod(0o700)\n sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()\n p={'schema_version':2,'instance_id':'fixture-epoch','host_id':'mmv','transport':'tcp','endpoint':'tcp:127.0.0.1:'+str(port),'forbidden_ports':[],'adb_bin':str(binary),'adb_realpath':str(binary),'adb_sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}\n policy=r/'policy.json';policy.write_text(json.dumps(p));policy.chmod(0o600)\n node=r/'node';node.write_text('fixed verifier bytes');node.chmod(0o700);(r/'device-epoch-fence-review.mjs').write_text('// fixed verifier fixture')\n registry={'schema_version':1,'startup_verifier':{'module':'device-epoch-fence-review.mjs','node':{'path':str(node),'sha256':hashlib.sha256(node.read_bytes()).hexdigest()}},'instances':[{'instance_id':p['instance_id'],'kind':'managed','policy_path':str(policy),'policy':p,'coexists_with':['legacy-external']},{'instance_id':'legacy-external','kind':'external_existing','policy_path':'/fixed/legacy.json','policy':{**{k:v for k,v in p.items() if k!='instance_id'},'schema_version':1,'endpoint':'tcp:127.0.0.1:5041'},'coexists_with':['fixture-epoch']}]}\n for f in ['adb-host-service.py','adb-existing-route.py','adb-host-instance-policy.py','adb-managed-client.py']:\n  if (SOURCE/f).exists():shutil.copyfile(SOURCE/f,r/f)\n (r/'config/adb-host-instances.json').write_text(json.dumps(registry))\n files=[{'path':'services/phone-adb-controller/'+str(f.relative_to(r)),'deployed_path':str(f.relative_to(r)),'content_sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in r.rglob('*') if f.is_file() and f!=policy and f!=binary]\n (r/'deployment-manifest.json').write_text(json.dumps({'source_repo':'perfectuser21/zenithjoy-workspace','source_commit':'a'*40,'target':'mmv','files':files}))\n return r,p,policy\n`;
function py(body){const r=spawnSync('python3',['-c',setup+body],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr||r.stdout);}
test('schema2显式instance仅接纳受审registry固定路径/字节，缺registry或漂移不回退schema1',()=>py(`with tempfile.TemporaryDirectory() as d:\n r,p,path=fixture(d);s=load(r,'adb-host-service');v=s.load_policy(str(path));assert v['instance_id']=='fixture-epoch' and v['port']==int(p['endpoint'].split(':')[-1])\n changed={**p,'instance_id':'other'};path.write_text(json.dumps(changed));rejected(lambda:s.load_policy(str(path)),'INSTANCE')\n path.write_text(json.dumps(p));(r/'config/adb-host-instances.json').write_text('{}');rejected(lambda:s.load_policy(str(path)),'INSTANCE')\n`));
test('schema2服务持global共享+instance独占+port独占，换id或端口不能绕锁，schema1全局独占仍拒新模式',()=>py(`with tempfile.TemporaryDirectory() as d:\n r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));base=r/'locks';base.mkdir(mode=0o700)\n with s.instance_service_locks(base,p):\n  rejected(lambda:s.instance_service_locks(base,p).__enter__(),'LOCKED')\n  rejected(lambda:s.instance_service_locks(base,{**p,'instance_id':'different'}).__enter__(),'LOCKED')\n  rejected(lambda:s.instance_service_locks(base,{**p,'port':p['port']+1}).__enter__(),'LOCKED')\n  rejected(lambda:s.service_lock(str(base/'adb-host.lock')).__enter__(),'LOCKED')\n with s.service_lock(str(base/'adb-host.lock')):rejected(lambda:s.instance_service_locks(base,p).__enter__(),'LOCKED')\n assert (base/('adb-host.instance-'+p['instance_id']+'.lock')).exists()\n assert (base/('adb-host.port-'+str(p['port'])+'.lock')).exists()\n`));
test('schema2只probe自身endpoint、不扫描旧port；固定binary loopback server命令不含connect或-a',()=>py(`with tempfile.TemporaryDirectory() as d:\n r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));s.validate_host(p,'r10-7',501)\n calls=[];s.ensure_absent(p,lambda port,*a:calls.append(port) or None);assert calls==[p['port']]\n assert s.foreground_command(p)==[p['adb_realpath'],'-L','tcp:'+str(p['port']),'server','nodaemon']\n rejected(lambda:s.validate_host({**p,'endpoint':'tcp:0.0.0.0:'+str(p['port'])},'r10-7',501),'INSTANCE')\n (r/'adb').write_text('tampered');rejected(lambda:s.foreground_command(p),'INSTANCE')\n`));

test('startup只消费固定Node只读验证单JSON；缺receipt、假授权、污染源码/Node均拒绝',()=>py(`with tempfile.TemporaryDirectory() as d:
 r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));i=s.route.instance_module();os.environ['BRAIN_INTERNAL_TOKEN']='FIXTURE_PRIVATE_TOKEN';receipt=r/'startup.json';receipt.write_text('{}');receipt.chmod(0o600)
 rejected(lambda:i.authorize_start(p,str(path),None),'RECEIPT_REQUIRED')
 expected={'protocol':'device-epoch-fence-startup-verification/v1','authorized':True,'action':'start_private_server','instance_id':p['instance_id'],'endpoint':p['endpoint'],'source_commit':'a'*40,'registry_sha256':hashlib.sha256((r/'config/adb-host-instances.json').read_bytes()).hexdigest(),'policy_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 import subprocess
 calls=[]
 def run(args,**kw):
  calls.append(args);assert args[2]=='verify-startup' and args[4]==str(receipt) and kw['timeout']==15;return subprocess.CompletedProcess(args,0,json.dumps(expected),'')
 assert i.authorize_start(p,str(path),str(receipt),run)==expected and len(calls)==1
 rejected(lambda:i.authorize_start(p,str(path),str(receipt),lambda *a,**k:subprocess.CompletedProcess(a,0,json.dumps({**expected,'authorized':False}),'')),'STARTUP_AUTHORITY')
 (r/'node').write_text('changed verifier');rejected(lambda:i.authorize_start(p,str(path),str(receipt),run),'VERIFIER_BINARY')
`));
test('version检查后必须再fresh授权，lease变化时不得启动任何daemon且留原锁文件',()=>py(`from types import SimpleNamespace
with tempfile.TemporaryDirectory() as d:
 r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));events=[]
 s.validate_host=lambda *a:None;s.pwd.getpwuid=lambda *a:SimpleNamespace(pw_dir=str(r));os.environ['HOME']=str(r)
 s.load_policy=lambda *a:p
 def auth(*a):
  events.append('fresh')
  if events.count('fresh')==2:raise ValueError('ADB_INSTANCE_STARTUP_AUTHORITY')
 s.route.instance_module=lambda:SimpleNamespace(authorize_start=auth)
 s.ensure_absent=lambda *a:events.append('absent');s.check_client=lambda *a:events.append('version')
 s.subprocess.Popen=lambda *a,**k:(_ for _ in ()).throw(AssertionError('DAEMON_MUST_NOT_START'))
 rejected(lambda:s.run_service(p,str(path),str(r/'receipt')),'STARTUP_AUTHORITY')
 assert events==['fresh','absent','version','absent','fresh']
 assert (r/'.config/zenithjoy'/('adb-host.port-'+str(p['port'])+'.lock')).exists()
`));
test('普通managedclient的connect/disconnect禁令在schema2保持',()=>py(`with tempfile.TemporaryDirectory() as d:
 r,p,path=fixture(d);m=load(r,'adb-managed-client')
 for command in ['connect','disconnect','start-server','kill-server','reconnect','tcpip','usb']:
  rejected(lambda:m.parse_args([command],int(p['endpoint'].split(':')[-1])),'LIFECYCLE_REFUSED')
`));

test('schema2 managedclient初读及version重核都仅当前instance，target消失不扫旧port',()=>py(`from types import SimpleNamespace
with tempfile.TemporaryDirectory() as d:
 r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));m=load(r,'adb-managed-client');seen=[];sent=[]
 def inspect(q):seen.append(q['port']);return {'devices':[{'serial':'fixture-serial','state':'device'}]}
 def scan(*a):raise AssertionError('NO_PORT_SCAN_OR_DEFAULT_FALLBACK')
 m.route_module=lambda:SimpleNamespace(read_host_policy=lambda *a:p,instance_module=s.route.instance_module,inspect_managed_host=inspect,select_existing_unique_route=scan,select_route=scan)
 os.environ['WFR_COLLECTION_LEAF_SOCKET']='/fixture/socket';os.environ['WFR_COLLECTION_POLICY_FILE']=str(path)
 for key in ['ADB_SERVER_SOCKET','ANDROID_ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','DOUYIN_ADB_PORT']:os.environ.pop(key,None)
 m.client_version=lambda binary,recheck=None:recheck()
 m.parent_leaf=lambda argv:sent.append(argv) or (0,b'',b'')
 assert m.main(['-s','fixture-serial','shell','true'])==0 and seen==[p['port'],p['port']] and len(sent)==1
 m.route_module=lambda:SimpleNamespace(read_host_policy=lambda *a:p,instance_module=s.route.instance_module,inspect_managed_host=lambda *a:{'devices':[]},select_existing_unique_route=scan,select_route=scan)
 rejected(lambda:m.main(['-s','fixture-serial','shell','true']),'INSTANCE_TARGET_UNAVAILABLE');assert len(sent)==1
`));

test('污染schema2 binary在version或execve前拒绝，零binary执行',()=>py(`with tempfile.TemporaryDirectory() as d:
 r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));m=load(r,'adb-managed-client');(r/'adb').write_text('poisoned bytes')
 def forbidden(*a,**k):raise AssertionError('BINARY_MUST_NOT_EXECUTE')
 rejected(lambda:s.check_client(p,{},forbidden),'INSTANCE_BINARY')
 os.environ['ZJ_ADB_HOST_CONFIG']=str(path)
 for key in ['WFR_COLLECTION_LEAF_SOCKET','ADB_SERVER_SOCKET','ANDROID_ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','DOUYIN_ADB_PORT']:os.environ.pop(key,None)
 m.client_version=forbidden;m.os.execve=forbidden
 rejected(lambda:m.main(['-s','fixture-serial','shell','true']),'INSTANCE_BINARY')
`));

test('显式Brain token仅送固定Node verifier；schema2 version与daemon不继承任何业务凭据',()=>py(`from types import SimpleNamespace\nimport subprocess\nwith tempfile.TemporaryDirectory() as d:\n r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));i=s.route.instance_module();receipt=r/'receipt';receipt.write_text('{}');receipt.chmod(0o600)\n secret_keys=['BRAIN_INTERNAL_TOKEN','CECELIA_INTERNAL_TOKEN','DATABASE_URL','DB_URL','OPENAI_API_KEY','OPENROUTER_API_KEY','ANTHROPIC_API_KEY']\n for key in secret_keys:os.environ[key]='FIXTURE_PRIVATE_'+key\n expected={'protocol':'device-epoch-fence-startup-verification/v1','authorized':True,'action':'start_private_server','instance_id':p['instance_id'],'endpoint':p['endpoint'],'source_commit':'a'*40,'registry_sha256':hashlib.sha256((r/'config/adb-host-instances.json').read_bytes()).hexdigest(),'policy_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}\n node_calls=[]\n def verifier(args,**kw):\n  node_calls.append(kw['env']);assert kw['env'].get('BRAIN_INTERNAL_TOKEN')=='FIXTURE_PRIVATE_BRAIN_INTERNAL_TOKEN';assert not any(k in kw['env'] for k in secret_keys if k!='BRAIN_INTERNAL_TOKEN');return subprocess.CompletedProcess(args,0,json.dumps(expected),'')\n assert i.authorize_start(p,str(path),str(receipt),verifier)==expected\n os.environ.pop('BRAIN_INTERNAL_TOKEN');rejected(lambda:i.authorize_start(p,str(path),str(receipt),verifier),'CREDENTIAL_REQUIRED');assert len(node_calls)==1\n os.environ['BRAIN_INTERNAL_TOKEN']='FIXTURE_PRIVATE_BRAIN_INTERNAL_TOKEN';os.environ['HOME']=str(r)\n s.validate_host=lambda *a:None;s.pwd.getpwuid=lambda *a:SimpleNamespace(pw_dir=str(r));s.load_policy=lambda *a:p;s.ensure_absent=lambda *a:None\n s.route.instance_module=lambda:SimpleNamespace(authorize_start=lambda *a:expected,verify_binary=lambda *a:None)\n calls=[]\n def version(policy,env):calls.append('version');assert not any(k in env for k in secret_keys)\n s.check_client=version\n class Child:\n  pid=987\n  def poll(self):return 0\n  def wait(self,timeout=None):return 0\n def popen(args,**kw):calls.append('daemon');assert not any(k in kw['env'] for k in secret_keys);return Child()\n s.subprocess.Popen=popen;s.run_service(p,str(path),str(receipt));assert calls==['version','daemon']\n`));

test('schema2每个真实phone dispatch前消费唯一epoch准入；失败不得parent_leaf或exec',()=>py(`from types import SimpleNamespace\nwith tempfile.TemporaryDirectory() as d:\n r,p,path=fixture(d);s=load(r,'adb-host-service');p=s.load_policy(str(path));m=load(r,'adb-managed-client');events=[]\n def admission(policy,serial,run_dir):\n  events.append('fence');assert serial=='fixture-serial' and run_dir==str(r)\n guard=SimpleNamespace(verify_binary=lambda *a:None,authorize_epoch=admission)\n m.route_module=lambda:SimpleNamespace(read_host_policy=lambda *a:p,instance_module=lambda:guard,inspect_managed_host=lambda *a:{'devices':[{'serial':'fixture-serial','state':'device'}]})\n os.environ['WFR_COLLECTION_LEAF_SOCKET']='/fixture/socket';os.environ['WFR_COLLECTION_POLICY_FILE']=str(path);os.environ['WFR_RUN_DIR']=str(r)\n for k in ['ADB_SERVER_SOCKET','ANDROID_ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','DOUYIN_ADB_PORT']:os.environ.pop(k,None)\n m.client_version=lambda *a,**k:None;m.parent_leaf=lambda *a:events.append('dispatch') or (0,b'',b'')\n assert m.main(['-s','fixture-serial','shell','true'])==0;assert events==['fence','dispatch']\n def revoked(*a):raise ValueError('ADB_INSTANCE_EPOCH_AUTHORITY')\n guard.authorize_epoch=revoked;rejected(lambda:m.main(['-s','fixture-serial','shell','true']),'EPOCH_AUTHORITY');assert events==['fence','dispatch']\n`));
