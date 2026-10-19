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
  env=dict(protocol='commander-v2',task_id=task_id,run_id=run,attempt=1,owner_epoch=1,input={'text':'原输入'},input_sha256=digest({'text':'原输入'}),definition=dict(snapshot_sha256='a'*64,runtime_snapshot_sha256=digest(files)),deadline_at='2000-01-01T00:00:00Z',cleanup_deadline_at='2000-01-01T00:01:00Z')
  binding=dict(task_id=task_id,run_id=run,nonce='closed-nonce',parent_session_key='agent:work-commander:'+run,child_run_id='33333333-3333-4333-8333-333333333333',child_session_key='agent:skill-factory:subagent:44444444-4444-4444-8444-444444444444')
  request=dict(binding,protocol='commander-v2',expires_at=946684800)
  evidence=directory/'evidence/cleanup.png';evidence.parent.mkdir();evidence.write_bytes(b'actual-cleanup')
  refs=[dict(path=str(evidence),sha256=hashlib.sha256(evidence.read_bytes()).hexdigest())]
  cleanup=dict(completed=True,failure=None,lock_status='free',evidence=[str(evidence)],_shell=dict(run_id=run,attempt=1,activity_key='cleanup',files=refs,started_at='2000-01-01T00:00:02Z',ended_at='2000-01-01T00:00:03Z'))
  for name,obj in [('envelope.json',env),('input.json',env['input']),('contract.json',{}),('runtime.json',dict(phase='blocked',execution_stopped=False,cleanup_completed=True)),('agent-binding.json',binding),('agent-request.json',request),('spawn-claimed.json',{'nonce':binding['nonce']}),('handoff-closed.json',{'nonce':binding['nonce'],'at':946684804}),('cleanup.json',cleanup)]:put(directory/name,obj)
  (directory/'.worker.lock').touch()
  identity={key:env[key] for key in ('task_id','run_id','attempt','owner_epoch','input_sha256')};identity['definition_snapshot_sha256']=env['definition']['snapshot_sha256']
  proof=dict(schema_version=1,**identity,runtime_snapshot_sha256=digest(files),verdict='FAIL',effects='unknown',retry_safe=False,verification_task_id='55555555-5555-4555-8555-555555555555',attestation_sha256='b'*64,cleanup_sha256=hashlib.sha256((directory/'cleanup.json').read_bytes()).hexdigest(),files=refs,terminal_sha256='c'*64,binding_sha256=digest(binding),original_child=dict(run_id=binding['child_run_id'],session_key=binding['child_session_key'],status='error',started_at=946684800000,ended_at=946684801000),actor='codex:operator',principal='internal-controller',reason='真实失败清理对账',observed_at='2000-01-01T00:02:00Z',request_sha256='d'*64,previous_control_sha256='e'*64)
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
   home=Path(tmp);root,directory,task,proof,get,calls,seal=self.fixture(home)
   with g.commander_admission(home,get):
    self.assertTrue((root/'.deploying').is_file());self.assertEqual(len(calls),2)
    for path in (root/'.admission.lock',directory/'.worker.lock'):
     with open(path,'r') as fd:
      with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    self.assertFalse(json.loads((directory/'runtime.json').read_text())['execution_stopped']);self.assertFalse((directory/'delivery.json').exists())
   with open(directory/'.worker.lock','r') as fd:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def test_fail_closed_for_each_identity_hash_active_state_and_api_error(self):
  import fcntl
  cases=['unreconciled','proof-hash','envelope','cleanup','runtime','nonce','deadline','other-active','run-not-failed','binding','authority','api']
  for case in cases:
   with self.subTest(case=case),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp);root,directory,task,proof,get,calls,seal=self.fixture(home)
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
    elif case=='api':
     def get(path):raise OSError('API unavailable')
    with self.assertRaises((ValueError,OSError,KeyError)):
     with module('deployment-guard').commander_admission(home,get):self.fail('unsafe install admitted')
    self.assertFalse((root/'.deploying').exists())
 def test_busy_original_worker_and_unrelated_active_run_never_exempted(self):
  import fcntl
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp);root,directory,task,proof,get,calls,seal=self.fixture(home)
   with open(directory/'.worker.lock','r') as fd:
    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    with self.assertRaises((BlockingIOError,ValueError)):
     with module('deployment-guard').commander_admission(home,get):self.fail('live worker admitted')
   self.assertEqual(calls,[]);self.assertFalse((root/'.deploying').exists())
 def test_original_success_delivery_lane_needs_no_failure_api(self):
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp);directory=home/'wf-agent-runs/completed';directory.mkdir(parents=True)
   (directory/'runtime.json').write_text('{"phase":"awaiting_verify","execution_stopped":true}');(directory/'delivery.json').write_text('{}')
   with module('deployment-guard').commander_admission(home,lambda _:self.fail('success lane called failure API')):pass

if __name__=='__main__':unittest.main()
