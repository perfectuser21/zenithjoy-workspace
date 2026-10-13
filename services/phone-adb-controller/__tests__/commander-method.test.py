#!/usr/bin/env python3
"""隔离fixture：真实文件/子进程，Brain与MMV宿主为显式测试替身。"""
import copy,hashlib,importlib.util,json,os,pathlib,shutil,socket,subprocess,tempfile,time,unittest
from datetime import datetime,timezone
from unittest.mock import patch
SOURCE=pathlib.Path(__file__).resolve().parents[1]
REPO='perfectuser21/zenithjoy-workspace'
PATH='services/phone-adb-controller/commander/wf-report.py'
def uid(n):return f'00000000-0000-4000-8000-{n:012d}'
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def digest(value):
 raw=value if isinstance(value,bytes) else json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
 return hashlib.sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))

class Methods(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='method-fixture-');self.addCleanup(self.tmp.cleanup)
  self.home=pathlib.Path(self.tmp.name).resolve();self.env=patch.dict(os.environ,HOME=str(self.home));self.env.start();self.addCleanup(self.env.stop)
  self.host=patch.object(socket,'gethostname',return_value='aad17-2');self.host.start();self.addCleanup(self.host.stop)
  self.runtime=self.home/'.openclaw/commander';shutil.copytree(SOURCE/'commander',self.runtime)
  workspace=self.home/'openclaw-root/workspaces-root/clawd-work-commander';shutil.copytree(self.runtime,workspace)
  self.io=load(self.runtime/'wf-v2-io.py','fixture_io')
  self.code=b'import json,sys\nprint(json.dumps({"method":"historical-fixture","args":sys.argv[1:]},ensure_ascii=False))\n'
  self.contract={'key':'fixture.internal','capability_id':uid(1),'execution_profile':'codex_agent','agent':'skill-factory','version':'1.0.0','input_schema':{'type':'object'},'output_schema':{'type':'object'},'resources':{},'verification':{'independent':True},'recovery':{'max_attempts':2,'retry_safe':True,'retry_on':['verification_failed'],'total_timeout_sec':120,'cleanup_timeout_sec':30},'activities':[{'key':'report','acceptance':['truth'],'steps':[]}]}
  self.binding={'kind':'code','repo':REPO,'path':PATH,'revision':'a'*40,'digest':'sha256:'+digest(self.code)}
  self.a={'id':uid(4),'activity_id':uid(5),'source_repo':REPO,'source_commit':'a'*40,'payload':{'activity_id':uid(5),'contract':self.contract['activities'][0],'steps':[],'implementation_bindings':[dict(self.binding,status='verified',scope='activity')]}}
  self.w={'id':uid(2),'workflow_id':uid(3),'source_repo':REPO,'source_commit':'a'*40,'payload_sha256':'c'*64,'payload':{'key':'fixture.internal','workflow_id':uid(3),'contract':self.contract,'activities':[{'activity_id':uid(5),'activity_version_id':uid(4),'reference_id':uid(6)}]}}
  self.manifest={'protocol':'commander-method-v1','workflow':{'key':'fixture.internal','workflow_id':uid(3),'workflow_definition_version_id':uid(2),'snapshot_sha256':'c'*64},'source':{'repo':REPO,'revision':'a'*40},'bindings':[self.binding]}
  mh=digest(self.manifest);self.root=self.home/'.local/share/zenithjoy/commander-methods'/mh;self.root.mkdir(parents=True)
  (self.root/PATH).parent.mkdir(parents=True);(self.root/PATH).write_bytes(self.code);self.io.write(self.root/'method-manifest.json',self.manifest)
  self.instance={'physical_host':'mmv','target':'mmv--method--'+mh,'method_root':str(self.root),'manifest_sha256':mh,'resolved_bindings':[dict(self.binding,absolute_path=str(self.root/PATH))]}
  payload={'workflows':[self.w],'activities':[self.a],'components':[{'kind':'repo','repo':REPO,'revision':'a'*40},self.binding],'verification':{'status':'verified'}}
  self.method={'id':uid(10),'environment':'production','target':self.instance['target'],'payload':payload};self.method['manifest_sha256']=digest({k:self.method[k] for k in ('environment','target','payload')})
  self.original=copy.deepcopy(self.method);self.original['id']=uid(11);self.original['target']='mmv';self.original['payload']['workflows'][0]['id']=uid(12);self.original['payload']['workflows'][0]['payload_sha256']='d'*64
  self.supervisor=copy.deepcopy(self.original);self.supervisor['id']=uid(13);sw=self.supervisor['payload']['workflows'][0];sw.update(id=uid(14),workflow_id=uid(15),payload_sha256='e'*64);sw['payload'].update(key='workflow_commander.internal',workflow_id=uid(15))
  for release in (self.original,self.supervisor):release['manifest_sha256']=digest({k:release[k] for k in ('environment','target','payload')})
  files=self.io.manifest(self.runtime,{uid(13):{'workflows':{'workflow_commander.internal':{'snapshot_sha256':'e'*64}}}})
  now=datetime.now(timezone.utc);deadline=datetime.fromtimestamp(time.time()+120,timezone.utc).isoformat();cleanup=datetime.fromtimestamp(time.time()+150,timezone.utc).isoformat()
  self.envelope={'protocol':'commander-v2','task_id':uid(20),'run_id':'wfd-method-fixture','workflow_key':'fixture.internal','attempt':2,'owner_epoch':2,'input':{'label':'中文\n$() `literal`'},'contract':self.contract,'deadline_at':deadline,'cleanup_deadline_at':cleanup,'definition':{'release_id':uid(10),'observation_id':uid(30),'workflow_id':uid(3),'workflow_definition_version_id':uid(2),'snapshot_sha256':'c'*64,'runtime_snapshot_sha256':None,'expected_path':[],'actor':'workflow-commander','attempt_key':'fixture:2'},'recovery':{'previous_attempt':{'run_id':'wfd-failed'}}}
  self.envelope['input_sha256']=digest(self.envelope['input'])
  self.envelope['method_selection']={'protocol':'commander-method-v1','original_goal_definition':{'original_run_id':'wfd-failed','release_id':uid(11),'workflow_id':uid(3),'workflow_definition_version_id':uid(12),'snapshot_sha256':'d'*64,'contract':copy.deepcopy(self.contract),'recovery':copy.deepcopy(self.contract['recovery']),'input_sha256':self.envelope['input_sha256'],'deadline_at':deadline,'cleanup_deadline_at':cleanup},'supervisor_definition':{'release_id':uid(13),'observation_id':uid(31),'workflow_id':uid(15),'workflow_definition_version_id':uid(14),'snapshot_sha256':'e'*64,'runtime_snapshot_sha256':files['runtime_snapshot_sha256']},'method_instance':self.instance,'selection_receipt':{'previous_run_id':'wfd-failed','business_run_id':'wfd-verified','verification_task_id':uid(40),'compatibility_sha256':'f'*64}}
  self.releases={r['id']:r for r in (self.method,self.original,self.supervisor)}
  self.gates={uid(10):{'deployed':True,'actual_matches':True,'current_observation_id':uid(30)},uid(13):{'deployed':True,'actual_matches':True,'current_observation_id':uid(31)}}
  self.observations={uid(30):{'id':uid(30),'release_id':uid(10),'collector':'fixture-trusted','evidence_ref':'uninitialized'},uid(31):{'id':uid(31),'release_id':uid(13),'collector':'fixture-trusted','evidence_ref':'current-runtime-fixture'}}
  self.calls=[]
  def request(path):
   self.calls.append(path);parts=path.split('/');rid=parts[4]
   if path.endswith('/gate'):return self.gates[rid]
   if '/observations/' in path:return {'observation':self.observations[parts[-1]]}
   return {'release':self.releases[rid]}
  self.io.brain_read=request;self.request=request
 def method_module(self):return load(self.runtime/'wf-method.py','fixture_method')
 def attest(self):
  observed=self.method_module().collect(self.manifest,self.home)
  ref='commander-method-v1:'+canonical({k:observed['method_instance'][k] for k in ('physical_host','method_root','manifest_sha256','resolved_bindings_sha256','installation_sha256')})
  self.observations[uid(30)]['evidence_ref']=ref
  return observed
 def test_current_ready_cannot_load_independent_method_without_new_protocol(self):
  # old ready误把旧business release当当前bundle release；新ready应分别核两套实物。
  self.attest();result=self.io.ready(self.envelope)
  self.assertTrue(result['ready']);self.assertEqual(result['release_id'],uid(10))
  expected=digest({'protocol':'commander-composition-v1','supervisor_runtime_sha256':self.envelope['method_selection']['supervisor_definition']['runtime_snapshot_sha256'],'method_manifest_sha256':digest(self.manifest),'resolved_bindings_sha256':digest(self.instance['resolved_bindings'])})
  self.assertEqual(result['runtime_snapshot_sha256'],expected)
  self.assertIn('/api/brain/releases/'+uid(13)+'/gate',self.calls);self.assertIn('/api/brain/releases/'+uid(10)+'/gate',self.calls)
 def test_drift_forgery_symlink_and_current_helper_are_rejected(self):
  self.attest()
  mutations=[lambda e:e['method_selection']['method_instance'].update(target='mmv'),lambda e:e['method_selection']['method_instance'].update(physical_host='xian-m4'),lambda e:e['method_selection']['method_instance'].update(method_root=str(self.runtime)),lambda e:e['method_selection']['method_instance']['resolved_bindings'][0].update(absolute_path=str(self.runtime/'wf-report.py')),lambda e:e['definition'].update(runtime_snapshot_sha256='0'*64)]
  for mutate in mutations:
   e=copy.deepcopy(self.envelope);mutate(e)
   with self.assertRaises(ValueError):self.io.ready(e)
  path=self.root/PATH;path.write_bytes(b'wrong')
  with self.assertRaises(ValueError):self.io.ready(self.envelope)
  path.unlink();path.symlink_to(self.runtime/'wf-report.py')
  with self.assertRaises(ValueError):self.io.ready(self.envelope)
 def test_ever_deployed_or_changed_observation_is_not_current(self):
  self.attest()
  for rid in (uid(10),uid(13)):
   old=copy.deepcopy(self.gates[rid]);self.gates[rid].update(deployed=False,ever_deployed=True)
   with self.assertRaises(ValueError):self.io.ready(self.envelope)
   self.gates[rid]=dict(old,current_observation_id=uid(99))
   with self.assertRaises(ValueError):self.io.ready(self.envelope)
   self.gates[rid]=old
 def test_original_input_budget_and_policy_cannot_expand(self):
  self.attest()
  for field,value in [('deadline_at','2099-01-01T00:00:00Z'),('cleanup_deadline_at','2099-01-01T00:00:00Z'),('input_sha256','0'*64)]:
   e=copy.deepcopy(self.envelope);e[field]=value
   with self.assertRaises(ValueError):self.io.ready(e)
  e=copy.deepcopy(self.envelope);e['contract']['recovery']['max_attempts']=99
  with self.assertRaises(ValueError):self.io.ready(e)
 def test_resolver_executes_historical_bytes_with_literal_args(self):
  self.attest();m=self.method_module();self.envelope['definition']['runtime_snapshot_sha256']=self.io.ready(self.envelope)['runtime_snapshot_sha256']
  result=m.execute(self.envelope,{'source_path':PATH,'args':['中文\n$() `literal`']},self.io.ready)
  self.assertEqual(result['exit_code'],0);out=json.loads(result['stdout']);self.assertEqual(out,{'method':'historical-fixture','args':['中文\n$() `literal`']})
  self.assertEqual(result['binding']['absolute_path'],str(self.root/PATH))
  with self.assertRaises(ValueError):m.resolve(self.envelope,'/tmp/not-a-binding',self.io.ready)
  with self.assertRaises(ValueError):m.resolve(self.envelope,'services/phone-adb-controller/commander/../wf-report.py',self.io.ready)
 def test_full_closure_not_activity_mix_and_safety_shell_cannot_roll_back(self):
  self.attest();m=self.method_module()
  for mutation in (lambda r:r['payload']['activities'].clear(),lambda r:r['payload']['components'].pop(),lambda r:r['payload']['workflows'].append(copy.deepcopy(self.w))):
   r=copy.deepcopy(self.method);mutation(r)
   with self.assertRaises(ValueError):m.manifest_for(r)
  r=copy.deepcopy(self.method);r['payload']['activities'][0]['payload']['implementation_bindings'][0].pop('repo')
  self.assertEqual(m.manifest_for(r),self.manifest,'historical normalized binding inherits only its source repo')
 def test_real_installer_reads_fixed_git_objects_and_keeps_current_unchanged(self):
  installer=load(SOURCE/'method-package.py','fixture_installer')
  source=self.home/'source';source.mkdir();subprocess.run(['git','init','-q',str(source)],check=True)
  file=source/PATH;file.parent.mkdir(parents=True);file.write_bytes(self.code)
  for args in (['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture source']):subprocess.run(['git','-C',str(source),*args],check=True)
  sha=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
  r=copy.deepcopy(self.method)
  for row in r['payload']['workflows']+r['payload']['activities']:row['source_commit']=sha
  for b in r['payload']['activities'][0]['payload']['implementation_bindings']:b['revision']=sha
  for b in r['payload']['components']:b['revision']=sha
  m=self.method_module();manifest=m.manifest_for(r);r['target']='mmv--method--'+digest(manifest);self.releases[r['id']]=r
  current=(self.runtime/'wf-report.py').read_bytes();observed=installer.install(r['id'],source,self.home,self.request)
  root=pathlib.Path(observed['method_instance']['method_root']);self.assertNotEqual(root,self.root);self.assertEqual((root/PATH).read_bytes(),self.code)
  self.assertEqual((self.runtime/'wf-report.py').read_bytes(),current);self.assertEqual(installer.install(r['id'],source,self.home,self.request),observed)
  self.assertEqual((root/PATH).stat().st_mode&0o222,0)

if __name__=='__main__':unittest.main(verbosity=2)
