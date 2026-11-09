import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const setup=`import os,json,tempfile,pathlib,hashlib,types,subprocess,shutil,signal\nSOURCE=pathlib.Path(${JSON.stringify(root)})\ndef load(root,name):\n p=root/(name+'.py');m=types.ModuleType(name);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m\ndef rejected(fn):\n try:fn()\n except (ValueError,RuntimeError,OSError,KeyError):pass\n else:raise AssertionError('expected closed failure')\ndef fixture(d):\n r=pathlib.Path(d).resolve();(r/'config').mkdir();binary=r/'adb';binary.write_text('fixture binary bytes');binary.chmod(0o700)\n p={'schema_version':2,'instance_id':'fixture-epoch','host_id':'mmv','transport':'tcp','endpoint':'tcp:127.0.0.1:5042','port':5042,'forbidden_ports':[],'adb_bin':str(binary),'adb_realpath':str(binary),'adb_sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}\n policy=r/'policy.json';policy.write_text(json.dumps({k:v for k,v in p.items() if k!='port'}));policy.chmod(0o600)\n node=r/'node';node.write_text('fixture verifier');node.chmod(0o700);(r/'device-epoch-fence-review.mjs').write_text('// fixed Node fixture')\n registry={'schema_version':1,'startup_verifier':{'module':'device-epoch-fence-review.mjs','node':{'path':str(node),'sha256':hashlib.sha256(node.read_bytes()).hexdigest()}},'instances':[{'instance_id':p['instance_id'],'kind':'managed','policy_path':str(policy),'policy':{k:v for k,v in p.items() if k!='port'},'coexists_with':[]}]}\n for f in ['adb-host-service.py','adb-host-instance-policy.py','adb-existing-route.py','adb-managed-client.py','adb-private-auth.py']:\n  if (SOURCE/f).exists():shutil.copyfile(SOURCE/f,r/f)\n (r/'config/adb-host-instances.json').write_text(json.dumps(registry));files=[{'path':'services/phone-adb-controller/'+str(f.relative_to(r)),'deployed_path':str(f.relative_to(r)),'content_sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in r.rglob('*') if f.is_file()]\n (r/'deployment-manifest.json').write_text(json.dumps({'source_repo':'perfectuser21/zenithjoy-workspace','source_commit':'a'*40,'target':'mmv','files':files}))\n authroot=r/'adb-auth'/p['instance_id'];authroot.mkdir(parents=True,mode=0o700);authroot.parent.chmod(0o700)\n def put(name,data):\n  path=authroot/name;raw=data if isinstance(data,bytes) else json.dumps(data).encode();path.write_bytes(raw);path.chmod(0o600);return {'path':str(path),'sha256':hashlib.sha256(raw).hexdigest()}\n key=put('new-key.pem',b'FIXTURE-NOT-A-REAL-KEY');attach=put('attach.json',{'fixture':True});keypair=put('keypair.json',{'fixture':True})\n ref={'protocol':'device-epoch-fence-auth-ref/v1','instance_id':p['instance_id'],'resource':{'serial':'fixture-serial','cloud_instance_id':'fixture-cloud','region_id':'fixture-region'},'key':{**key,'key_pair_id':'fixture-keypair','public_key_sha256':'b'*64},'credential':{'provider':'1password','item_id':'fixture-item','version':1,'compromised':False,'valid_from':0,'expires_at':0},'provenance':{'attach':attach,'keypair':keypair}}\n refmeta=put('auth-ref.json',ref);receipt=r/'startup.json';body={'protocol':'device-epoch-fence-resume-startup/v1','resume_plan_sha256':'c'*64,'prior_pending_sha256':'d'*64,'auth_ref_sha256':refmeta['sha256'],'auth_ref_path':refmeta['path']};receipt.write_text(json.dumps(body));receipt.chmod(0o600)\n answer={'protocol':'device-epoch-fence-startup-verification/v2','authorized':True,'action':'start_private_server','instance_id':p['instance_id'],'endpoint':p['endpoint'],'source_commit':'a'*40,'registry_sha256':hashlib.sha256((r/'config/adb-host-instances.json').read_bytes()).hexdigest(),'policy_sha256':hashlib.sha256(policy.read_bytes()).hexdigest(),'resume_plan_sha256':body['resume_plan_sha256'],'prior_pending_sha256':body['prior_pending_sha256'],'auth_ref_sha256':refmeta['sha256'],'auth':{'ref_path':refmeta['path'],'ref_sha256':refmeta['sha256'],'key_path':key['path'],'key_sha256':key['sha256'],'public_key_sha256':'b'*64}}\n return r,p,policy,receipt,answer,ref\n`;
function py(code){const r=spawnSync('python3',['-I','-c',setup+code],{encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr||r.stdout);}
test('v2只接受固定Node精确答复并重核受保护新authref/key原件，0期限保留unset',()=>py(`with tempfile.TemporaryDirectory() as d:
 r,p,path,receipt,answer,ref=fixture(d);s=load(r,'adb-host-service');i=s.route.instance_module();os.environ['BRAIN_INTERNAL_TOKEN']='FIXTURE_NODE_ONLY'
 def run(args,**kw):
  assert kw['env']['BRAIN_INTERNAL_TOKEN']=='FIXTURE_NODE_ONLY';assert 'ADB_VENDOR_KEYS' not in kw['env'];return subprocess.CompletedProcess(args,0,json.dumps(answer),'')
 assert i.authorize_start(p,str(path),str(receipt),run)==answer
 env=i.authenticated_environment(p,str(path),answer,{'HOME':str(r),'BRAIN_INTERNAL_TOKEN':'never','ADB_VENDOR_KEYS':'old','DATABASE_URL':'never'})
 assert env=={'HOME':str(r),'ADB_VENDOR_KEYS':ref['key']['path']}
 pathlib.Path(ref['key']['path']).write_text('changed');rejected(lambda:i.authenticated_environment(p,str(path),answer,{}))
`));
test('ref来源/权限/共享Android路径/compromised/缺原件漂移默认拒绝',()=>py(`with tempfile.TemporaryDirectory() as d:
 r,p,path,receipt,answer,ref=fixture(d);a=load(r,'adb-private-auth');check=lambda:a.validate_auth(str(path),p['instance_id'],answer['auth'])
 assert check()['key_path']==ref['key']['path']
 key=pathlib.Path(ref['key']['path']);key.chmod(0o644);rejected(check);key.chmod(0o600)
 refpath=pathlib.Path(answer['auth']['ref_path']);old=refpath.read_bytes();ref['credential']['compromised']=True;raw=json.dumps(ref).encode();refpath.write_bytes(raw);bad={**answer['auth'],'ref_sha256':hashlib.sha256(raw).hexdigest()};rejected(lambda:a.validate_auth(str(path),p['instance_id'],bad));refpath.write_bytes(old)
 shared=r/'.android';shared.mkdir();bad={**answer['auth'],'key_path':str(shared/'adbkey')};rejected(lambda:a.validate_auth(str(path),p['instance_id'],bad))
 pathlib.Path(ref['provenance']['attach']['path']).unlink();rejected(check)
`));
test('schema2 service仅daemon拿新key，version/probe无keytoken，两次fresh授权后才spawn',()=>py(`with tempfile.TemporaryDirectory() as d:
 r,p,path,receipt,answer,ref=fixture(d);s=load(r,'adb-host-service');i=s.route.instance_module();events=[];s.validate_host=lambda *a:None;s.pwd.getpwuid=lambda *a:types.SimpleNamespace(pw_dir=str(r));os.environ['HOME']=str(r);os.environ['BRAIN_INTERNAL_TOKEN']='private';os.environ['ADB_VENDOR_KEYS']='old'
 def authorize(*a):events.append('authorize');return answer
 i.authorize_start=authorize;s.load_policy=lambda *a:p;s.route.instance_module=lambda:i;s.ensure_absent=lambda *a:events.append('absent')
 def version(policy,env):events.append('version');assert 'ADB_VENDOR_KEYS' not in env and 'BRAIN_INTERNAL_TOKEN' not in env
 s.check_client=version
 class Child:
  pid=12345
  def poll(self):return 0
  def wait(self,timeout=None):return 0
 def popen(args,**kw):
  events.append('daemon');assert kw['env']['ADB_VENDOR_KEYS']==ref['key']['path'];assert 'BRAIN_INTERNAL_TOKEN' not in kw['env'];return Child()
 s.subprocess.Popen=popen;s.run_service(p,str(path),str(receipt));assert events==['authorize','absent','version','absent','authorize','daemon','absent']
`));
