import importlib.util,json,hashlib,tempfile,unittest
from pathlib import Path
from unittest.mock import patch

def module(name):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).resolve().parent.parent/(name+'.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
p=module('deployment-installed');c=p
class Tests(unittest.TestCase):
 def test_installed_package_identity_and_actual_paths(self):
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();package=home/'.local/share/zenithjoy/publish-releases'/('a'*40);root=package/'.agents/skills/multi-platform-publish';root.mkdir(parents=True)
   for name in p.ATTACHMENTS+p.CONTROLLERS:
    file=package/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'installed')
   managed=home/'.openclaw/skills/multi-platform-publish';managed.parent.mkdir(parents=True);managed.symlink_to(root)
   codex=home/'.codex-team1/skills/multi-platform-publish';codex.parent.mkdir(parents=True);codex.symlink_to(root)
   runtime=package/'.skills-runtime/android-publish/SKILL.md';runtime.parent.mkdir(parents=True);runtime.write_bytes(b'installed')
   closure=dict(schema_version=1,source_repo='perfectuser21/zenithjoy-workspace',source_commit='a'*40,files=[dict(path=x,sha256=hashlib.sha256(b'installed').hexdigest()) for x in p.ATTACHMENTS+p.CONTROLLERS+('.skills-runtime/android-publish/SKILL.md',)])
   (package/'publish-source-manifest.json').write_text(json.dumps(closure))
   info=dict(source='openclaw-managed',eligible=True,modelVisible=True,baseDir=str(root),filePath=str(root/'SKILL.md'))
   digest=hashlib.sha256(b'installed').hexdigest();entries=[dict(path=x,content_sha256=digest) for x in p.ATTACHMENTS+p.CONTROLLERS]
   remote=dict(manifest={'source_commit':'b'*40},execution_copies=[dict(repo_path=x,path=d+'/'+Path(x).name,sha256=digest) for x in p.CONTROLLERS for d in ('bin-harvest','.local/bin')])
   def call(args,**kw):return json.dumps(info if args[0]=='openclaw' else closure if args[0]=='node' else remote).encode()
   with patch.object(p.subprocess,'check_output',side_effect=call):
    result=p.collect_publish(home,entries,c.read_regular);self.assertEqual(result['installed_package_revision'],'a'*40);self.assertEqual(len(result['files']),8)
    self.assertEqual(result['locations'][p.CONTROLLERS[0]]['installed_revision'],'b'*40)
    self.assertGreater(result['source_closure']['file_count'],len(p.ATTACHMENTS));self.assertNotIn('files',result['source_closure'])
    runtime.write_bytes(b'changed dependency')
    with self.assertRaisesRegex(ValueError,'依赖闭包'):p.collect_publish(home,entries,c.read_regular)
    runtime.write_bytes(b'installed')
    remote['execution_copies'][0]['sha256']='c'*64
    with self.assertRaisesRegex(ValueError,'执行字节'):p.collect_publish(home,entries,c.read_regular)
    remote['execution_copies'][0]['sha256']=digest
    file=package/p.ATTACHMENTS[-1];file.unlink();file.symlink_to(root/'SKILL.md')
    with self.assertRaisesRegex(ValueError,'软链接'):p.collect_publish(home,entries,c.read_regular)
    file.unlink();file.write_bytes(b'installed');info['baseDir']=str(home/'checkout/.agents/skills/multi-platform-publish')
    with self.assertRaisesRegex(ValueError,'安装根'):p.collect_publish(home,entries,c.read_regular)


class AggregateTests(unittest.TestCase):
 def test_real_local_files_remote_readback_and_official_skill_identity(self):
  import subprocess,os,shlex,sys
  original=subprocess.check_output
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();remote=home/'phone';remote.mkdir();package=home/'.local/share/zenithjoy/publish-releases'/('b'*40)
   runtime=home/'.openclaw/commander';workspace=home/'openclaw-root/workspaces-root/clawd-work-commander'
   data=b'fixed production source';h=hashlib.sha256(data).hexdigest()
   def put(root,name):
    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
   for name in p.ATTACHMENTS+p.CONTROLLERS:put(package,name)
   managed=home/'.openclaw/skills/multi-platform-publish';managed.parent.mkdir(parents=True);managed.symlink_to(package/'.agents/skills/multi-platform-publish')
   codex=home/'.codex-team1/skills/multi-platform-publish';codex.parent.mkdir(parents=True);codex.symlink_to(package/'.agents/skills/multi-platform-publish')
   for name in p.CONTROLLERS:put(package,name)
   put(package,'.skills-runtime/android-publish/SKILL.md')
   closure=dict(schema_version=1,source_repo='perfectuser21/zenithjoy-workspace',source_commit='b'*40,files=[dict(path=n,sha256=h) for n in p.ATTACHMENTS+p.CONTROLLERS+('.skills-runtime/android-publish/SKILL.md',)])
   (package/'publish-source-manifest.json').write_text(json.dumps(closure))
   controller_entries=[dict(path=n,deployed_path=Path(n).name,content_sha256=h) for n in p.CONTROLLERS]
   for n in p.CONTROLLERS:
    for folder in ('bin-harvest','.local/bin'):put(remote/folder,Path(n).name)
    for folder in ('bin-harvest','.openclaw/leadgen-scripts'):put(home/folder,Path(n).name)
   sql_path='apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql'
   sql_dest='release-evidence/'+Path(sql_path).name
   sql_data=(Path(__file__).resolve().parents[3]/sql_path).read_bytes();sql_sha=hashlib.sha256(sql_data).hexdigest()
   controller_entries.append(dict(path=sql_path,deployed_path=sql_dest,content_sha256=sql_sha))
   sql_copies=[remote/'bin-harvest'/sql_dest,home/'bin-harvest'/sql_dest,home/'.openclaw/leadgen-scripts'/sql_dest]
   for file in sql_copies:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(sql_data)
   ack=dict(source_repo='repo',source_commit='b'*40,release_id='xian-release',observation_id='xian-observation',environment='production',target='xian-m4',files=controller_entries)
   (remote/'bin-harvest/deployment-manifest.json').write_text(json.dumps(ack))
   files={'AGENTS.md':h,'skills/workflow-commander/SKILL.md':h}
   for name in files:put(runtime,name);put(workspace,name)
   releases={'release':{'workflows':{'one':{'snapshot_sha256':h}}}}
   (runtime/'runtime-manifest.json').write_text(json.dumps(dict(protocol='commander-v2',files=files,releases=releases,runtime_snapshot_sha256=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest())))
   paths=list(p.ATTACHMENTS+p.CONTROLLERS)+['services/phone-adb-controller/commander/'+name for name in files]
   spec=dict(manifest=dict(source_repo='repo',source_commit='b'*40,files=[dict(path=n,deployed_path='component:'+n,content_sha256=h) for n in paths]),local_manifest=dict(files=controller_entries),commander_files=files,commander_releases=releases,xian_ack=ack)
   paths.append(sql_path);spec['manifest']['files'].append(dict(path=sql_path,deployed_path=sql_dest,content_sha256=sql_sha))
   work_info=dict(source='openclaw-workspace',eligible=True,modelVisible=True,filePath=str(workspace/'skills/workflow-commander/SKILL.md'))
   def call(args,**kwargs):
    if args[0]=='openclaw':
     if 'work-commander' in args:return json.dumps(work_info).encode()
     return json.dumps(dict(source='openclaw-managed',eligible=True,modelVisible=True,baseDir=str(package/'.agents/skills/multi-platform-publish'),filePath=str(package/p.ATTACHMENTS[0]))).encode()
    if args[0]=='node':return json.dumps(closure).encode()
    code=shlex.split(args[-1])[2]
    return original([sys.executable,'-c',"import socket;socket.gethostname=lambda:'mac-mini-m4-xian';"+code],env=dict(os.environ,HOME=str(remote)))
   with patch.object(p.socket,'gethostname',return_value='r10-7.macminivault.com'),patch.object(p.subprocess,'check_output',side_effect=call):
    for actual_hostname in ('aad17-2.macminivault.com','r10-7.macminivault.com'):
     with self.subTest(hostname=actual_hostname),patch.object(p.socket,'gethostname',return_value=actual_hostname):
      self.assertEqual(len(p.collect(spec,home)['files']),len(paths))
    result=p.collect(spec,home);self.assertEqual(len(result['files']),len(paths));self.assertEqual(result['publish_readback']['installed_package_revision'],'b'*40)
    for file in sql_copies:
     with self.subTest(sql_copy=str(file)):
      file.unlink()
      with self.assertRaises((ValueError,FileNotFoundError,subprocess.CalledProcessError)):p.collect(spec,home)
      file.write_bytes(b'tampered')
      with self.assertRaises((ValueError,subprocess.CalledProcessError)):p.collect(spec,home)
      file.unlink();file.symlink_to(package/p.ATTACHMENTS[0])
      with self.assertRaises((ValueError,subprocess.CalledProcessError)):p.collect(spec,home)
      file.unlink();file.write_bytes(sql_data)
      self.assertEqual(len(p.collect(spec,home)['files']),len(paths))
    work_info['source']='openclaw-managed'
    with self.assertRaisesRegex(ValueError,'官方实际skill'):p.collect(spec,home)
    work_info['source']='openclaw-workspace';spec['xian_ack']=dict(ack,observation_id='other')
    with self.assertRaisesRegex(ValueError,'ACK'):p.collect(spec,home)

class HostIdentityTests(unittest.TestCase):
 def test_similar_hostname_cannot_reach_installed_file_checks(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(p.socket,'gethostname',return_value='r10-70.macminivault.com'):
   with self.assertRaisesRegex(ValueError,'实际机器不是MMV'):p.collect({},Path(tmp))

class GuardTests(unittest.TestCase):
 def test_real_kernel_lock_conflict_and_release(self):
  import subprocess,os,time,signal,sys
  guard=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   env=dict(os.environ,HOME=tmp)
   server=subprocess.Popen([sys.executable,'-u','-c',guard.SERVER],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env=env)
   try:
    self.assertTrue(json.loads(server.stdout.readline())['locked'])
    second=subprocess.run([sys.executable,'-u','-c',guard.SERVER],input=b'',capture_output=True,env=env)
    self.assertNotEqual(second.returncode,0)
   finally:server.stdin.close();server.wait(timeout=5)
   third=subprocess.run([sys.executable,'-u','-c',guard.SERVER],input=b'',capture_output=True,env=env)
   self.assertEqual(third.returncode,0,third.stderr)
 def test_lost_lock_transport_terminates_deployment(self):
  import subprocess,sys,os
  guard=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   marker=Path(tmp)/'forbidden'
   transport=[sys.executable,'-u','-c',"import json,time;print(json.dumps({'locked':True,'target':'mmv'}),flush=True);time.sleep(.2)"]
   with self.assertRaisesRegex(ValueError,'锁通道丢失'):
    guard.guarded([sys.executable,'-c',"import time;from pathlib import Path;time.sleep(2);Path("+repr(str(marker))+").write_text('unexpected')"],transport=transport)
   self.assertFalse(marker.exists())

 def test_default_ssh_lock_has_bounded_liveness_checks(self):
  import subprocess,sys,os
  guard=module('deployment-guard');original=subprocess.Popen;commands=[]
  with tempfile.TemporaryDirectory() as tmp:
   def launch(args,**kwargs):
    if args[0]=='ssh':
     commands.append(args);return original([sys.executable,'-u','-c',guard.SERVER],env=dict(os.environ,HOME=tmp),**kwargs)
    return original(args,**kwargs)
   with patch.object(guard.subprocess,'Popen',side_effect=launch):self.assertEqual(guard.guarded([sys.executable,'-c','pass']),0)
   self.assertEqual(len(commands),1)
   for option in ('ConnectTimeout=10','ServerAliveInterval=5','ServerAliveCountMax=3'):self.assertIn(option,commands[0])

 def test_guard_termination_stops_child_before_releasing_remote_lock(self):
  import subprocess,sys,os,signal,time
  guard=module('deployment-guard')
  for signum in (signal.SIGTERM,signal.SIGHUP):
   with self.subTest(signal=signum),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp);started=home/'started';marker=home/'forbidden';driver=home/'driver.py'
    child_code="import os,time;from pathlib import Path;Path("+repr(str(started))+").write_text(str(os.getpid()));time.sleep(1.2);Path("+repr(str(marker))+").write_text('unexpected')"
    guard_path=Path(guard.__file__)
    driver.write_text("import importlib.util,sys;spec=importlib.util.spec_from_file_location('guard',"+repr(str(guard_path))+");g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);sys.exit(g.guarded([sys.executable,'-c',"+repr(child_code)+"],transport=[sys.executable,'-u','-c',g.SERVER]))")
    proc=subprocess.Popen([sys.executable,str(driver)],env=dict(os.environ,HOME=tmp),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    child_pid=None
    try:
     deadline=time.monotonic()+5
     while not started.exists() and time.monotonic()<deadline:time.sleep(.02)
     self.assertTrue(started.exists());child_pid=int(started.read_text());proc.send_signal(signum);proc.wait(timeout=7)
     time.sleep(1.4)
     self.assertFalse(marker.exists(),'guard已退出但部署子进程继续写入')
     retry=subprocess.run([sys.executable,'-u','-c',guard.SERVER],input=b'',capture_output=True,env=dict(os.environ,HOME=tmp),timeout=5)
     self.assertEqual(retry.returncode,0,retry.stderr)
    finally:
     if proc.poll() is None:proc.kill();proc.wait()
     if child_pid:
      try:os.killpg(child_pid,signal.SIGKILL)
      except ProcessLookupError:pass

class FailedAdmissionTests(unittest.TestCase):
 def fixture(self,home):
  import time
  root=home/'.openclaw/commander';root.mkdir(parents=True)
  run='wfd-11111111-1111-4111-8111-111111111111';task_id='22222222-2222-4222-8222-222222222222';directory=home/'wf-agent-runs'/run;directory.mkdir(parents=True)
  def put(path,obj):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(obj,ensure_ascii=False))
  def digest(obj):return hashlib.sha256(json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  files={'wf-v2.py':hashlib.sha256(b'original-runtime').hexdigest()};(root/'wf-v2.py').write_bytes(b'original-runtime')
  manifest=dict(protocol='commander-v2',files=files,runtime_snapshot_sha256=digest(files));put(root/'runtime-manifest.json',manifest)
  env=dict(protocol='commander-v2',task_id=task_id,run_id=run,attempt=1,owner_epoch=1,input={'text':'原输入'},input_sha256=digest({'text':'原输入'}),contract={},definition=dict(release_id='88888888-8888-4888-8888-888888888888',snapshot_sha256='a'*64,runtime_snapshot_sha256=digest(files)),deadline_at='2000-01-01T00:00:00Z',cleanup_deadline_at='2000-01-01T00:01:00Z')
  binding=dict(task_id=task_id,run_id=run,nonce='closed-nonce',parent_session_key='agent:work-commander:'+run,child_run_id='33333333-3333-4333-8333-333333333333',child_session_key='agent:skill-factory:subagent:44444444-4444-4444-8444-444444444444')
  request=dict(binding,protocol='commander-v2',expires_at=946684800)
  evidence=directory/'evidence/cleanup.png';evidence.parent.mkdir();evidence.write_bytes(b'actual-cleanup')
  roots={name:dict(realpath=str(path),st_dev=path.stat().st_dev,st_ino=path.stat().st_ino) for name,path in [('run',directory),('evidence',evidence.parent),('commander',root)]};put(directory/'root-identity.json',roots)
  refs=[dict(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in (evidence,directory/'root-identity.json')]
  cleanup=dict(completed=True,failure=None,lock_status='free',evidence=[str(evidence)],_shell=dict(run_id=run,attempt=1,activity_key='cleanup',files=refs,started_at='2000-01-01T00:00:02Z',ended_at='2000-01-01T00:00:03Z'))
  for name,obj in [('envelope.json',env),('input.json',env['input']),('contract.json',{}),('runtime.json',dict(phase='blocked',execution_stopped=False,cleanup_completed=True)),('agent-binding.json',binding),('agent-request.json',request),('spawn-claimed.json',{'nonce':binding['nonce']}),('handoff-closed.json',{'at':946684804}),('cleanup.json',cleanup)]:put(directory/name,obj)
  (directory/'.worker.lock').touch()
  identity={key:env[key] for key in ('task_id','run_id','attempt','owner_epoch','input_sha256')};identity['definition_snapshot_sha256']=env['definition']['snapshot_sha256']
  proof=dict(schema_version=1,**identity,runtime_snapshot_sha256=digest(files),runtime_files=files,verdict='FAIL',effects='unknown',retry_safe=False,verification_task_id='55555555-5555-4555-8555-555555555555',attestation_sha256='b'*64,cleanup_sha256=hashlib.sha256((directory/'cleanup.json').read_bytes()).hexdigest(),files=refs,terminal_sha256='c'*64,binding_sha256=digest(binding),original_child=dict(run_id=binding['child_run_id'],session_key=binding['child_session_key'],status='error',started_at=946684800000,ended_at=946684801000),actor='codex:operator',principal='internal-controller',reason='真实失败清理对账',observed_at='2000-01-01T00:02:00Z',request_sha256='d'*64,previous_control_sha256='e'*64)
  def seal():proof['sha256']=digest({k:v for k,v in proof.items() if k!='sha256'})
  seal()
  control=dict(envelope=env,phase='final',verdict='FAIL',effects='unknown',retry_safe=False,execution_stopped=True,failed_reconciliation=proof)
  task=dict(id=task_id,status='failed',task_type='workflow_dispatch',payload={'commander_protocol':'commander-v2'},result=dict(workflow_control=control,commander_failure_reconciliation=dict(operator_actor='codex:operator',verification_task_id=proof['verification_task_id'],**identity)))
  runrow=dict(id='66666666-6666-4666-8666-666666666666',run_id=run,task_id=task_id,status='failed',ended_at='2000-01-01T00:02:00Z',context={'commander_envelope':env},result={'failed_reconciliation':proof})
  reconciliation=dict(run_id=run,run_binding_id='77777777-7777-4777-8777-777777777777',release_id='88888888-8888-4888-8888-888888888888',task_run=runrow,links=dict(task_id=task_id,task_run_id=runrow['id']),evidence_status='incomplete',business_outcome='unknown')
  calls=[]
  def get(path):calls.append(path);return task if path=='/api/brain/tasks/'+task_id else reconciliation if path=='/api/brain/runs/'+run+'/reconciliation' else self.fail('unexpected GET '+path)
  return root,directory,task,proof,get,calls,seal
 def test_original_blocked_runtime_admitted_only_by_exact_authoritative_failure_proof_and_held_worker(self):
  import fcntl
  g=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
   with g.commander_admission(home,get):
    self.assertTrue((root/'.deploying').is_file());self.assertEqual(len(calls),2)
    for path in (root/'.admission.lock',directory/'.worker.lock'):
     with open(path,'r') as fd:
      with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    self.assertFalse(json.loads((directory/'runtime.json').read_text())['execution_stopped']);self.assertFalse((directory/'delivery.json').exists())
   with open(directory/'.worker.lock','r') as fd:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def test_fail_closed_for_each_identity_hash_active_state_and_api_error(self):
  import fcntl
  cases=['unreconciled','proof-hash','envelope','cleanup','runtime','nonce','deadline','other-active','run-not-failed','binding','authority','child-stop-readback','input','contract','api']
  for case in cases:
   with self.subTest(case=case),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
    if case=='unreconciled':task['result']['workflow_control'].pop('failed_reconciliation')
    elif case=='proof-hash':proof['effects']='none'
    elif case=='envelope':task['result']['workflow_control']['envelope']['owner_epoch']=2
    elif case=='cleanup':(directory/'cleanup.json').write_text('{}')
    elif case=='runtime':(root/'wf-v2.py').write_bytes(b'tamper')
    elif case=='nonce':(directory/'handoff-closed.json').unlink()
    elif case=='deadline':
     env=json.loads((directory/'envelope.json').read_text());env['cleanup_deadline_at']='2999-01-01T00:00:00Z';(directory/'envelope.json').write_text(json.dumps(env));task['result']['workflow_control']['envelope']=env
    elif case=='other-active':
     other=home/'wf-agent-runs/other';other.mkdir();(other/'runtime.json').write_text('{"phase":"running","execution_stopped":false}')
    elif case=='run-not-failed':
     old=get
     def get(path):
      result=old(path)
      if '/runs/' in path:result['task_run']['status']='running'
      return result
    elif case=='binding':(directory/'agent-binding.json').write_text('{}')
    elif case=='authority':task['result']['commander_failure_reconciliation']['operator_actor']='codex:other'
    elif case=='child-stop-readback':(directory/'child-stop-readback.json').write_text('{}')
    elif case in ('input','contract'):(directory/(case+'.json')).write_text('{"changed":true}')
    elif case=='api':
     def get(path):raise OSError('API unavailable')
    with self.assertRaises((ValueError,OSError,KeyError)):
     with module('deployment-guard').commander_admission(home,get):self.fail('unsafe install admitted')
    self.assertFalse((root/'.deploying').exists())
 def test_busy_original_worker_and_unrelated_active_run_never_exempted(self):
  import fcntl
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
   with open(directory/'.worker.lock','r') as fd:
    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    with self.assertRaises((BlockingIOError,ValueError)):
     with module('deployment-guard').commander_admission(home,get):self.fail('live worker admitted')
   self.assertEqual(calls,[]);self.assertFalse((root/'.deploying').exists())
 def test_original_success_delivery_lane_needs_no_failure_api(self):
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();directory=home/'wf-agent-runs/completed';directory.mkdir(parents=True)
   (directory/'runtime.json').write_text('{"phase":"awaiting_verify","execution_stopped":true}');(directory/'delivery.json').write_text('{}')
   with module('deployment-guard').commander_admission(home,lambda _:self.fail('success lane called failure API')):pass

 def test_guard_lease_protocol_holds_real_admission_through_child_and_completes_marker(self):
  import os,subprocess,sys,fcntl
  g=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();script=home/'child.py';marker=home/'.openclaw/commander/.deploying'
   script.write_text("import importlib.util,fcntl,os;from pathlib import Path;spec=importlib.util.spec_from_file_location('guard',"+repr(g.__file__)+");g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);g.request_admission();root=Path.home()/'.openclaw/commander';assert (root/'.deploying').is_file();fd=open(root/'.admission.lock','r');\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);raise AssertionError('lock released before installation')\nexcept BlockingIOError: pass\ng.request_admission('complete');assert not (root/'.deploying').exists()")
   with patch.dict(os.environ,HOME=str(home)):
    self.assertEqual(g.guarded([sys.executable,str(script)],transport=[sys.executable,'-u','-c',g.SERVER]),0)
   self.assertFalse(marker.exists())
 def test_marker_or_held_lock_replacement_ends_guard_before_installation_continues(self):
  import os,sys
  g=module('deployment-guard')
  for name in ('.deploying','.admission.lock','.deployment.lock'):
   with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp).resolve();marker=home/'forbidden';script=home/'child.py'
    script.write_text("import importlib.util,time;from pathlib import Path;spec=importlib.util.spec_from_file_location('guard',"+repr(g.__file__)+");g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);g.request_admission();p=Path.home()/'.openclaw/commander'/"+repr(name)+";p.rename(p.with_name(p.name+'.replaced'));p.touch();time.sleep(2);Path("+repr(str(marker))+").touch()")
    with patch.dict(os.environ,HOME=str(home)):
     with self.assertRaisesRegex(ValueError,'锁通道丢失'):
      g.guarded([sys.executable,str(script)],transport=[sys.executable,'-u','-c',g.SERVER])
    self.assertFalse(marker.exists())
 def test_frozen_failed_evidence_change_is_detected_while_worker_lock_is_held(self):
  g=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
   with g.commander_admission(home,get) as verify:
    (directory/'cleanup.json').write_text('{}')
    with self.assertRaisesRegex(ValueError,'evidence changed'):verify()
 def test_actual_authority_gets_use_fixed_paths_close_connection_and_no_mutation(self):
  import http.server,threading,urllib.request
  g=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
   cache=home/'.credentials/cecelia-internal.env';cache.parent.mkdir();cache.write_text('CECELIA_INTERNAL_TOKEN=fixture-secret\n');cache.chmod(0o600)
   requests=[]
   class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
     requests.append((self.command,self.path,self.headers.get('Connection'),self.headers.get('Authorization')))
     data=json.dumps(get(self.path),ensure_ascii=False).encode();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
   server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();request=urllib.request.Request
   def local_request(url,*args,**kwargs):
    self.assertTrue(url.startswith('http://localhost:5221/api/brain/'))
    return request(url.replace('http://localhost:5221','http://127.0.0.1:'+str(server.server_port)),*args,**kwargs)
   try:
    with patch.object(g.Path,'home',return_value=home),patch.object(g.urllib.request,'Request',side_effect=local_request):
     with g.commander_admission(home):pass
    self.assertEqual(len(requests),2);self.assertTrue(all(x[0]=='GET' and x[2]=='close' and x[3]=='Bearer fixture-secret' for x in requests))
   finally:server.shutdown();thread.join();server.server_close()

 def test_marker_fifo_directory_or_symlink_cannot_hang_or_admit(self):
  import os,time
  for kind in ('fifo','directory','symlink'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp).resolve();root=home/'.openclaw/commander';root.mkdir(parents=True);marker=root/'.deploying'
    if kind=='fifo':os.mkfifo(marker)
    elif kind=='directory':marker.mkdir()
    else:marker.symlink_to(home/'elsewhere')
    started=time.monotonic()
    with self.assertRaises((OSError,ValueError)):
     with module('deployment-guard').commander_admission(home,lambda _:self.fail('unexpected GET')):self.fail('bad marker admitted')
    self.assertLess(time.monotonic()-started,1)
 def test_actual_failed_run_worker_mutex_stays_held_over_full_guard_child_lifetime(self):
  import os,sys
  g=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
   values={'/api/brain/tasks/'+task['id']:task,'/api/brain/runs/'+proof['run_id']+'/reconciliation':get('/api/brain/runs/'+proof['run_id']+'/reconciliation')}
   inject='def fixture_get(path):return json.loads('+repr(json.dumps(values))+')[path]\n'
   # Only the authority response transport is replaced; the production SERVER and kernel locks execute unchanged.
   code=g.SERVER.replace('import sys,select\n','import sys,select\n'+inject).replace('commander_admission(Path.home())','commander_admission(Path.home(),fixture_get)')
   script=home/'worker-check.py';script.write_text("import importlib.util,fcntl;from pathlib import Path;spec=importlib.util.spec_from_file_location('guard',"+repr(g.__file__)+");g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);g.request_admission();fd=open("+repr(str(directory/'.worker.lock'))+",'r');\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);raise AssertionError('original worker became runnable during replacement')\nexcept BlockingIOError: pass\ng.request_admission('complete')")
   with patch.dict(os.environ,HOME=str(home)):
    self.assertEqual(g.guarded([sys.executable,str(script)],transport=[sys.executable,'-u','-c',code]),0)
   with open(directory/'.worker.lock','r') as fd:__import__('fcntl').flock(fd,__import__('fcntl').LOCK_EX|__import__('fcntl').LOCK_NB)

 def official_install(self,home,root,version):
  def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
  release='99999999-9999-4999-8999-'+str(version).zfill(12);obs_id='aaaaaaaa-aaaa-4aaa-8aaa-'+str(version).zfill(12)
  data=('official-runtime-'+str(version)).encode();(root/'wf-v2.py').write_bytes(data)
  manifest=dict(protocol='commander-v2',files={'wf-v2.py':hashlib.sha256(data).hexdigest()},releases={release:{'workflows':{'frozen':{'snapshot_sha256':'a'*64}}}});manifest['runtime_snapshot_sha256']=digest(manifest['files']);(root/'runtime-manifest.json').write_text(json.dumps(manifest))
  local=dict(release_id=release,observation_id=obs_id,target='mmv',environment='production',source_repo='perfectuser21/zenithjoy-workspace',source_commit=str(version)*40)
  file=home/'.openclaw/leadgen-scripts/deployment-manifest.json';file.parent.mkdir(parents=True,exist_ok=True);file.write_text(json.dumps(local))
  evidence=dict(source_repo=local['source_repo'],source_commit=local['source_commit'],installed_runtime_manifest_sha256=hashlib.sha256((root/'runtime-manifest.json').read_bytes()).hexdigest(),files=[])
  payload=dict(environment='production',target='mmv',attempt_key='github:123:1',components=[dict(kind='repo',repo=local['source_repo'],revision=local['source_commit'])],evidence_ref='deployment-sha256:'+digest(evidence))
  obs=dict(id=obs_id,release_id=release,payload=payload,payload_sha256=digest(payload));gate=dict(release_id=release,deployed=True,actual_matches=True,current_status='deployed',current_observation_id=obs_id,gaps=[])
  file=home/'.config/zenithjoy/deployments'/(digest(dict(release_id=release,host='mmv',attempt_key=payload['attempt_key']))+'.evidence.json');file.parent.mkdir(parents=True,exist_ok=True);file.write_text(json.dumps(evidence))
  return {'/api/brain/releases/'+release+'/gate':gate,'/api/brain/releases/'+release+'/observations/'+obs_id:{'observation':obs}},obs,gate,file,local
 def test_repeat_deployment_uses_old_authoritative_map_and_new_official_observation_without_rewriting_old_run(self):
  g=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
   original={x.name:x.read_bytes() for x in directory.iterdir() if x.is_file()}
   with g.commander_admission(home,get):self.official_install(home,root,1)
   (root/'.deploying').unlink()
   extra,_,_,_,_=self.official_install(home,root,1);base_get=get
   def get(path):return extra[path] if path in extra else base_get(path)
   with g.commander_admission(home,get):self.official_install(home,root,2)
   (root/'.deploying').unlink()
   extra,_,_,_,_=self.official_install(home,root,2)
   with g.commander_admission(home,get):pass
   self.assertEqual({x.name:x.read_bytes() for x in directory.iterdir() if x.is_file()},original)
 def test_later_runtime_cannot_be_self_signed_or_use_wrong_release_observation_host_or_unknown_api(self):
  for case in ('missing-runtime-map','wrong-runtime-map','wrong-observation','wrong-release','wrong-host','wrong-evidence','self-signed-current','wrong-source','wrong-repo','partial-gate','api'):
   with self.subTest(case=case),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp).resolve();root,directory,task,proof,get,calls,seal=self.fixture(home)
    extra,obs,gate,file,local=self.official_install(home,root,1);base_get=get
    def get(path):
     if path in extra:
      if case=='api':raise OSError('authority unavailable')
      return extra[path]
     return base_get(path)
    if case=='missing-runtime-map':proof.pop('runtime_files');seal()
    elif case=='wrong-runtime-map':proof['runtime_files']={'wf-v2.py':'f'*64};seal()
    elif case=='wrong-observation':obs['id']='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    elif case=='wrong-release':obs['release_id']='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    elif case=='wrong-host':obs['payload']['target']='xian-m4'
    elif case=='wrong-evidence':file.write_text('{}')
    elif case=='self-signed-current':
     data=b'self-signed-runtime';(root/'wf-v2.py').write_bytes(data);manifest=json.loads((root/'runtime-manifest.json').read_text());manifest['files']['wf-v2.py']=hashlib.sha256(data).hexdigest();manifest['runtime_snapshot_sha256']=hashlib.sha256(json.dumps(manifest['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest();(root/'runtime-manifest.json').write_text(json.dumps(manifest))
    elif case in ('wrong-source','wrong-repo'):
     local['source_commit' if case=='wrong-source' else 'source_repo']='f'*40 if case=='wrong-source' else 'outsider/zenithjoy-workspace';(home/'.openclaw/leadgen-scripts/deployment-manifest.json').write_text(json.dumps(local))
    elif case=='partial-gate':gate['gaps']=[{'code':'unknown'}]
    with self.assertRaises((ValueError,OSError)):
     with module('deployment-guard').commander_admission(home,get):self.fail('untrusted later runtime admitted')
    self.assertFalse((root/'.deploying').exists())

 def test_transient_eperm_from_zero_signal_probe_is_not_mistaken_for_terminated_or_abort_cleanup(self):
  import errno,os,signal,sys
  g=module('deployment-guard');original=os.killpg;seen=[]
  with tempfile.TemporaryDirectory() as tmp:
   marker=Path(tmp)/'forbidden'
   def probe(pgid,sig):
    if sig==0 and not seen:seen.append(True);raise PermissionError(errno.EPERM,'Darwin exiting-process probe')
    return original(pgid,sig)
   transport=[sys.executable,'-u','-c',"import json,time;print(json.dumps({'locked':True,'target':'mmv'}),flush=True);time.sleep(.2)"]
   with patch.object(g.os,'killpg',side_effect=probe):
    with self.assertRaisesRegex(ValueError,'锁通道丢失'):
     g.guarded([sys.executable,'-c',"import time;from pathlib import Path;time.sleep(2);Path("+repr(str(marker))+").touch()"],transport=transport)
   self.assertTrue(seen);self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
