import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';
import {runWorkflow} from '../activity-commander.mjs';
import {execInput,executionDidNotStart} from '../leadgen-client.mjs';
import * as workflow from '../leadgen-workflow.mjs';
import {createActivityRecovery} from '../activity-skill-recovery.mjs';

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

test('原生命令完成后的业务解析失败保留停止未知，不放行清场',async()=>{
 const state={nativeStopUnproven:true};
 await assert.rejects(workflow.invokeNativeActivity(async()=>{throw Error('missing semantic output');},state),error=>{
  assert.equal(error.message,'missing semantic output');assert.equal(error.executionStopped,false);assert.equal(error.externalEffect,'unknown');return true;
 });
 assert.equal(state.executionUnknown,true);
});
for(const status of ['partial','failed'])test('原生命令完成后的业务部分失败保留实际产出并标停止未知：'+status,async()=>{
 const state={nativeStopUnproven:true},actual={status,comments_saved:3,failures:[{reason:'readback missing'}]};
 const result=await workflow.invokeNativeActivity(async()=>actual,state);
 assert.equal(result.execution_stopped,false);assert.equal(result.comments_saved,3);assert.deepEqual(result.failures,actual.failures);assert.equal(state.executionUnknown,true);
});
test('原生命令正常产出仍进入原业务验收，不被一律判失败',async()=>{
 const state={nativeStopUnproven:true},actual={record_started:true,recording_id:'local-owned-resource'};
 assert.equal(await workflow.invokeNativeActivity(async()=>actual,state),actual);assert.equal(state.executionUnknown,undefined);
});

test('恢复门核对真实未启动能力的全部身份，磁盘副本和旧opid不能代替能力',async()=>{
 const f=setup((command,args,opts)=>execInput(command,args,opts));
 try{
  let original;await assert.rejects(f.handlers.preflight(),error=>{original=error;return true;});
  const failure={status:'failed',error:original.message,execution_stopped:original.executionStopped,external_effect:original.externalEffect,operation_id:original.operationId};
  const make=()=>({runDir:f.dir,frozen:{deployment:{source_commit:'a'.repeat(40)},activities:[]},binding:{run_id:'run__a1',task_id:'task'},env:{...f.env},handlers:{state:{...f.handlers.state}},rpc:async()=>{throw Error('unexpected RPC');}});
  // 真能力通过停止准入，随后因本夹具没有Skill绑定而在下一关退出；不宣称Skill已运行。
  await assert.rejects(createActivityRecovery(make())({activity:{key:'preflight'},failure}),error=>error.message==='SKILL_ACTIVITY_BINDING_INVALID'&&error.executionStopped===true);
  const changes={runDir:c=>c.runDir+='-other',runId:c=>c.binding.run_id='other',taskId:c=>c.binding.task_id='other',profile:c=>c.env.P='other',serial:c=>c.env.SERIAL='other',owner:c=>c.env.WFR_TAG='other',source:c=>c.frozen.deployment.source_commit='b'.repeat(40),serialized:c=>c.handlers.state.nativeStopProof=structuredClone(c.handlers.state.nativeStopProof)};
  for(const [key,change] of Object.entries(changes)){
   const context=make();change(context);
   await assert.rejects(createActivityRecovery(context)({activity:{key:'preflight'},failure}),error=>error.message==='OLD_EXECUTION_TERMINATION_UNKNOWN'&&error.executionStopped===false,key);
  }
  for(const changed of [{...failure,operation_id:'old-operation'},{...failure,operation_id:undefined},{...failure,error:'EXECUTION_DEADLINE'}])await assert.rejects(createActivityRecovery(make())({activity:{key:'preflight'},failure:changed}),error=>error.message==='OLD_EXECUTION_TERMINATION_UNKNOWN'&&error.executionStopped===false);
  await assert.rejects(createActivityRecovery(make())({activity:{key:'collection'},failure}),error=>error.message==='OLD_EXECUTION_TERMINATION_UNKNOWN'&&error.executionStopped===false);
 }finally{f.close();}
});

for(const boundary of ['verify-throw','verify-false','after-throw','after-finish','record-throw'])test('原生覆盖未知时后置边界失败仍隔离且不清场：'+boundary,async()=>{
 const state={nativeStopUnproven:true};let cleaned=0,quarantined=0;
 const result=await runWorkflow({activities:[{key:'collection'},{key:'cleanup'}],context:{},
  handlers:{collection:()=>workflow.invokeNativeActivity(async()=>({comments_saved:1}),state),cleanup:async()=>{cleaned++;return {};}},
  terminationUnverified:()=>state.nativeStopUnproven===true,
  commander:async receipt=>{if(receipt.phase==='after'&&boundary==='after-throw')throw Error('COMMANDER_READ_FAILED');return {action:receipt.phase==='after'&&boundary==='after-finish'?'finish':'continue'};},
  record:async receipt=>{if(boundary==='record-throw'&&['execution','failure'].includes(receipt.phase))throw Error('LEDGER_WRITE_FAILED');},
  verify:async()=>{if(boundary==='verify-throw')throw Error('VERIFY_RECEIPT_PARSE_FAILED');return {verified:boundary!=='verify-false'};},
  quarantine:async()=>{quarantined++;return {verified:true};}});
 assert.equal(cleaned,0);assert.equal(quarantined,1);assert.notEqual(result.status,'completed');
});
test('原生正常产出及后置验证通过仍可清场，不把覆盖未知当业务失败',async()=>{
 let cleaned=0;const result=await runWorkflow({activities:[{key:'collection'},{key:'cleanup'}],context:{},handlers:{collection:async()=>({comments_saved:1}),cleanup:async()=>{cleaned++;return {};}},terminationUnverified:()=>true,commander:async()=>({action:'continue'}),record:async()=>{},verify:async()=>({verified:true}),quarantine:async()=>{throw Error('unexpected quarantine');}});
 assert.equal(result.status,'completed');assert.equal(cleaned,1);
});
