"""Exact non-replay scope regression; never exercises a live lock or device."""
import unittest, tempfile, importlib.util, pathlib, json, copy, subprocess, sys, tarfile, io, hashlib
from unittest.mock import patch
SOURCE = pathlib.Path(__file__).resolve().parents[1]/'cloud8-quarantine-supersession.py'
def put(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v)+'\n');p.chmod(0o600)
class Cloud8Tests(unittest.TestCase):
 def setUp(self):
  self.assertTrue(SOURCE.is_file(),'missing cloud8 observer-only non-replay authority')
  spec=importlib.util.spec_from_file_location('cloud8',SOURCE);self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.run=pathlib.Path(self.tmp.name).resolve()
  self.owner={'sealed':True,'calibration':{'positive_closed':True,'fork_denied':True},'pending':0,'execution_unknown':True,'execution_stopped':False,'leaves':[]}
  for i,(purpose,pid,code) in enumerate(self.m.LEAVES):
   self.owner['leaves'].append(dict(purpose=purpose,pid=pid,code=code,signal=None,ready=i>1,closing=True,unknown=i==5,**{k:True for k in self.m.CLOSED_FIELDS}))
  self.domain={'domain':'runner-phone-observer/v1','execution_stopped':False,'execution_unknown':True,'activities':[{'activity':'preflight','evidence':{'domain':'runner-official-observer/v1','execution_stopped':False,'execution_unknown':True,'sdk':dict(sealed=True,pending=0,execution_unknown=False,external_effect_unknown=False,previous_caller_stop_unproven=False,execution_stopped=True),'control':dict(sealed=True,pending=0,execution_unknown=False,external_effect_unknown=False,previous_caller_stop_unproven=False,execution_stopped=True,caller_execution_stopped=True,final_record_failed=False),'owner':self.owner}}]}
 def test_only_unknown_owner_is_admissible_without_relabeling_old_stop(self):
  before=copy.deepcopy(self.domain);self.m.check_observer(self.domain);self.assertEqual(before,self.domain);self.assertFalse(self.domain['execution_stopped'])
 def test_unknown_in_sdk_or_caller_is_never_admissible(self):
  for key in ['sdk','control']:
   d=copy.deepcopy(self.domain);d['activities'][0]['evidence'][key]['execution_unknown']=True
   with self.assertRaises(ValueError):self.m.check_observer(d)
 def test_incomplete_or_extra_leaf_never_admissible(self):
  for key in self.m.CLOSED_FIELDS:
   d=copy.deepcopy(self.domain);d['activities'][0]['evidence']['owner']['leaves'][5][key]=False
   with self.assertRaises(ValueError):self.m.check_observer(d)
  self.owner['leaves'].append(copy.deepcopy(self.owner['leaves'][5]))
  with self.assertRaises(ValueError):self.m.check_observer(self.domain)
 def test_fork_calibration_missing_or_pending_leaf_refuses(self):
  for change in [lambda o:o['calibration'].update(fork_denied=False),lambda o:o.update(pending=1),lambda o:o['leaves'][0].update(unknown=True)]:
   d=copy.deepcopy(self.domain);change(d['activities'][0]['evidence']['owner'])
   with self.assertRaises(ValueError):self.m.check_observer(d)
 def test_wrong_activity_and_recovered_aggregate_refuse(self):
  for change in [lambda d:d.update(execution_stopped=True),lambda d:d['activities'][0].update(activity='collection')]:
   d=copy.deepcopy(self.domain);change(d)
   with self.assertRaises(ValueError):self.m.check_observer(d)
 def test_cli_has_no_identity_or_hash_override(self):
  r=subprocess.run([sys.executable,str(SOURCE),'plan','--epoch','foreign'],capture_output=True,text=True)
  self.assertEqual(r.returncode,2);self.assertIn('USAGE',r.stderr)
 def test_exact_authority_has_preserved_old_unknown_and_fresh_successor(self):
  self.assertEqual(self.m.IDENTITY['epoch'],'d185baf6-b32f-4de5-801f-52ee6bb35f26')
  self.assertEqual(self.m.SUCCESSOR['run_tag'],'potato20261108_101_cloud9')
  self.assertNotEqual(self.m.IDENTITY['owner'],self.m.SUCCESSOR['run_tag'])
  self.assertEqual(self.m.PROTOCOL,'cloud8-observer-quarantine-supersession/v1')
 def test_original_archive_exact_inventory_and_bytes_are_required(self):
  evidence=self.run/'evidence';evidence.mkdir();ledger=self.run/'ledger';ledger.mkdir();put(ledger/'result.json',{'execution_stopped':False})
  archive=evidence/'cloud8-original-runtime-evidence.tar.gz'
  with tarfile.open(archive,'w:gz') as t:t.add(ledger/'result.json',arcname='ledger/result.json')
  self.m.PINS['archive']=hashlib.sha256(archive.read_bytes()).hexdigest()
  self.assertEqual(set(self.m.preserved_archive(ledger,evidence)),{'result.json'})
  put(ledger/'extra.json',{'execution_stopped':True})
  with self.assertRaises(ValueError):self.m.preserved_archive(ledger,evidence)
  (ledger/'extra.json').unlink();put(ledger/'result.json',{'execution_stopped':True})
  with self.assertRaises(ValueError):self.m.preserved_archive(ledger,evidence)
 def test_main_source_admission_is_mandatory_for_authoritative_plan(self):
  def git(argv,**kwargs):
   if argv[-2:]==['rev-parse','HEAD']:return ('f'*40+'\n').encode()
   if 'merge-base' in argv:raise subprocess.CalledProcessError(1,argv)
   self.fail('must reject unmerged authority before reading deployable source')
  with patch.object(self.m.subprocess,'check_output',side_effect=git):
   with self.assertRaisesRegex(ValueError,"RECOVERY_SOURCE_NOT_MAIN"):self.m.source_authority()
 def test_private_transaction_does_not_mutate_cloud7_entry_identity(self):
  spec=importlib.util.spec_from_file_location('original_cloud7',SOURCE.parent/'cloud7-quarantine-supersession.py')
  original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
  self.assertNotEqual(original.IDENTITY,self.m._tx.IDENTITY)
  self.assertEqual(original.TAG,'potato20261107_101_cloud7')
  self.assertIs(self.m._tx.validate_plan,self.m.validate_plan)
 def test_old_failed_task_is_retained_without_fake_blocked_label(self):
  def brain(path):
   if path=='/tasks/'+self.m.TASK:return dict(id=self.m.TASK,status='failed')
   if path=='/tasks/'+self.m.FIX_TASK:return dict(id=self.m.FIX_TASK,status='in_progress',**self.m.CLAIM)
   return dict(success=True,locks=[dict(device_name=self.m.SERIAL,locked_by=None)])
  self.m._tx.brain_get=brain
  self.assertEqual(self.m.brain_authority()['original_status'],'failed')
 def test_cloud8_cas_transaction_preserves_epoch_unknown_and_pending(self):
  import os, hashlib
  root=self.run/'locks';root.mkdir(mode=0o700);legacy=self.run/'legacy';legacy.mkdir(mode=0o700)
  marker=root/'.migration-complete.json';put(marker,dict(schema_version=1,state='complete',legacy_root=str(legacy)))
  self.m.PINS['marker']=hashlib.sha256(marker.read_bytes()).hexdigest()
  guard=root/(self.m.SERIAL+'.guard');guard.write_bytes(b'');guard.chmod(0o600);os.link(guard,legacy/guard.name)
  lock=root/(self.m.SERIAL+'.lock');lock.mkdir(mode=0o700)
  for name,value in self.m.LOCK_FIELDS.items():
   p=lock/name;p.write_text(value+'\n');p.chmod(0o600)
  inode=lock.stat().st_ino;facts={'original_execution_stopped':False,'identity':self.m.IDENTITY,'authority_basis':'fixture-noninterference'}
  pending=self.run/'old-owner-pending';pending.write_text('unknown remains')
  self.m._tx.layout=lambda:(self.run,root,self.run,self.run)
  self.m._tx.verify_evidence=lambda:facts.copy()
  authority=dict(original_task=self.m.TASK,original_status='failed',fix_task=self.m.FIX_TASK,claim=self.m.CLAIM,central_owner=None)
  self.m._tx.brain_authority=lambda:authority.copy()
  self.m._tx.free_readback=lambda root,run,facts:dict(state='free')
  p=self.m.plan();self.assertEqual(p['machine_authority']['original_status'],'failed')
  r=self.m.apply();self.assertFalse(r['original_execution_stopped']);self.assertFalse(lock.exists())
  archived=self.m.archive_path(root);self.assertEqual(archived.stat().st_ino,inode)
  self.assertEqual((archived/'preflight_epoch').read_text(),self.m.EPOCH+'\n');self.assertEqual(pending.read_text(),'unknown remains')
  self.assertEqual(self.m.apply(),r)
  lock.mkdir(mode=0o700);(lock/'owner').write_text('successor')
  with self.assertRaises(ValueError):self.m.apply()
  self.assertEqual((lock/'owner').read_text(),'successor')
if __name__=='__main__':unittest.main()
