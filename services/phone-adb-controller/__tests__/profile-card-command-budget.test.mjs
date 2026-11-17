import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
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
`;const args=[...argv];args[1]=script;const r=spawnSync('/usr/bin/python3',['-c',program,helper,owner,JSON.stringify(args)],{encoding:'utf8',env:{...process.env,DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS:'1',WFR_NATIVE_UNKNOWN_FILE:unknown},timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1)).code,124);assert.match(readFileSync(unknown,'utf8'),/guard_canceled_or_timeout/);assert.equal(readFileSync(owner,'utf8'),'fixture-owner\n');const ids=JSON.parse(readFileSync(pids));for(const pid of ids){const p=spawnSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'});assert.ok(p.status!==0||p.stdout.trim().startsWith('Z'),'live process '+pid);}
 }finally{rmSync(root,{recursive:true,force:true});}});
test('frozen actual host phone subprocess timeout leaves at least60s above the new command cap',()=>{const f=JSON.parse(readFileSync(new URL('./fixtures/tool-admission-wiring.json',import.meta.url))),source=f['tools.py'].source;assert.match(source,/return subprocess\.run\(ssh\(c,approved\),capture_output=True,text=True,timeout=420\)/);assert.equal(420-360,60);});
