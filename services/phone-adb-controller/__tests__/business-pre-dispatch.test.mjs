import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/business-pre-dispatch-wiring.json',import.meta.url))),helper=new URL('../activity-tool-result.py',import.meta.url).pathname,hash=b=>createHash('sha256').update(b).digest('hex');
function probe(mode){const root=mkdtempSync(join(tmpdir(),'business-pre-rejection-'));try{const script=String.raw`import os,sys,json,pathlib,re,time,fcntl,subprocess,importlib.util
packet=json.load(sys.stdin);P=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
spec=importlib.util.spec_from_file_location('result',sys.argv[3]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
PreDispatchRejected=module.PreDispatchRejected;emit_pre_dispatch_rejection=module.emit_pre_dispatch_rejection
if hasattr(module,'read_business_input'):read_business_input=module.read_business_input
exec(packet['tool_scope.py']['source'],globals());exec(packet['tools.py']['source'],globals())
calls={'brain':0,'resource':0,'credentials':0,'subprocess':0,'invoke':0,'authority':0}
def context():return {'assigned_workflow':'102','node':'fixture-node','max_candidates':1,'comment_limit':1,'verification':{'102':{'video_ids':[]}},'line':'yuesheng','tasks':{'102':{'task_id':'6b8ffb48-4813-49e0-a096-3901dd42d441','run_id':'e9050372-9725-4adc-836e-12f86ebc7429','run_tag':'cloud102-20261118-eb6ddd6a'}},'business_deadline_ms':time.time()*1000+10000,'cleanup_deadline_ms':time.time()*1000+10000},'preflight'
def task_authority(c):calls['authority']+=1
def qualification_recovery_guard(*a):pass
def outreach_recovery(*a):return False
def resource_authority(c):calls['resource']+=1
def environment(c):calls['credentials']+=1;return {}
def brain(*a):calls['brain']+=1;return {'locks':[]}
def run(*a,**kw):
 calls['subprocess']+=1
 if mode=='after-dispatch':raise ValueError('BUSINESS_ACTIVITY_SCOPE')
 if mode=='network':raise OSError('network unknown')
 return {'exit_code':0}
subprocess.run=run
actual_invoke=invoke
def invoke(*a):
 calls['invoke']+=1
 if mode=='generic':raise ValueError('BUSINESS_ACTIVITY_SCOPE')
 return actual_invoke(*a)
def read(p):return json.loads(p.read_text())
def atomic(p,v):
 if mode=='write-failure' and v['state']=='terminal':raise OSError('disk unknown')
 p.write_text(json.dumps(v))
value={} if mode=='missing' else {'op':'invalid_operation'} if mode=='invalid' else {'op':'company_config'} if mode in ['after-dispatch','network'] else {'op':'task_read','task_id':'6b8ffb48-4813-49e0-a096-3901dd42d441'}
sys.argv=['tools','brain','correct-get','device-locks'] if mode=='correct-get' else ['tools','business','invalid-business',json.dumps(value)]
first=None
try:first=main()
except Exception:pass
receipt=read(P/'receipts'/('correct-get.json' if mode=='correct-get' else 'invalid-business.json'))
print(json.dumps({'probe':True,'first':first,'receipt':receipt,'calls':calls}))`;
 const execute=which=>{const r=spawnSync('/usr/bin/python3',['-c',script,root,which,helper],{input:JSON.stringify(fixture),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').at(-1));};
 const first=execute(mode);if(['task_read','missing','invalid','replay'].includes(mode)){const calls=[first.calls];if(mode==='replay'){const replay=execute(mode);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.calls.invoke,0);calls.push(replay.calls);}const second=execute('correct-get');first.second=second.first;calls.push(second.calls);first.calls=Object.fromEntries(Object.keys(first.calls).map(k=>[k,calls.reduce((sum,c)=>sum+c[k],0)]));}return first;
}finally{rmSync(root,{recursive:true,force:true});}}
for(const mode of ['task_read','missing','invalid','replay'])test('actual main '+mode+' rejection is terminal before dispatch and permits next correct brain GET',()=>{const p=probe(mode);assert.equal(p.receipt.state,'terminal');assert.equal(p.first,2);assert.equal(p.second,0);assert.equal(p.receipt.result.data.dispatched,false);assert.deepEqual(p.receipt.result.data.allowed_operations,['company_config']);assert.equal(p.calls.brain,1);assert.equal(p.calls.resource,0);assert.equal(p.calls.credentials,0);assert.equal(p.calls.subprocess,0);assert.equal(p.calls.invoke,2);});
for(const mode of ['generic','after-dispatch','network','write-failure'])test(mode+' is never fabricated as a pre-dispatch terminal receipt',()=>{const p=probe(mode);assert.equal(p.receipt.state,'unknown');if(['after-dispatch','network'].includes(mode))assert.equal(p.calls.subprocess,1);});
test('permanent actual tools and scope excerpts bind exact delivered candidate bytes',()=>{const candidate=process.env.BUSINESS_PRE_DISPATCH_CANDIDATE;if(candidate)for(const[name,item]of Object.entries(fixture)){const s=readFileSync(join(candidate,name),'utf8');assert.equal(hash(s),item.sha256);if(name==='tool_scope.py')assert.equal(s,item.source);else for(const p of item.source.split('\n\ndef '))assert.ok(s.includes(p.startsWith('def ')?p:'def '+p)||s.includes(p));}});
