import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const source=JSON.parse(readFileSync(new URL('./fixtures/resource-pre-dispatch-wiring.json',import.meta.url))),helper=new URL('../activity-tool-result.py',import.meta.url).pathname,hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(mode){const root=mkdtempSync(join(tmpdir(),'resource-admission-'));writeFileSync(join(root,'locks.json'),JSON.stringify({central:{device_name:'PHYSICAL',locked_by:mode==='foreign'?'other':null,expires_at:mode==='foreign'?new Date(Date.now()+900000).toISOString():null,lease_version:'49479981'},local:{lock:'free'}}));return{root,cleanup:()=>rmSync(root,{recursive:true,force:true})};}
const program=String.raw`import os,sys,json,pathlib,re,time,fcntl,subprocess,importlib.util,urllib.error
packet=json.load(sys.stdin);P=pathlib.Path(sys.argv[1]);mode=sys.argv[2];action=sys.argv[3];spec=importlib.util.spec_from_file_location('result',sys.argv[4]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
PreDispatchRejected=module.PreDispatchRejected;emit_pre_dispatch_rejection=module.emit_pre_dispatch_rejection;read_business_input=module.read_business_input
if hasattr(module,'scope_rejection'):scope_rejection=module.scope_rejection;resource_rejection=module.resource_rejection
if hasattr(module,'central_owner_rejection'):central_owner_rejection=module.central_owner_rejection
if hasattr(module,'lease_cas_rejection'):lease_cas_rejection=module.lease_cas_rejection
exec(packet['tool_scope.py']['source'],globals());exec(packet['tools.py']['source'],globals())
calls={'resource_reads':0,'guard':0,'credentials':0,'business':0,'phone':0,'brain_write':0}
def read(p):return json.loads(p.read_text())
def locks():return read(P/'locks.json')
def save(v):(P/'locks.json').write_text(json.dumps(v))
def context():return {'assigned_workflow':'102','serial':'PHYSICAL','central_owner':'OWNER','local_owner':'LOCAL','profile':'fixture','node':'fixture-node','max_candidates':1,'comment_limit':1,'line':'yuesheng','verification':{'102':{'video_ids':['7707600173446204723']}},'recovery':{'collection':{'existing_comment_id':'one','video_id':'7707600173446204723','expected_douyin_id':'123','expected_nickname_b64':'bmFtZQ==','comment_body_sha256':'a'*64,'before_snapshot':{},'before_sha256':'b'*64,'evidence_prefix':'batch-resume1-r11'}},'tasks':{'102':{'task_id':'task','run_id':'run','run_tag':'batch'}},'business_deadline_ms':time.time()*1000+10000,'cleanup_deadline_ms':time.time()*1000+10000},'collection' if mode.startswith('scope-') else 'cleanup' if mode.startswith('lease') else 'preflight'
def task_authority(c):pass
def qualification_recovery_guard(*a):calls['guard']+=1
def outreach_recovery(*a):return False
def central(c):
 calls['resource_reads']+=1
 if mode in ['network','lease-network']:raise OSError('read unknown')
 if mode=='lease-missing':x=locks()['central'];x.pop('lease_version');return x
 if mode=='lease-bad':x=locks()['central'];x['lease_version']=True;return x
 if mode=='generic':raise ValueError('RESOURCE_AUTHORITY')
 return locks()['central']
def local(c):
 calls['resource_reads']+=1
 if mode=='missing':return {}
 if mode=='bad-held':return {'lock':'held','stale':'false'}
 return locks()['local']
def environment(c):calls['credentials']+=1;return {}
def ssh(c,args):return ['fixed-controller']+args
def brain(route,body=None):
 if body is not None:
  calls['brain_write']+=1
  if mode=='lease-after-dispatch':raise ValueError('LEASE_CAS_REQUIRED')
  if mode=='lease-http409':raise urllib.error.HTTPError('https://fixture.invalid',409,'conflict',{},None)
  v=locks();v['central'].update(locked_by=body['locked_by'],expires_at='2099-01-01T00:00:00Z');save(v)
 return {'locks':[locks()['central']]}
def run(command,**kw):
 if 'business.mjs' in command[-1]:
  calls['business']+=1
  if mode=='after-dispatch':raise ValueError('RESOURCE_AUTHORITY')
 else:
  calls['phone']+=1
  if 'lock-acquire-new' in command:
   v=locks();v['local']={'lock':'held','owner':'LOCAL','stale':'false'};save(v)
 return {'exit_code':0}
subprocess.run=run
def atomic(p,v):
 if mode=='write-failure' and v['state']=='terminal':raise OSError('disk unknown')
 p.write_text(json.dumps(v))
if action=='release':args=['brain',action,'device-locks/release',json.dumps({'device_name':'PHYSICAL','locked_by':'OWNER','expected_lease_version':'old'})]
elif action=='release-correct':args=['brain',action,'device-locks/release',json.dumps({'device_name':'PHYSICAL','locked_by':'OWNER','expected_lease_version':'49479981'})]
elif action=='get':args=['brain',action,'device-locks']
elif action=='acquire':args=['brain',action,'device-locks/acquire',json.dumps({'device_name':'PHYSICAL','locked_by':'OWNER','ttl_minutes':90})]
elif action in ['local','local-after-acquire']:args=['phone',action,'lock-acquire-new','LOCAL']
elif mode=='scope-phone':args=['phone',action,'tap','1','1']
elif mode=='scope-uid':args=['phone',action,'commenter-profile-card-link','7707600173446204723','wrong','bmFtZQ==','a'*64,'batch-resume1-r11-card']
elif mode=='scope-eid':args=['phone',action,'open-video','7707600173446204723','batch-wrong-eid']
elif mode=='scope-business':args=['business',action,json.dumps({'op':'complete_collected_comment_metadata','comment_id':'wrong','video_id':'7707600173446204723'})]
else:args=['business',action,json.dumps({'op':'company_config','step':102,'source_run':None,'device_binding':{'profile':'fixture','device_serial':'PHYSICAL'}})]
sys.argv=['tools']+args;rc=None
try:rc=main()
except Exception:pass
print(json.dumps({'rc':rc,'receipt':read(P/'receipts'/(action+'.json')),'calls':calls}))`;
function run(f,mode,action){const r=spawnSync('/usr/bin/python3',['-c',program,f.root,mode,action,helper],{input:JSON.stringify(source),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').at(-1));}
test('free lock observation is a terminal rejection; exact acquire and local lock permit following company snapshot',()=>{const f=fixture('free');try{const a=run(f,'free','first');assert.equal(a.receipt.state,'terminal');assert.equal(a.receipt.result.error,'RESOURCE_AUTHORITY');assert.equal(a.receipt.result.data.dispatched,false);assert.equal(a.calls.business,0);assert.equal(a.calls.credentials,0);assert.equal(a.calls.resource_reads,2);assert.equal(run(f,'free','acquire').rc,0);assert.equal(run(f,'free','local').rc,0);const b=run(f,'free','company');assert.equal(b.rc,0);assert.equal(b.calls.business,1);}finally{f.cleanup();}});
test('local-lock before central owner is a terminal refusal and correct order can continue',()=>{const f=fixture('free');try{const a=run(f,'free','local');assert.equal(a.receipt.state,'terminal');assert.equal(a.receipt.result.error,'CENTRAL_OWNER_REQUIRED');assert.equal(a.calls.phone,0);assert.equal(run(f,'free','acquire').rc,0);assert.equal(run(f,'free','local-after-acquire').rc,0);}finally{f.cleanup();}});
test('complete foreign ownership is terminal and never auto-acquires or dispatches snapshot',()=>{const f=fixture('foreign');try{const a=run(f,'foreign','first');assert.equal(a.receipt.state,'terminal');assert.equal(a.calls.brain_write,0);assert.equal(a.calls.phone,0);assert.equal(a.calls.business,0);}finally{f.cleanup();}});
for(const lock of [{lock:'stale',owner:'LOCAL',stale:'true',reclaimable:'false'},{lock:'preserved',owner:'unknown',reclaimable:'false',reason:'standalone-review-required'}])test('complete '+lock.lock+' observation refuses terminally without reclaim',()=>{const f=fixture('free');try{const p=join(f.root,'locks.json'),x=JSON.parse(readFileSync(p));x.local=lock;writeFileSync(p,JSON.stringify(x));const r=run(f,'free','first');assert.equal(r.receipt.state,'terminal');assert.deepEqual(r.receipt.result.data.next_actions,['stop_without_reclaim']);assert.equal(r.calls.business,0);assert.equal(r.calls.brain_write,0);}finally{f.cleanup();}});
for(const mode of ['scope-phone','scope-uid','scope-eid','scope-business'])test('actual invoke '+mode+' rejects explicitly before resource or guard access',()=>{const f=fixture('free');try{const a=run(f,mode,'first');assert.equal(a.receipt.state,'terminal');assert.equal(a.receipt.result.data.dispatched,false);assert.equal(a.calls.resource_reads,0);assert.equal(a.calls.guard,0);}finally{f.cleanup();}});
for(const mode of ['missing','bad-held','network','generic','after-dispatch','write-failure'])test(mode+' never becomes a fabricated known resource rejection',()=>{const f=fixture('free');try{if(mode==='after-dispatch'){const x=JSON.parse(readFileSync(join(f.root,'locks.json')));x.central.locked_by='OWNER';x.central.expires_at='2099-01-01T00:00:00Z';x.local={lock:'held',owner:'LOCAL',stale:'false'};writeFileSync(join(f.root,'locks.json'),JSON.stringify(x));}assert.equal(run(f,mode,'first').receipt.state,'unknown');}finally{f.cleanup();}});
test('known stale lease CAS is terminal; fresh read then exact release can continue',()=>{const f=fixture('free');try{const a=run(f,'lease','release');assert.equal(a.receipt.state,'terminal');assert.equal(a.receipt.result.error,'LEASE_CAS_REQUIRED');assert.equal(a.calls.brain_write,0);assert.equal(run(f,'lease','get').rc,0);assert.equal(run(f,'lease','release-correct').calls.brain_write,1);}finally{f.cleanup();}});
for(const mode of ['lease-missing','lease-bad','lease-network','lease-after-dispatch','lease-http409'])test(mode+' stays unknown instead of claiming no release dispatch',()=>{const f=fixture('free');try{const r=run(f,mode,['lease-after-dispatch','lease-http409'].includes(mode)?'release-correct':'release');assert.equal(r.receipt.state,'unknown');assert.equal(r.calls.brain_write,['lease-after-dispatch','lease-http409'].includes(mode)?1:0);}finally{f.cleanup();}});
test('source excerpts match the delivered full tools and scope bytes',()=>{const dir=process.env.RESOURCE_PRE_DISPATCH_CANDIDATE;if(dir)for(const[name,item]of Object.entries(source)){const raw=readFileSync(join(dir,name),'utf8');assert.equal(hash(raw),item.sha256);if(name==='tool_scope.py')assert.equal(raw,item.source);else for(const part of item.source.split('\n\ndef '))assert.ok(raw.includes(part.startsWith('def ')?part:'def '+part)||raw.includes(part));}});
