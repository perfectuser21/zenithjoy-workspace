import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-host-tools.json',import.meta.url)));
const fixture102=JSON.parse(readFileSync(new URL('./fixtures/activity-host-102.json',import.meta.url)));
const helper=new URL('../activity-host-tools.py',import.meta.url).pathname;
function probe(mode='normal',workflow='101'){
 const root=mkdtempSync(join(tmpdir(),'activity-host-tools-'));
 try{
 const script=String.raw`import pathlib,sys,json,time,types,importlib.util,contextlib,io,hashlib,os,gc
p=pathlib.Path(sys.argv[1]);helper=pathlib.Path(sys.argv[2]);mode=sys.argv[3];workflow=sys.argv[4];base=p/'base';base.mkdir();packet=json.load(sys.stdin)
for name,item in packet['files'].items():
 assert hashlib.sha256(item['source'].encode()).hexdigest()==item['sha256'];(base/name).parent.mkdir(parents=True,exist_ok=True);(base/name).write_text(item['source'])
c={'assigned_workflow':workflow,'source_commit':'a'*40,'profile':'fixture-phone','node':'node','max_candidates':1,'comment_limit':1,'line':'fixture','tasks':{workflow:{'task_id':'task','run_id':'run','run_tag':'fixture-new-run'}},'verification':{'policy_version':35,'102':{'video_ids':['7711111111111111111'],'qualification_input':{'video_id':'7711111111111111111','coverage':{'kind':'full_video','source_duration_display_seconds':37,'capture_max_seconds':120,'max_capture_sessions':1,'max_asr_calls':1,'max_judge_primary_calls':1}}}},'business_deadline_ms':time.time()*1000+10000,'cleanup_deadline_ms':time.time()*1000+10000}
target=p/'candidate'
if helper.exists():
 spec=importlib.util.spec_from_file_location('assembler',helper);a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
 if workflow=='102':
  import inspect,shutil
  if 'workflow' in inspect.signature(a.assemble).parameters:a.assemble(base,target,workflow='102',context=c)
  else:shutil.copytree(base,target)
 else:a.assemble(base,target)
else:
 import shutil
 shutil.copytree(base,target)
sys.path.insert(0,str(target));transport=types.ModuleType('local_transport')
def forbidden(*a):raise AssertionError('external transport is forbidden')
transport.local_command=forbidden;transport.pinned_transport=forbidden;sys.modules['local_transport']=transport
activity='dedup' if workflow=='102' else 'collect_videos'
(target/'context.json').write_text(json.dumps(c));(target/'input.json').write_text(json.dumps({'activity_key':activity,'identity':c['tasks'][workflow]}));os.environ['COMMANDER_ACTIVITY_INPUT_FILE']=str(target/'input.json');os.environ['COMMANDER_ACTIVITY_KEY']=activity
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
 sys.argv=['tools','business',name,json.dumps({'op':op})];out=io.StringIO();error=None;rc=None
 try:
  with contextlib.redirect_stdout(out):rc=m.main()
 except Exception as e:error=type(e).__name__+':'+str(e)
 gc.collect();f=target/'receipts'/(name+'.json')
 return {'rc':rc,'stdout':out.getvalue(),'error':error,'receipt':json.loads(f.read_text()) if f.exists() else None}
first=call('first','company_config' if mode in ['normal','persist-failure'] else 'inspect_videos');before=dict(calls)
replay=call('first','company_config' if mode in ['normal','persist-failure'] else 'inspect_videos')
second=call('corrected','inspect_videos')
print(json.dumps({'first':first,'before':before,'replay':replay,'second':second,'calls':calls,'instructions':(target/'TOOLS.txt').read_text() if (target/'TOOLS.txt').exists() else '', 'original':(target/'TOOLS-base.txt').read_text() if (target/'TOOLS-base.txt').exists() else '', 'tools':(target/'tools.py').read_text()}))`;
 const r=spawnSync('/usr/bin/python3',['-c',script,root,helper,mode,workflow],{input:JSON.stringify(workflow==='102'?fixture102:fixture),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('real assembled collect host emits typed company_config rejection and only dispatches corrected new action',()=>{
 const r=probe();assert.equal(r.first.rc,2,r.first.error);const v=JSON.parse(r.first.stdout);
 assert.equal(v.state,'terminal');assert.equal(v.result.error,'BUSINESS_ACTIVITY_SCOPE');assert.equal(v.result.data.dispatched,false);assert.equal(v.result.data.external_effect,'none');
 assert.deepEqual(v.result.data.allowed_operations,['discover','discover_readback','inspect_videos']);assert.match(v.result.data.tool_hint,/当前Activity为collect_videos/);assert.doesNotMatch(v.result.data.tool_hint,/preflight从brain/);assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0});
 assert.equal(r.replay.stdout,r.first.stdout);assert.equal(r.second.rc,0);assert.deepEqual(r.calls,{dispatch:1,credentials:1,resource:1});
 assert.ok(r.instructions.startsWith(fixture.files['TOOLS.txt'].source));assert.match(r.instructions,/collect_videos允许操作：discover, discover_readback, inspect_videos/);assert.match(r.instructions,/101.*company_config.*preflight/);
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
for(const mode of ['same-text','after-dispatch','network','persist-failure'])test(`real assembled ${mode} remains unknown`,()=>{
 const r=probe(mode);assert.equal(r.first.stdout,'');assert.ok(r.first.error);assert.equal(r.first.receipt.state,'unknown');
 if(['after-dispatch','network'].includes(mode))assert.equal(r.calls.dispatch,1);assert.deepEqual(r.calls,r.before);assert.match(r.replay.error,/ACTION_UNKNOWN_NO_REPLAY/);assert.match(r.second.error,/PRIOR_ACTION_UNKNOWN/);
});
