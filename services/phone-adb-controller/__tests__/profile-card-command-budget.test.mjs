import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const helper=new URL('../phone-lock-helper.py',import.meta.url).pathname,ctl=new URL('../douyin-phone-adb',import.meta.url).pathname;
const argv=['/bin/zsh',ctl,'--profile','wuying_android14','--lock-owner','fixture-owner','commenter-profile-card-link','7707600173446204723','56755237968','54O954Gr5L2z5Lq6','a'.repeat(64),'fixture-card'];
function simulated(args,override){const program=String.raw`import sys,os,json,importlib.util,subprocess
s=importlib.util.spec_from_file_location('helper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);argv=json.loads(sys.argv[2]);clock=[0];killed=[]
if sys.argv[3]!='unset':os.environ['DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS']=sys.argv[3]
else:os.environ.pop('DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS',None)
class Child:
 pid=123456789
 def wait(self,timeout):
  if killed:return -15
  clock[0]+=10
  if clock[0]>=300:return 0
  raise subprocess.TimeoutExpired(argv,timeout)
m.time.monotonic=lambda:clock[0];m.time.sleep=lambda _:None;m.signal.signal=lambda *a:None;m.subprocess.Popen=lambda *a,**k:Child();m.os.killpg=lambda pid,sig:killed.append(sig);m.require_group_ended=lambda pid:None;m.owner_matches=lambda *a:True
try:m._bounded_command(argv,9,'unused','fixture-owner')
except SystemExit as e:print(json.dumps({'code':e.code,'elapsed':clock[0],'killed':bool(killed)}))
`;const r=spawnSync('/usr/bin/python3',['-c',program,helper,JSON.stringify(args),override??'unset'],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return{...JSON.parse(r.stdout.trim().split('\n').at(-1)),stderr:r.stderr};}
test('actual guard permits measured card completion at 300s without extending ordinary 280s commands',()=>{const r=simulated(argv);assert.equal(r.code,0);assert.equal(r.elapsed,300);assert.equal(r.killed,false);const old=simulated([...argv.slice(0,6),'close-app']);assert.equal(old.code,124);assert.equal(old.elapsed,280);assert.equal(old.killed,true);assert.match(old.stderr,/TERMINATION_UNKNOWN/);});
test('only exact full card invocation gets cap360; env can shrink but never exceed its selected cap',()=>{assert.equal(simulated(argv,'360').code,0);assert.equal(simulated(argv,'361').code,2);assert.equal(simulated(argv,'1').code,124);for(const args of [argv.slice(0,-1),[...argv,'extra'],argv.map((v,i)=>i===5?'':v),argv.map((v,i)=>i===6?'other':v),argv.map((v,i)=>i===7?'wrong-vid':v),argv.map((v,i)=>i===10?'bad-sha':v)])assert.equal(simulated(args,'281').code,2);});
test('real guard timeout stops parent and child, retains exact owner and an unknown marker',()=>{const root=mkdtempSync(join(tmpdir(),'card-budget-'));try{const script=join(root,'douyin-phone-adb'),owner=join(root,'owner'),pids=join(root,'pids.json'),late=join(root,'late'),unknown=join(root,'unknown');writeFileSync(owner,'fixture-owner\n');writeFileSync(script,`exec /usr/bin/python3 -c 'import subprocess,os,time,json,pathlib;child=subprocess.Popen(["/bin/sleep","30"]);pathlib.Path(${JSON.stringify(pids)}).write_text(json.dumps([os.getpid(),child.pid]));time.sleep(5);pathlib.Path(${JSON.stringify(late)}).write_text("late")'\n`);
 const program=String.raw`import sys,json,importlib.util,os
s=importlib.util.spec_from_file_location('helper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
fd=os.open(sys.argv[2],os.O_RDONLY)
try:m._bounded_command(json.loads(sys.argv[3]),fd,sys.argv[2],'fixture-owner')
except SystemExit as e:print(json.dumps({'code':e.code}))
`;const args=[...argv];args[1]=script;const r=spawnSync('/usr/bin/python3',['-c',program,helper,owner,JSON.stringify(args)],{encoding:'utf8',env:{...process.env,DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS:'1',WFR_NATIVE_UNKNOWN_FILE:unknown},timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1)).code,124);assert.match(readFileSync(unknown,'utf8'),/guard_canceled_or_timeout/);assert.equal(readFileSync(owner,'utf8'),'fixture-owner\n');assert.equal(existsSync(late),false);const ids=JSON.parse(readFileSync(pids));for(const pid of ids){const p=spawnSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'});assert.ok(p.status!==0||p.stdout.trim().startsWith('Z'),'live process '+pid);}
 }finally{rmSync(root,{recursive:true,force:true});}});
test('frozen actual host phone subprocess timeout leaves at least60s above the new command cap',()=>{const f=JSON.parse(readFileSync(new URL('./fixtures/tool-admission-wiring.json',import.meta.url))),source=f['tools.py'].source;assert.match(source,/return subprocess\.run\(ssh\(c,approved\),capture_output=True,text=True,timeout=420\)/);assert.equal(420-360,60);});

test('real guarded entry selects default budgets for complete card and all unmatched layouts',()=>{const root=mkdtempSync(join(tmpdir(),'card-entry-budget-'));try{const program=String.raw`import sys,json,importlib.util,os
s=importlib.util.spec_from_file_location('helper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
values=json.loads(sys.argv[2]);guard=sys.argv[3];owner=values[5]
def capture(argv,fd,owner_path,expected_owner):
 assert os.fstat(fd).st_ino==os.stat(guard).st_ino
 print(json.dumps({'argv':argv,'budget':m.guarded_command_budget(argv),'owner':expected_owner,'owner_path':owner_path}))
m.bounded_command=capture
sys.argv=[sys.argv[1],'guard',guard,'SER1','--lock-owner',values[1],values[3],owner]+values[6:]
m.guarded()
`;const env={...process.env};delete env.DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS;
 for(const [args,cap]of [[argv,360],[[...argv.slice(0,6),'close-app'],280],[argv.slice(0,-1),280],[[...argv,'extra'],280],[argv.map((v,i)=>i===5?'':v),280]]){const r=spawnSync('/usr/bin/python3',['-c',program,helper,JSON.stringify(args),join(root,'SER1.guard')],{encoding:'utf8',timeout:10000,env});assert.equal(r.status,0,r.stderr);const x=JSON.parse(r.stdout);assert.deepEqual(x.argv,args);assert.equal(x.budget,cap);assert.equal(x.owner,args[5]);assert.equal(x.owner_path,join(root,'SER1.lock/owner'));}
 }finally{rmSync(root,{recursive:true,force:true});}});

test('guarded interactive account verification completes at 300s without expanding ordinary operations',()=>{
 const owner='dd9fd7d9-903e-4a0f-835e-4591091e65e1';
 const managed=['/bin/zsh',ctl,'--profile','wuying_android14','--lock-owner',owner,'account-current',owner+'-account','--single-dump'];
 for(const mode of ['--single-dump','--verify-own-profile']){
  const result=simulated([...managed.slice(0,-1),mode]);
  assert.deepEqual({code:result.code,elapsed:result.elapsed,killed:result.killed},{code:0,elapsed:300,killed:false});
 }
 assert.equal(simulated(managed,'341').code,2);
 for(const args of [managed.slice(0,-1),[...managed,'extra'],managed.map((arg,i)=>i===8?'--other':arg),managed.map((arg,i)=>i===5?'broken':arg),managed.map((arg,i)=>i===7?'another-run':arg)]){
  assert.equal(simulated(args,'281').code,2);
 }
});
