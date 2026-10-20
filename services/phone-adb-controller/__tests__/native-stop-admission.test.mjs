import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';
import {runWorkflow} from '../activity-commander.mjs';
import {execInput,executionDidNotStart} from '../leadgen-client.mjs';

const root=new URL('..',import.meta.url).pathname;
function setup(execute){
 const dir=mkdtempSync(join(tmpdir(),'native-stop-admission-'));
 const env={HOME:dir,WFR_RUN_DIR:dir,P:'actual-profile',SERIAL:'ACTUAL-SERIAL',WFR_TAG:'owner',WFR_RUN_ID:'run',WFR_ATTEMPT:'a1',LEADGEN_LINE:'jinuo',DOUYIN_PHONE_ADB:join(dir,'missing-native-program')};
 const handlers=createHandlers({root,env,sourceCommit:'a'.repeat(40),taskId:'task',rpc:async()=>{throw Error('unexpected RPC');},execute:async(command,args,opts)=>opts.receipt?execute(command,args,opts):{code:0,stdout:'device\n',stderr:''}});
 handlers.state.currentActivity='preflight';handlers.state.budgetDeadline=Date.now()+30000;
 return {dir,env,handlers,close:()=>rmSync(dir,{recursive:true,force:true})};
}
async function outer(handlers){
 const calls={recovered:0,cleaned:0,quarantined:0};
 const result=await runWorkflow({activities:[{key:'preflight'},{key:'cleanup'}],context:{run_id:'run__a1',task_id:'task',source_commit:'a'.repeat(40)},handlers:{preflight:()=>handlers.preflight(),cleanup:async()=>{calls.cleaned++;return {}; }},commander:async()=>({action:'continue'}),record:async()=>{},recover:async()=>{calls.recovered++;return {status:'completed',execution_stopped:true};},quarantine:async()=>{calls.quarantined++;return {verified:true};}});
 return {result,calls};
}

test('原生命令非零退出的真实checked错误不可绕过停止未知屏障',async()=>{
 const f=setup(async()=>({code:7,stdout:'',stderr:'local fixture failure'}));
 try{
  const {result,calls}=await outer(f.handlers);
  assert.equal(calls.recovered,0);assert.equal(calls.cleaned,0);assert.equal(calls.quarantined,1);
  assert.equal(result.status,'failed');assert.equal(result.results[0].execution_stopped,false);
 }finally{f.close();}
});
for(const field of ['none','profile','serial','run_id','task_id','owner','source_commit','activity'])test('磁盘not_started不能洗白实际DEADLINE或身份错配：'+field,async()=>{
 const f=setup(async(command,args,opts)=>{
  const r=opts.receipt;
  const proof={version:1,operation_id:r.operationId,run_dir:r.runDir,run_id:r.runId,task_id:r.taskId,profile:r.profile,serial:r.serial,source_commit:r.sourceCommit,owner:r.owner,activity:r.activity,status:'not_started',execution_stopped:true,failure:'native_pre_spawn_error',processes:[]};
  if(field!=='none')proof[field]='wrong-identity';
  mkdirSync(join(r.runDir,'native-operations'),{recursive:true});
  writeFileSync(join(r.runDir,'native-operations',r.operationId+'.json'),JSON.stringify(proof));
  const error=Error('EXECUTION_DEADLINE');error.executionStopped=false;throw error;
 });
 try{
  const {result,calls}=await outer(f.handlers);
  assert.equal(calls.recovered,0);assert.equal(calls.cleaned,0);assert.equal(calls.quarantined,1);
  assert.equal(result.status,'failed');assert.equal(result.results[0].execution_stopped,false);
 }finally{f.close();}
});
test('真正prespawn失败仍可在原运行接手，不操作真实ADB',async()=>{
 const f=setup((command,args,opts)=>execInput(command,args,opts));
 try{
  const {result,calls}=await outer(f.handlers);
  assert.equal(calls.recovered,1);assert.equal(calls.cleaned,1);assert.equal(calls.quarantined,0);
  assert.equal(result.status,'completed');
 }finally{f.close();}
});
test('真实WeakMap未启动证明同时绑定原run设备及操作身份',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-pre-spawn-scope-'));
 const command=join(dir,'missing-program'),args=[];
 const receipt={runDir:dir,operationId:'prespawn',runId:'run__a1',taskId:'task',profile:'profile',serial:'SERIAL',sourceCommit:'a'.repeat(40),owner:'owner',activity:'preflight'};
 try{
  let original;
  await assert.rejects(execInput(command,args,{receipt,timeoutMs:1000}),error=>{original=error;return error.message==='EXECUTION_START_FAILED';});
  assert.equal(executionDidNotStart(original,command,args,receipt),true);
  for(const key of Object.keys(receipt))assert.equal(executionDidNotStart(original,command,args,{...receipt,[key]:'other'}),false,key+' must be bound');
  assert.equal(executionDidNotStart(Error('EXECUTION_START_FAILED'),command,args,receipt),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
