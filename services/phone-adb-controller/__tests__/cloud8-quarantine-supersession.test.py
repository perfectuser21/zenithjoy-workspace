"""Exact non-replay scope regression; never exercises a live lock or device."""
import unittest, tempfile, importlib.util, pathlib, json, copy, subprocess, sys
SOURCE = pathlib.Path(__file__).resolve().parents[1]/'cloud8-quarantine-supersession.py'
def put(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v)+'\n');p.chmod(0o600)
class Cloud8Tests(unittest.TestCase):
 def setUp(self):
  self.assertTrue(SOURCE.is_file(),'missing cloud8 observer-only non-replay authority')
  spec=importlib.util.spec_from_file_location('cloud8',SOURCE);self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.run=pathlib.Path(self.tmp.name)
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
if __name__=='__main__':unittest.main()
