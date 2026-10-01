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
  const reg=join(dir,'registry.tsv'), adb=join(dir,'adb'), ssh=join(dir,'ssh');
  writeFileSync(reg,'p1\tSER1\tMODEL\t1199\t2663\n');
  writeFileSync(adb,`#!/bin/sh\nprintf '%s\\n' "$*" >> "$TEST_DIR/adb.log"\ncase "$*" in\n *get-state*) echo device;;\n *'getprop ro.product.model'*) echo MODEL;;\n *'dumpsys window'*) echo 'mCurrentFocus=Window{abc u0 com.android.launcher/.Launcher}';;\n *' pull '*) for last; do :; done; printf fake > "$last";;\nesac\nexit 0\n`,{mode:0o755});
  writeFileSync(ssh,`#!/bin/sh\nprintf '%s\\n' "$*" >> "$TEST_DIR/ssh.log"\n[ -f "$TEST_DIR/ssh-fail" ] && exit 255\ncat "$TEST_DIR/tasks.json"\n`,{mode:0o755});
  writeFileSync(join(dir,'tasks.json'),'[]');
  const env={...process.env,TEST_DIR:dir,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_ADB_BIN:adb,DOUYIN_PHONE_TMP_ROOT:join(dir,'tmp'),DOUYIN_PYTHON_BIN:python,DOUYIN_LOCK_SSH_BIN:ssh};
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
 const c=setup(t); const p=spawn('zsh',[script,'--profile','p1','with-lock','probe','--','sh','-c','touch "$TEST_DIR/ready"; exec sleep 30'],{env:c.env,stdio:'ignore'});
 t.after(()=>p.kill('SIGKILL'));
 await new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const tick=()=>existsSync(join(c.dir,'ready'))?resolve():Date.now()>deadline?reject(Error('子命令未启动')):setTimeout(tick,20);tick();});
 const exited=new Promise(resolve=>p.once('exit',(code,signal)=>resolve({code,signal}))); p.kill('SIGTERM');
 const r=await exited;assert.equal(r.code,143);assert.equal((c.actions().match(/am force-stop/g)||[]).length,1);assert.ok(!existsSync(c.lock));
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
