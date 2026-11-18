import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-host-tools.json',import.meta.url)));
const fixture102=JSON.parse(readFileSync(new URL('./fixtures/activity-host-102.json',import.meta.url)));
const fixture103=JSON.parse(readFileSync(new URL('./fixtures/activity-host-103.json',import.meta.url)));
const helper=new URL('../activity-host-tools.py',import.meta.url).pathname;
function probe(mode='normal',workflow='101'){
 const root=mkdtempSync(join(tmpdir(),'activity-host-tools-'));
 try{
 const script=String.raw`import pathlib,sys,json,time,types,importlib.util,contextlib,io,hashlib,os,gc
p=pathlib.Path(sys.argv[1]);helper=pathlib.Path(sys.argv[2]);mode=sys.argv[3];workflow=sys.argv[4];base=p/'base';base.mkdir();packet=json.load(sys.stdin)
for name,item in packet['files'].items():
 assert hashlib.sha256(item['source'].encode()).hexdigest()==item['sha256'];(base/name).parent.mkdir(parents=True,exist_ok=True);(base/name).write_text(item['source'])
c={'assigned_workflow':workflow,'source_commit':'a'*40,'profile':'fixture-phone','node':'node','max_candidates':1,'comment_limit':1,'line':'fixture','tasks':{workflow:{'task_id':'task','run_id':'run','run_tag':'fixture-new-run'}},'verification':{'policy_version':35,'102':{'video_ids':['7711111111111111111'],'qualification_input':{'video_id':'7711111111111111111','coverage':{'kind':'full_video','source_duration_display_seconds':37,'capture_max_seconds':120,'max_capture_sessions':1,'max_asr_calls':1,'max_judge_primary_calls':1}}}},'business_deadline_ms':time.time()*1000+10000,'cleanup_deadline_ms':time.time()*1000+10000}
if workflow=='103':c['verification']['103']={'input_mode':'committed_partial_ids','comment_ids':['11111111-1111-4111-8111-111111111111'],'sources':{'11111111-1111-4111-8111-111111111111':'fixture-source-102'}}
proof=p/'host-proof.json';c['verification']['proof_manifest_path']=str(proof);proof.write_text(json.dumps({'schema':'activity-evidence/v1','identity':{**c['tasks'][workflow],'workflow':workflow}}));proof.chmod(0o600)
target=p/'candidate'
if helper.exists():
 spec=importlib.util.spec_from_file_location('assembler',helper);a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
 if workflow in ['102','103']:
  import inspect,shutil
  if 'workflow' in inspect.signature(a.assemble).parameters and (workflow=='102' or hasattr(a,'BASE_SHA103')):a.assemble(base,target,workflow=workflow,context=c)
  else:shutil.copytree(base,target)
 else:a.assemble(base,target)
else:
 import shutil
 shutil.copytree(base,target)
sys.path.insert(0,str(target));transport=types.ModuleType('local_transport')
def forbidden(*a):raise AssertionError('external transport is forbidden')
transport.local_command=forbidden;transport.pinned_transport=forbidden;sys.modules['local_transport']=transport
activity='mark_leads' if workflow=='103' else ('dedup' if workflow=='102' else 'collect_videos')
(target/'context.json').write_text(json.dumps(c));(target/'input.json').write_text(json.dumps({'activity_key':activity,'identity':c['tasks'][workflow]}));os.environ['COMMANDER_ACTIVITY_INPUT_FILE']=str(target/'input.json');os.environ['COMMANDER_ACTIVITY_KEY']=activity
if mode=='proof-removed':proof.unlink()
if mode=='context-drift':
 if workflow=='103':c['verification']['103']['sources']['11111111-1111-4111-8111-111111111111']='changed-source'
 else:c['verification']['102']['qualification_input']['coverage']['source_duration_display_seconds']=38
 (target/'context.json').write_text(json.dumps(c))
spec=importlib.util.spec_from_file_location('host',target/'tools.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.task_authority=lambda c:None;calls={'dispatch':0,'credentials':0,'resource':0}
def resource(c):calls['resource']+=1
def environment(c):calls['credentials']+=1;return {}
def dispatch(*args,**kw):
 calls['dispatch']+=1
 if mode=='after-dispatch':raise ValueError('BUSINESS_ACTIVITY_SCOPE')
 if mode=='network':raise OSError('network')
 return {'exit_code':0,'data':{'fixture':True}}
m.resource_authority=resource;m.environment=environment;m.subprocess.run=dispatch
if mode=='same-text':m.invoke=lambda *args:(_ for _ in ()).throw(ValueError('BUSINESS_ACTIVITY_SCOPE'))
if mode=='persist-failure':
 original=m.atomic
 def atomic(path,value):
  if value.get('state')=='terminal':raise OSError('disk')
  original(path,value)
 m.atomic=atomic
def call(name,op):
 value={'op':op}
 if mode.startswith('metrics-'):
  value={'op':mode[8:],'video':{'video_id':'7711111111111111111','video_url':'https://www.douyin.com/video/7711111111111111111'}}
  if name=='corrected':value['video']['metrics']={'schema':'test-opaque-original','evidence':{'xml':'fixture original XML'},'digest':'a'*64}
 sys.argv=['tools','business',name,json.dumps(value)];out=io.StringIO();error=None;rc=None
 try:
  with contextlib.redirect_stdout(out):rc=m.main()
 except Exception as e:error=type(e).__name__+':'+str(e)
 gc.collect();f=target/'receipts'/(name+'.json')
 return {'rc':rc,'stdout':out.getvalue(),'error':error,'receipt':json.loads(f.read_text()) if f.exists() else None}
good='score_readback' if workflow=='103' else 'inspect_videos'
first=call('first','company_config' if mode in ['normal','persist-failure'] else good);before=dict(calls)
replay=call('first','company_config' if mode in ['normal','persist-failure'] else good)
second=call('corrected',good)
corrected_replay=call('corrected','inspect_videos') if mode.startswith('metrics-') else None
print(json.dumps({'first':first,'before':before,'replay':replay,'second':second,'corrected_replay':corrected_replay,'calls':calls,'instructions':(target/'TOOLS.txt').read_text() if (target/'TOOLS.txt').exists() else '', 'original':(target/'TOOLS-base.txt').read_text() if (target/'TOOLS-base.txt').exists() else '', 'tools':(target/'tools.py').read_text()}))`;
 const r=spawnSync('/usr/bin/python3',['-c',script,root,helper,mode,workflow],{input:JSON.stringify(workflow==='103'?fixture103:(workflow==='102'?fixture102:fixture)),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('real assembled collect host emits typed company_config rejection and only dispatches corrected new action',()=>{
 const r=probe();assert.equal(r.first.rc,2,r.first.error);const v=JSON.parse(r.first.stdout);
 assert.equal(v.state,'terminal');assert.equal(v.result.error,'BUSINESS_ACTIVITY_SCOPE');assert.equal(v.result.data.dispatched,false);assert.equal(v.result.data.external_effect,'none');
 assert.deepEqual(v.result.data.allowed_operations,['discover','discover_readback','inspect_videos']);assert.match(v.result.data.tool_hint,/当前Activity为collect_videos/);assert.doesNotMatch(v.result.data.tool_hint,/preflight从brain/);assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0});
 assert.equal(r.replay.stdout,r.first.stdout);assert.equal(r.second.rc,0);assert.deepEqual(r.calls,{dispatch:1,credentials:1,resource:1});
 assert.ok(r.instructions.startsWith(fixture.files['TOOLS.txt'].source));assert.match(r.instructions,/collect_videos允许操作：discover, discover_readback, inspect_videos/);assert.match(r.instructions,/101.*company_config.*preflight/);
});
for(const op of ['discover','discover_readback'])test(`101 ${op} missing metrics is rejected before dispatch and exact supplied metrics correction dispatches once`,()=>{
 const r=probe('metrics-'+op),v=JSON.parse(r.first.stdout);
 assert.equal(r.first.rc,2);assert.equal(v.result.error,'METRICS_OBSERVATION_REQUIRED');assert.equal(v.result.data.dispatched,false);assert.equal(v.result.data.external_effect,'none');assert.deepEqual(v.result.data.required_fields,['video.metrics']);
 assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0});assert.equal(r.replay.stdout,r.first.stdout);
 assert.equal(r.second.rc,0);assert.deepEqual(r.calls,{dispatch:1,credentials:1,resource:1});assert.equal(r.corrected_replay.stdout,r.second.stdout);
 const corrected=JSON.parse(r.second.receipt.binding.args[0]);assert.equal(corrected.op,op);assert.deepEqual(corrected.video.metrics,{schema:'test-opaque-original',evidence:{xml:'fixture original XML'},digest:'a'.repeat(64)});
 assert.match(r.instructions,/discover.*discover_readback.*video\.metrics/);
});
test('102 typed host retains COS and original methods while rendering current input without historical execution claims',()=>{
 const r=probe('normal','102');assert.notEqual(r.first.stdout,'',r.first.error);const v=JSON.parse(r.first.stdout);
 assert.equal(v.result.error,'BUSINESS_ACTIVITY_SCOPE');assert.equal(v.result.data.dispatched,false);
 assert.deepEqual(v.result.data.allowed_operations,['claim_videos','inspect_videos','renew_video']);assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0});
 assert.equal(r.replay.stdout,r.first.stdout);assert.equal(r.second.rc,0);assert.deepEqual(r.calls,{dispatch:1,credentials:1,resource:1});
 assert.equal(r.original,fixture102.files['TOOLS.txt'].source);assert.match(r.tools,/COS_SECRET_ID/);assert.match(r.tools,/COS_SECRET_KEY/);
 assert.match(r.instructions,/7711111111111111111/);assert.match(r.instructions,/37/);assert.match(r.instructions,/fixture-new-run/);assert.match(r.instructions,/a{40}/);
 for(const old of ['7707600173446204723','原97e','r7原件','caa47f8ba3ae','00:58','至少14秒','约90秒墙钟'])assert.ok(!r.instructions.includes(old),old);
 for(const needed of ['started_at_epoch_seconds','recipientEvidence','record-status','swipe-evidence','ffprobe','单次ASR','unknown','cleanup','no_active_capture'])assert.ok(r.instructions.includes(needed),needed);
});
for(const mode of ['same-text','after-dispatch','network','persist-failure'])test(`102 ${mode} remains unknown without dispatch replay`,()=>{
 const r=probe(mode,'102');assert.equal(r.first.stdout,'');assert.equal(r.first.receipt.state,'unknown');assert.deepEqual(r.calls,r.before);assert.match(r.second.error,/PRIOR_ACTION_UNKNOWN/);
});
test('102 runtime rejects changed rendered context before dispatch',()=>{
 const r=probe('context-drift','102');assert.equal(r.first.stdout,'');assert.match(r.first.error,/ACTIVITY_HOST_METHOD_INPUT_CHANGED/);assert.equal(r.calls.dispatch,0);
});
test('102 rendering rejects recovery scopes, multiple videos and nonnumeric provider budgets',()=>{
 const script=String.raw`import importlib.util,json,sys,copy
s=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
c={'assigned_workflow':'102','source_commit':'a'*40,'profile':'fixture','comment_limit':1,'tasks':{'102':{'run_tag':'fixture'}},'verification':{'policy_version':34,'102':{'video_ids':['7711111111111111111'],'qualification_input':{'video_id':'7711111111111111111','coverage':{'kind':'full_video','source_duration_display_seconds':37,'capture_max_seconds':120,'max_capture_sessions':1,'max_asr_calls':1,'max_judge_primary_calls':1}}}}}
for mode in ['recovery','multiple','zero','bool']:
 v=copy.deepcopy(c)
 if mode=='recovery':v['recovery']={'mode':'qualification-readonly-v1'}
 if mode=='multiple':v['verification']['102']['video_ids'].append('7722222222222222222')
 if mode=='zero':v['verification']['102']['qualification_input']['coverage']['max_asr_calls']=0
 if mode=='bool':v['verification']['102']['qualification_input']['coverage']['max_asr_calls']=True
 try:m.method_input102(v)
 except ValueError:continue
 raise AssertionError(mode+' incorrectly accepted')
print('rejected')`;
 const r=spawnSync('/usr/bin/python3',['-c',script,helper],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'rejected');
});
for(const mode of ['same-text','after-dispatch','network','persist-failure'])test(`real assembled ${mode} remains unknown`,()=>{
 const r=probe(mode);assert.equal(r.first.stdout,'');assert.ok(r.first.error);assert.equal(r.first.receipt.state,'unknown');
 if(['after-dispatch','network'].includes(mode))assert.equal(r.calls.dispatch,1);assert.deepEqual(r.calls,r.before);assert.match(r.replay.error,/ACTION_UNKNOWN_NO_REPLAY/);assert.match(r.second.error,/PRIOR_ACTION_UNKNOWN/);
});

test('103 real host preserves dedicated methods and freezes exact current comment provenance',()=>{
 const r=probe('normal','103');assert.notEqual(r.first.stdout,'');const v=JSON.parse(r.first.stdout);
 assert.equal(v.result.error,'BUSINESS_ACTIVITY_SCOPE');assert.equal(v.result.data.dispatched,false);assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0});assert.equal(r.replay.stdout,r.first.stdout);assert.equal(r.second.rc,0);assert.equal(r.calls.dispatch,1);
 assert.equal(r.original,fixture103.files['TOOLS.txt'].source);assert.ok(r.instructions.startsWith(r.original));assert.match(r.instructions,/11111111-1111-4111-8111-111111111111/);assert.match(r.instructions,/fixture-source-102/);assert.match(r.instructions,/fixture-new-run/);assert.doesNotMatch(r.instructions,/6ced59bd|cloud102-20261118|录制|capture上限/);
});
for(const mode of ['same-text','after-dispatch','network','persist-failure'])test(`103 ${mode} remains unknown without dispatch replay`,()=>{
 const r=probe(mode,'103');assert.equal(r.first.stdout,'');assert.equal(r.first.receipt.state,'unknown');assert.deepEqual(r.calls,r.before);assert.match(r.second.error,/PRIOR_ACTION_UNKNOWN/);
});
test('103 rejects changed source mapping before dispatch',()=>{
 const r=probe('context-drift','103');assert.equal(r.first.stdout,'');assert.match(r.first.error,/ACTIVITY_HOST_METHOD_INPUT_CHANGED/);assert.equal(r.calls.dispatch,0);
});

test('103 source drift and recovery or inconsistent comment provenance cannot assemble',()=>{
 const root=mkdtempSync(join(tmpdir(),'activity-host-103-negative-'));
 try{
 const script=String.raw`import importlib.util,json,sys,pathlib,copy
s=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=pathlib.Path(sys.argv[2]);base=r/'base';base.mkdir();packet=json.load(sys.stdin)
for name,v in packet['files'].items():(base/name).write_text(v['source'])
u='11111111-1111-4111-8111-111111111111'
c={'assigned_workflow':'103','source_commit':'a'*40,'comment_limit':1,'max_candidates':1,'tasks':{'103':{'task_id':'task','run_id':'run','run_tag':'fixture-new'}},'verification':{'policy_version':34,'103':{'input_mode':'committed_partial_ids','comment_ids':[u],'sources':{u:'fixture-upstream'}}}}
for mode in ['source','recovery','mapping','multiple','same-run']:
 v=copy.deepcopy(c);out=r/mode
 if mode=='source':(base/'tools.py').write_text('changed')
 if mode=='recovery':v['recovery']={'mode':'readonly'}
 if mode=='mapping':v['verification']['103']['sources']={}
 if mode=='multiple':v['verification']['103']['comment_ids'].append(u)
 if mode=='same-run':v['verification']['103']['sources'][u]='fixture-new'
 try:m.assemble(base,out,workflow='103',context=v)
 except ValueError as e:
  assert not out.exists()
  if mode=='source':assert str(e)=='ACTIVITY_HOST_BASE_SOURCE_CHANGED'
 else:raise AssertionError(mode+' accepted')
 (base/'tools.py').write_text(packet['files']['tools.py']['source'])
print('rejected')`;
 const r=spawnSync('/usr/bin/python3',['-c',script,helper,root],{input:JSON.stringify(fixture103),encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'rejected');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('host launch verification rejects removed external proof before tool dispatch',()=>{
 const r=probe('proof-removed');assert.equal(r.first.stdout,'');assert.match(r.first.error,/ACTIVITY_HOST_PROOF_MISSING/);assert.equal(r.calls.dispatch,0);
});
test('assembly validates configured proof without requiring it for proof-free workflows',()=>{
 const root=mkdtempSync(join(tmpdir(),'activity-host-proof-'));
 try{
 const script=String.raw`import importlib.util,json,sys,pathlib,copy
s=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=pathlib.Path(sys.argv[2]);base=r/'base';base.mkdir();packet=json.load(sys.stdin)
for name,v in packet['files'].items():(base/name).write_text(v['source'])
identity={'task_id':'real-test-task','run_id':'real-test-run','run_tag':'real-test-tag','workflow':'101'}
proof=r/'proof.json';c={'assigned_workflow':'101','tasks':{'101':{k:v for k,v in identity.items() if k!='workflow'}},'verification':{'proof_manifest_path':str(proof)}}
for mode in ['missing','mismatch']:
 if mode=='mismatch':proof.write_text(json.dumps({'schema':'activity-evidence/v1','identity':{**identity,'run_id':'wrong'}}));proof.chmod(0o600)
 target=r/mode
 try:m.assemble(base,target,context=c)
 except ValueError as e:assert 'ACTIVITY_HOST_PROOF_' in str(e)
 else:raise AssertionError(mode+' proof accepted')
 assert not target.exists()
existing={'schema':'activity-evidence/v1','identity':identity,'qualification_evidence':{'opaque_original_reference':'preserved_not_claimed_passed'}}
proof.write_text(json.dumps(existing));proof.chmod(0o600);before=proof.read_bytes();m.assemble(base,r/'valid',context=c);assert proof.read_bytes()==before
no_proof=copy.deepcopy(c);no_proof['verification'].pop('proof_manifest_path');m.assemble(base,r/'proof-free',context=no_proof)
host=r/'internal-host';host.mkdir();(host/'proof.json').write_bytes(proof.read_bytes());(host/'proof.json').chmod(0o600)
alias=r/'host-alias';alias.symlink_to(host,target_is_directory=True)
inside=copy.deepcopy(c);inside['verification']['proof_manifest_path']=str(alias/'proof.json')
try:m.verify_proof_manifest(inside,host)
except ValueError as e:assert str(e)=='ACTIVITY_HOST_PROOF_PATH'
else:raise AssertionError('parent symlink into host accepted')
print('verified_no_overwrite')`;
 const r=spawnSync('/usr/bin/python3',['-c',script,helper,root],{input:JSON.stringify(fixture),encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'verified_no_overwrite');
 }finally{rmSync(root,{recursive:true,force:true});}
});
