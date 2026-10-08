// 297d7f32：真实控制器 + 隔离锁目录/fakeADB，人工会话退出必须收尾，不操作手机。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const script = new URL('../douyin-phone-adb', import.meta.url).pathname;
const python = spawnSync('sh', ['-c', 'command -v python3'], {encoding:'utf8'}).stdout.trim();
function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'phone-lock-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const reg=join(dir,'registry.tsv'), adb=join(dir,'adb'), ssh=join(dir,'ssh'), pgrep=join(dir,'pgrep');
  writeFileSync(pgrep,'#!/bin/sh\n[ -f "$TEST_DIR/local-running" ] && exit 0\nexit 1\n',{mode:0o755});
  writeFileSync(reg,'p1\tSER1\tMODEL\t1199\t2663\n');
  writeFileSync(adb,`#!/bin/sh\nprintf '%s\\n' "$*" >> "$TEST_DIR/adb.log"\ncase "$*" in\n *get-state*) echo device;;\n *'getprop ro.product.model'*) echo MODEL;;\n *'dumpsys window'*) echo 'mCurrentFocus=Window{abc u0 com.android.launcher/.Launcher}';;\n *' pull '*) for last; do :; done; printf fake > "$last";;\nesac\nexit 0\n`,{mode:0o755});
  writeFileSync(ssh,`#!/bin/sh\nprintf '%s\\n' "$*" >> "$TEST_DIR/ssh.log"\n[ -f "$TEST_DIR/ssh-fail" ] && exit 255\ncat "$TEST_DIR/tasks.json"\n`,{mode:0o755});
  writeFileSync(join(dir,'tasks.json'),'[]');
  const env={...process.env,TEST_DIR:dir,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_ADB_BIN:adb,DOUYIN_PHONE_TMP_ROOT:join(dir,'tmp'),DOUYIN_PYTHON_BIN:python,DOUYIN_LOCK_SSH_BIN:ssh,DOUYIN_LOCK_PGREP_BIN:pgrep};
  const lock=join(dir,'tmp','locks','SER1.lock');
  const run=(...args)=>spawnSync('zsh',[script,'--profile','p1',...args],{env,encoding:'utf8',timeout:20000});
  const stale=(owner='probe-btr-budget')=>{mkdirSync(lock,{recursive:true});writeFileSync(join(lock,'owner'),owner+'\n');writeFileSync(join(lock,'acquired_at'),String(Math.floor(Date.now()/1000)-1900));};
  const actions=()=>existsSync(join(dir,'adb.log'))?readFileSync(join(dir,'adb.log'),'utf8'):'';
  return {dir,env,lock,run,stale,actions};
}
test('with-lock 正常退出：命令先持锁，关App在释放之前，锁最后free',t=>{
 const c=setup(t); const r=c.run('with-lock','probe','--','sh','-c','test "$(cat "$TEST_DIR/tmp/locks/SER1.lock/owner")" = probe');
 assert.equal(r.status,0,r.stderr); assert.match(c.actions(),/am force-stop/); assert.ok(!existsSync(c.lock));
 assert.match(r.stdout,/lock=released owner=probe/);
});
test('with-lock 失败仍收尾并保留子命令退出码',t=>{
 const c=setup(t); const r=c.run('with-lock','probe','--','sh','-c','exit 37');
 assert.equal(r.status,37,r.stderr); assert.match(c.actions(),/am force-stop/); assert.ok(!existsSync(c.lock));
});
test('with-lock 拿不到别人的锁，不执行命令、不清场',t=>{
 const c=setup(t); assert.equal(c.run('lock-acquire','other').status,0);
 const r=c.run('with-lock','probe','--','sh','-c','touch "$TEST_DIR/ran"');
 assert.notEqual(r.status,0); assert.ok(!existsSync(join(c.dir,'ran')));assert.equal(c.actions(),'');
 assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),'other');
});
test('with-lock 锁已易主不关App也不释放后来者',t=>{
 const c=setup(t); const r=c.run('with-lock','probe','--','sh','-c','printf other > "$TEST_DIR/tmp/locks/SER1.lock/owner"');
 assert.equal(r.status,0,r.stderr);assert.equal(c.actions(),'');assert.equal(readFileSync(join(c.lock,'owner'),'utf8'),'other');
});
test('with-lock TERM：终止子进程，收尾一次且退出143',async t=>{
 const c=setup(t); const p=spawn('zsh',[script,'--profile','p1','with-lock','probe','--','sh','-c','touch "$TEST_DIR/ready"; exec sleep 30'],{env:c.env,stdio:['ignore','pipe','pipe']});
 let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);
 t.after(()=>p.kill('SIGKILL'));
 await new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const tick=()=>existsSync(join(c.dir,'ready'))?resolve():Date.now()>deadline?reject(Error('子命令未启动')):setTimeout(tick,20);tick();});
 const exited=new Promise(resolve=>p.once('exit',(code,signal)=>resolve({code,signal}))); p.kill('SIGTERM');
 const r=await exited;assert.equal(r.code,143);assert.equal((c.actions().match(/am force-stop/g)||[]).length,1,output);assert.ok(!existsSync(c.lock));
});
test('lock-status 过期可接管，损坏时间戳不崩溃',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.lock,'acquired_at'),'bad');const r=c.run('lock-status');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=stale.*reclaimable=true/);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
test('lock-reap：过期无在跑任务，清场回收并记原持有者',t=>{
 const c=setup(t);c.stale();const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/lock=reaped.*owner=probe-btr-budget/);assert.match(c.actions(),/am force-stop/);assert.ok(!existsSync(c.lock));
});
for (const [name,tasks] of [
 ['owner对应任务',[{id:'probe-btr-budget',status:'in_progress',task_type:'dev',payload:{}}]],
 ['同设备任务',[{id:'other',status:'in_progress',task_type:'qiumi_task',payload:{phone:{serial:'SER1'}}}]],
 ['设备不明',[{id:'other',status:'in_progress',task_type:'qiumi_task',payload:{}}]],
 ['API数据异常',{error:'unavailable'}],
]) test(`lock-reap ${name}保留锁与现场`,t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.dir,'tasks.json'),JSON.stringify(tasks));const r=c.run('lock-reap');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=preserved/);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
test('lock-reap Brain请求失败保留',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.dir,'ssh-fail'),'1');const r=c.run('lock-reap');
 assert.equal(r.status,0,r.stderr);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
test('lock-reap 本地活PID保留',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.lock,'pid'),String(process.pid));const r=c.run('lock-reap');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=preserved/);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
test('lock-reap 超过200行时扩大读取，后段owner任务阻止回收',t=>{
 const c=setup(t);c.stale();const tasks=Array.from({length:201},(_,i)=>({id:`task-${i}`,status:'in_progress',task_type:'dev',payload:{}}));tasks[200].id='probe-btr-budget';
 writeFileSync(join(c.dir,'tasks.json'),JSON.stringify(tasks));const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);
 assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');assert.match(readFileSync(join(c.dir,'ssh.log'),'utf8'),/limit=400/);
});
test('lock-reap 满12800行拒绝把截断列表当空闲',t=>{
 const c=setup(t);c.stale();const tasks=Array.from({length:12800},(_,i)=>({id:`task-${i}`,status:'in_progress',task_type:'dev',payload:{}}));
 writeFileSync(join(c.dir,'tasks.json'),JSON.stringify(tasks));const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/lock=preserved/);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
test('lock-acquire 不抢wrapper活PID的过期锁；释放后可正常重新拿锁',t=>{
 const c=setup(t);c.stale('first');writeFileSync(join(c.lock,'pid'),String(process.pid));const busy=c.run('lock-acquire','second');assert.notEqual(busy.status,0);
 assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),'first');assert.equal(c.run('lock-release','first').status,0);
 assert.equal(c.run('lock-acquire','second').status,0);assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),'second');
});
test('with-lock close-app失败也释放且保留原命令错误',t=>{
 const c=setup(t);writeFileSync(join(c.dir,'adb'),'#!/bin/sh\nexit 1\n',{mode:0o755});const r=c.run('with-lock','probe','--','sh','-c','exit 37');
 assert.equal(r.status,37,r.stderr);assert.ok(!existsSync(c.lock));assert.match(r.stderr,/cleanup failed/);
});
test('lock-reap fresh锁不查询Brain也不操作设备',t=>{
 const c=setup(t);assert.equal(c.run('lock-acquire','other').status,0);const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);
 assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');assert.ok(!existsSync(join(c.dir,'ssh.log')));
});
test('巡检接入每分钟claimer且helper与控制器一起部署两处',()=>{
 const base=new URL('../',import.meta.url);const claimer=readFileSync(new URL('device-job-claimer.sh',base),'utf8');
 assert.match(claimer,/lock-reap/);assert.match(claimer,/lock-status/);
 const deploy=readFileSync(new URL('deploy.sh',base),'utf8');assert.match(deploy,/DEVICE_CTL_FILES=\([\s\S]*phone-lock-lib\.sh[\s\S]*phone-lock-helper\.py[\s\S]*?\)/);
});
test('lock-reap 已明确属于另一手机的任务不阻止本机回收（短profile不误匹配priority P1）',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.dir,'tasks.json'),JSON.stringify([{id:'other',status:'in_progress',task_type:'qiumi_task',priority:'P1',payload:{phone:{serial:'OTHER',profile:'other-profile'}}}]));
 const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=reaped/);assert.ok(!existsSync(c.lock));
});
test('lock-reap 清场期间互斥guard阻止并发拿锁，清场结束后可再拿',async t=>{
 const c=setup(t), adb=join(c.dir,'adb');c.stale();const original=readFileSync(adb,'utf8');
 writeFileSync(adb,original.replace('case "$*" in','case "$*" in\n *"am force-stop"*) touch "$TEST_DIR/cleaning"; tries=0; while [ ! -f "$TEST_DIR/proceed" ]; do tries=$((tries+1)); [ "$tries" -lt 600 ] || exit 1; sleep 0.02; done; exit 0;;'),{mode:0o755});
 const p=spawn('zsh',[script,'--profile','p1','lock-reap'],{env:c.env,stdio:'ignore'});t.after(()=>p.kill('SIGKILL'));
 const ended=new Promise(resolve=>p.once('exit',code=>resolve(code)));
 await new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const tick=()=>existsSync(join(c.dir,'cleaning'))?resolve():Date.now()>deadline?reject(Error('未开始清场')):setTimeout(tick,20);tick();});
 const r=c.run('lock-acquire','new-owner'), owner=readFileSync(join(c.lock,'owner'),'utf8').trim();
 writeFileSync(join(c.dir,'proceed'),'1');const code=await ended;
 assert.notEqual(r.status,0);assert.match(r.stderr,/lock operation busy/);assert.match(r.stderr,/lock is held by another run/);
 assert.equal(owner,'probe-btr-budget');assert.equal(code,0);assert.equal(c.run('lock-acquire','new-owner').status,0);
});

test('lock-reap 本地旧执行链活进程保留',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.dir,'local-running'),'1');const r=c.run('lock-reap');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=preserved.*local-process/);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
test('lock-reap device_job缺设备字段保留原锁与现场',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.dir,'tasks.json'),JSON.stringify([{id:'device-job',status:'in_progress',task_type:'device_job',payload:{}}]));
 const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=preserved.*device-uncertain/);assert.ok(existsSync(c.lock));assert.equal(c.actions(),'');
});
for (const ignoreTerm of [false,true]) test(`with-lock 子进程建组前TERM必须及时退出且不执行业务命令（屏蔽TERM=${ignoreTerm}）`,async t=>{
 const c=setup(t), launcher=join(c.dir,'slow-python');
 writeFileSync(launcher,`#!${python}\nimport os,sys,time,signal\nif len(sys.argv)>2 and sys.argv[2]=='run':\n if ${ignoreTerm ? 'True' : 'False'}: signal.signal(signal.SIGTERM,signal.SIG_IGN)\n open(os.environ['TEST_DIR']+'/pre-session','w').write(str(os.getpid()))\n time.sleep(8)\nos.execv(${JSON.stringify(python)},[${JSON.stringify(python)},*sys.argv[1:]])\n`,{mode:0o755});
 const p=spawn('zsh',[script,'--profile','p1','with-lock','probe','--','sh','-c','touch "$TEST_DIR/business-started"; exec sleep 30'],{env:{...c.env,DOUYIN_PYTHON_BIN:launcher},stdio:'ignore'});
 let child=0;t.after(()=>{for(const pid of [child,-child]){if(pid)try{process.kill(pid,'SIGKILL');}catch{}}p.kill('SIGKILL');});
 const exited=new Promise(resolve=>p.once('exit',(code,signal)=>resolve({code,signal})));
 await new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const tick=()=>existsSync(join(c.dir,'pre-session'))?resolve():Date.now()>deadline?reject(Error('未进入建组窗口')):setTimeout(tick,20);tick();});
 child=Number(readFileSync(join(c.dir,'pre-session'),'utf8'));p.kill('SIGTERM');
 const r=await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),3000))]);
 assert.equal(r.timeout,undefined,'TERM未在建组前结束launcher');assert.equal(r.code,143);assert.ok(!existsSync(join(c.dir,'business-started')));assert.ok(!existsSync(c.lock));
});
test('lock-reap device_job明确属于别机则允许回收',t=>{
 const c=setup(t);c.stale();writeFileSync(join(c.dir,'tasks.json'),JSON.stringify([{id:'other-job',status:'in_progress',task_type:'device_job',payload:{device_serial:'OTHER'}}]));
 const r=c.run('lock-reap');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/lock=reaped/);assert.ok(!existsSync(c.lock));
});


test('qiumi合法a开头任务号不被当成attempt裁剪，完整原run保留', t => {
  const c=setup(t), run='qiumi-a1234567-1791427263848';
  const r=c.run('lock-acquire',run);
  assert.equal(r.status,0,r.stderr);
  assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);
  assert.equal(c.run('lock-release',run+':a2').status,0);
});
test('不同运行不能以短前缀认领或释放别人的锁', t => {
  const c=setup(t), run='qiumi-e1234567-1791427263848';
  assert.equal(c.run('lock-acquire',run).status,0);
  assert.notEqual(c.run('lock-acquire','qiumi').status,0);
  assert.notEqual(c.run('lock-release','qiumi').status,0);
  assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);
});
test('同原run的明确attempt阶段变体仍共享同一锁', t => {
  const c=setup(t), run='qiumi-a1234567-1791427263848';
  assert.equal(c.run('lock-acquire',run).status,0);
  const second=c.run('lock-acquire',run+'-a2-cleanup-1');
  assert.equal(second.status,0,second.stderr);
  assert.match(second.stdout,/idempotent=true/);
  assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);
  assert.equal(c.run('lock-release',run+'-a3-cleanup-1').status,0);
});

test('独立清理用原子精确释放：回读后owner变化不能释放新锁', t => {
  const c=setup(t), run='qiumi-e1234567-1791427263848';
  assert.equal(c.run('lock-acquire',run).status,0);
  writeFileSync(join(c.lock,'owner'),run+'-a2-preflight-1\n');
  assert.notEqual(c.run('lock-release-exact',run).status,0);
  assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run+'-a2-preflight-1');
  writeFileSync(join(c.lock,'owner'),run+'\n');
  const r=c.run('lock-release-exact',run);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,new RegExp('lock=released owner='+run));
  assert.ok(!existsSync(c.lock));
});

for (const condition of ['other','expired','free']) test(`带精确owner的前台命令拒绝${condition}锁，零手机动作`,t=>{
 const c=setup(t), run='qiumi-a1234567-1791427263848';
 if(condition==='other')c.run('lock-acquire','qiumi-b1234567-1791427263848');
 if(condition==='expired')c.stale(run);
 const r=c.run('--lock-owner',run,'close-app');
 assert.notEqual(r.status,0);assert.match(r.stderr,/required lock owner|lock lease budget/);assert.equal(c.actions(),'');
});
test('带精确owner的有效前台命令可执行',t=>{
 const c=setup(t), run='qiumi-a1234567-1791427263848';assert.equal(c.run('lock-acquire',run).status,0);
 const r=c.run('--lock-owner',run,'close-app');assert.equal(r.status,0,r.stderr);assert.match(c.actions(),/am force-stop/);
 assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);
});
test('前台动作整个期间guard阻止并发释放或易主',async t=>{
 const c=setup(t), run='qiumi-a1234567-1791427263848';c.run('lock-acquire',run);
 const adb=join(c.dir,'adb'),original=readFileSync(adb,'utf8');
 writeFileSync(adb,original.replace('case "$*" in','case "$*" in\n *"am force-stop"*) touch "$TEST_DIR/acting"; tries=0; while [ ! -f "$TEST_DIR/proceed" ]; do tries=$((tries+1)); [ "$tries" -lt 200 ] || exit 1; sleep 0.02; done; exit 0;;'),{mode:0o755});
 const p=spawn('zsh',[script,'--profile','p1','--lock-owner',run,'close-app'],{env:c.env,stdio:'ignore'});t.after(()=>p.kill('SIGKILL'));
 const ended=new Promise(resolve=>p.once('exit',code=>resolve(code)));
 await new Promise(resolve=>{const deadline=Date.now()+1000;const tick=()=>existsSync(join(c.dir,'acting'))||Date.now()>deadline?resolve():setTimeout(tick,20);tick();});
 assert.ok(existsSync(join(c.dir,'acting')),'有效前台动作未开始');
 const r=c.run('lock-release-exact',run);assert.notEqual(r.status,0);assert.match(r.stderr,/lock operation busy/);
 writeFileSync(join(c.dir,'proceed'),'1');assert.equal(await ended,0);assert.equal(c.run('lock-release-exact',run).status,0);
});

for(const command of ['close-app','lock-release-exact']) test(`环境guard字符串不能伪造${command}的真实互斥`,t=>{
 const c=setup(t),run='qiumi-a1234567-1791427263848';c.run('lock-acquire',run);
 const label=command==='close-app'?'--lock-owner':command;
 const args=command==='close-app'?['--lock-owner',run,command]:[command,run];
 const r=spawnSync('zsh',[script,'--profile','p1',...args],{env:{...c.env,DOUYIN_LOCK_GUARDED:'SER1:'+label},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/guard.*descriptor|guard.*ownership/);
 assert.equal(c.actions(),'');assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);
});

test('独立前台复合命令有整条硬截止并终止子进程，保留原锁',t=>{
 const c=setup(t), run='qiumi-a1234567-1791427263848';c.run('lock-acquire',run);
 const adb=join(c.dir,'adb'),original=readFileSync(adb,'utf8');
 writeFileSync(adb,original.replace('case "$*" in','case "$*" in\n *"am force-stop"*) touch "$TEST_DIR/acting"; sleep 2; touch "$TEST_DIR/late-ui"; exit 0;;'),{mode:0o755});
 const r=spawnSync('zsh',[script,'--profile','p1','--lock-owner',run,'close-app'],{env:{...c.env,DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS:'1'},encoding:'utf8',timeout:10000});
 assert.equal(r.status,124,r.stderr);assert.match(r.stderr,/guarded command timeout/);assert.ok(!existsSync(join(c.dir,'late-ui')));
 assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);assert.equal(c.run('lock-release-exact',run).status,0);
});

test('取消独立前台命令终止整个原进程组，不留下继续动手机的孩子',async t=>{
 const c=setup(t),run='qiumi-a1234567-1791427263848';c.run('lock-acquire',run);
 const adb=join(c.dir,'adb'),original=readFileSync(adb,'utf8');
 writeFileSync(adb,original.replace('case "$*" in','case "$*" in\n *"am force-stop"*) touch "$TEST_DIR/acting"; sleep 2; touch "$TEST_DIR/late-ui"; exit 0;;'),{mode:0o755});
 const p=spawn('zsh',[script,'--profile','p1','--lock-owner',run,'close-app'],{env:c.env,stdio:'ignore'});t.after(()=>p.kill('SIGKILL'));
 const ended=new Promise(resolve=>p.once('exit',code=>resolve(code)));
 await new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const tick=()=>existsSync(join(c.dir,'acting'))?resolve():Date.now()>deadline?reject(Error('未开始动作')):setTimeout(tick,20);tick();});
 p.kill('SIGTERM');assert.equal(await ended,143);
 await new Promise(resolve=>setTimeout(resolve,2100));assert.ok(!existsSync(join(c.dir,'late-ui')));
 assert.equal(readFileSync(join(c.lock,'owner'),'utf8').trim(),run);assert.equal(c.run('lock-release-exact',run).status,0);
});

test('父命令在启动许可前已取消时，不再创建手机命令孩子',()=>{
 const helper=new URL('../phone-lock-helper.py',import.meta.url).pathname;
 const program=`import importlib.util,sys
s=importlib.util.spec_from_file_location('lock_helper',sys.argv[1]); m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def register(sig, handler):
 if sig==m.signal.SIGTERM: handler(sig,None)
m.signal.signal=register
def forbidden(*args,**kwargs): raise AssertionError('spawned after cancel')
m.subprocess.Popen=forbidden
try: m.bounded_command([],9)
except SystemExit as e: assert e.code==143
else: raise AssertionError('not canceled')
`;
 const r=spawnSync(python,['-c',program,helper],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('取消与根进程正常退出重叠时不能返回成功',t=>{
 const c=setup(t),helper=new URL('../phone-lock-helper.py',import.meta.url).pathname,owner=join(c.dir,'owner');writeFileSync(owner,'run\n');
 const program=`import importlib.util,sys,types
s=importlib.util.spec_from_file_location('lock_helper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
handlers={}
m.signal.signal=lambda sig,h:handlers.update({sig:h})
class Child:
 pid=123456789
 def wait(self,timeout):
  if timeout==0.1: handlers[m.signal.SIGTERM](m.signal.SIGTERM,None)
  return 0
m.subprocess.Popen=lambda *a,**k:Child()
m.os.killpg=lambda *a:None
m.subprocess.run=lambda *a,**k:types.SimpleNamespace(stdout='')
try: m.bounded_command([],9,sys.argv[2],'run')
except SystemExit as e: assert e.code==143,e.code
else: raise AssertionError('not canceled')
`;
 const r=spawnSync(python,['-c',program,helper,owner],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('超时owner首尾空格变化不能被吞掉当作原owner保留',t=>{
 const c=setup(t),run='qiumi-a1234567-1791427263848';c.run('lock-acquire',run);
 const adb=join(c.dir,'adb'),original=readFileSync(adb,'utf8');
 writeFileSync(adb,original.replace('case "$*" in',`case "$*" in\n *"am force-stop"*) printf ' ${run} ' > "$TEST_DIR/tmp/locks/SER1.lock/owner"; sleep 2; exit 0;;`),{mode:0o755});
 const r=spawnSync('zsh',[script,'--profile','p1','--lock-owner',run,'close-app'],{env:{...c.env,DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS:'1'},encoding:'utf8',timeout:10000});
 assert.notEqual(r.status,124);assert.match(r.stderr,/owner preservation unproven/);assert.equal(readFileSync(join(c.lock,'owner'),'utf8'),' '+run+' ');
});


for(const existing of ['same','other','stale']) test(`独立新认领${existing}已有锁一律拒绝且不续接`,t=>{
 const c=setup(t),run='qiumi-a1234567-1791427263848';
 if(existing==='stale') c.stale('other');else c.run('lock-acquire',existing==='same'?run:'other');
 const owner=readFileSync(join(c.lock,'owner'),'utf8'),stamp=readFileSync(join(c.lock,'acquired_at'),'utf8');
 const r=c.run('lock-acquire-new',run);assert.notEqual(r.status,0);assert.match(r.stderr,/fresh acquisition.*existing lock/);
 assert.equal(readFileSync(join(c.lock,'owner'),'utf8'),owner);assert.equal(readFileSync(join(c.lock,'acquired_at'),'utf8'),stamp);assert.equal(c.actions(),'');
});
test('独立新认领只有原子空锁取得者拿到acquired回执',t=>{
 const c=setup(t),run='qiumi-a1234567-1791427263848';const first=c.run('lock-acquire-new',run);
 assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/lock=acquired/);
 assert.notEqual(c.run('lock-acquire-new',run).status,0);assert.equal(c.actions(),'');
});

test('取消收尾owner的CRLF不能被文本换行转换冒认单LF',t=>{
 const c=setup(t),helper=new URL('../phone-lock-helper.py',import.meta.url).pathname,owner=join(c.dir,'owner');writeFileSync(owner,'run\r\n');
 const program=`import importlib.util,sys,types
s=importlib.util.spec_from_file_location('lock_helper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
handlers={}
m.signal.signal=lambda sig,h:handlers.update({sig:h})
class Child:
 pid=123456789
 def wait(self,timeout):
  if timeout==0.1: handlers[m.signal.SIGTERM](m.signal.SIGTERM,None)
  return 0
m.subprocess.Popen=lambda *a,**k:Child()
m.os.killpg=lambda *a:None
m.subprocess.run=lambda *a,**k:types.SimpleNamespace(stdout='')
try: m.bounded_command([],9,sys.argv[2],'run')
except RuntimeError as e: assert 'owner preservation unproven' in str(e)
else: raise AssertionError('CRLF owner was accepted')
`;
 const r=spawnSync(python,['-c',program,helper,owner],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
