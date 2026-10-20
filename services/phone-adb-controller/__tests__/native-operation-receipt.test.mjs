import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {execInput} from '../leadgen-client.mjs';
import {beginNativeOperation,readNativeOperation,receiptPath} from '../native-operation-receipt.mjs';

test('两套 run 的原生收据只读回本 run，同 ID 不覆盖且不泄漏命令参数', {skip:process.platform==='win32'},async()=>{
 const a=mkdtempSync(join(tmpdir(),'native-receipt-a-')),b=mkdtempSync(join(tmpdir(),'native-receipt-b-'));
 const operationId='same-operation',base={operationId,runId:'run-a',taskId:'task-a',profile:'profile-a',serial:'serial-a',sourceCommit:'a'.repeat(40),owner:'owner-a',activity:'preflight'};
 try{
  const result=await execInput(process.execPath,['-e',"process.stderr.write('PRIVATE_STDERR_MUST_NOT_APPEAR');setTimeout(()=>process.exit(0),100)",'PRIVATE_ARG_MUST_NOT_APPEAR'],{timeoutMs:3000,receipt:{...base,runDir:a}});
  assert.equal(result.code,0);
  const good=readNativeOperation(a,operationId),wrong=readNativeOperation(b,operationId);
  assert.equal(good.execution_stopped,true);assert.equal(good.run_id,'run-a');assert.equal(wrong.execution_stopped,false);
  assert.equal(statSync(receiptPath(a,operationId)).mode&0o777,0o600);
  assert.doesNotMatch(readFileSync(receiptPath(a,operationId),'utf8'),/PRIVATE_ARG_MUST_NOT_APPEAR/);
  assert.doesNotMatch(readFileSync(receiptPath(a,operationId),'utf8'),/PRIVATE_STDERR_MUST_NOT_APPEAR/);
  const cli=fileURLToPath(new URL('../native-operation-receipt.mjs',import.meta.url));
  for(let i=0;i<2;i++){
   const readback=spawnSync(process.execPath,[cli,'readback','--run-dir',a,'--operation-id',operationId],{encoding:'utf8'});
   assert.equal(readback.status,0);assert.equal(JSON.parse(readback.stdout).execution_stopped,true);
  }
  const crossed=spawnSync(process.execPath,[cli,'readback','--run-dir',b,'--operation-id',operationId],{encoding:'utf8'});
  assert.equal(crossed.status,1);assert.equal(JSON.parse(crossed.stdout).execution_stopped,false);
  assert.throws(()=>beginNativeOperation({...base,runDir:a}),/EEXIST/);
  assert.throws(()=>receiptPath(a,'../escape'),/NATIVE_OPERATION_ID_INVALID/);
  writeFileSync(receiptPath(a,operationId),JSON.stringify({...good,argv:'PRIVATE_ARG_MUST_NOT_APPEAR'}));
  assert.equal(readNativeOperation(a,operationId).execution_stopped,false);
  assert.doesNotMatch(JSON.stringify(readNativeOperation(a,operationId)),/PRIVATE_ARG_MUST_NOT_APPEAR/);
 }finally{rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true});}
});
test('脱离原进程组的子孙即使关闭也不能给出停止正证', {skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-escaped-'));
 const child=`process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),2500)`;
 const parent=`const {spawn}=require('child_process');process.on('SIGTERM',()=>{});spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'inherit'});setTimeout(()=>process.exit(0),2500)`;
 const receipt={runDir:dir,operationId:'escaped',runId:'run',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'owner',activity:'collect_videos'};
 try{
  await assert.rejects(execInput(process.execPath,['-e',parent],{timeoutMs:500,receipt}),error=>{assert.equal(error.executionStopped,false);return true;});
  assert.equal(readNativeOperation(dir,'escaped').execution_stopped,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('明确未 spawn 的原生失败保持未启动正证',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-no-spawn-'));
 const receipt={runDir:dir,operationId:'not-started',runId:'run',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'owner',activity:'preflight'};
 try{
  await assert.rejects(execInput(join(dir,'missing-executable'),[],{timeoutMs:1000,receipt}),error=>{assert.equal(error.message,'EXECUTION_START_FAILED');assert.equal(error.executionStopped,true);return true;});
  const proof=readNativeOperation(dir,'not-started');assert.equal(proof.status,'not_started');assert.equal(proof.execution_stopped,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('停止当前 owner 时另一进程组仍继续心跳', {skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-other-owner-')),heartbeat=join(dir,'other-heartbeat');
 const other=spawn(process.execPath,['-e',`const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'.'),20);setTimeout(()=>process.exit(0),2500)`],{detached:true,stdio:'ignore'});
 const ended=new Promise(r=>other.once('close',r));
 const receipt={runDir:dir,operationId:'current-owner',runId:'run',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'current',activity:'preflight'};
 try{
  await assert.rejects(execInput(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{timeoutMs:400,receipt}),/EXECUTION_DEADLINE/);
  const before=existsSync(heartbeat)?readFileSync(heartbeat).length:0;
  await new Promise(r=>setTimeout(r,150));
  assert.ok(readFileSync(heartbeat).length>before,'另一 owner 的心跳必须继续');
 }finally{await ended;rmSync(dir,{recursive:true,force:true});}
});
test('受控输出上限也留下独立停止收据', {skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-output-limit-'));
 const receipt={runDir:dir,operationId:'output-limit',runId:'run',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'owner',activity:'collect_videos'};
 try{
  await assert.rejects(execInput(process.execPath,['-e',`process.on('SIGTERM',()=>{});setTimeout(()=>process.stdout.write('x'.repeat(9*1024*1024)),100);setInterval(()=>{},1000)`],{timeoutMs:4000,receipt}),/EXECUTION_OUTPUT_LIMIT/);
  assert.equal(readNativeOperation(dir,'output-limit').execution_stopped,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('受控信号返回 EPERM 时不能给出停止正证', {skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-eperm-'));
 const receipt={runDir:dir,operationId:'eperm',runId:'run',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'owner',activity:'preflight'};
 const originalKill=process.kill;
 try{
  process.kill=function(pid,signal){if(pid!==process.pid){const error=Error('fixture EPERM');error.code='EPERM';throw error;}return originalKill(pid,signal);};
  await assert.rejects(execInput(process.execPath,['-e','setTimeout(()=>process.exit(0),1500)'],{timeoutMs:200,receipt}),error=>{assert.equal(error.executionStopped,false);return true;});
  assert.equal(readNativeOperation(dir,'eperm').execution_stopped,false);
 }finally{process.kill=originalKill;rmSync(dir,{recursive:true,force:true});}
});
test('进程身份探针不可用时正常退出也不能当停止正证',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-inspector-missing-'));
 const receipt={runDir:dir,operationId:'inspector-missing',runId:'run',taskId:'task',profile:'profile',serial:'serial',sourceCommit:'a'.repeat(40),owner:'owner',activity:'preflight'};
 const prior=process.env.PATH;
 try{
  process.env.PATH='';
  await assert.rejects(execInput(process.execPath,['-e','setTimeout(()=>process.exit(0),100)'],{timeoutMs:1000,receipt}),error=>{assert.equal(error.message,'NATIVE_OPERATION_RECEIPT_UNKNOWN');assert.equal(error.executionStopped,false);return true;});
  assert.equal(readNativeOperation(dir,'inspector-missing').execution_stopped,false);
 }finally{process.env.PATH=prior;rmSync(dir,{recursive:true,force:true});}
});
