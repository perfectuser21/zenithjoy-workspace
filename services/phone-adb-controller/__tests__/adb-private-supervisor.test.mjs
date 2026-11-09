import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const setup=`import os,sys,json,pathlib,subprocess,types,tempfile,signal,hashlib,shutil,socket,time,fcntl\nROOT=pathlib.Path(${JSON.stringify(root)})\np=ROOT/'adb-private-supervisor.py';m=types.ModuleType('private_supervisor');m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__)\ndef rejected(fn):\n try:fn()\n except (ValueError,RuntimeError,OSError):pass\n else:raise AssertionError('expected closed failure')\n`;
function py(body){const r=spawnSync('python3',['-I','-c',setup+body],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr||r.stdout);}
test('真实held进程核UID微秒出生/真实exe和argv，PID复用身份不能冒充终态',()=>py(`child=subprocess.Popen(['/bin/sleep','30'])
try:
 row=m.process_identity(child.pid);assert row['pid']==child.pid and row['uid']==os.geteuid() and row['ppid']==os.getpid();assert len(row['kernel_start'])==2 and all(type(v) is int for v in row['kernel_start']);assert len(row['executable_sha256'])==64 and len(row['argv_sha256'])==64
 rejected(lambda:m.process_identity(child.pid,{**row,'kernel_start':[row['kernel_start'][0],row['kernel_start'][1]+1]}));assert m.identity_terminal(row) is False
 child.terminate();child.wait(timeout=2);assert m.identity_terminal(row) is True
finally:
 if child.poll() is None:child.kill();child.wait()
`));
const fixture=`
def fixture(d):
 r=pathlib.Path(d).resolve();(r/'config').mkdir();home=r/'home';home.mkdir();base=home/'.config/zenithjoy';base.mkdir(parents=True,mode=0o700)
 client=r/'adb';code='#include <sys/socket.h>\\n#include <netinet/in.h>\\n#include <stdlib.h>\\n#include <unistd.h>\\nint main(int c,char**v){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(0x7f000001);a.sin_port=htons(atoi(v[2]+4));if(bind(s,(void*)&a,sizeof(a))||listen(s,2))return 2;for(;;)pause();}\\n'
 subprocess.run(['cc','-x','c','-o',str(client),'-'],input=code,text=True,capture_output=True,check=True)
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 policy={'schema_version':2,'instance_id':'mmv-cloud-epoch2','host_id':'mmv','transport':'tcp','endpoint':'tcp:127.0.0.1:'+str(port),'forbidden_ports':[],'adb_bin':str(client),'adb_realpath':str(client),'adb_sha256':hashlib.sha256(client.read_bytes()).hexdigest()};path=r/'policy.json';path.write_text(json.dumps(policy));path.chmod(0o600);receipt=r/'startup.json';receipt.write_text('{}');receipt.chmod(0o600)
 registry={'schema_version':1,'startup_verifier':{'module':'device-epoch-fence-review.mjs','node':{'path':'/fixed/node','sha256':'b'*64}},'instances':[{'instance_id':policy['instance_id'],'kind':'managed','policy_path':str(path),'policy':policy,'coexists_with':[]}]};(r/'config/adb-host-instances.json').write_text(json.dumps(registry))
 for name in ['adb-host-instance-policy.py','adb-existing-route.py','adb-managed-client.py','adb-process-observation.py','adb-private-supervisor.py']:shutil.copyfile(ROOT/name,r/name)
 service=r/'adb-host-service.py';service.write_text("import os,sys,json,subprocess,signal,fcntl,pathlib\\np=json.load(open(sys.argv[3]));base=pathlib.Path(os.environ['HOME'])/'.config/zenithjoy';port=int(p['endpoint'].rsplit(':',1)[1]);fds=[]\\nfor n in ['adb-host.instance-'+p['instance_id']+'.lock','adb-host.port-'+str(port)+'.lock']:\\n f=os.open(base/n,os.O_RDWR|os.O_CREAT,0o600);fcntl.flock(f,fcntl.LOCK_EX);fds.append(f)\\nc=subprocess.Popen([p['adb_realpath'],'-L','tcp:'+str(port),'server','nodaemon']);os.write(fds[0],json.dumps({'supervisor_pid':os.getpid(),'child_pid':c.pid}).encode());os.fsync(fds[0])\\ndef stop(*a):\\n c.terminate()\\nsignal.signal(signal.SIGTERM,stop);c.wait()\\n")
 files=[{'path':'services/phone-adb-controller/'+str(f.relative_to(r)),'deployed_path':str(f.relative_to(r)),'content_sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in r.rglob('*') if f.is_file()];(r/'deployment-manifest.json').write_text(json.dumps({'source_repo':'perfectuser21/zenithjoy-workspace','source_commit':'f'*40,'target':'mmv','files':files}))
 g=types.ModuleType('fixture_supervisor');g.__file__=str(r/'adb-private-supervisor.py');exec(compile((r/'adb-private-supervisor.py').read_bytes(),g.__file__,'exec'),g.__dict__);g.pwd.getpwuid=lambda uid:types.SimpleNamespace(pw_dir=str(home))
 document={'action':'inspect','instance_id':policy['instance_id'],'endpoint':policy['endpoint'],'source_commit':'f'*40,'policy_path':str(path),'policy_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'supervisor_source':{'runtime_root':str(r),'source_commit':'f'*40,'service_sha256':hashlib.sha256(service.read_bytes()).hexdigest()}}
 return r,home,path,receipt,service,g,document
`;
test('真实本人supervisor→held child→loopback listener：独验双源/锁/父链，controller单TERM后terminal零追加signal',()=>py(fixture+`with tempfile.TemporaryDirectory() as d:
 r,home,path,receipt,service,g,document=fixture(d);owned=subprocess.Popen([str(pathlib.Path(sys.executable).resolve()),str(service),'run','--config',str(path),'--maintenance-receipt',str(receipt)],env={**os.environ,'HOME':str(home)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  actual=None;end=time.monotonic()+8
  while time.monotonic()<end:
   try:actual=g.run(document);break
   except (ValueError,OSError,json.JSONDecodeError) as e:last_error=e;time.sleep(.05)
  assert actual is not None,'fixture service failed to become independently inspectable: '+str(last_error)
  expected=actual['actual'];assert expected['child']['ppid']==owned.pid;rejected(lambda:g.run({**document,'source_commit':'e'*40}));rejected(lambda:g.run({**document,'supervisor_source':{**document['supervisor_source'],'service_sha256':'0'*64}}));rejected(lambda:g.run({**document,'endpoint':'tcp:127.0.0.1:5041'}));rejected(lambda:g.run({**document,'expected':{'supervisor':{**expected['supervisor'],'uid':os.geteuid()+1},'child':expected['child']}}));rejected(lambda:g.run({**document,'action':'terminal','expected':expected}))
  # Simulates only the Code controller's branded-plan effect; helper never signals.
  os.kill(owned.pid,signal.SIGTERM);owned.wait(timeout=3);proof=g.run({**document,'action':'terminal','expected':expected});assert proof['selected_identities_absent'] and proof['listener_absent'] and proof['instance_locks_released'];lockpath=home/'.config/zenithjoy/adb-host.instance-mmv-cloud-epoch2.lock';fd=os.open(lockpath,os.O_RDONLY);fcntl.flock(fd,fcntl.LOCK_EX);rejected(lambda:g.run({**document,'action':'terminal','expected':expected}));os.close(fd);intruder=socket.socket();intruder.bind(('127.0.0.1',int(document['endpoint'].rsplit(':',1)[1])));intruder.listen();rejected(lambda:g.run({**document,'action':'terminal','expected':expected}));intruder.close()
  rejected(lambda:g.run({**document,'action':'signal','expected':expected}));rejected(lambda:g.run({**document,'action':'terminal','expected':{'supervisor':{'pid':9999999},'child':{'pid':9999998,'ppid':9999999}}}))
 finally:
  if owned.poll() is None:owned.terminate();owned.wait(timeout=3)
`));
test('真实held隔离Python argv：仅已核48b语法接纳exact -I -B -S，其他前缀或新源拒绝',()=>py(fixture+`with tempfile.TemporaryDirectory() as d:
 r,home,path,receipt,service,g,document=fixture(d)
 for flags in [['-I','-B','-S'],['-B','-I','-S'],['-I','-S','-B'],['-I','-B','-S','-u'],['-I','-B'],['-I','-B','-S','-S']]:
  owned=subprocess.Popen([str(pathlib.Path(sys.executable).resolve()),*flags,str(service),'run','--config',str(path),'--maintenance-receipt',str(receipt)],env={**os.environ,'HOME':str(home)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  try:
   # Observe the real interpreter argv, not a fixture's self-reported receipt.
   row=g.process_identity(owned.pid);assert row is not None;argv=g.shlex.split(row['_argv']);assert argv[1:1+len(flags)]==flags;original_hash=row['argv_sha256']
   # The grammar runs only after inspect's source context. The fixture does not
   # impersonate the deployed 48b image: the unchanged outer hardpin rejects it.
   rejected(lambda:g.context({**document,'supervisor_source':{**document['supervisor_source'],'source_commit':g.OLD_SOURCE}}))
   if flags==['-I','-B','-S']:
    assert g.supervisor_argv(row,service.parent,str(path),g.OLD_SOURCE)==pathlib.Path(receipt)
    rejected(lambda:g.supervisor_argv(row,service.parent,str(path),'f'*40))
    rejected(lambda:g.supervisor_argv({**row,'_argv':row['_argv']+' --resume-reserved-start'},service.parent,str(path),g.OLD_SOURCE))
    rejected(lambda:g.supervisor_argv({**row,'_argv':row['_argv'].replace(' -I ',' -Z ',1)},service.parent,str(path),g.OLD_SOURCE))
   else:rejected(lambda:g.supervisor_argv(row,service.parent,str(path),g.OLD_SOURCE))
   assert row['argv_sha256']==original_hash and hashlib.sha256(row['_argv'].encode()).hexdigest()==original_hash
  finally:
   if owned.poll() is None:owned.terminate()
   owned.wait(timeout=3)
`));

test('新source仅可终态核已审d7c私有service，旧manifest/servicehash不可自报',()=>py(fixture+`with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as old:
 r,home,path,receipt,service,g,document=fixture(d)
 service.write_bytes((ROOT/'adb-host-service.py').read_bytes());manifest=json.loads((r/'deployment-manifest.json').read_text())
 for row in manifest['files']:
  if row['deployed_path']=='adb-host-service.py':row['content_sha256']=hashlib.sha256(service.read_bytes()).hexdigest()
 (r/'deployment-manifest.json').write_text(json.dumps(manifest));oldroot=pathlib.Path(old).resolve();shutil.copytree(r,oldroot,dirs_exist_ok=True)
 prior=json.loads((oldroot/'deployment-manifest.json').read_text());prior['source_commit']='d7c9e6b25bd6434699653f381abbcf3e44c83a66';(oldroot/'deployment-manifest.json').write_text(json.dumps(prior))
 historical={**document,'action':'terminal','supervisor_source':{'runtime_root':str(oldroot),'source_commit':prior['source_commit'],'service_sha256':hashlib.sha256(service.read_bytes()).hexdigest()}}
 assert g.context(historical)[3]==oldroot
 for action in ['inspect','kernel']:rejected(lambda:g.context({**historical,'action':action}))
 rejected(lambda:g.context({**historical,'supervisor_source':{**historical['supervisor_source'],'service_sha256':'0'*64}}))
 prior['source_commit']='a'*40;(oldroot/'deployment-manifest.json').write_text(json.dumps(prior));rejected(lambda:g.context({**historical,'supervisor_source':{**historical['supervisor_source'],'source_commit':'a'*40}}))
`));
