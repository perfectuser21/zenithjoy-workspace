import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralDeviceLease} from '../central-device-lease.mjs';
import {createHandlers} from '../leadgen-handlers.mjs';
import {mkdtempSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {centralDeviceLockEvidence} from '../runtime-receipts.mjs';

const TASK='7037d210-2af1-4af9-8635-f93a805e58b6';
function fixture({busy=false,offline=false,projectId='68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6',expectedProjectId}={}){
  const calls=[];let owner=busy?'another-task':null,expires=null;
  const fetcher=async(url,options={})=>{
    const path=new URL(url).pathname;calls.push({path,body:options.body?JSON.parse(options.body):null});
    if(offline)throw Error('offline');
    const json=(status,body)=>({status,ok:status===200,json:async()=>body});
    if(path.endsWith('/acquire')){
      const {device_name,locked_by}=JSON.parse(options.body);
      if(owner&&owner!==locked_by)return json(200,{acquired:false,locked_by:owner,expires_at:expires});
      owner=locked_by;expires=new Date(Date.now()+60*60*1000).toISOString();
      return json(200,{acquired:true,lock:{device_name,locked_by:owner,expires_at:expires}});
    }
    if(path.endsWith('/release')){
      if(owner!==JSON.parse(options.body).locked_by)return json(409,{success:false});
      owner=null;expires=null;return json(200,{success:true,released:{device_name:'SERIAL',locked_by:null}});
    }
    if(path.endsWith('/tasks/'+TASK))return json(200,{id:TASK,status:'in_progress',project_id:projectId,payload:{workflow_key:'douyin_video_processing',device_serial:'SERIAL',company_line:'jinuo',source_commit:'a'.repeat(40),run_tag:'run'}});
    return json(200,{success:true,locks:[{device_name:'SERIAL',locked_by:owner,expires_at:expires}]});
  };
  const lease=createCentralDeviceLease({brainUrl:'http://brain.test:5221',token:'fixture-token',deviceName:'SERIAL',taskId:TASK,runId:'run__a1',fetcher,expectedProjectId});
  return {lease,calls,get owner(){return owner;},setOffline:v=>{offline=v;}};
}

test('原子获取后精确读回，同 Task 续租，再按 owner 释放并读回',async()=>{
  const f=fixture();await f.lease.acquire();assert.equal(f.owner,TASK);
  assert.deepEqual(f.calls.map(c=>c.path.split('/').at(-1)),['acquire','device-locks']);
  await f.lease.renew();assert.equal(f.owner,TASK);
  await f.lease.release();assert.equal(f.owner,null);
  assert.deepEqual(f.calls.map(c=>c.path.split('/').at(-1)),['acquire','device-locks','acquire','device-locks','release','device-locks']);
  assert.ok(f.calls.filter(c=>c.body?.locked_by).every(c=>c.body.locked_by===TASK));
});

test('被别的 owner 持有、Brain 离线、无 Task 绑定均阻止设备操作',async()=>{
  const busy=fixture({busy:true});await assert.rejects(busy.lease.acquire(),/CENTRAL_LOCK_BUSY/);
  const offline=fixture({offline:true});await assert.rejects(offline.lease.acquire(),/CENTRAL_LOCK_UNKNOWN/);
  assert.throws(()=>createCentralDeviceLease({brainUrl:'http://brain.test',token:'fixture',deviceName:'SERIAL',taskId:null,runId:'run__a1',fetcher:async()=>{}}),/CENTRAL_LOCK_TASK_REQUIRED/);
});

test('中央锁 owner 必须来自已登记、已认领且与本次来源吻合的 Brain Task',async()=>{
  const f=fixture();
  const task=await f.lease.verifyTask({workflowKey:'douyin_video_processing',companyLine:'jinuo',sourceCommit:'a'.repeat(40),runTag:'run'});
  assert.equal(task.id,TASK);assert.equal(f.calls[0].path,'/api/brain/tasks/'+TASK);
  await assert.rejects(f.lease.verifyTask({workflowKey:'douyin_video_discovery',companyLine:'jinuo',sourceCommit:'a'.repeat(40),runTag:'run'}),/CENTRAL_LOCK_TASK_MISMATCH/);
});

test('其他公司的合法项目可运行，调用方声明项目时必须精确一致',async()=>{
  const other='11111111-2222-4333-8444-555555555555';
  const taskFields={workflowKey:'douyin_video_processing',companyLine:'jinuo',sourceCommit:'a'.repeat(40),runTag:'run'};
  const valid=fixture({projectId:other,expectedProjectId:other});
  assert.equal((await valid.lease.verifyTask(taskFields)).project_id,other);
  const mismatch=fixture({projectId:other,expectedProjectId:'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6'});
  await assert.rejects(mismatch.lease.verifyTask(taskFields),/CENTRAL_LOCK_TASK_MISMATCH/);
});

function handlerFixture(t,{acquireError=null,localReleaseError=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'central-lock-handler-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'accounts'),'profile\t44997267357\n');
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'fixture-run',WFR_RUN_ID:'processing-fixture-run',WFR_ATTEMPT:'a1',P:'profile',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',WF_BRAIN_WORKFLOW:'douyin_video_processing',WFR_HOSTKEY:'xian-m4',DOUYIN_ACCOUNT_REGISTRY:join(dir,'accounts'),DOUYIN_PHONE_ADB:'/fixture/phone',DOUYIN_ADB_BIN:'/fixture/adb'};
  const events=[];
  const centralLease={held:false,attempted:false,async verifyTask(){events.push('task-verified');},async acquire(){events.push('central-acquire');if(acquireError)throw Error(acquireError);this.held=true;this.attempted=true;},async ensure(){events.push('central-ensure');},async release(){events.push('central-release');this.held=false;this.attempted=false;}};
  const execute=async(command,args)=>{
    if(args[0]===join(dir,'adb-existing-route.py'))return {code:0,stdout:'5042\n',stderr:''};
    const op=command==='/fixture/phone'?(args[2]==='--lock-owner'?args[4]:args[2]):args.includes('get-state')?'get-state':args.includes('telephony.registry')?'call':'';
    if(op)events.push(op);
    const stdout={preflight:'serial=SERIAL\n','lock-acquire':'lock=acquired\n','lock-refresh':'lock=refreshed\n','lock-release':'lock=released\n','account-current':'douyin_id=44997267357\n','get-state':'device\n',call:'mCallState=0\n'}[op]||'';
    return {code:localReleaseError&&op==='lock-release'?1:0,stdout,stderr:localReleaseError&&op==='lock-release'?'release failed':''};
  };
  return {handlers:createHandlers({root:dir,env,execute,rpc:async()=>{throw Error('unexpected RPC');},taskId:TASK,centralLease}),events};
}

test('正式 M4 102 预检先拿中央锁，清场后按同 owner 放锁',async t=>{
  const f=handlerFixture(t);await f.handlers.preflight();await f.handlers.cleanup();
  assert.ok(f.events.indexOf('central-acquire')<f.events.indexOf('get-state'));
  assert.ok(f.events.indexOf('central-acquire')<f.events.indexOf('lock-acquire'));
  assert.ok(f.events.indexOf('lock-release')<f.events.indexOf('central-release'));
});

test('正式 M4 102 中央锁冲突时零设备动作',async t=>{
  const f=handlerFixture(t,{acquireError:'CENTRAL_LOCK_BUSY'});
  await assert.rejects(f.handlers.preflight(),/CENTRAL_LOCK_BUSY/);
  assert.deepEqual(f.events,['task-verified','central-acquire']);
});

test('本地锁归位失败时中央锁保留，清场不得误报成功',async t=>{
  const f=handlerFixture(t,{localReleaseError:true});await f.handlers.preflight();
  const result=await f.handlers.cleanup();
  assert.equal(result.status,'partial');assert.equal(result.central_lock_released,0);
  assert.ok(!f.events.includes('central-release'));
});

test('中央 Task/run 关联进入 Brain span 证据，可由 runs include=spans 读回',t=>{
  const dir=mkdtempSync(join(tmpdir(),'central-span-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const runId='douyin_video_processing-run__a1',sourceCommit='a'.repeat(40);
  writeFileSync(join(dir,'central-lock-events.jsonl'),JSON.stringify({event:'acquired',task_id:TASK,run_id:runId,device_name:'SERIAL',source_commit:sourceCommit,observed_at:new Date().toISOString()})+'\n',{mode:0o600});
  const evidence=centralDeviceLockEvidence({dir,stage:'preflight',artifact:{result:{central_lock_task_id:TASK,central_lock_run_id:runId}},
    binding:{run_id:runId},frozen:{deployment:{source_commit:sourceCommit}},env:{WF_BRAIN_WORKFLOW:'douyin_video_processing',WF_BRAIN_TASK_ID:TASK,SERIAL:'SERIAL'}});
  assert.deepEqual(evidence,{version:1,task_id:TASK,run_id:runId,device_name:'SERIAL',source_commit:sourceCommit,acquired:true,released:false});
  appendFileSync(join(dir,'central-lock-events.jsonl'),JSON.stringify({event:'released',task_id:TASK,run_id:runId,device_name:'SERIAL',observed_at:new Date().toISOString()})+'\n');
  const scope={dir,binding:{run_id:runId},frozen:{deployment:{source_commit:sourceCommit}},env:{WF_BRAIN_WORKFLOW:'douyin_video_processing',WF_BRAIN_TASK_ID:TASK,SERIAL:'SERIAL'}};
  assert.equal(centralDeviceLockEvidence({...scope,stage:'preflight',artifact:{result:{central_lock_task_id:TASK,central_lock_run_id:runId}}}).released,false);
  assert.equal(centralDeviceLockEvidence({...scope,stage:'cleanup',artifact:{result:{central_lock_task_id:TASK,central_lock_run_id:runId,central_lock_released:1}}}).released,true);
});
