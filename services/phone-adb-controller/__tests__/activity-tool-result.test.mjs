import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const main=new URL('./fixtures/activity-tool-main.py',import.meta.url),program=new URL('../activity-tool-result.py',import.meta.url);
const brainFixture=new URL('./fixtures/activity-tool-brain.py',import.meta.url);
const hash=s=>createHash('sha256').update(s).digest('hex');
function run(mode){const dir=mkdtempSync(join(tmpdir(),'activity-result-'));try{
const code=`import pathlib,sys,json,time,fcntl,re,subprocess,importlib.util
P=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
spec=importlib.util.spec_from_file_location('result',${JSON.stringify(program.pathname)});module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
PreDispatchRejected=module.PreDispatchRejected;emit_pre_dispatch_rejection=module.emit_pre_dispatch_rejection
def read(p):return json.loads(p.read_text())
def atomic(p,x):
 if mode=='write-failure' and x.get('state')=='terminal':raise OSError('disk failed')
 p.write_text(json.dumps(x))
def context():return {'cleanup_deadline_ms':int(time.time()*1000)+10000,'business_deadline_ms':int(time.time()*1000)+10000,'assigned_workflow':'102','serial':'PHYSICAL','central_owner':'OWNER','tasks':{'102':{'task_id':'task','run_id':'run'}}},'preflight'
def task_authority(c):pass
def outreach_recovery(*a):return False
READ=set()
calls={'invoke':0,'brain':0}
def brain(route,body):
 calls['brain']+=1
 if mode=='after-dispatch':raise ValueError('LOCK_WRITE_SCOPE')
 if mode=='network':raise OSError('network unknown')
 return {'lease':'fixture'}
exec(compile(pathlib.Path(${JSON.stringify(brainFixture.pathname)}).read_text(),'brain-fixture.py','exec'))
def invoke(*args):
 calls['invoke']+=1
 if mode=='same-text':raise ValueError('LOCK_WRITE_SCOPE')
 return brain_invoke(*args)
body={'device_name':'PHYSICAL',('locked_by' if mode in ('correct','after-dispatch','network') else 'owner'):'OWNER'}
sys.argv=['tools','brain','test-action','device-locks/acquire',json.dumps(body)]
__name__='fixture_main'
exec(compile(pathlib.Path(${JSON.stringify(main.pathname)}).read_text(),'tools.py','exec'))
try:
 code=main()
 if mode=='replay':code=main()
 sys.exit(code)
except Exception as error:
 print(type(error).__name__,file=sys.stderr);sys.exit(2)
finally:(P/'calls.json').write_text(json.dumps(calls))
`;
const r=spawnSync('/usr/bin/python3',['-c',code,dir,mode],{encoding:'utf8'});return {...r,calls:JSON.parse(readFileSync(join(dir,'calls.json'))),receipt:JSON.parse(readFileSync(join(dir,'receipts/test-action.json')))};
}finally{rmSync(dir,{recursive:true,force:true});}}
test('typed pure local rejection reaches host as structured terminal failure',()=>{const r=run('pre');assert.equal(r.status,2);const x=JSON.parse(r.stdout);assert.equal(x.state,'terminal');assert.equal(x.result.exit_code,2);assert.equal(x.result.data.dispatched,false);assert.deepEqual(x.result.data.expected_fields,['device_name','locked_by']);assert.equal(r.receipt.state,'terminal');assert.equal(r.calls.brain,0);});
for(const mode of ['same-text','after-dispatch','network','write-failure'])test(mode+' remains unknown without fabricated terminal stdout',()=>{const r=run(mode);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.equal(r.receipt.state,'unknown');});
test('same action terminal binding is read back without another invoke',()=>{const r=run('replay'),rows=r.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(rows.length,2);assert.deepEqual(rows[0],rows[1]);assert.equal(r.calls.invoke,1);assert.equal(r.calls.brain,0);});
test('correct locked_by dispatches exactly once through the actual lock admission branch',()=>{const r=run('correct');assert.equal(r.status,0);assert.equal(r.calls.brain,1);assert.equal(JSON.parse(r.stdout).result.exit_code,0);});
test('permanent fixture and delivered main are byte identical with recorded provenance',()=>{const p=JSON.parse(readFileSync(new URL('./fixtures/activity-tool-main.provenance.json',import.meta.url)));assert.equal(hash(readFileSync(main)),p.fixture_sha256);assert.equal(p.candidate_main_sha256,p.fixture_sha256);assert.equal(hash(readFileSync(brainFixture)),p.brain_fixture_sha256);if(process.env.ACTIVITY_TOOL_CANDIDATE){const s=readFileSync(process.env.ACTIVITY_TOOL_CANDIDATE,'utf8');assert.equal(hash(s),p.candidate_tools_sha256);assert.equal(s.slice(s.indexOf('def main():')),readFileSync(main,'utf8'));const block=s.slice(s.indexOf(" if kind=='brain':"),s.indexOf(" if kind=='business':"));assert.equal(hash(block),p.candidate_brain_block_sha256);assert.equal('def brain_invoke(c,key,kind,args):\n'+block,readFileSync(brainFixture,'utf8'));}});
