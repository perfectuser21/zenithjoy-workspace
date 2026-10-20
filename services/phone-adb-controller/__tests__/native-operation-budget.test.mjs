import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {beginNativeOperation} from '../native-operation-receipt.mjs';

// Replace only OS observation boundaries: the real operation state machine,
// watcher promises, timers, identity checks and receipt writes remain active.
function observations(t,{count=8,exited=false}={}){
 const root=41000,children=Array.from({length:count},(_,i)=>root+i+1);
 let watchers=0,closed=0,cost=0,clock=10000;
 const timeouts=[];
 t.mock.method(childProcess,'spawnSync',(_command,args,options)=>{
  const kind=args.at(-1),pid=Number(args.at(-2));
  if(cost){timeouts.push(options.timeout);clock+=Math.min(cost,options.timeout);}
  if(cost&&options.timeout<cost)return {status:null,stdout:'',error:{code:'ETIMEDOUT'}};
  const value=kind==='children'?children:kind==='group'?children:{pid,ppid:pid===root?1:root,uid:501,pgid:root,start_identity:'birth-'+pid};
  return {status:0,stdout:JSON.stringify(value)};
 });
 t.mock.method(childProcess,'spawn',()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();watchers++;
  child.kill=()=>{closed++;queueMicrotask(()=>child.emit('close'));return true;};
  queueMicrotask(()=>child.stdout.emit('data',exited?'READY\nEXIT\n':'READY\n'));
  return child;
 });
 syncBuiltinESMExports();
 const dir=mkdtempSync(join(tmpdir(),'native-budget-'));
 const operation=beginNativeOperation({runDir:dir,operationId:'bounded-tail',runId:'run__a1',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'owner',activity:'preflight'});
 t.after(async()=>{try{await operation.stop(null,0,null);}finally{t.mock.restoreAll();syncBuiltinESMExports();rmSync(dir,{recursive:true,force:true});}});
 return {operation,root,timeouts,counts:()=>({watchers,closed}),clock:()=>clock,
  advance:ms=>{clock+=ms;},clocked:()=>t.mock.method(performance,'now',()=>clock),
  slowInspections:()=>{cost=350;t.mock.method(performance,'now',()=>clock);}};
}

test('停止多个未确认watcher共用尾段预算，不逐PID累计200ms', {timeout:5000},async t=>{
 const f=observations(t);await f.operation.started(f.root);
 const start=performance.now();const receipt=await f.operation.stop(null,0,null);const elapsed=performance.now()-start;
 assert.equal(receipt.execution_stopped,false);assert.equal(receipt.status,'unknown');
 assert.equal(f.counts().closed,f.counts().watchers,'退出观测器必须全部关闭');
 assert.ok(elapsed<1200,`停止尾段累计耗时 ${elapsed.toFixed(1)}ms，不能按PID逐个等待`);
});

test('同步身份观测也扣同一尾段剩余预算',async t=>{
 const f=observations(t,{count:8,exited:true});await f.operation.started(f.root);f.slowInspections();
 const start=f.clock();const receipt=await f.operation.stop(null,0,null);
 assert.equal(receipt.execution_stopped,false);
 assert.ok(f.clock()-start<=1000,`同步观测累计 ${f.clock()-start}ms，缺共享截止`);
 assert.ok(f.timeouts.some(ms=>ms<350),'最后一次OS读取必须受剩余预算限制');
});

test('超量后代不能创建无限观测器且不得取得停止许可',async t=>{
 const f=observations(t,{count:80,exited:true});await f.operation.started(f.root);
 const receipt=await f.operation.stop(null,0,null);
 assert.equal(receipt.execution_stopped,false);assert.equal(receipt.status,'unknown');
 assert.ok(f.counts().watchers<=64,`观测器数量 ${f.counts().watchers} 未受有限集合约束`);
});


test('已核身份的TERM和KILL共享有限信号窗口且重复调用不续期',async t=>{
 const f=observations(t,{count:0,exited:true});await f.operation.started(f.root);f.clocked();
 const signals=[];t.mock.method(process,'kill',(pid,signal)=>{signals.push({pid,signal});return true;});
 assert.equal(await f.operation.signalTargets('SIGTERM'),1);
 f.advance(1000);assert.equal(await f.operation.signalTargets('SIGKILL'),1,'原有1秒后KILL仍须经过精确身份检查');
 f.advance(5000);assert.equal(await f.operation.signalTargets('SIGKILL'),0,'耗尽后不能重置观测截止');
 assert.deepEqual(signals,[{pid:f.root,signal:'SIGTERM'},{pid:f.root,signal:'SIGKILL'}]);
 const receipt=await f.operation.stop(null,0,null);assert.equal(receipt.execution_stopped,false);
});
