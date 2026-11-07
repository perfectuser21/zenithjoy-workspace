"""Synthetic private-home fixtures; production CLI accepts no identity/hash override."""
import unittest,tempfile,importlib.util,json,hashlib,os,tarfile,io,fcntl,sys
from pathlib import Path
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/'cloud6-source-review-recovery.py'
TASK='16b2887e-310e-4882-a4e5-1b3840e766c9';FIX='786eb515-3c57-4216-a82b-4bb950250778';BIND='6d79dde7-7481-4e11-bf1b-1a05aa737617';COMMIT='db11c6bbf884ccdcd84fbf027c3c7c6436e148c7';TAG='potato20261107_101_cloud6';RUN='douyin_video_discovery-'+TAG+'__a1';EPOCH='5d282615-87f7-40ee-91f2-10b18671ccec';SERIAL='47.100.213.173:10001'
sha=lambda b:hashlib.sha256(b).hexdigest()
def encoded(v):return (json.dumps(v,separators=(',',':'))+'\n').encode()
def put(path,value):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);path.write_bytes(value if isinstance(value,bytes) else encoded(value));path.chmod(0o600)
def jsonl(path,values):put(path,b''.join(encoded(x) for x in values))
def identity():return dict(task_id=TASK,run_id=RUN,binding_id=BIND,source_commit=COMMIT,profile='cloud-phone-test',serial=SERIAL,owner=TAG,epoch=EPOCH)

class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.assertTrue(SOURCE.is_file(),'missing source-only quarantine recovery implementation')
  spec=importlib.util.spec_from_file_location('source_review',SOURCE);self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.home=Path(self.temp.name).resolve();self.root=self.home/'.local/share/zenithjoy/phone-locks';self.root.mkdir(parents=True,mode=0o700);self.root.chmod(0o700)
  self.run=self.home/'.local/share/zenithjoy/phone-candidate-runs'/COMMIT/'ledger'/('douyin_video_discovery-'+TAG);self.run.mkdir(parents=True,mode=0o700)
  self.e=self.home/'perfect21/runner-deploy-evidence/potato-runner-commander-20261107/cloud-drive6';self.e.mkdir(parents=True,mode=0o700)
  self.legacy=self.home/'legacy';self.legacy.mkdir(mode=0o700);put(self.root/'.migration-complete.json',dict(schema_version=1,state='complete',source_sha256='a'*64,legacy_root=str(self.legacy)));put(self.root/(SERIAL+'.guard'),b'')
  self.lock=self.root/(SERIAL+'.lock');self.lock.mkdir(mode=0o700)
  for name,value in dict(owner=TAG,preflight_epoch=EPOCH,preflight_proof_required=EPOCH,standalone_review_required=TAG,preflight_quarantined=EPOCH,acquired_at='1794068935').items():put(self.lock/name,(value+'\n').encode())
  self.foreign=self.root/'4227.lock';self.foreign.mkdir(mode=0o700);put(self.foreign/'owner',b'untouched\n')
  self.files={};self.build_evidence()
  self.m.system_home=lambda:self.home;self.m.process_exists=lambda pid:False;self.calls=[]
  self.task=dict(id=TASK,status='blocked');self.fix=dict(id=FIX,status='in_progress',claimed_by='codex-native-source-authority',claimed_at='2026-11-07T16:54:38.750Z');self.central=dict(device_name=SERIAL,locked_by=None,expires_at=None)
  def brain(path):
   self.calls.append(path)
   if path=='/tasks/'+TASK:return self.task
   if path=='/tasks/'+FIX:return self.fix
   if path=='/device-locks':return dict(success=True,locks=[self.central])
   self.fail('unexpected Brain read '+path)
  self.m.brain_get=brain;self.repin()
 def add(self,path,value):
  f=self.run/path;put(f,value);self.files[path]=f
 def build_evidence(self):
  runtime={}
  for i in range(420):
   name='runtime/fixture-'+str(i)+'.txt';b=('synthetic frozen '+str(i)+'\n').encode();put(self.run/name,b);runtime[name]=sha(b)
  name='runtime/phone-lock-root.py';b=(SOURCE.parent/'phone-lock-root.py').read_bytes();put(self.run/name,b);runtime[name]=sha(b)
  self.add('run-definition.json',dict(files=runtime,agent_input=dict(task_id=TASK,run_id=RUN,run_tag=TAG,profile='cloud-phone-test',serial=SERIAL,workflow_key='douyin_video_discovery',line='yuesheng'),deployment=dict(source_commit=COMMIT),snapshot_sha256='a'*64))
  self.add('activity-preflight.json',dict(status='needs_review',execution_stopped=False,error='AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED'))
  p='skill-primary/preflight/launch-intent.json';self.add(p,dict(scope=dict(task_id=TASK,run_id=RUN,binding_id=BIND,source_commit=COMMIT,profile='cloud-phone-test',serial=SERIAL,run=TAG),request=dict(task_id=TASK,run_id=RUN,binding_id=BIND,source_commit=COMMIT,profile='cloud-phone-test',serial=SERIAL,run_tag=TAG)))
  self.add('agent-tools/preflight/'+'0'*64+'.intent.json',dict(operation='resource_prepare'))
  for n,domain in enumerate(['commander-preflight/caller','skill-primary/preflight','skill-primary/preflight/native-authority']):
   d=domain+'/official-control/';rs=[dict(event='read_intent',path='/api/brain/tasks/'+TASK,epoch=0),dict(event='read_returned',path='/api/brain/tasks/'+TASK,epoch=0,bytes=12)]
   if n==2:rs.append(dict(event='read_intent',path='/api/brain/runs/'+RUN+'/definition',epoch=0))
   self.add(d+'official-authority-fixture.jsonl',b''.join(encoded(x) for x in rs));self.add(d+'caller-lifecycle-fixture.intent.json',dict(protocol='official-caller-lifecycle/v1',source_commit=COMMIT));b=self.files[d+'official-authority-fixture.jsonl'].read_bytes();a=self.files[d+'caller-lifecycle-fixture.intent.json'].read_bytes()
   self.add(d+'official-caller-final-fixture.json',dict(protocol='official-caller-final/v1',evidence_only=True,not_recovery_authority=True,task_id=TASK,run_id=RUN,binding_id=BIND,source_commit=COMMIT,activity_key='preflight',raw_turns=[],journal_closed=True,evidence_complete=True,snapshot=dict(sealed=True,pending=0,execution_stopped=True,caller_execution_stopped=True,execution_unknown=False,external_effect_unknown=False,previous_caller_stop_unproven=False,final_record_failed=False),ledger=dict(file='official-authority-fixture.jsonl',sha256=sha(b),bytes=len(b)),artifacts=[dict(file='caller-lifecycle-fixture.intent.json',sha256=sha(a),bytes=len(a))]))
  self.add('native-phone/preflight/source/lifecycle.intent.json',dict(protocol='native-phone-adb-read/v1'))
  for n,path in enumerate(['/system/bin/am','/system/bin/app_process','/system/bin/app_process32','/system/bin/app_process64']):
   d='native-phone/preflight/source/';self.add(d+f'read-{n}.intent.json',dict(id=n,path=path,scope_sha256='b'*64));cmds=[]
   for service in ['host:transport:'+SERIAL,'sync:']:
    b=service.encode();cmds.append(f'{len(b):04x}'.encode()+b)
   b=path.encode();cmds.append(b'RECV'+len(b).to_bytes(4,'little')+b)
   if n<3:cmds.append(b'QUIT'+bytes(4))
   for k,b in enumerate(cmds):self.add(d+f'read-{n}-write-{k}.intent.json',dict(bytes=len(b),sha256=sha(b)))
   if n<3:self.add(d+f'read-{n}.returned.json',dict(id=n,path=path,sha256='a'*64,bytes=207,peer_eof=True,socket_closed=True))
   else:self.add(d+'read-3.unknown.json',dict(id=3,code='NATIVE_PHONE_READ_AUTHORITY'))
  close={**identity(), 'physical_sequence':1,'physical':dict(domain='parent-preflight-local-nofork-v1',execution_stopped=True,pending=0,command_failures=0,adb=dict(complete=True,requests_returned=True,leaves=[dict(sequence=1,pid=700003,code=0,tainted=False,request_returned=True)]),local=dict(sealed=True,execution_stopped=True,leaves=[dict(id='leaf',pid=700004,code=0,tainted=False)])),'control':dict(sealed=True,pending=0,execution_stopped=True),'official_stopped':False,'agent_not_launched':True,'resource_unknown':False};self.add('preflight-native-domain-close.jsonl',encoded(close))
  self.add('preflight-native-scopes/local.jsonl',b''.join(encoded(x) for x in [dict(event='intent',id='leaf',operation='lock'),dict(event='started',id='leaf',pid=700004),dict(event='returned',id='leaf',pid=700004,code=0,tainted=False)]))
  self.add('preflight-native-scopes/adb.jsonl',b''.join(encoded(x) for x in [dict(phase='intent',sequence=1),dict(phase='started',sequence=1,pid=700003),dict(phase='exit',sequence=1,pid=700003,code=0,tainted=False,request_returned=True)]))
  self.add('preflight-lock-events.jsonl',b''.join(encoded({**identity(),'operation':op,'result':dict(lock=state,owner=TAG,epoch=EPOCH,readback_owner=TAG,readback_epoch=EPOCH)}) for op,state in [('acquire','acquired'),('quarantine','quarantined')]))
  for n in range(2):
   id='fixture-'+str(n);d='commander-preflight/sdk/';session='fixture-session-'+str(n);proofs=[dict(method=x,request_closed=True,websocket_closed=True,socket_closed=True) for x in ['agent','agent.wait']]
   self.add(d+id+'.intent.json',dict(run_id=id,execution_session_id=session));self.add(d+id+'.model-turn.intent.json',dict(run_id=id,execution_session_id=session));self.add(d+id+'.terminal.json',dict(run_id=id,terminal=dict(status='ok',run_id_matches=True),success_evidence=dict(official_run_id=id,session_id=session,turn_id=id),transport_proofs=proofs))
  while len(self.files)<85:self.add('fixture-evidence/'+str(len(self.files))+'.json',dict(synthetic=True))
  self.launch=dict(pid=700001,supervisor_pid=700002,task_id=TASK,source_commit=COMMIT,host='mmv',broker_host='mmv',adb_endpoint='tcp:127.0.0.1:5041',argv=['/bin/bash',str(self.home/'.local/share/zenithjoy/phone-candidates'/COMMIT/'run.sh'),'douyin_video_discovery','cloud-phone-test',SERIAL,'yuesheng',TAG]);put(self.e/'launch.json',self.launch);put(self.e/'exit.json',dict(exit_code=1,finished_at='2026-11-07T16:32:35.255055+00:00'))
 def repin(self):
  manifest=dict(run_dir=str(self.run),files=[dict(path=p,bytes=f.stat().st_size,sha256=sha(f.read_bytes())) for p,f in self.files.items()]);put(self.e/'runtime-evidence-manifest.json',manifest)
  with tarfile.open(self.e/'runtime-evidence.tar.gz','w:gz') as t:
   for p,f in self.files.items():
    b=f.read_bytes();i=tarfile.TarInfo(p);i.size=len(b);t.addfile(i,io.BytesIO(b))
  self.m.PINS=dict(manifest=sha((self.e/'runtime-evidence-manifest.json').read_bytes()),archive=sha((self.e/'runtime-evidence.tar.gz').read_bytes()),launch=sha((self.e/'launch.json').read_bytes()),exit=sha((self.e/'exit.json').read_bytes()),marker=sha((self.root/'.migration-complete.json').read_bytes()))
 def alter(self,path,fn):
  f=self.files[path];v=json.loads(f.read_text());fn(v);put(f,v);self.repin()
 def plan(self):return self.m.plan()
 def apply(self):return self.m.apply()
 def test_plan_apply_preserves_all_originals_and_retires_only_exact_lock(self):
  original={p:sha(f.read_bytes()) for p,f in self.files.items()};before={f.name:f.read_bytes() for f in self.lock.iterdir()};p=self.plan();self.assertTrue(self.lock.is_dir());self.assertEqual(p['state'],'planned');r=self.apply();self.assertEqual(r['state'],'retired');self.assertEqual(r['local_readback']['state'],'free');self.assertFalse(self.lock.exists());retired=Path(r['retired_path']);self.assertEqual({f.name:f.read_bytes() for f in retired.iterdir()},before);self.assertEqual((self.foreign/'owner').read_bytes(),b'untouched\n');self.assertEqual(original,{p:sha(f.read_bytes()) for p,f in self.files.items()});self.assertFalse(json.loads(self.files['activity-preflight.json'].read_text())['execution_stopped']);self.assertGreaterEqual(self.calls.count('/device-locks'),3)
 def test_apply_requires_durable_plan(self):
  with self.assertRaises(ValueError):self.apply()
  self.assertTrue(self.lock.exists())
 def test_hash_or_frozen_source_drift_refuses_before_archive(self):
  for f in [self.files['activity-preflight.json'],self.run/'runtime/fixture-4.txt']:
   b=f.read_bytes();put(f,b+b' ')
   with self.assertRaises(ValueError):self.plan()
   put(f,b)
 def test_unknown_identity_worker_or_unstopped_facts_fail_even_with_matching_fixture_pins(self):
  cases=[('activity-preflight.json',lambda v:v.update(execution_stopped=True)),('native-phone/preflight/source/read-3.unknown.json',lambda v:v.update(code='NATIVE_PHONE_READ_OTHER')),('skill-primary/preflight/official-control/official-caller-final-fixture.json',lambda v:v.update(raw_turns=[dict(dispatched=True)])),('skill-primary/preflight/official-control/official-caller-final-fixture.json',lambda v:v['snapshot'].update(execution_stopped=False)),('skill-primary/preflight/official-control/official-caller-final-fixture.json',lambda v:v.update(task_id='foreign')),('preflight-native-domain-close.jsonl',lambda v:v.update(agent_not_launched=False))]
  for path,fn in cases:
   with self.subTest(path=path):
    b=self.files[path].read_bytes();self.alter(path,fn)
    with self.assertRaises(ValueError):self.plan()
    put(self.files[path],b);self.repin()
 def test_no_shell_or_extra_business_or_extra_native_inventory(self):
  path='native-phone/preflight/source/read-0-write-1.intent.json';b=self.files[path].read_bytes();self.alter(path,lambda v:v.update(sha256=sha(b'shell:input tap 1 1')))
  with self.assertRaises(ValueError):self.plan()
  put(self.files[path],b);self.repin();put(self.run/'native-phone/preflight/command-0/intent.json',dict(command='tap'))
  with self.assertRaises(ValueError):self.plan()
 def test_unmatched_local_leaf_or_live_parent_refuses(self):
  f=self.files['preflight-native-scopes/local.jsonl'];b=f.read_bytes();put(f,b+encoded(dict(event='intent',id='unknown',operation='lock')));self.repin()
  with self.assertRaises(ValueError):self.plan()
  put(f,b);self.repin();self.m.process_exists=lambda pid:pid==700001
  with self.assertRaises(ValueError):self.plan()
 def test_owner_epoch_field_inventory_and_guard_contention_refuse(self):
  self.plan()
  for name in ['owner','preflight_epoch','preflight_quarantined']:
   f=self.lock/name;b=f.read_bytes();put(f,b'foreign\n')
   with self.assertRaises(ValueError):self.apply()
   put(f,b)
  put(self.lock/'unexpected',b'unknown')
  with self.assertRaises(ValueError):self.apply()
  (self.lock/'unexpected').unlink()
  with (self.root/(SERIAL+'.guard')).open('r+') as g:
   fcntl.flock(g,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(ValueError):self.apply()
 def test_brain_claim_task_and_foreign_lock_fail_closed(self):
  for target,key,value in [(self.fix,'claimed_by','foreign'),(self.fix,'claimed_at','changed'),(self.fix,'status','blocked'),(self.task,'status','in_progress'),(self.central,'locked_by','foreign')]:
   old=target.get(key);target[key]=value
   with self.assertRaises(ValueError):self.plan()
   target[key]=old
  self.central.update(locked_by=TASK,expires_at='2020-01-01T00:00:00Z');self.plan()
 def test_same_original_central_owner_without_expiry_refuses(self):
  self.central.update(locked_by=TASK,expires_at='2999-01-01T00:00:00Z')
  with self.assertRaises(ValueError):self.plan()
 def test_double_apply_and_interruption_before_or_after_rename_are_exactly_idempotent(self):
  self.plan();rename=self.m.os.rename
  with patch.object(self.m.os,'rename',side_effect=OSError('before rename')):
   with self.assertRaises(OSError):self.apply()
  self.assertTrue(self.lock.exists())
  def after(a,b):rename(a,b);raise OSError('after rename')
  with patch.object(self.m.os,'rename',side_effect=after):
   with self.assertRaises(OSError):self.apply()
  self.assertFalse(self.lock.exists());first=self.apply();second=self.apply();self.assertEqual(first,second)
 def test_retired_archive_or_plan_drift_never_releases_or_recreates(self):
  self.plan();r=self.apply();f=Path(r['retired_path'])/'owner';put(f,b'foreign\n')
  with self.assertRaises(ValueError):self.apply()
  self.assertFalse(self.lock.exists())
 def test_plan_journal_or_marker_drift_refuses(self):
  self.plan();j=next(self.root.glob('.source-review-cloud6-*/plan.json'));v=json.loads(j.read_text());v['identity']['epoch']='foreign';put(j,v)
  with self.assertRaises(ValueError):self.apply()
  self.assertTrue(self.lock.exists())
 def test_cli_cannot_supply_another_owner_root_or_hash(self):
  import subprocess
  r=subprocess.run([sys.executable,str(SOURCE),'plan','--owner','foreign'],capture_output=True,text=True)
  self.assertEqual(r.returncode,2);self.assertIn('USAGE',r.stderr);self.assertTrue(self.lock.exists())
 def test_retirement_without_apply_intent_cannot_be_adopted(self):
  p=self.plan();os.rename(self.lock,Path(p['retired_path']))
  with self.assertRaises(ValueError):self.apply()
  with self.assertRaises(ValueError):self.plan()
 def test_last_machine_authority_cannot_hide_original_evidence_drift(self):
  self.plan();old=self.m.brain_get;count=0
  def read(path):
   nonlocal count
   if path=='/device-locks':
    count+=1
    if count==2:
     f=self.files['activity-preflight.json'];v=json.loads(f.read_text());v['execution_stopped']=True;put(f,v)
   return old(path)
  self.m.brain_get=read
  with self.assertRaises(ValueError):self.apply()
  self.assertTrue(self.lock.exists());self.assertFalse(any(self.root.glob('.source-review-cloud6-*/apply.returned.json')))
 def test_final_machine_readback_cannot_hide_evidence_drift_after_retirement(self):
  self.plan();old=self.m.brain_get;count=0
  def read(path):
   nonlocal count
   if path=='/device-locks':
    count+=1
    if count==3:
     f=self.files['activity-preflight.json'];v=json.loads(f.read_text());v['execution_stopped']=True;put(f,v)
   return old(path)
  self.m.brain_get=read
  with self.assertRaises(ValueError):self.apply()
  self.assertFalse(self.lock.exists());self.assertFalse(any(self.root.glob('.source-review-cloud6-*/apply.returned.json')))
 def test_last_machine_authority_guard_replacement_is_not_the_owned_guard(self):
  self.plan();old=self.m.brain_get;count=0;held=[]
  def read(path):
   nonlocal count
   if path=='/device-locks':
    count+=1
    if count==2:
     guard=self.root/(SERIAL+'.guard');os.rename(guard,self.root/'.guard.replaced');put(guard,b'')
     fd=os.open(guard,os.O_RDWR);held.append(fd);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   return old(path)
  self.m.brain_get=read
  try:
   with self.assertRaises(ValueError):self.apply()
   self.assertTrue(self.lock.exists());self.assertFalse(any(self.root.glob('.source-review-cloud6-*/apply.returned.json')))
  finally:
   for fd in held:os.close(fd)
 def test_final_readback_guard_replacement_cannot_write_success_returned(self):
  self.plan();old=self.m.brain_get;count=0;held=[]
  def read(path):
   nonlocal count
   if path=='/device-locks':
    count+=1
    if count==3:
     guard=self.root/(SERIAL+'.guard');os.rename(guard,self.root/'.guard.replaced');put(guard,b'')
     fd=os.open(guard,os.O_RDWR);held.append(fd);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   return old(path)
  self.m.brain_get=read
  try:
   with self.assertRaises(ValueError):self.apply()
   self.assertFalse(self.lock.exists());self.assertFalse(any(self.root.glob('.source-review-cloud6-*/apply.returned.json')))
  finally:
   for fd in held:os.close(fd)
 def test_root_inode_replacement_preserving_guard_and_lock_inodes_is_refused(self):
  self.plan();old=self.m.brain_get;count=0
  def read(path):
   nonlocal count
   if path=='/device-locks':
    count+=1
    if count==2:
     backup=self.root.parent/'old-root';os.rename(self.root,backup);self.root.mkdir(mode=0o700)
     for child in backup.iterdir():os.rename(child,self.root/child.name)
   return old(path)
  self.m.brain_get=read
  with self.assertRaises(ValueError):self.apply()
  self.assertTrue(self.lock.exists());self.assertFalse(any(self.root.glob('.source-review-cloud6-*/apply.returned.json')))
 def test_symlink_and_hardlink_fail_before_plan(self):
  f=self.lock/'owner';b=f.read_bytes();f.unlink();os.link(self.foreign/'owner',f)
  with self.assertRaises(ValueError):self.plan()
  f.unlink();f.symlink_to(self.foreign/'owner')
  with self.assertRaises(ValueError):self.plan()
 def test_central_readback_failure_after_rename_retains_intent_and_archive(self):
  self.plan();old=self.m.brain_get;count=0
  def read(path):
   nonlocal count
   if path=='/device-locks':
    count+=1
    if not self.lock.exists():raise ValueError('central after rename unknown')
   return old(path)
  self.m.brain_get=read
  with self.assertRaises(ValueError):self.apply()
  self.assertFalse(self.lock.exists());self.m.brain_get=old;self.assertEqual(self.apply()['state'],'retired')

if __name__=='__main__':unittest.main()
