import test from 'node:test';import assert from 'node:assert/strict';
const subject=await import('../code-observer-authority.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('Code observer有独立冻结授权入口，不借raw Worker请求或全局workspace',()=>{
 assert.equal(typeof subject.createCodeObserverRequest,'function');
 assert.equal(typeof subject.verifyCodeObserverAuthority,'function');
 assert.equal(typeof subject.issueCodeObserverCapability,'function');
});
import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';
import {using} from './fixtures/official-control-fixture.mjs';import {startNativePhoneGatewayFixture} from './fixtures/native-phone-public-fixture.mjs';
import {writeFileSync,readFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function scenario(t,workflow,fn,options={}){t.mock.method(os,'hostname',()=> 'r10-7');syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});return using(async f=>{
 const runDir=dirname(f.runtimeRoot),load=name=>import(pathToFileURL(join(f.runtimeRoot,name))),def=await load('runtime-definition.mjs');
 const key=workflow,tag='code_fixture',run_id=key+'-'+tag+'__a1',claim={claimed_by:'code-owner',claimed_at:'2026-11-08T01:00:00.000Z'},serial=key==='douyin_comment_scoring'?'none':'192.0.2.31:10001',profile=serial==='none'?'mmv-scoring':'fixture-phone',scope=options.scope??{run_max_seconds:300,limit:1};
 const task={id:f.q.task_id,status:'in_progress',...claim,payload:{workflow_key:key,run_tag:tag,source_commit:f.source.commit,profile,company_line:'fixture',scope,...(options.top??{}),...(serial==='none'?{}:{device_serial:serial})}};
 const keys=key==='douyin_video_discovery'?['preflight','collect_videos','cleanup']:key==='douyin_video_processing'?['preflight','dedup','qualification','collection','cleanup']:['scoring','mark_leads'];
 const method={kind:'code',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:f.source.commit,path:'services/phone-adb-controller/leadgen-handlers.mjs',digest:'sha256:'+sha(readFileSync(join(f.runtimeRoot,'leadgen-handlers.mjs')))};
 const activities=keys.map((slot,i)=>({reference:{slot_key:slot,reference_id:'ref'+i,activity_id:'a'+i,activity_version_id:'av'+i},version:{id:'av'+i,source_commit:f.source.commit,payload:{definition_key:key+'.'+slot,contract:{budget:{max_duration_s:90}},implementation_bindings:[method]}},implementations:[{...method,execution_verification:'verified_local'}]}));
 const wf={id:'wv1',source_commit:f.source.commit,payload:{key,workflow_id:'w1',activities:activities.map(a=>a.reference)}};wf.payload_sha256=def.digest(wf.payload);
 const body={schema_version:2,code_observer_scope:{schema_version:1,task_id:task.id,claim,run_tag:tag,workflow_key:key,profile,serial,line:'fixture',run_start_ts:Math.floor(Date.now()/1000),run_max_seconds:300,scope,consumed_task_payload:structuredClone(options.top??{})},deployment:{source_commit:f.source.commit,target:'mmv',observation_id:'o1'},release:{id:'r1',target:'mmv'},workflow_version:wf,activities,files:Object.fromEntries(f.source.files.map(x=>['runtime/'+x.path,x.sha256]))};
 body.files['runtime/leadgen-handlers.mjs']=sha(readFileSync(join(f.runtimeRoot,'leadgen-handlers.mjs')));
 const frozen={...body,snapshot_sha256:def.digest(body)},binding={id:f.q.binding_id,run_id,workflow_id:'w1',workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:frozen.snapshot_sha256,external_origin:'zenithjoy:mmv',actor:'runtime:phone-adb-controller',source_kind:'external',task_run_id:null};
 const registration={release_id:'r1',observation_id:'o1',workflow_id:'w1',workflow_definition_version_id:'wv1',snapshot_sha256:wf.payload_sha256,runtime_snapshot_sha256:frozen.snapshot_sha256,source_kind:'external',external_origin:'zenithjoy:mmv',attempt_key:'a1',actor:'runtime:phone-adb-controller',expected_path:activities.map(a=>({reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id,required:true}))};Object.assign(binding,registration,{payload_sha256:def.digest(registration)});
 writeFileSync(join(runDir,'run-definition.json'),JSON.stringify(frozen));mkdirSync(join(runDir,'run-bindings'));writeFileSync(join(runDir,'run-bindings/a1.request.json'),JSON.stringify({run_id,runtime_snapshot_sha256:frozen.snapshot_sha256,body:registration}));writeFileSync(join(runDir,'run-bindings/a1.ack.json'),JSON.stringify({binding}));
 f.routes.set('/api/brain/runs/'+run_id+'/definition',{binding});f.routes.set('/api/brain/workflows/w1/versions/wv1',{version:wf});f.routes.set('/api/brain/tasks/'+task.id,task);for(const a of activities)f.routes.set('/api/brain/activities/'+a.reference.activity_id+'/versions/'+a.version.id,{version:a.version});
 rmSync(f.options.home,{recursive:true,force:true});const user=os.userInfo();t.mock.method(os,'homedir',()=>f.options.home);t.mock.method(os,'userInfo',()=>({...user,homedir:f.options.home}));syncBuiltinESMExports();assert.equal(existsSync(join(f.options.home,'.openclaw/commander')),false);
 const auth=await load('code-observer-authority.mjs'),request=auth.createCodeObserverRequest({runtimeRoot:f.runtimeRoot,source:f.source,activity:{key:keys[0]},attempt:'a1'}),cap=auth.issueCodeObserverCapability({runtimeRoot:f.runtimeRoot,source:f.source,request});
 const get=async path=>{const v=f.routes.get(path);assert.ok(v,path);return structuredClone(v);};
 await fn({...f,load,runDir,frozen,binding,activities:activities.map(a=>({...a.version.payload.contract,key:a.reference.slot_key})),context:{run_id,binding_id:binding.id,task_id:task.id,source_commit:f.source.commit,workflow_key:key,profile},env:{WFR_ATTEMPT:'a1'},task,auth,request,cap,get});
 },{rawTransport:true,phone:true});}
for(const workflow of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'])test('真实部署目录无共享workspace，正式Code '+workflow+'通过官方只读Observer与关闭证明',async t=>{
 await scenario(t,workflow,async f=>{
  const dependencies=await startNativePhoneGatewayFixture(t,[]),runner=await f.load('runner-official-commander.mjs'),sdk=await f.load('official-commander-sdk.mjs'),controller=await f.load('official-agent-control.mjs'),workflowModule=await f.load('leadgen-workflow.mjs');
  const controls=[],factories={createControl:({request,directory,codeObserverCapability})=>{const journalDirectory=join(directory,'actual-control');mkdirSync(journalDirectory,{mode:0o700});const control=controller.createOfficialAgentControl({...f.options,request,codeObserverCapability,journalDirectory,deadlineMs:request.receipt_deadline_ms,cleanupDeadlineMs:request.deadline_ms});controls.push(control);return control;},createSdk:options=>sdk.createOfficialCommanderExecute({...options,gatewayDependencies:dependencies,gatewayCredential:()=> 'fixture-only'})};
  const productionEnv={...f.env,BRAIN_TASK_ID:f.task.id,WF_BRAIN_WORKFLOW:workflow,P:f.frozen.code_observer_scope.profile};f.context=workflowModule.createWorkflowContext({frozen:f.frozen,binding:f.binding,env:productionEnv,taskId:workflowModule.resolveWorkflowTaskIdentity({frozen:f.frozen,binding:f.binding,env:productionEnv})});f.env=productionEnv;
  const observer=await workflowModule.prepareWorkflowCommander({...f,createObserver:options=>runner.createRunnerOfficialCommander({...options,factories}),rpc:async()=>{throw Error('旧workspace RPC不得调用');}});
  assert.equal((await observer.commander({...f.context,commander_role:'observer',phase:'wake',activity:null})).action,'none');
  for(const activity of f.activities){await observer.selectActivity(activity,{});assert.equal((await observer.commander({...f.context,commander_role:'observer',phase:'event',activity:activity.key})).action,'none');}
  const proof=await observer.close();assert.equal(proof.execution_stopped,true,JSON.stringify(proof));assert.equal(runner.runnerCommanderClosureKnown(proof,f.context),true);assert.equal(dependencies.fixtureWorkerTurns(),0);
  for(const control of controls)for(const name of ['request','authorizeIntent','consumeIntentPermit','authorizeBrokerDelivery','createReadOnlyContinuation','readAuthorizedTaskClaim'])assert.equal(control[name],undefined,name);
 });
});
test('Code授权拒绝外来Task/claim/source/预算/非Code及伪造私有能力',async t=>{await scenario(t,'douyin_video_discovery',async f=>{
 await f.auth.verifyCodeObserverAuthority({...f,request:f.request});
 for(const key of ['task_id','source_commit','method_sha256']){const q={...f.request,[key]:'foreign'};await assert.rejects(()=>f.auth.verifyCodeObserverAuthority({...f,request:q}),/CODE_OBSERVER/);}
 for(const mutation of [q=>q.worker_deadline_ms=q.deadline_ms+1,q=>q.execution_mode='agent',q=>q.execution_transport='raw-model-v1']){const q=structuredClone(f.request);mutation(q);assert.throws(()=>f.auth.issueCodeObserverCapability({...f,request:q}),/CODE_OBSERVER/);}
 assert.throws(()=>f.auth.verifyCodeObserverCapability({}, {...f,request:f.request}),/CODE_OBSERVER/);assert.throws(()=>f.auth.verifyCodeObserverCapability(f.cap,{...f,request:f.request,requireAuthorized:true}),/CODE_OBSERVER/);await f.auth.authorizeCodeObserverCapability(f.cap,{...f,request:f.request});assert.equal(f.auth.verifyCodeObserverCapability(f.cap,{...f,request:f.request,requireAuthorized:true}),true);
 const current=f.routes.get('/api/brain/runs/'+f.request.run_id+'/definition').binding;current.task_run_id='foreign';await assert.rejects(()=>f.auth.verifyCodeObserverAuthority({...f,request:f.request}),/CODE_OBSERVER/);current.task_run_id=null;current.task_id='foreign';await assert.rejects(()=>f.auth.verifyCodeObserverAuthority({...f,request:f.request}),/CODE_OBSERVER/);delete current.task_id;
 f.task.claimed_by='foreign';await assert.rejects(()=>f.auth.verifyCodeObserverAuthority({...f,request:f.request}),/CODE_OBSERVER/);
});});
test('Code观察者多工具终态被官方SDK拒绝并隔离，正式Code handler不能继续',async t=>{await scenario(t,'douyin_video_discovery',async f=>{
 const dependencies=await startNativePhoneGatewayFixture(t,[]),Original=dependencies.WebSocket;
 dependencies.WebSocket=class extends Original{on(event,listener){if(event!=='message')return super.on(event,listener);return super.on(event,(bytes,...rest)=>{const frame=JSON.parse(bytes.toString()),meta=frame.payload?.result?.meta?.agentMeta;if(meta?.terminalReceipt)meta.terminalReceipt.successfulToolNames=['phone'];if(frame.payload?.terminalReceipt)frame.payload.terminalReceipt.successfulToolNames=['phone'];listener(Buffer.from(JSON.stringify(frame)),...rest);});}};
 const runner=await f.load('runner-official-commander.mjs'),sdk=await f.load('official-commander-sdk.mjs'),controller=await f.load('official-agent-control.mjs'),workflow=await f.load('leadgen-workflow.mjs');let executed=0,quarantined=0;
 const factories={createControl:({request,directory,codeObserverCapability})=>{const journalDirectory=join(directory,'actual-control');mkdirSync(journalDirectory,{mode:0o700});return controller.createOfficialAgentControl({...f.options,request,codeObserverCapability,journalDirectory,deadlineMs:request.receipt_deadline_ms,cleanupDeadlineMs:request.deadline_ms});},createSdk:options=>sdk.createOfficialCommanderExecute({...options,gatewayDependencies:dependencies,gatewayCredential:()=> 'fixture-only'})};
 const result=await workflow.runWorkflowWithCommander({...f,rpc:async()=>{throw Error('旧RPC禁止');},createObserver:options=>runner.createRunnerOfficialCommander({...options,factories}),handlers:Object.fromEntries(f.activities.map(a=>[a.key,async()=>{executed++;return{};}])),quarantine:async()=>{quarantined++;return{verified:true};},verify:async()=>({verified:true})});
 assert.equal(executed,0);assert.equal(result.execution_stopped,false);assert.equal(result.commander_execution_unknown,true);assert.ok(quarantined>0);assert.equal(dependencies.fixtureWorkerTurns(),0);
});});
test('MMV Code缺冻结scope不能退共享workspace，非MMV保持原严格RPC入口',async()=>{
 const workflow=await import('../leadgen-workflow.mjs');const frozen={deployment:{target:'mmv'},workflow_version:{payload:{key:'douyin_video_discovery'}}};
 await assert.rejects(()=>workflow.prepareWorkflowCommander({frozen}),/FROZEN_SCOPE_REQUIRED/);
 let reads=0;const old=await workflow.prepareWorkflowCommander({frozen:{...frozen,deployment:{target:'xian-m4'}},context:{},rpc:async()=>{reads++;return{decision:{action:'none'}};}});await old.commander({});assert.equal(reads,1);
});
test('Code预算只从正式Task/CLI冻结，原start恢复不重置，显式约束缺参数或越权均拒绝',async t=>{await scenario(t,'douyin_video_discovery',async f=>{
 const s=f.frozen.code_observer_scope,env={WF_BRAIN_TASK_ID:f.task.id,WF_BRAIN_WORKFLOW:s.workflow_key,WFR_TAG:s.run_tag,P:s.profile,SERIAL:s.serial,LEADGEN_LINE:s.line,LEADGEN_EXECUTION_MODE:'code',WFR_RUN_DIR:f.runDir,WF_RUN_START_TS:String(s.run_start_ts),WF_RUN_MAX_SECONDS:String(s.run_max_seconds),LEADGEN_LIMIT:'1'};
 const scope=await f.auth.buildCodeObserverScope({env,sourceCommit:f.source.commit,get:f.get});assert.deepEqual(scope,s);
 assert.deepEqual(f.auth.initializeCodeBudget({env,now:Date.now()+5000}),{run_start_ts:s.run_start_ts,run_max_seconds:300});
 assert.throws(()=>f.auth.initializeCodeBudget({env:{...env,WF_RUN_START_TS:String(s.run_start_ts+1)}}),/CODE_OBSERVER/);assert.throws(()=>f.auth.initializeCodeBudget({env,now:(s.run_start_ts+s.run_max_seconds)*1000}),/CODE_OBSERVER/);
 for(const [key,value] of [['send',1],['max_turns',64],['limit',2],['max_screens',1]]){
  f.task.payload.scope[key]=value;await assert.rejects(()=>f.auth.buildCodeObserverScope({env,sourceCommit:f.source.commit,get:f.get}),/CODE_OBSERVER/);delete f.task.payload.scope[key];
 }
 f.task.payload.scope.limit=1;
 const file=join(f.runDir,'keywords.txt');writeFileSync(file,'AI办公\n');Object.assign(f.task.payload.scope,{keyword:'AI办公',max_attempts:4,max_screens:1});
 const full={...env,LEADGEN_SOURCES_FILE:file,LEADGEN_SOURCE_KIND:'keyword',LEADGEN_DISCOVERY_MAX_ATTEMPTS:'4',LEADGEN_MAX_SCREENS:'1'};
 assert.equal((await f.auth.buildCodeObserverScope({env:full,sourceCommit:f.source.commit,get:f.get})).scope.keyword,'AI办公');writeFileSync(file,'另一关键词\n');await assert.rejects(()=>f.auth.buildCodeObserverScope({env:full,sourceCommit:f.source.commit,get:f.get}),/CODE_OBSERVER/);
});});

test('正式Code Runner走注入Observer并执行有界Code handlers，收尾保存私有关闭品牌',async t=>{await scenario(t,'douyin_comment_scoring',async f=>{
 const dependencies=await startNativePhoneGatewayFixture(t,[]),runner=await f.load('runner-official-commander.mjs'),sdk=await f.load('official-commander-sdk.mjs'),controller=await f.load('official-agent-control.mjs'),workflow=await f.load('leadgen-workflow.mjs');let executed=0;const records=[];
 const factories={createControl:({request,directory,codeObserverCapability})=>{const journalDirectory=join(directory,'actual-control');mkdirSync(journalDirectory,{mode:0o700});return controller.createOfficialAgentControl({...f.options,request,codeObserverCapability,journalDirectory,deadlineMs:request.receipt_deadline_ms,cleanupDeadlineMs:request.deadline_ms});},createSdk:options=>sdk.createOfficialCommanderExecute({...options,gatewayDependencies:dependencies,gatewayCredential:()=> 'fixture-only'})};
 const result=await workflow.runWorkflowWithCommander({...f,rpc:async()=>{throw Error('NO_GLOBAL_WORKSPACE_RPC');},createObserver:options=>runner.createRunnerOfficialCommander({...options,factories}),handlers:Object.fromEntries(f.activities.map(a=>[a.key,async()=>{executed++;return{};}])),verify:async()=>({verified:true}),record:async r=>records.push(r)});
 assert.equal(result.status,'completed');assert.equal(executed,2);assert.notEqual(result.execution_stopped,false);const closed=records.find(r=>r.phase==='commander_domain_closed');assert.ok(closed);assert.equal(runner.runnerCommanderClosureKnown(closed.evidence,f.context),true);assert.equal(dependencies.fixtureWorkerTurns(),0);
});});

test('顶层已消费约束变动撤销旧Code授权，元描述变化不撤权',async t=>{await scenario(t,'douyin_video_discovery',async f=>{
 await f.auth.verifyCodeObserverAuthority({...f,request:f.request});f.task.description='任务描述改变';f.task.payload.description='描述改变';await f.auth.verifyCodeObserverAuthority({...f,request:f.request});
 for(const change of [p=>p.limit=0,p=>delete p.limit,p=>p.keyword='新增关键词',p=>p.source_run='新增来源',p=>p.run_max_seconds=900,p=>p.send=0,p=>p.execution_mode=null,p=>p.execution_transport=null,p=>p.max_turns=null]){
  const prior=structuredClone(f.task.payload);change(f.task.payload);let handlers=0;
  await assert.rejects(async()=>{await f.auth.authorizeCodeObserverCapability(f.cap,{...f,request:f.request});handlers++;},/CODE_OBSERVER/);assert.equal(handlers,0);
  for(const key of Object.keys(f.task.payload))delete f.task.payload[key];Object.assign(f.task.payload,prior);
 }
}, {scope:{run_max_seconds:300},top:{limit:1}});});
test('Code103生产main同一Task解析与上下文构造使用外部ACK空Task，不靠fixture手注身份',async t=>{await scenario(t,'douyin_comment_scoring',async f=>{
 const workflow=await f.load('leadgen-workflow.mjs');assert.equal(typeof workflow.resolveWorkflowTaskIdentity,'function');
 const env={...f.env,BRAIN_TASK_ID:f.task.id,WF_BRAIN_WORKFLOW:'douyin_comment_scoring',P:'mmv-scoring'};
 const taskId=workflow.resolveWorkflowTaskIdentity({frozen:f.frozen,binding:f.binding,env});assert.equal(taskId,f.task.id);
 const context=workflow.createWorkflowContext({frozen:f.frozen,binding:f.binding,env,taskId});assert.equal(context.task_id,f.task.id);
 assert.throws(()=>workflow.resolveWorkflowTaskIdentity({frozen:f.frozen,binding:f.binding,env:{...env,WF_BRAIN_TASK_ID:'foreign'}}),/TASK/);
 assert.throws(()=>workflow.resolveWorkflowTaskIdentity({frozen:f.frozen,binding:{...f.binding,task_id:'foreign'},env}),/TASK/);
});});
test('Code scope builder不能用Task别名优先级掩盖冲突',async t=>{await scenario(t,'douyin_video_discovery',async f=>{
 const s=f.frozen.code_observer_scope,env={WF_BRAIN_TASK_ID:f.task.id,BRAIN_TASK_ID:'22222222-2222-4222-8222-222222222222',WF_BRAIN_WORKFLOW:s.workflow_key,WFR_TAG:s.run_tag,P:s.profile,SERIAL:s.serial,LEADGEN_LINE:s.line,LEADGEN_EXECUTION_MODE:'code',WFR_RUN_DIR:f.runDir,WF_RUN_START_TS:String(s.run_start_ts),WF_RUN_MAX_SECONDS:String(s.run_max_seconds),LEADGEN_LIMIT:'1'};
 await assert.rejects(()=>f.auth.buildCodeObserverScope({env,sourceCommit:f.source.commit,get:f.get}),/CODE_OBSERVER/);
});});
test('顶层limit变动经生产Code Runner和真实Caller HTTP拒绝，零handler或模型派发',async t=>{await scenario(t,'douyin_video_discovery',async f=>{
 await f.auth.verifyCodeObserverAuthority({...f,request:f.request});f.task.payload.limit=0;
 const runner=await f.load('runner-official-commander.mjs'),controller=await f.load('official-agent-control.mjs'),workflow=await f.load('leadgen-workflow.mjs');let handlers=0,sdk=0;
 const factories={createControl:({request,directory,codeObserverCapability})=>{const journalDirectory=join(directory,'actual-control');mkdirSync(journalDirectory,{mode:0o700});return controller.createOfficialAgentControl({...f.options,request,codeObserverCapability,journalDirectory,deadlineMs:request.receipt_deadline_ms,cleanupDeadlineMs:request.deadline_ms});},createSdk:()=>{sdk++;throw Error('未授权不应进入模型');}};
 await assert.rejects(()=>workflow.runWorkflowWithCommander({...f,rpc:async()=>{throw Error('NO_GLOBAL_WORKSPACE_RPC');},createObserver:options=>runner.createRunnerOfficialCommander({...options,factories}),handlers:Object.fromEntries(f.activities.map(a=>[a.key,async()=>{handlers++;return{};}])),verify:async()=>({verified:true})}),/RUNNER_OFFICIAL_COMMANDER/);
 assert.equal(handlers,0);assert.equal(sdk,0);
}, {scope:{run_max_seconds:300},top:{limit:1}});});
