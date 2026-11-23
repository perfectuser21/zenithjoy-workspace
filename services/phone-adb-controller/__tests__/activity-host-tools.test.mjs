import test from 'node:test';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-host-tools.json',import.meta.url)));
const fixture102=JSON.parse(readFileSync(new URL('./fixtures/activity-host-102.json',import.meta.url)));
const fixture103=JSON.parse(readFileSync(new URL('./fixtures/activity-host-103.json',import.meta.url)));
const diagnosticFixture=JSON.parse(readFileSync(new URL('./fixtures/activity-host-record-diagnostic.json',import.meta.url)));
const profile102=JSON.parse(readFileSync(new URL('../leadgen-foundation/profiles/102.json',import.meta.url)));
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
if mode.startswith('diagnostic-'):c['tasks'][workflow]['run_tag']=packet['diagnostic']['receipt']['binding']['identity']['run_tag']
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
if mode=='qualification-owned-readback':activity='qualification'
(target/'context.json').write_text(json.dumps(c));(target/'input.json').write_text(json.dumps({'activity_key':activity,'identity':c['tasks'][workflow]}));os.environ['COMMANDER_ACTIVITY_INPUT_FILE']=str(target/'input.json');os.environ['COMMANDER_ACTIVITY_KEY']=activity
if mode=='proof-removed':proof.unlink()
if mode=='context-drift':
 if workflow=='103':c['verification']['103']['sources']['11111111-1111-4111-8111-111111111111']='changed-source'
 else:c['verification']['102']['qualification_input']['coverage']['source_duration_display_seconds']=38
 (target/'context.json').write_text(json.dumps(c))
spec=importlib.util.spec_from_file_location('host',target/'tools.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
if mode=='reopen-video-scope':
 from tool_scope import phone_args
 c['local_owner']='fixture-owner'
 def probe_open(command,video,run_tag='fixture-new-run'):
  try:return phone_args(c,activity,[command,video,run_tag+'-reopen','unused','unused',run_tag+'-card'])
  except ValueError as exc:return str(exc)
 known='7711111111111111111';discovered='7722222222222222222'
 print(json.dumps({'known':probe_open('open-video',known),'discovered':probe_open('open-video',discovered),
                   'bad':probe_open('open-video','not-a-video-id'),'another_run':probe_open('open-video',known,'another-run'),
                   'card':probe_open('commenter-profile-card-link',discovered)}))
 sys.exit(0)
m.task_authority=lambda c,**kw:None;calls={'dispatch':0,'credentials':0,'resource':0}
def resource(c):calls['resource']+=1
def environment(c):calls['credentials']+=1;return {}
def dispatch(*args,**kw):
 calls['dispatch']+=1
 if mode=='after-dispatch':raise ValueError('BUSINESS_ACTIVITY_SCOPE')
 if mode=='network':raise OSError('network')
 if mode in ('qualification-owned-readback','dedup-normal-readback'):
  return {'exit_code':0,'data':{'flags':args[0][2:],'request':json.loads(kw['input'])}}
 return {'exit_code':0,'data':{'fixture':True}}
m.resource_authority=resource;m.environment=environment;m.subprocess.run=dispatch
if mode=='same-text':m.invoke=lambda *args:(_ for _ in ()).throw(ValueError('BUSINESS_ACTIVITY_SCOPE'))
if mode in ['persist-failure','fetch-persist-failure']:
 original=m.atomic
 def atomic(path,value):
  if value.get('state')=='terminal':raise OSError('disk')
  original(path,value)
 m.atomic=atomic
def call(name,op):
 value={'op':op}
 if mode in ('qualification-owned-readback','dedup-normal-readback'):
  value['video_ids']=['7711111111111111111']
 if mode.startswith('metrics-'):
  value={'op':mode[8:],'video':{'video_id':'7711111111111111111','video_url':'https://www.douyin.com/video/7711111111111111111'}}
  if name=='corrected':value['video']['metrics']={'schema':'test-opaque-original','evidence':{'xml':'fixture original XML'},'digest':'a'*64}
 sys.argv=['tools','business',name,json.dumps(value)];out=io.StringIO();error=None;rc=None
 try:
  with contextlib.redirect_stdout(out):rc=m.main()
 except Exception as e:error=type(e).__name__+':'+str(e)
 gc.collect();f=target/'receipts'/(name+'.json')
 return {'rc':rc,'stdout':out.getvalue(),'error':error,'receipt':json.loads(f.read_text()) if f.exists() else None}
if mode.startswith('diagnostic-'):
 raw=packet['diagnostic']['receipt'];original=raw['result'];args=list(raw['binding']['args']);c['tasks'][workflow]['run_tag']=raw['binding']['identity']['run_tag'];c['native_root']=packet['diagnostic']['native_root'];c['local_owner']='fixture-owner'
 # Keep the historical P4 fixture immutable; exercise its error format with today's admitted recording identity.
 historical_eid=args[1];args[1]=c['tasks'][workflow]['run_tag']+'-v7711111111111111111-capture'
 original={**original,'stderr':original['stderr'].replace(historical_eid,args[1])}
 activity='qualification';kind='phone'
 if mode=='diagnostic-wrong-activity':activity='cleanup'
 if mode=='diagnostic-other-command':args=['close-app']
 if mode=='diagnostic-wrong-run':args[1]='different-run-record'
 result=dict(original)
 if mode=='diagnostic-success':result['exit_code']=0
 if mode=='diagnostic-cross-path':result['stderr']=result['stderr'].replace(c['tasks'][workflow]['run_tag'],'another-run')
 if mode=='diagnostic-traversal':result['stderr']=result['stderr'].replace(c['native_root']+'/',c['native_root']+'/../')
 if mode=='diagnostic-secret':result['stderr']+='SECRET_TOKEN=fixture-secret\n'
 if mode=='diagnostic-unmatched':result['stderr']='private arbitrary stderr fixture-secret\n'
 if mode=='diagnostic-large':result['stdout']='x'*14000
 (target/'context.json').write_text(json.dumps(c));(target/'input.json').write_text(json.dumps({'activity_key':activity,'identity':c['tasks'][workflow]}));os.environ['COMMANDER_ACTIVITY_KEY']=activity
 m.ssh=lambda *args:['fixture-dispatch']
 def phone_dispatch(*a,**kw):calls['dispatch']+=1;return types.SimpleNamespace(returncode=result['exit_code'],stdout=result['stdout'],stderr=result['stderr'])
 m.subprocess.run=phone_dispatch
 if mode in ['diagnostic-existing-data','diagnostic-other-kind']:
  if mode=='diagnostic-existing-data':result['data']={'original':'preserved'}
  else:kind='business';args=[json.dumps({'op':'inspect_videos'})]
  m.invoke=lambda *a:result
 sys.argv=['tools',kind,'record-diagnostic',*args];out=io.StringIO();error=None;rc=None
 try:
  with contextlib.redirect_stdout(out):rc=m.main()
 except Exception as e:error=type(e).__name__+':'+str(e)
 gc.collect();f=target/'receipts/record-diagnostic.json'
 print(json.dumps({'rc':rc,'stdout':out.getvalue(),'error':error,'receipt':json.loads(f.read_text()) if f.exists() else None,'calls':calls}));sys.exit(0)
if mode.startswith('fetch-'):
 native=p/'native-source';native.mkdir();c.update(transport='local',native_root=str(native));(target/'context.json').write_text(json.dumps(c))
 source=native/'fixture-new-run-wrong.json';correct=native/'fixture-new-run-correct.json';correct.write_text('original evidence')
 if mode=='fetch-symlink':source.symlink_to(correct)
 elif mode=='fetch-directory':source.mkdir()
 elif mode in ['fetch-after-copy','fetch-untyped','fetch-timeout']:source.write_text('evidence')
 calls['copy']=0;m.pinned_transport=lambda c:None
 copy=m.shutil.copy2
 def copying(src,dst):
  calls['copy']+=1;copy(src,dst)
  if mode=='fetch-after-copy':src.write_text('changed after local write')
 m.shutil.copy2=copying
 if mode=='fetch-untyped':m.invoke=lambda *a:(_ for _ in ()).throw(ValueError('NATIVE_LOCAL_SOURCE'))
 if mode=='fetch-stat-error':
  original_lstat=pathlib.Path.lstat
  def lstat(self,*args,**kw):
   if self==source:raise PermissionError('fixture read failure')
   return original_lstat(self,*args,**kw)
  pathlib.Path.lstat=lstat
 if mode=='fetch-timeout':m.invoke=lambda *a:(_ for _ in ()).throw(m.subprocess.TimeoutExpired('read-only download',1))
 def fetch(name,filename):
  sys.argv=['tools','fetch-native',name,filename];out=io.StringIO();error=None;rc=None
  try:
   with contextlib.redirect_stdout(out):rc=m.main()
  except Exception as e:error=type(e).__name__+':'+str(e)
  gc.collect();receipt=target/'receipts'/(name+'.json')
  return {'rc':rc,'stdout':out.getvalue(),'error':error,'receipt':json.loads(receipt.read_text()) if receipt.exists() else None}
 first=fetch('first',source.name);before=dict(calls);replay=fetch('first',source.name);conflict=fetch('first',correct.name)
 second=fetch('corrected',correct.name);after=dict(calls)
 os.environ['COMMANDER_ACTIVITY_KEY']='cleanup';(target/'input.json').write_text(json.dumps({'activity_key':'cleanup','identity':c['tasks'][workflow]}))
 cleanup=call('cleanup','inspect_videos')
 print(json.dumps({'first':first,'before':before,'replay':replay,'conflict':conflict,'second':second,'after':after,'cleanup':cleanup,'calls':calls,'source':str(source),'native_target_exists':(target/'native'/source.name).exists(),'partial_exists':(target/'download-incomplete'/(source.name+'.download-part')).exists()}));sys.exit(0)
good='score_readback' if workflow=='103' else 'inspect_videos'
first=call('first','company_config' if mode in ['normal','persist-failure'] else good);before=dict(calls)
replay=call('first','company_config' if mode in ['normal','persist-failure'] else good)
second=call('corrected',good)
corrected_replay=call('corrected','inspect_videos') if mode.startswith('metrics-') else None
print(json.dumps({'first':first,'before':before,'replay':replay,'second':second,'corrected_replay':corrected_replay,'calls':calls,'instructions':(target/'TOOLS.txt').read_text() if (target/'TOOLS.txt').exists() else '', 'original':(target/'TOOLS-base.txt').read_text() if (target/'TOOLS-base.txt').exists() else '', 'tools':(target/'tools.py').read_text()}))`;
 const r=spawnSync('/usr/bin/python3',['-c',script,root,helper,mode,workflow],{input:JSON.stringify({... (workflow==='103'?fixture103:(workflow==='102'?fixture102:fixture)),diagnostic:diagnosticFixture}),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('101 reopens a newly discovered canonical video while 102 retains its frozen upstream scope',()=>{
 const discovery=probe('reopen-video-scope');
 assert.ok(Array.isArray(discovery.discovered),discovery.discovered);
 assert.equal(discovery.bad,'VIDEO_SCOPE');
 assert.equal(discovery.another_run,'EVIDENCE_RUN_SCOPE');
 assert.equal(discovery.card,'VIDEO_SCOPE');
 const processing=probe('reopen-video-scope','102');
 assert.ok(Array.isArray(processing.known));
 assert.equal(processing.discovered,'VIDEO_SCOPE');
});
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
 assert.doesNotMatch(r.instructions,/native_artifacts\.py|artifact_checker|gate-contract\.md/);
 assert.match(r.instructions,/collect_partial\.comments\[0\]传recipientEvidenceAction/);
 assert.doesNotMatch(r.instructions,/读该JSON并原样放/);
 assert.equal(r.original,fixture102.files['TOOLS.txt'].source);assert.match(r.tools,/COS_SECRET_ID/);assert.match(r.tools,/COS_SECRET_KEY/);
 assert.match(r.instructions,/7711111111111111111/);assert.match(r.instructions,/37/);assert.match(r.instructions,/fixture-new-run/);assert.match(r.instructions,/a{40}/);
 for(const old of ['7707600173446204723','原97e','r7原件','caa47f8ba3ae','00:58','至少14秒','约90秒墙钟'])assert.ok(!r.instructions.includes(old),old);
 for(const needed of ['started_at_epoch_seconds','recipientEvidence','record-status','swipe-evidence','ffprobe','单次ASR','unknown','cleanup','no_active_capture','video.last_pts_seconds','media_progress','同一次录制','不得换EID'])assert.ok(r.instructions.includes(needed),needed);
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
 assert.equal(r.original,fixture103.files['TOOLS.txt'].source);assert.ok(r.instructions.startsWith(r.original));assert.match(r.instructions,/11111111-1111-4111-8111-111111111111/);assert.match(r.instructions,/fixture-source-102/);assert.match(r.instructions,/fixture-new-run/);assert.doesNotMatch(r.instructions.split('手机工具统一使用')[0],/6ced59bd|cloud102-20261118|录制|capture上限/);
 assert.match(r.instructions,/不再按Activity列手机命令名单/);
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

for(const [mode,reason] of [['fetch-missing','not_found'],['fetch-symlink','symlink'],['fetch-directory','not_regular_file']])test(`local ${mode} rejects before copy with exact cause; replay immutable, correction new action and cleanup admitted`,()=>{
 const r=probe(mode,'102');assert.equal(r.first.rc,2,r.first.error);const v=JSON.parse(r.first.stdout);
 assert.equal(v.state,'terminal');assert.equal(v.result.error,'NATIVE_LOCAL_SOURCE');assert.equal(v.result.data.reason,reason);assert.equal(v.result.data.source_path,r.source);
 assert.equal(v.result.data.dispatched,false);assert.equal(v.result.data.external_effect,'none');assert.match(v.result.data.tool_hint,/新action/);
 assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0,copy:0});assert.equal(r.replay.stdout,r.first.stdout);assert.match(r.conflict.error,/ACTION_IDENTITY_CONFLICT/);
 assert.equal(r.second.rc,0,r.second.error);assert.equal(r.after.copy,1);assert.equal(r.after.dispatch,0);assert.equal(r.cleanup.rc,0,r.cleanup.error);assert.equal(r.calls.dispatch,1);
 assert.equal(r.native_target_exists,false);assert.equal(r.partial_exists,false);
});
for(const mode of ['fetch-after-copy','fetch-untyped','fetch-persist-failure'])test(`${mode} remains unknown; matching error text cannot grant deterministic rejection`,()=>{
 const r=probe(mode,'102');assert.equal(r.first.stdout,'');assert.equal(r.first.receipt.state,'unknown');assert.match(r.replay.error,/ACTION_UNKNOWN_NO_REPLAY/);assert.match(r.cleanup.error,/PRIOR_ACTION_UNKNOWN/);
 if(mode==='fetch-after-copy'){assert.equal(r.before.copy,1);assert.equal(r.partial_exists,true);}
});
test('existing read-only downloader timeout terminal semantics remain unchanged',()=>{
 const r=probe('fetch-timeout','102');assert.equal(r.first.rc,124);assert.equal(r.first.receipt.state,'terminal');assert.equal(r.first.receipt.result.error,'READ_ONLY_DOWNLOAD_TIMEOUT');assert.equal(r.first.receipt.result.artifact_usable,false);
});

test('source observation I/O error retains existing downloader error and is not relabeled missing',()=>{
 const r=probe('fetch-stat-error','102');assert.equal(r.first.rc,74);assert.equal(r.first.receipt.result.error,'READ_ONLY_DOWNLOAD_IO_ERROR');assert.equal(r.first.receipt.result.error_type,'PermissionError');assert.equal(r.first.receipt.result.data,undefined);assert.equal(r.before.copy,0);
});
test('local native source validator rejects an existing file outside the approved root without copying',()=>{
 const script=String.raw`import importlib.util,pathlib,tempfile,sys
s=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);outside=root/'other';outside.write_text('original');approved=root/'approved';approved.mkdir()
 try:m.require_local_native_source(outside,approved.resolve())
 except m.PreDispatchRejected as e:assert e.details['reason']=='outside_native_root';assert e.details['source_path']==str(outside)
 else:raise AssertionError('outside source accepted')
 assert outside.read_text()=='original';assert list(approved.iterdir())==[]`;
 const r=spawnSync('/usr/bin/python3',['-c',script,helper],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

function projectDiagnostic(value){
 const source=diagnosticFixture.project_source;
 assert.equal(createHash('sha256').update(source).digest('hex'),diagnosticFixture.provenance.project_sha256);
 return vm.runInNewContext('const json=JSON.stringify;const fail=r=>{throw Error(r)};'+source+';project(value,paths)',{Buffer,value,paths:profile102.profile.skill_runtime.host_tools.response_paths});
}
for(const mode of ['diagnostic-normal','diagnostic-large'])test(`P4 error format with an admitted EID ${mode} exposes only bounded filenames through pinned MCP projection`,()=>{
 const r=probe(mode,'102');assert.equal(r.rc,2,r.error);assert.equal(r.receipt.state,'terminal');assert.equal(r.receipt.result.exit_code,2);const original=diagnosticFixture.receipt,eid=original.binding.identity.run_tag+'-v7711111111111111111-capture';assert.equal(r.receipt.result.stderr,original.result.stderr.replaceAll(original.binding.args[1],eid));
 const projected=projectDiagnostic(JSON.parse(r.stdout)),data=projected['result.data'];
 assert.equal(data.error_code,'RECORD_AUDIO_CAPTURE_UNAVAILABLE');
 assert.equal(data.diagnostic_files.startup,eid+'.capture-startup.json');assert.equal(data.diagnostic_files.log,eid+'.rec.log');
 assert.equal(data.execution_stopped,undefined);assert.equal(data.retry_allowed,undefined);assert.equal(projected['result.stderr'],undefined);assert.equal(projected.stderr,undefined);assert.ok(Buffer.byteLength(JSON.stringify(projected))<32768);assert.equal(r.calls.dispatch,1);
 if(mode==='diagnostic-large')assert.equal(projected.large_result_saved,true);
});
for(const mode of ['diagnostic-wrong-activity','diagnostic-other-command','diagnostic-wrong-run','diagnostic-success','diagnostic-cross-path','diagnostic-traversal','diagnostic-secret','diagnostic-unmatched','diagnostic-other-kind','diagnostic-existing-data'])test(`${mode} does not create or leak native diagnostics`,()=>{
 const r=probe(mode,'102');if(r.stdout){const projected=projectDiagnostic(JSON.parse(r.stdout));assert.equal(projected['result.data']?.error_code,undefined);assert.equal(projected['result.data']?.diagnostic_files,undefined);assert.doesNotMatch(JSON.stringify(projected),/fixture-secret/);assert.equal(projected['result.stderr'],undefined);}
 if(mode==='diagnostic-existing-data')assert.deepEqual(r.receipt.result.data,{original:'preserved'});
});
test('different Workflow cannot acquire 102 native record diagnostic fields',()=>{
 const r=probe('diagnostic-normal','101');assert.equal(r.receipt.result?.data?.diagnostic_files,undefined);
});

test('assembled 102 only grants full result readback to the claimed qualification Activity',()=>{
 const qualification=probe('qualification-owned-readback','102');
 const dedup=probe('dedup-normal-readback','102');
 assert.equal(qualification.first.rc,0,qualification.first.error);
 assert.equal(dedup.first.rc,0,dedup.first.error);
 const scoped=qualification.first.receipt.result.data;
 const ordinary=dedup.first.receipt.result.data;
 assert.deepEqual(scoped.flags,['--qualification-result-readback']);
 assert.deepEqual(ordinary.flags,[]);
 assert.deepEqual(scoped.request,{op:'inspect_videos',video_ids:['7711111111111111111'],line:'fixture',run:'fixture-new-run'});
 assert.deepEqual(ordinary.request,scoped.request);
});

test('102 collect_partial hydrates the exact owned evidence through its bound collection action',()=>{
 const script=String.raw`import hashlib,importlib.util,json,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('admission',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
identity={'task_id':'test-task','run_id':'test-run','run_tag':'test-run'}
video='7711111111111111111'; url='https://www.douyin.com/video/'+video
eid='test-run-v'+video+'-collection-person1-t1'
body='测试评论'; digest=lambda buf:hashlib.sha256(buf).hexdigest()
context={'assigned_workflow':'102','tasks':{'102':identity},'line':'fixture','profile':'phone'}
evidence={'status':'verified','scope':{'run':'test-run','line_key':'fixture','profile':'phone','video_id':video,'video_url':url,'source_run':None,
 'douyin_id':'test-uid','nickname':'测试用户','comment_body_sha256':digest(body.encode()),'profile_eid':eid},'raw':{'profile':'X'*50000}}
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d).resolve(); (root/'receipts').mkdir()
 directory=root/'collection-evidence-receipts'/eid
 directory.mkdir(parents=True)
 asset=directory/(eid+'-recipient-fixture.json')
 asset.write_text(json.dumps(evidence,ensure_ascii=False)); asset.chmod(0o600)
 response={'status':'evidence_built','video_id':video,'body_sha256':digest(body.encode()),'evidence':{'path':str(asset),'sha256':digest(asset.read_bytes())}}
 receipt={'state':'terminal','binding':{'kind':'collection-evidence','activity':'collection','identity':identity,
    'args':[json.dumps({'profile_eid':eid})]},'result':{'exit_code':0,'stdout':json.dumps(response)}}
 path=root/'receipts/capture-comment.json'
 def persist():path.write_text(json.dumps(receipt)); path.chmod(0o600)
 persist()
 row={'nickname':'测试用户','douyinId':'test-uid','commentBody':body,'recipientEvidenceAction':'capture-comment'}
 request={'op':'collect_partial','video_id':video,'video_url':url,'source_run':None,'comments':[row]}
 verify=module.resolve_collection_evidence
 hydrated=verify(root,context,'collection',request)
 assert hydrated['comments']==[{k:v for k,v in row.items() if k!='recipientEvidenceAction'}|{'recipientEvidence':evidence}]
 assert 'recipientEvidence' not in row
 inline={**request,'comments':[hydrated['comments'][0]]}
 assert verify(root,context,'collection',inline)==inline
 def denied(value=request):
  try:verify(root,context,'collection',value)
  except module.PreDispatchRejected as e:assert e.code=='COLLECTION_EVIDENCE_REFERENCE_INVALID'
  else:raise AssertionError('reference must be rejected before dispatch')
 denied({**request,'comments':[{**row,'recipientEvidenceAction':'../capture-comment'}]})
 denied({**request,'comments':[{**row,'recipientEvidence':evidence}]})
 denied({**request,'comments':[{**row,'commentBody':'changed'}]})
 receipt['binding']['identity']={**identity,'run_id':'outside'};persist();denied()
 receipt['binding']['identity']=identity;persist()
 saved=asset.with_name('real.json');asset.rename(saved);asset.symlink_to(saved)
 denied();asset.unlink();saved.rename(asset)
 original_open=module.os.open
 alternate=asset.with_name('different-inode.json')
 alternate.write_bytes(asset.read_bytes());alternate.chmod(0o600)
 def open_with_swap(filename, flags, *args, **kwargs):
  if filename==asset:alternate.replace(asset)
  return original_open(filename,flags,*args,**kwargs)
 module.os.open=open_with_swap
 try:denied()
 finally:module.os.open=original_open
 asset.write_text('changed');denied()
 print('safe')
 `;
 const source=new URL('../activity-tool-result.py',import.meta.url).pathname;
 const result=spawnSync('/usr/bin/python3',['-c',script,source],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 assert.equal(result.stdout.trim(),'safe');
});
