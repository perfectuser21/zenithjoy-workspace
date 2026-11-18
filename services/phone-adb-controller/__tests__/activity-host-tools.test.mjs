import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-host-tools.json',import.meta.url)));
const helper=new URL('../activity-host-tools.py',import.meta.url).pathname;
function probe(mode='normal'){
 const root=mkdtempSync(join(tmpdir(),'activity-host-tools-'));
 try{
 const script=String.raw`import pathlib,sys,json,time,types,importlib.util,contextlib,io,hashlib,os,gc
p=pathlib.Path(sys.argv[1]);helper=pathlib.Path(sys.argv[2]);mode=sys.argv[3];base=p/'base';base.mkdir();packet=json.load(sys.stdin)
for name,item in packet['files'].items():
 assert hashlib.sha256(item['source'].encode()).hexdigest()==item['sha256'];(base/name).write_text(item['source'])
target=p/'candidate'
if helper.exists():
 spec=importlib.util.spec_from_file_location('assembler',helper);a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a);a.assemble(base,target)
else:
 import shutil
 shutil.copytree(base,target)
sys.path.insert(0,str(target));transport=types.ModuleType('local_transport')
def forbidden(*a):raise AssertionError('external transport is forbidden')
transport.local_command=forbidden;transport.pinned_transport=forbidden;sys.modules['local_transport']=transport
c={'assigned_workflow':'101','node':'node','max_candidates':100,'comment_limit':100,'line':'fixture','tasks':{'101':{'task_id':'task','run_id':'run','run_tag':'run-tag'}},'verification':{},'business_deadline_ms':time.time()*1000+10000,'cleanup_deadline_ms':time.time()*1000+10000}
(target/'context.json').write_text(json.dumps(c));(target/'input.json').write_text(json.dumps({'activity_key':'collect_videos','identity':c['tasks']['101']}));os.environ['COMMANDER_ACTIVITY_INPUT_FILE']=str(target/'input.json');os.environ['COMMANDER_ACTIVITY_KEY']='collect_videos'
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
replay=call('first','company_config') if mode=='normal' else None
second=call('corrected','inspect_videos') if mode=='normal' else None
print(json.dumps({'first':first,'before':before,'replay':replay,'second':second,'calls':calls,'instructions':(target/'TOOLS.txt').read_text() if (target/'TOOLS.txt').exists() else ''}))`;
 const r=spawnSync('/usr/bin/python3',['-c',script,root,helper,mode],{input:JSON.stringify(fixture),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('real assembled collect host emits typed company_config rejection and only dispatches corrected new action',()=>{
 const r=probe();assert.equal(r.first.rc,2,r.first.error);const v=JSON.parse(r.first.stdout);
 assert.equal(v.state,'terminal');assert.equal(v.result.error,'BUSINESS_ACTIVITY_SCOPE');assert.equal(v.result.data.dispatched,false);assert.equal(v.result.data.external_effect,'none');
 assert.deepEqual(v.result.data.allowed_operations,['discover','discover_readback','inspect_videos']);assert.deepEqual(r.before,{dispatch:0,credentials:0,resource:0});
 assert.equal(r.replay.stdout,r.first.stdout);assert.equal(r.second.rc,0);assert.deepEqual(r.calls,{dispatch:1,credentials:1,resource:1});
 assert.match(r.instructions,/collect_videos允许操作：discover, discover_readback, inspect_videos/);assert.match(r.instructions,/101.*company_config.*preflight/);
});
for(const mode of ['same-text','after-dispatch','network','persist-failure'])test(`real assembled ${mode} remains unknown`,()=>{
 const r=probe(mode);assert.equal(r.first.stdout,'');assert.ok(r.first.error);assert.equal(r.first.receipt.state,'unknown');
 if(['after-dispatch','network'].includes(mode))assert.equal(r.calls.dispatch,1);
});
