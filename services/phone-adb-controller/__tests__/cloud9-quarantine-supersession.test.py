"""固定只读源未知迁移回归；全部使用私有目录和虚构中央响应。"""
import unittest, tempfile, pathlib, importlib.util, copy, json, os, tarfile, subprocess, sys
from unittest.mock import patch
SOURCE=pathlib.Path(__file__).resolve().parents[1]/'cloud9-quarantine-supersession.py'
class Cloud9Tests(unittest.TestCase):
 def setUp(self):
  self.assertTrue(SOURCE.is_file(),'missing exact cloud9 non-replay authority')
  s=importlib.util.spec_from_file_location('cloud9',SOURCE);self.m=importlib.util.module_from_spec(s);s.loader.exec_module(self.m)
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name).resolve()
 def test_fixed_identity_and_fresh_code_successor(self):
  self.assertEqual(self.m.IDENTITY['task_id'],'8e8fbff5-21dd-4e4b-83ed-f06d9b4ea68d')
  self.assertEqual(self.m.SUCCESSOR['run_tag'],'potato20261108_101_cloud10')
  self.assertEqual(self.m.SUCCESSOR['execution_mode'],'code')
  self.assertNotIn('execution_transport',self.m.SUCCESSOR)
 def test_four_exact_read_only_wire_intents(self):
  d=self.root/'source';d.mkdir();
  for i,b in enumerate(self.m.WIRES):(d/f'read-18-write-{i}.intent.json').write_text(json.dumps(dict(bytes=len(b),sha256=self.m.sha(b))))
  (d/'read-18.intent.json').write_text(json.dumps(dict(id=18,path=self.m.PATH)))
  (d/'read-18.unknown.json').write_text(json.dumps(dict(id=18,code='NATIVE_PHONE_READ_UNKNOWN')))
  before={f.name:f.read_bytes() for f in d.iterdir()};self.m.check_wire(d)
  self.assertEqual(before,{f.name:f.read_bytes() for f in d.iterdir()})
  for name in list(before):
   p=d/name;p.write_text('{}')
   with self.assertRaises(ValueError):self.m.check_wire(d)
   p.write_bytes(before[name])
  (d/'read-19.intent.json').write_text('{}')
  with self.assertRaises(ValueError):self.m.check_wire(d)
 def test_release_unknown_is_not_retried_even_if_central_now_free(self):
  j=self.root/'journal';j.mkdir();facts={'fixed':True}
  authority={'central_owner':self.m.TASK}
  with patch.object(self.m,'brain_authority',return_value=authority),patch.object(self.m,'brain_release',side_effect=OSError('lost ack')) as post:
   with self.assertRaises(OSError):self.m.release_central(j,facts,lambda:None)
   self.assertEqual(post.call_count,1)
  with patch.object(self.m,'brain_authority',return_value={'central_owner':None}),patch.object(self.m,'brain_release') as post:
   with self.assertRaisesRegex(ValueError,'RELEASE_UNKNOWN'):self.m.release_central(j,facts,lambda:None)
   post.assert_not_called()
 def test_foreign_owner_never_released(self):
  j=self.root/'journal';j.mkdir()
  with patch.object(self.m,'brain_authority',return_value={'central_owner':'foreign'}),patch.object(self.m,'brain_release') as post:
   with self.assertRaises(ValueError):self.m.release_central(j,{},lambda:None)
   post.assert_not_called()
 def test_release_requires_response_and_free_readback(self):
  for response in [{}, {'success':True,'released':{'device_name':self.m.SERIAL,'locked_by':'foreign'}}]:
   j=self.root/str(len(list(self.root.iterdir())));j.mkdir()
   with patch.object(self.m,'brain_authority',return_value={'central_owner':self.m.TASK}),patch.object(self.m,'brain_release',return_value=response):
    with self.assertRaises(ValueError):self.m.release_central(j,{},lambda:None)
 def test_no_owner_is_a_state_readback_not_a_stop_proof(self):
  j=self.root/'journal';j.mkdir()
  with patch.object(self.m,'brain_authority',return_value={'central_owner':None}),patch.object(self.m,'brain_release') as post:
   r=self.m.release_central(j,{},lambda:None)
   self.assertEqual(r['operation'],'observed_free');self.assertFalse(r['original_execution_stopped']);post.assert_not_called()
 def test_complete_release_receipt_is_idempotent_but_new_owner_refuses(self):
  j=self.root/'journal';j.mkdir();ok={'success':True,'released':{'device_name':self.m.SERIAL,'locked_by':None}}
  with patch.object(self.m,'brain_authority',side_effect=[{'central_owner':self.m.TASK},{'central_owner':None}]),patch.object(self.m,'brain_release',return_value=ok):r=self.m.release_central(j,{},lambda:None)
  with patch.object(self.m,'brain_authority',return_value={'central_owner':None}),patch.object(self.m,'brain_release') as post:self.assertEqual(r,self.m.release_central(j,{},lambda:None));post.assert_not_called()
  with patch.object(self.m,'brain_authority',return_value={'central_owner':self.m.TASK}):
   with self.assertRaises(ValueError):self.m.release_central(j,{},lambda:None)
 def test_review_registry_pin(self):self.m.check_review_pin()
 def cas_fixture(self):
  root=self.root/'locks';root.mkdir(mode=0o700);legacy=self.root/'legacy';legacy.mkdir(mode=0o700)
  marker=root/'.migration-complete.json';marker.write_text(json.dumps(dict(schema_version=1,state='complete',legacy_root=str(legacy)))+'\n');marker.chmod(0o600)
  self.m.PINS['marker']=self.m.sha(marker.read_bytes())
  guard=root/(self.m.SERIAL+'.guard');guard.write_bytes(b'');guard.chmod(0o600);os.link(guard,legacy/guard.name)
  lock=root/(self.m.SERIAL+'.lock');lock.mkdir(mode=0o700)
  for k,v in self.m.LOCK_FIELDS.items():p=lock/k;p.write_text(v+'\n');p.chmod(0o600)
  self.facts=dict(identity=self.m.IDENTITY,original_execution_stopped=False,authority_basis='fixed-read-only-sync-recv')
  self.m.layout=self.m._tx.layout=lambda:(self.root,root,self.root,self.root)
  self.m.verify_evidence=self.m._tx.verify_evidence=lambda:self.facts.copy()
  self.m._tx.free_readback=lambda root,run,facts:dict(serial=self.m.SERIAL,state='free',migration='verified')
  self.central=self.m.TASK
  self.authority=lambda:dict(original_task=self.m.TASK,original_status='failed',fix_task=self.m.FIX_TASK,claim=self.m.CLAIM,central_owner=self.central)
  self.m.brain_authority=self.authority
  def release():
   self.assertEqual(self.central,self.m.TASK);self.central=None
   return dict(success=True,released=dict(device_name=self.m.SERIAL,locked_by=None))
  self.m.brain_release=release
  return root,lock
 def test_real_guard_rename_preserves_inode_unknown_pending_and_refuses_new_owner(self):
  root,lock=self.cas_fixture();inode=lock.stat().st_ino
  pending=self.root/'owner-pending';pending.write_text('reserved unknown remains')
  self.m.plan();result=self.m.apply();self.assertFalse(result['original_execution_stopped']);self.assertIsNone(result['central_readback']['central_owner'])
  retired=self.m.archive_path(root);self.assertEqual(retired.stat().st_ino,inode);self.assertFalse(lock.exists());self.assertEqual(pending.read_text(),'reserved unknown remains')
  self.assertEqual(result,self.m.apply())
  lock.mkdir(mode=0o700);(lock/'owner').write_text('new-owner')
  with self.assertRaises(ValueError):self.m.apply()
  self.assertEqual((lock/'owner').read_text(),'new-owner')
 def test_real_cas_crash_after_central_ack_before_rename_resumes_once(self):
  root,lock=self.cas_fixture();self.m.plan();original=self.m._tx.os.rename
  with patch.object(self.m._tx.os,'rename',side_effect=OSError('crash')):
   with self.assertRaises(OSError):self.m.apply()
  self.assertTrue(lock.exists());self.assertIsNone(self.central)
  with patch.object(self.m,'brain_release') as post:
   result=self.m.apply();post.assert_not_called()
  self.assertEqual(result['state'],'superseded');self.assertFalse(lock.exists())
 def test_real_cas_lost_ack_keeps_local_barrier_and_never_reposts(self):
  root,lock=self.cas_fixture();self.m.plan()
  def lost():self.central=None;raise OSError('lost ack')
  self.m.brain_release=lost
  with self.assertRaises(OSError):self.m.apply()
  with patch.object(self.m,'brain_release') as post:
   with self.assertRaisesRegex(ValueError,'RELEASE_UNKNOWN'):self.m.apply()
   post.assert_not_called()
  self.assertTrue(lock.exists());self.assertFalse(self.m.archive_path(root).exists())
 def test_cas_owner_epoch_or_evidence_drift_before_apply_is_rejected(self):
  root,lock=self.cas_fixture();self.m.plan();(lock/'preflight_epoch').write_text('foreign\n')
  with patch.object(self.m,'brain_release') as post:
   with self.assertRaises(ValueError):self.m.apply()
   post.assert_not_called()
  self.assertTrue(lock.exists())
 def test_new_central_owner_between_release_and_rename_refuses(self):
  root,lock=self.cas_fixture();self.m.plan()
  real=self.m.release_central
  def release_then_foreign(*args):
   result=real(*args);self.central='foreign';return result
  with patch.object(self.m,'release_central',side_effect=release_then_foreign):
   with self.assertRaises(ValueError):self.m.apply()
  self.assertTrue(lock.exists());self.assertFalse(self.m.archive_path(root).exists())
 def test_network_mutating_evidence_aborts_before_post(self):
  root,lock=self.cas_fixture();self.m.plan();calls=0
  def changed():
   self.facts['drift']=True;return self.authority()
  with patch.object(self.m,'brain_authority',side_effect=changed),patch.object(self.m,'brain_release') as post:
   with self.assertRaises(ValueError):self.m.apply()
   post.assert_not_called()
  self.assertTrue(lock.exists())
 def test_archive_pins_exact_986_files_and_refuses_extra_or_changed_bytes(self):
  ledger=self.root/'ledger';ledger.mkdir();e=self.root/'evidence';e.mkdir()
  for i in range(986):(ledger/(str(i)+'.json')).write_text('{}')
  archive=e/'original-runtime-evidence.tar.gz'
  with tarfile.open(archive,'w:gz') as t:t.add(ledger,arcname='ledger')
  self.m.PINS['archive']=self.m.sha(archive.read_bytes());self.assertEqual(len(self.m.preserved_archive(ledger,e)),986)
  (ledger/'extra.json').write_text('{}')
  with self.assertRaises(ValueError):self.m.preserved_archive(ledger,e)
  (ledger/'extra.json').unlink();(ledger/'0.json').write_text('{"stop":true}')
  with self.assertRaises(ValueError):self.m.preserved_archive(ledger,e)
 def test_observer_closure_is_semantic_not_pid_or_elapsed_time(self):
  common=dict(sealed=True,pending=0,execution_stopped=True,execution_unknown=False,external_effect_unknown=False,previous_caller_stop_unproven=False)
  owner=dict(sealed=True,pending=0,execution_stopped=True,execution_unknown=False,calibration=dict(positive_closed=True,fork_denied=True),leaves=[])
  for i in range(6):owner['leaves'].append(dict(purpose='calibration-positive' if i==0 else 'calibration-negative' if i==1 else 'owner',code=1 if i==1 else 0,signal=None,pid=99999999,unknown=False,closing=True,**{k:True for k in ['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed']}))
  domain=dict(domain='runner-phone-observer/v1',execution_stopped=True,execution_unknown=False,activities=[])
  for name in ['preflight','cleanup']:
   o=copy.deepcopy(owner)
   if name=='cleanup':o['leaves']=[]
   domain['activities'].append(dict(activity=name,evidence=dict(domain='runner-official-observer/v1',execution_stopped=True,execution_unknown=False,sdk=common.copy(),control=dict(**common,caller_execution_stopped=True,final_record_failed=False),owner=o)))
  self.m.check_observer(domain)
  for key in ['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed']:
   d=copy.deepcopy(domain);d['activities'][0]['evidence']['owner']['leaves'][5][key]=False
   with self.assertRaises(ValueError):self.m.check_observer(d)
  for key in ['sdk','control']:
   d=copy.deepcopy(domain);d['activities'][0]['evidence'][key]['pending']=1
   with self.assertRaises(ValueError):self.m.check_observer(d)
 def test_unmerged_source_and_cli_identity_overrides_refuse(self):
  def git(argv,**kw):
   if argv[-2:]==['rev-parse','HEAD']:return ('f'*40+'\n').encode()
   raise subprocess.CalledProcessError(1,argv)
  with patch.object(self.m.subprocess,'check_output',side_effect=git):
   with self.assertRaisesRegex(ValueError,'NOT_MAIN'):self.m.source_authority()
  r=subprocess.run([sys.executable,str(SOURCE),'apply','--epoch','other'],capture_output=True,text=True);self.assertEqual(r.returncode,2);self.assertIn('USAGE',r.stderr)
 def test_changed_returned_release_receipt_is_never_admitted(self):
  j=self.root/'journal';j.mkdir()
  with patch.object(self.m,'brain_authority',return_value={'central_owner':None}):self.m.release_central(j,{},lambda:None)
  r=j/'central.returned.json';v=json.loads(r.read_text());v['operation']='owner_cas_released';r.write_text(json.dumps(v))
  with patch.object(self.m,'brain_authority',return_value={'central_owner':None}),patch.object(self.m,'brain_release') as post:
   with self.assertRaises(ValueError):self.m.release_central(j,{},lambda:None)
   post.assert_not_called()
 def test_caller_artifact_and_unstarted_worker_are_permanent_guards(self):
  for i in range(6):
   d=self.root/str(i);d.mkdir();artifact=d/'ledger.jsonl';artifact.write_text('{}\n')
   ref=dict(file=artifact.name,sha256=self.m.sha(artifact.read_bytes()),bytes=artifact.stat().st_size)
   v=dict(**{k:self.m.IDENTITY[k] for k in ['task_id','run_id','binding_id','source_commit']},snapshot=dict(sealed=True,pending=0,execution_stopped=True,caller_execution_stopped=True,execution_unknown=False,external_effect_unknown=False,previous_caller_stop_unproven=False,final_record_failed=False),not_recovery_authority=True,journal_closed=True,evidence_complete=True,ledger=ref,artifacts=[],raw_turns=[])
   if i==0:v['raw_turns']=[dict(index=0,dispatched=False,accepted=False,official_terminal=False,recovered=False)]
   (d/f'official-caller-final-{i}.json').write_text(json.dumps(v))
  self.m.closed_callers(self.root)
  p=self.root/'0/official-caller-final-0.json';v=json.loads(p.read_text());v['raw_turns'][0]['dispatched']=True;p.write_text(json.dumps(v))
  with self.assertRaises(ValueError):self.m.closed_callers(self.root)
  v['raw_turns'][0]['dispatched']=False;p.write_text(json.dumps(v));(self.root/'0/ledger.jsonl').write_text('changed')
  with self.assertRaises(ValueError):self.m.closed_callers(self.root)
 def test_missing_locked_by_in_success_response_retains_local_barrier(self):
  root,lock=self.cas_fixture();self.m.plan()
  response=dict(success=True,released=dict(device_name=self.m.SERIAL))
  with patch.object(self.m,'brain_release',return_value=response):
   with self.assertRaisesRegex(ValueError,'RELEASE_RESPONSE'):self.m.apply()
  self.assertTrue(lock.exists());self.assertFalse(self.m.archive_path(root).exists())
  self.assertFalse((self.m.journal_dir(root)/'central.returned.json').exists())
if __name__=='__main__':unittest.main()
