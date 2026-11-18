import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const wiring=JSON.parse(readFileSync(new URL('./fixtures/103-tool-host-wiring.json',import.meta.url)));
const helper=new URL('../activity-tool-result.py',import.meta.url).pathname;
function probe(activity,op,mode='normal',version='active'){
 const root=mkdtempSync(join(tmpdir(),'103-tool-host-'));
 try{
  const program=String.raw`import pathlib,sys,json,time,fcntl,re,subprocess,importlib.util,contextlib,io
P=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('typed',sys.argv[2]);typed=importlib.util.module_from_spec(spec);spec.loader.exec_module(typed)
for name in ['PreDispatchRejected','emit_pre_dispatch_rejection','read_business_input','scope_rejection']:globals()[name]=getattr(typed,name)
packet=json.load(sys.stdin);mode=packet['mode'];exec(packet['source']['tool_scope.py']['source'],globals());exec(packet['source']['tools.py']['source'],globals())
activity=packet['activity'];calls={'dispatch':0,'credentials':0}
c={'assigned_workflow':'103','node':'node','max_candidates':1,'comment_limit':1,'line':'example','tasks':{'103':{'task_id':'task','run_id':'run','run_tag':'score-run'}},'verification':{'103':{'comment_ids':['comment'],'sources':{'comment':'source-run'}}},'business_deadline_ms':time.time()*1000+10000,'cleanup_deadline_ms':time.time()*1000+10000}
def context():return c,activity
def task_authority(c):pass
def outreach_recovery(*a):return False
def read(p):return json.loads(pathlib.Path(p).read_text())
def atomic(p,x):
 if mode=='persist-failure' and x['state']=='terminal':raise OSError('disk unknown')
 pathlib.Path(p).write_text(json.dumps(x))
def environment(c):calls['credentials']+=1;return {}
def dispatch(*a,**kw):
 calls['dispatch']+=1
 if mode=='after-dispatch':raise ValueError('BUSINESS_ACTIVITY_SCOPE')
 if mode=='network':raise OSError('network unknown')
 return {'exit_code':0,'data':{'verified':True}}
subprocess.run=dispatch
if mode=='same-text':
 def invoke(*a):raise ValueError('BUSINESS_ACTIVITY_SCOPE')
def call(name,op):
 sys.argv=['tools','business',name,json.dumps({'op':op,'ids':['comment'],'sources':{'comment':'source-run'},'committed_partial_ids':['comment']})];out=io.StringIO();error=None;rc=None
 try:
  with contextlib.redirect_stdout(out):rc=main()
 except Exception as e:error={'type':type(e).__name__,'message':str(e)}
 return {'rc':rc,'stdout':out.getvalue(),'error':error,'receipt':read(P/'receipts'/(name+'.json'))}
first=call('wrong-call',packet['op']);before=dict(calls);second=None;replay=None
if mode=='normal':
 replay=call('wrong-call',packet['op']);second=call('correct-readback','score_readback')
print(json.dumps({'first':first,'before':before,'replay':replay,'second':second,'calls':calls}))`;
  const r=spawnSync('/usr/bin/python3',['-c',program,root,helper],{input:JSON.stringify({source:wiring[version],activity,op,mode}),encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
for(const [activity,op]of [['scoring','policy_review'],['mark_leads','company_config']]){
 test(`actual 103 ${activity}/${op} rejection reaches MCP and permits only corrected operation`,()=>{
  const r=probe(activity,op);assert.equal(r.first.rc,2);assert.equal(r.first.error,null);
  const receipt=JSON.parse(r.first.stdout);assert.equal(receipt.state,'terminal');assert.equal(receipt.result.error,'BUSINESS_ACTIVITY_SCOPE');
  assert.equal(receipt.result.data.dispatched,false);assert.equal(receipt.result.data.external_effect,'none');
  assert.equal(receipt.result.data.activity,activity);assert.ok(!receipt.result.data.allowed_operations.includes(op));
  assert.ok(receipt.result.data.allowed_operations.includes('score_readback'));assert.deepEqual(r.before,{dispatch:0,credentials:0});
  assert.equal(r.replay.stdout,r.first.stdout);assert.equal(r.second.rc,0);assert.deepEqual(r.calls,{dispatch:1,credentials:1});
 });
 test(`legacy 103 ${activity}/${op} reproduces local terminal but missing MCP stdout`,()=>{
  const r=probe(activity,op,'normal','legacy');assert.equal(r.first.stdout,'');assert.equal(r.first.error.message,'BUSINESS_ACTIVITY_SCOPE');assert.equal(r.first.receipt.state,'terminal');
 });
}
for(const mode of ['same-text','after-dispatch','network','persist-failure'])test(`103 ${mode} stays unknown without fabricated safe retry`,()=>{
 const r=probe('mark_leads',mode==='persist-failure'?'company_config':'score_readback',mode);
 assert.equal(r.first.stdout,'');assert.equal(r.first.receipt.state,'unknown');assert.ok(r.first.error);
 if(['after-dispatch','network'].includes(mode))assert.equal(r.calls.dispatch,1);
});
test('permanent 103 wiring excerpts match the delivered candidate',()=>{
 const candidate=process.env.ACTIVITY103_HOST_CANDIDATE;if(!candidate)return;
 for(const [name,item]of Object.entries(wiring.active)){
  const raw=readFileSync(join(candidate,name),'utf8');assert.equal(createHash('sha256').update(raw).digest('hex'),item.sha256);
  if(name==='tool_scope.py')assert.equal(raw,item.source);else for(const part of item.source.split('\n\ndef '))assert.ok(raw.includes(part.startsWith('def ')?part:'def '+part));
 }
});
