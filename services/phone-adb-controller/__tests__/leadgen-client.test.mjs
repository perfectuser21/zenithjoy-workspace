import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {execInput,createRpc,RPC_FILES} from '../leadgen-client.mjs';

const frozen={deployment:{source_commit:'a'.repeat(40)},files:Object.fromEntries(RPC_FILES.map(path=>['runtime/'+path,'b'.repeat(64)]))};
test('只读Commander丢失SSH回执时有界重试；仍按原总预算',async()=>{
 const calls=[];const rpc=createRpc({frozen,execute:async(_cmd,_args,opts)=>{
  calls.push(opts.timeoutMs);return calls.length===1?{code:255,stdout:'',stderr:'transport closed'}:{code:0,stdout:JSON.stringify({ok:true,decision:{action:'continue',reason:'真实回执'}}),stderr:''};
 }});
 const r=await rpc({kind:'commander',receipt:{}},{timeoutMs:1000});assert.equal(r.decision.action,'continue');assert.equal(calls.length,2);assert.ok(calls[1]<=calls[0]);
});
test('队列写入和版本校验失败不得自动重跑',async()=>{
 for(const kind of ['queue','commander']){
  let calls=0;const rpc=createRpc({frozen,execute:async()=>{calls++;return kind==='queue'?{code:255,stdout:'',stderr:''}:{code:1,stdout:JSON.stringify({ok:false,error:'RPC_SOURCE_BYTES_MISMATCH'}),stderr:''};}});
  await assert.rejects(rpc({kind},{timeoutMs:1000}));assert.equal(calls,1);
 }
});

// 实际启动两层进程；模拟会忽略SIGTERM的设备脚本，不能靠mock声称子进程已停止。
for(const failure of ['deadline','output_limit']){
 test(`执行${failure}后等待自有父子进程退出，返回后不得继续操作`,{skip:process.platform==='win32'},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'leadgen-owned-process-'));
  const ids=join(dir,'pids.json'),heartbeat=join(dir,'heartbeat');
  const childCode=`const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'.'),30);${failure==='output_limit'?"setTimeout(()=>process.stdout.write('x'.repeat(9*1024*1024)),150);":''}`;
  const code=`const fs=require('fs'),{spawn}=require('child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(ids)},JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000);`;
  try{
   await assert.rejects(execInput(process.execPath,['-e',code],{timeoutMs:failure==='deadline'?600:4000}),failure==='deadline'?/EXECUTION_DEADLINE/:/EXECUTION_OUTPUT_LIMIT/);
   const before=readFileSync(heartbeat,'utf8').length;
   await delay(180);
   assert.equal(readFileSync(heartbeat,'utf8').length,before,'返回失败后仍有旧设备子进程继续动作');
  }finally{
   // 红灯实现会遗留测试进程；仅清理此测试记录的PID，不触碰其他进程。
   try{const pids=JSON.parse(readFileSync(ids,'utf8'));for(const pid of [pids.child,pids.parent])try{process.kill(pid,'SIGKILL');}catch{}}catch{}
   rmSync(dir,{recursive:true,force:true});
  }
 });
}

test('正常执行保留stdout/stderr与真实退出码',async()=>{
 const result=await execInput(process.execPath,['-e',"process.stdout.write('real-output');process.stderr.write('real-error');process.exitCode=7;"],{timeoutMs:3000});
 assert.deepEqual(result,{code:7,stdout:'real-output',stderr:'real-error'});
});
