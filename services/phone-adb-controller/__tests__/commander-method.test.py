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
 def repack(self, files):
  bindings=[dict(self.binding,path=path,digest='sha256:'+digest(raw)) for path,raw in sorted(files.items())]
  self.manifest['bindings']=bindings;self.method['payload']['components']=[{'kind':'repo','repo':REPO,'revision':'a'*40},*bindings]
  self.a['payload']['implementation_bindings']=[dict(b,status='verified',scope='activity') for b in bindings]
  mh=digest(self.manifest);self.root=self.home/'.local/share/zenithjoy/commander-methods'/mh;self.root.mkdir(parents=True)
  for path,raw in files.items():
   p=self.root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
  self.io.write(self.root/'method-manifest.json',self.manifest)
  self.instance={'physical_host':'mmv','target':'mmv--method--'+mh,'method_root':str(self.root),'manifest_sha256':mh,'resolved_bindings':[dict(b,absolute_path=str(self.root/b['path'])) for b in bindings]}
  self.envelope['method_selection']['method_instance']=self.instance;self.method['target']=self.instance['target'];self.method['manifest_sha256']=digest({k:self.method[k] for k in ('environment','target','payload')})
 def test_launch_claim_and_child_request_use_method_context_and_preserve_original_failure(self):
  self.attest();core=load(self.runtime/'wf-v2.py','fixture_core');core.io=self.io
  file=self.home/'method-envelope.json';self.io.write(file,self.envelope)
  with patch.dict(os.environ,WF_V2_NO_WORKER='1'):
   with self.assertRaises(ValueError):core.launch(str(file),'agent:work-commander:method-fixture')
   self.assertFalse((self.home/'wf-agent-runs'/self.envelope['run_id']).exists())
   self.envelope['definition']['runtime_snapshot_sha256']=self.io.ready(self.envelope)['runtime_snapshot_sha256']
   self.io.write(file,self.envelope);result=core.launch(str(file),'agent:work-commander:method-fixture')
   self.assertEqual(result['action'],'claim_spawn');directory=self.home/'wf-agent-runs'/self.envelope['run_id']
   request=self.io.read(directory/'agent-request.json');context=self.io.read(directory/'method-context.json')
   self.assertEqual(context['method_selection'],self.envelope['method_selection']);self.assertEqual(context['execution']['tool'],'gateway_exec')
   self.assertEqual(request['execution_location']['method_context'],str(directory/'method-context.json'))
   message=(directory/'msg.txt').read_text();self.assertIn('wf-method.py execute',message);self.assertIn('不要求业务子会话调用session_status',message)
   core.launch(str(file),'agent:work-commander:method-fixture');self.assertEqual(self.io.read(directory/'agent-request.json'),request)
   previous=self.gates[uid(10)]['deployed'];self.gates[uid(10)]['deployed']=False
   with self.assertRaises(ValueError):core.claim(directory)
   self.assertFalse((directory/'spawn-claimed.json').exists());self.gates[uid(10)]['deployed']=previous
   claim=core.claim(directory);self.assertEqual(claim['request']['nonce'],request['nonce'])
   with self.assertRaises(ValueError):core.claim(directory)
   core.failed_delivery(directory,self.envelope,'child_blocked: unavailable_tool')
   delivery=self.io.read(directory/'delivery.json');self.assertEqual(delivery['status'],'failed')
   self.assertEqual(delivery['failure'],'child_blocked: unavailable_tool');self.assertEqual(delivery['definition'],self.envelope['definition']);self.assertEqual(delivery['input'],self.envelope['input'])
 def test_new_attempt_directory_conflict_or_alias_never_overwrites_original_evidence(self):
  self.attest();self.envelope['definition']['runtime_snapshot_sha256']=self.io.ready(self.envelope)['runtime_snapshot_sha256']
  core=load(self.runtime/'wf-v2.py','fixture_isolation');core.io=self.io
  runs=self.home/'wf-agent-runs';runs.mkdir();old=runs/'wfd-failed';old.mkdir();evidence=old/'report.json';evidence.write_bytes(b'original failure evidence')
  original=digest(evidence.read_bytes());new=runs/self.envelope['run_id'];file=self.home/'envelope.json';self.io.write(file,self.envelope)
  with patch.dict(os.environ,WF_V2_NO_WORKER='1'):
   new.symlink_to(old)
   with self.assertRaises(ValueError):core.launch(str(file),'agent:work-commander:method-fixture')
   self.assertEqual(digest(evidence.read_bytes()),original);self.assertFalse((old/'agent-request.json').exists());new.unlink()
   new.mkdir();(new/'unexpected.json').write_text('preexisting artifact')
   with self.assertRaises(ValueError):core.launch(str(file),'agent:work-commander:method-fixture')
   self.assertFalse((new/'agent-request.json').exists());self.assertEqual((new/'unexpected.json').read_text(),'preexisting artifact')
   shutil.rmtree(new);core.launch(str(file),'agent:work-commander:method-fixture')
   self.assertNotEqual(new.resolve(),old.resolve());self.assertEqual(digest(evidence.read_bytes()),original)
 def test_method_cli_uses_only_persisted_run_envelope_and_input(self):
  m=self.method_module();directory=self.home/'wf-agent-runs'/self.envelope['run_id'];directory.mkdir(parents=True)
  for name,value in [('envelope.json',self.envelope),('input.json',self.envelope['input']),('contract.json',self.envelope['contract'])]:self.io.write(directory/name,value)
  self.assertEqual(m.read_bound_envelope(directory/'envelope.json',self.io),self.envelope)
  copied=self.home/'copied.json';self.io.write(copied,self.envelope)
  with self.assertRaises(ValueError):m.read_bound_envelope(copied,self.io)
  self.io.write(directory/'input.json',{'changed':True})
  with self.assertRaises(ValueError):m.read_bound_envelope(directory/'envelope.json',self.io)
 def test_indirect_global_command_and_dynamic_import_routes_are_not_admitted(self):
  sources=[b'import os; os.system("true")',b'from os import system as call; call("true")',b'import os; os.popen("true").read()',b'import runpy; runpy.run_path("/current/helper.py")',b'import os; f=getattr(os,"system");f("true")',b'import sys;sys.path.append("/current");import json']
  for raw in sources:
   self.repack({PATH:raw})
   with self.assertRaises(ValueError):self.attest()
 def test_different_historical_business_bytes_with_identical_current_safety_are_admitted(self):
  safety='services/phone-adb-controller/commander/wf-v2-phone.py';raw=(self.runtime/'wf-v2-phone.py').read_bytes()
  self.assertNotEqual((self.runtime/'wf-report.py').read_bytes(),self.code)
  self.repack({PATH:self.code,safety:raw});self.attest()
  # 当前supervisor的真实meta闭包明确绑定该安全code，聚合业务helper不混入安全集合。
  binding=dict(self.binding,path=safety,digest='sha256:'+digest(raw),status='verified',scope='activity',field='implementation')
  self.supervisor['payload']['activities'][0]['payload']['implementation_bindings']=[binding]
  self.supervisor['payload']['components']=[{'kind':'repo','repo':REPO,'revision':'a'*40},{k:binding[k] for k in ('kind','repo','path','revision','digest')}]
  self.supervisor['manifest_sha256']=digest({k:self.supervisor[k] for k in ('environment','target','payload')})
  result=self.io.ready(self.envelope);self.assertTrue(result['ready'])
  self.supervisor['payload']['activities'][0]['payload']['implementation_bindings']=[]
  self.supervisor['manifest_sha256']=digest({k:self.supervisor[k] for k in ('environment','target','payload')})
  with self.assertRaises(ValueError):self.io.ready(self.envelope)

 def test_historical_business_skill_with_bare_global_command_is_rejected_mechanically(self):
  path='skills/business/SKILL.md';raw=b'---\nname: business\nversion: 1.0.0\n---\n```sh\npython3 ~/.openclaw/commander/not-frozen.py\n```\n'
  self.repack({path:raw})
  for rows in (self.manifest['bindings'],self.method['payload']['components'],self.a['payload']['implementation_bindings']):
   for b in rows:
    if b.get('path')==path:b['kind']='skill'
  m=self.method_module()
  with self.assertRaisesRegex(ValueError,'unsupported_method_skill'):m.dependencies(self.manifest,self.root)
  with self.assertRaisesRegex(ValueError,'unsupported_method_skill'):m.manifest_for(self.method)
 def test_safety_skill_context_alone_cannot_be_a_business_method(self):
  path='services/phone-adb-controller/commander/skills/workflow-commander/SKILL.md';self.repack({path:(self.runtime/'skills/workflow-commander/SKILL.md').read_bytes()})
  for rows in (self.manifest['bindings'],self.method['payload']['components'],self.a['payload']['implementation_bindings']):
   for b in rows:
    if b.get('path')==path:b['kind']='skill'
  self.a['payload']['implementation_bindings'][0]['field']='implementation_bindings'
  with self.assertRaises(ValueError):self.method_module().manifest_for(self.method)
 def test_nested_skill_entries_are_rejected_and_default_recovery_is_not_budget_drift(self):
  m=self.method_module()
  for contract in [{'steps':[{'skill':'hidden'}]},{'implementation':{'kind':'skill'}},{'runtime':{'kind':'skill'}},{'activities':[{'steps':[{'implementation':{'kind':'skill'}}]}]}]:
   release=copy.deepcopy(self.method);release['payload']['activities'][0]['payload']['steps']=[{'contract':contract}]
   with self.assertRaisesRegex(ValueError,'unsupported_method_skill'):m.manifest_for(release)
  partial={'max_attempts':2,'retry_safe':True,'retry_on':['verification_failed']}
  self.contract['recovery']=copy.deepcopy(partial);self.original['payload']['workflows'][0]['payload']['contract']['recovery']=copy.deepcopy(partial)
  goal=self.envelope['method_selection']['original_goal_definition'];goal['contract']['recovery']=copy.deepcopy(partial)
  goal['recovery']={**partial,'total_timeout_sec':2400,'cleanup_timeout_sec':300}
  for r in (self.method,self.original):r['manifest_sha256']=digest({k:r[k] for k in ('environment','target','payload')})
  self.attest();self.assertTrue(self.io.ready(self.envelope)['ready'])
  goal['recovery']['total_timeout_sec']=2401
  with self.assertRaises(ValueError):self.io.ready(self.envelope)
 def test_brain_canonical_golden_numbers_keys_and_unicode(self):
  m=self.method_module()
  golden=json.loads((SOURCE/'__tests__/fixtures/commander-method-brain.json').read_text())
  for value,sha in [('manifest','manifest_sha256'),('resolved_bindings','resolved_bindings_sha256'),('composition','runtime_snapshot_sha256'),('input','input_sha256')]:self.assertEqual(m.digest(golden[value]),golden[sha])
  for row in json.loads((SOURCE/'__tests__/fixtures/commander-method-digests.json').read_text()):self.assertEqual(m.digest(json.loads(row['input'])),row['sha256'])
  for value in (float('nan'),float('inf'),-float('inf')):
   with self.assertRaises(ValueError):m.digest({'number':value})
 def test_relative_dependency_is_frozen_and_global_pollution_cannot_fill_a_gap(self):
  entry=b'import method_helper,json\nprint(json.dumps({"value":method_helper.VALUE}))\n';helper=PATH.rsplit('/',1)[0]+'/method_helper.py'
  self.repack({PATH:entry,helper:b'VALUE="frozen dependency"\n'});self.attest()
  poison=self.home/'global';poison.mkdir();(poison/'method_helper.py').write_text('VALUE="global poison"')
  self.envelope['definition']['runtime_snapshot_sha256']=self.io.ready(self.envelope)['runtime_snapshot_sha256']
  with patch.dict(os.environ,PYTHONPATH=str(poison)):
   result=self.method_module().execute(self.envelope,{'source_path':PATH,'args':[]},self.io.ready)
   self.assertEqual(json.loads(result['stdout'])['value'],'frozen dependency')
  self.repack({PATH:entry});self.envelope['definition']['runtime_snapshot_sha256']=None
  with self.assertRaises(ValueError):self.attest()
  with patch.dict(os.environ,PYTHONPATH=str(poison)):
   with self.assertRaises(ValueError):self.io.ready(self.envelope)
 def test_parent_symlink_and_current_workspace_drift_are_rejected(self):
  self.attest();parent=self.root.parent;backup=parent.with_name('saved');parent.rename(backup);parent.symlink_to(backup)
  with self.assertRaises(ValueError):self.io.ready(self.envelope)
  parent.unlink();backup.rename(parent)
  (self.home/'openclaw-root/workspaces-root/clawd-work-commander/skills/workflow-commander/SKILL.md').write_text('polluted workspace')
  with self.assertRaises(ValueError):self.io.ready(self.envelope)
 def test_different_safety_shell_and_ambiguous_binding_are_rejected(self):
  self.repack({PATH:self.code,'services/phone-adb-controller/commander/wf-v2-phone.py':b'old unsafe shell'});self.attest()
  with self.assertRaises(ValueError):self.io.ready(self.envelope)
  r=copy.deepcopy(self.method);b=copy.deepcopy(r['payload']['activities'][0]['payload']['implementation_bindings'][0]);b['digest']='sha256:'+'0'*64;r['payload']['activities'][0]['payload']['implementation_bindings'].append(b)
  with self.assertRaises(ValueError):self.method_module().manifest_for(r)
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
