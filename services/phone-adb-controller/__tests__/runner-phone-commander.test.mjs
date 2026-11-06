import test from 'node:test';
import assert from 'node:assert/strict';
import * as subject from '../runner-official-commander.mjs';

test('Phone Observer提供同一AV隔离桥入口，不以103桥接受手机槽位',()=>{
 assert.equal(typeof subject.createRunnerPhoneCommander,'function');
});
import {using} from './fixtures/official-control-fixture.mjs';
import {createCommanderBridge} from '../common-runner/runner-commander-bridge.js';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import WS,{WebSocketServer} from 'ws';
import {GatewayProtocolClient} from '@openclaw/gateway-client/browser';
import {rawDataToString} from '@openclaw/gateway-client/websocket-data';
import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';

// Real copied Caller, SDK and bounded owner. Only the central HTTP authority
// and model server are isolated fixtures; positive closure is never fabricated.
async function realPhone(fn,{processing=false,cloneClosure=false,gateway,nativeRuntimeFactory}={}){
 await using(async f=>{
  const cold=await import('file://'+join(f.runtimeRoot,'runner-official-commander.mjs'));
  const sdk=await import('file://'+join(f.runtimeRoot,'official-commander-sdk.mjs'));
  const owner=await import('file://'+join(f.runtimeRoot,'commander-bounded-owner.mjs'));
  const q=structuredClone(f.q),keys=processing?['preflight','dedup','qualification','collection','cleanup']:['preflight','collect_videos','cleanup'];
  if(processing){q.workflow_key='douyin_video_processing';q.discovery_filters=null;q.source_run='source_fixture';q.comment_limit=2;}
  const task=f.routes.get('/api/brain/tasks/'+q.task_id);task.payload.workflow_key=q.workflow_key;
  const wf=f.routes.get('/api/brain/workflows/w1/versions/wv1').version;wf.payload.key=q.workflow_key;
  const original=f.routes.get('/api/brain/activities/a1/versions/av1').version;
  wf.payload.activities=keys.map((key,i)=>({slot_key:key,reference_id:'ref'+i,activity_id:'a'+i,activity_version_id:'av'+i}));
  const requests=keys.map((key,i)=>{const r=structuredClone(q);r.activity_key=key;r.nonce=String(i+1).repeat(48);r.worker_deadline_ms=Date.now()+12000;r.receipt_deadline_ms=Date.now()+16000;r.deadline_ms=Date.now()+19000;r.method.reference_id='ref'+i;r.method.activity_version_id='av'+i;r.method.contract.activity_version_id='av'+i;r.method.contract.definition_key=q.workflow_key+'.'+key;const av=structuredClone(original);av.payload.definition_key=r.method.contract.definition_key;f.routes.set('/api/brain/activities/a'+i+'/versions/av'+i,{version:av});return r;});
  const activities=keys.map(key=>({key,version:'fixture-v1'})),allocated=[],proofs=[],ownerPins=[];
  const createObserver=async options=>{
   const observer=await cold.createRunnerOfficialCommander({...options,factories:{createControl:({request,directory})=>f.createControl({...f.options,request,journalDirectory:directory,deadlineMs:request.worker_deadline_ms,cleanupDeadlineMs:request.deadline_ms}),createSdk:options=>sdk.createOfficialCommanderExecute({...options,...(gateway?{gatewayDependencies:gateway.dependencies,gatewayCredential:()=> 'fixture'}:{})}),createOwner:options=>{ownerPins.push(structuredClone(options.python));const actual=owner.createBoundedCommanderOwner(options);return {...actual,reserveOwner:(scope,options)=>actual.reserveOwner(scope,{...options,home:f.options.home})};}}});
   allocated.push(options.request.activity_key);
   return {...observer,close:async()=>{const proof=await observer.close();proofs.push(proof);assert.equal(cold.runnerCommanderClosureKnown(proof,options.request),true);return cloneClosure?{...proof}:proof;}};
  };
  const nativePhoneRuntime=nativeRuntimeFactory?nativeRuntimeFactory(await import('file://'+join(f.runtimeRoot,'native-phone-runtime.mjs'))):undefined;
  let router;try{router=await cold.createRunnerPhoneCommander({runtimeRoot:f.runtimeRoot,source:f.source,runDir:f.runDir,activities,nativePhoneRuntime,workflowDeadlineMs:q.deadline_ms,prepareRequest:activity=>requests.find(r=>r.activity_key===activity.key),createObserver});await fn({router,cold,q,keys,activities,requests,allocated,proofs,ownerPins,owner,runtimeRoot:f.runtimeRoot,source:f.source});}finally{await router?.close();}
 },{rawTransport:true});
}
for(const processing of [false,true])test('真实私有close后顺序分配所有Phone AV，隔离Caller/SDK且不授业务权 '+(processing?'102':'101'),async()=>{
 await realPhone(async({router,cold,q,keys,activities,allocated,proofs})=>{
  for(let i=1;i<keys.length;i++){await router.selectActivity(activities[i]);assert.equal(proofs.length,i);assert.deepEqual(allocated,keys.slice(0,i+1));}
  const closure=await router.close();assert.equal(closure.domain,'runner-phone-observer/v1');assert.equal(cold.runnerCommanderClosureKnown(closure,q),true);assert.equal(cold.runnerCommanderClosureKnown({...closure},q),false);assert.equal(closure.activities.length,keys.length);
 },{processing});
});
test('Phone fixture binds a different legitimate physical Python before Source freeze; production pin absence and hash drift never bypass owner proof',async t=>{
 const policy=JSON.parse(fs.readFileSync(new URL('../config/collection-phone-hosts.json',import.meta.url))),production=policy.hosts.find(row=>row.target==='mmv').executables.python;
 const actualRealpath=fs.realpathSync,python=actualRealpath(execFileSync('/usr/bin/python3',['-I','-S','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim());
 assert.notEqual(python,production.path,'the test must exercise a genuinely different physical interpreter');
 const pin={path:python,sha256:createHash('sha256').update(fs.readFileSync(python)).digest('hex')},before=process.env.PREFLIGHT_TEST_PYTHON_BIN;
 process.env.PREFLIGHT_TEST_PYTHON_BIN=python;t.after(()=>{if(before===undefined)delete process.env.PREFLIGHT_TEST_PYTHON_BIN;else process.env.PREFLIGHT_TEST_PYTHON_BIN=before;t.mock.restoreAll();syncBuiltinESMExports();});
 t.mock.method(fs,'realpathSync',(path,...args)=>{if(path===production.path)throw Object.assign(Error('simulated hosted runner missing the production MMV interpreter'),{code:'ENOENT'});return actualRealpath(path,...args);});syncBuiltinESMExports();
 const gateway=await loopbackGateway(t);gateway.release();
 await realPhone(async({router,q,ownerPins,owner,runtimeRoot,source})=>{
  assert.deepEqual(ownerPins[0],pin,'only the explicitly selected physical test Python belongs in fixture Source');
  const count=gateway.frames.length;await assert.rejects(router.commander({...q,commander_role:'observer',phase:'event',activity:'preflight',broker_host:'foreign-host'}),/PHONE_OBSERVER_SCOPE/);assert.equal(gateway.frames.length,count);
  assert.throws(()=>owner.createBoundedCommanderOwner({runtimeRoot,source,python:{...pin,sha256:'0'.repeat(64)},deadlineMs:Date.now()+3000,cleanupDeadlineMs:Date.now()+4000}),/COMMANDER_OWNER_BOUNDED_UNVERIFIED/);
  assert.equal((await router.commander({...q,commander_role:'observer',phase:'event',activity:'preflight'})).action,'none');
  const closed=await router.close();assert.equal(closed.execution_stopped,true);assert.ok(closed.activities[0].evidence.owner.leaves.length>=2);
  for(const leaf of closed.activities[0].evidence.owner.leaves)for(const key of ['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed'])assert.equal(leaf[key],true);
 },{gateway});
});
test('越序、离开后重复slot及活动metadata漂移拒绝且不新建域',async()=>{
 await realPhone(async({router,activities,allocated})=>{
  await assert.rejects(router.selectActivity(activities[2]),/PHONE_OBSERVER_SCOPE/);
  await assert.rejects(router.selectActivity({...activities[1],version:'changed'}),/PHONE_OBSERVER_SCOPE/);
  assert.deepEqual(allocated,['preflight']);await router.selectActivity(activities[1]);
  await assert.rejects(router.selectActivity(activities[0]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight','collect_videos']);
 });
});
test('真实close对象复制后不再有私有品牌，拒分配下一AV',async()=>{
 await realPhone(async({router,activities,allocated})=>{
  await assert.rejects(router.selectActivity(activities[1]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight']);assert.equal((await router.close()).execution_unknown,true);
 },{cloneClosure:true});
});
test('冻结phone metadata/Task/source发生变化，不能借新AV重置原scope',async()=>{
 for(const field of ['serial','profile','broker_host','workflow_definition_version_id','binding_id','task_id','source_commit'])await realPhone(async({router,activities,requests,allocated})=>{
  requests[1][field]='changed';await assert.rejects(router.selectActivity(activities[1]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight']);
 });
});
async function loopbackGateway(t){
 const frames=[],sockets=new Set(),http=createServer(),wss=new WebSocketServer({server:http});let release,arrived;const waiting=new Promise(r=>arrived=r),held=new Promise(r=>release=r);
 wss.on('connection',ws=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'fixture',ts:Date.now()}}));ws.on('message',async raw=>{
  const frame=JSON.parse(raw);frames.push(frame);const reply=payload=>ws.send(JSON.stringify({type:'res',id:frame.id,ok:true,payload}));
  if(frame.method==='connect')return reply({protocol:4,server:{version:'2026.9.8'},auth:{role:'operator',scopes:['operator.read','operator.write']}});
  const run=frame.params.idempotencyKey??frame.params.runId,session='internal-session-effects-'+run+'-'+createHash('sha256').update(run).digest('hex').slice(0,16),receipt={runId:run,sessionId:session,turnId:'fixture-turn',requested:{provider:'openai',model:'gpt-6.1-sol'},successfulToolNames:[],rerouted:false,effective:{provider:'openai',model:'gpt-6.1-sol'}};
  if(frame.method==='agent'){reply({runId:run,status:'accepted'});if(frames.filter(f=>f.method==='agent').length===1){arrived();await held;}reply({runId:run,status:'ok',result:{payloads:[{text:'{"action":"none"}'}],meta:{agentMeta:{agentHarnessId:'openclaw',sessionId:session,provider:'openai',model:'gpt-6.1-sol',terminalReceipt:receipt}}}});}
  else if(frame.method==='agent.wait')reply({runId:run,status:'ok',endedAt:Date.now(),terminalReceipt:receipt});else throw Error('unexpected fixture frame');
 });});
 await new Promise(r=>http.listen(0,'127.0.0.1',r));t.after(async()=>{release();for(const ws of sockets)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>http.close(r));});
 class Socket extends WS{constructor(url,options){assert.equal(url,'ws://127.0.0.1:18789');super('ws://127.0.0.1:'+http.address().port,options);}}
 return {frames,waiting,release,dependencies:{GatewayProtocolClient,WebSocket:Socket,rawDataToString}};
}
for(const processing of [false,true])test('真实模型WS及有界owner未归还时不跨slot，跨AV全桥预算不重置 '+(processing?'102':'101'),async t=>{
 const gateway=await loopbackGateway(t);
 await realPhone(async({router,q,activities,allocated,proofs})=>{
  const receipt=activity=>({...q,commander_role:'observer',phase:'event',activity});
  const turn=router.commander(receipt('preflight'));await gateway.waiting;
  let transitioned=false;const next=router.selectActivity(activities[1]).then(()=>transitioned=true);
  await new Promise(r=>setTimeout(r,30));assert.equal(transitioned,false);assert.deepEqual(allocated,['preflight']);assert.equal(proofs.length,0);
  gateway.release();assert.equal((await turn).action,'none');await next;assert.equal(proofs.length,1);
  assert.ok(proofs[0].owner.leaves.length>=2);for(const leaf of proofs[0].owner.leaves)for(const key of ['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed'])assert.equal(leaf[key],true);
  const events=[],bridge=createCommanderBridge({run_id:q.run_id,budget:{max_calls:1,timeout_ms:5000},onEvent:async event=>events.push(event),transport:request=>router.commander({...q,...request,commander_role:'observer'})});
  await bridge.notify(activities[1],{progress:'fixture'},{executor_kind:'agent'});await router.selectActivity(activities[2]);await bridge.notify(activities[2],{progress:'fixture'},{executor_kind:'agent'});assert.ok(events.some(event=>event.event_type==='COMMANDER_BUDGET_EXHAUSTED'));const agents=gateway.frames.filter(f=>f.method==='agent');assert.equal(agents.length,2);assert.equal(new Set(agents.map(f=>f.params.sessionKey)).size,1);assert.equal((await router.close()).execution_stopped,true);
 },{processing,gateway});
});
test('上一AV退出不重置全workflow绝对截止；receipt元数据改变不派模型',async t=>{
 await realPhone(async({router,q,activities,allocated})=>{
  await assert.rejects(router.commander({...q,commander_role:'observer',phase:'event',activity:'preflight',profile:'changed'}),/PHONE_OBSERVER_SCOPE/);
  await router.selectActivity(activities[1]);t.mock.timers.enable({apis:['Date'],now:q.deadline_ms+1});
  try{await assert.rejects(router.selectActivity(activities[2]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight','collect_videos']);}finally{t.mock.timers.reset();}
 });
});

test('genuine但未prepare的Phone runtime不能凭品牌跳cleanup，先关闭核Observer才交原runtime验证',async()=>{
 await realPhone(async({router,activities,allocated,proofs})=>{await assert.rejects(router.selectActivity(activities[2]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight']);assert.equal(proofs.length,1);assert.equal((await router.close()).execution_unknown,true);},{nativeRuntimeFactory:module=>module.createNativePhoneRuntime({})});
});
for(const kind of ['json','copied-runtime'])test('cleanup越序不能由'+kind+'或Worker自报stop授权，拒绝后正常相邻仍可继续',async()=>{
 await realPhone(async({router,activities,allocated,proofs})=>{await assert.rejects(router.selectActivity(activities[2]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight']);assert.equal(proofs.length,0);await router.selectActivity(activities[1]);assert.deepEqual(allocated,['preflight','collect_videos']);},{nativeRuntimeFactory:module=>kind==='json'?{verified:true,execution_stopped:true,model_stopped:true,always_run:['cleanup'],authorizeCleanupTransition:()=>true}:{...module.createNativePhoneRuntime({})}});
});
test('cleanup例外仍不能越过上一个Observer原私有close证明',async()=>{
 await realPhone(async({router,activities,allocated})=>{await assert.rejects(router.selectActivity(activities[2]),/PHONE_OBSERVER_SCOPE/);assert.deepEqual(allocated,['preflight']);assert.equal((await router.close()).execution_unknown,true);},{cloneClosure:true,nativeRuntimeFactory:module=>module.createNativePhoneRuntime({})});
});
