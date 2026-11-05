import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {callActivityTool} from '../activity-skill-tool.mjs';
import {reserveWorkflowCommanderTurn,workflowCommanderSession} from '../activity-commander.mjs';
import * as workflow from '../leadgen-workflow.mjs';
import {agentInput} from '../runtime-definition.mjs';
import {runWorkflow} from '../leadgen-runner-adapter.mjs';
const api=await import('../activity-skill-executor.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const taskId='11111111-1111-4111-8111-111111111111',bindingId='22222222-2222-4222-8222-222222222222',childId='33333333-3333-4333-8333-333333333333';
function fixture(t){
 const runDir=mkdtempSync(join(tmpdir(),'primary-executor-'));t.after(()=>rmSync(runDir,{recursive:true,force:true}));
 const method='---\nname: douyin-leadgen-activity-103-scoring\nmetadata:\n  version: 0.1.0\n  primary_execution: agent-v1\n  activity_ref: douyin_comment_scoring.scoring\n---\n按原政策评分。',support='已冻结Activity只使用本轮受控工具。';
 const path='runtime/skills/douyin-leadgen-activity-103-scoring/SKILL.md';mkdirSync(join(runDir,'runtime/skills/douyin-leadgen-activity-103-scoring'),{recursive:true});writeFileSync(join(runDir,path),method);writeFileSync(join(runDir,'runtime/skills/leadgen-activity-execution.md'),support);
 const contract={budget:{max_duration_s:30}},frozen={execution_mode:'agent',deployment:{target:'mmv',source_commit:'a'.repeat(40),observation_id:'observation'},release:{id:'release'},snapshot_sha256:'b'.repeat(64),workflow_version:{id:'wv',payload:{key:'douyin_comment_scoring'}},files:{[path]:sha(method),'runtime/skills/leadgen-activity-execution.md':sha(support)},activities:[{reference:{slot_key:'scoring',reference_id:'ref'},version:{id:'av',payload:{definition_key:'douyin_comment_scoring.scoring',contract,implementation_bindings:[{kind:'skill',name:'douyin-leadgen-activity-103-scoring',version:'0.1.0',path:'services/phone-adb-controller/skills/douyin-leadgen-activity-103-scoring/SKILL.md'}]}}}]};
 const env={LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WF_BRAIN_TASK_ID:taskId,WFR_TAG:'pure_103',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',LEADGEN_SOURCE_RUN:'pure_102',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'1800'};
 frozen.agent_input=agentInput(env);
 return {runDir,frozen,env,supportsNativeScope:()=>true,nativeState:()=>({}),binding:{id:bindingId,run_id:'pure_103__a1',task_id:taskId},deadlineFor:()=>Date.now()+10000};
}
function phoneFixture(t,{discovery=false}={}){
 const f=fixture(t);Object.assign(f.env,{WF_BRAIN_WORKFLOW:discovery?'douyin_video_discovery':'douyin_video_processing',WFR_TAG:discovery?'pure_101':'pure_102',P:'xiaolongxia',SERIAL:'ANGYVB4311010223',...(discovery?{}:{LEADGEN_SOURCE_RUN:'pure_101',LEADGEN_COMMENT_LIMIT:'5'})});
 if(discovery){delete f.env.LEADGEN_SOURCE_RUN;delete f.env.LEADGEN_COMMENT_LIMIT;}
 f.frozen.workflow_version.payload.key=f.env.WF_BRAIN_WORKFLOW;f.frozen.agent_input=agentInput(f.env);f.frozen.activities=[];
 for(const key of ['preflight','qualification','cleanup']){
  const name=`douyin-leadgen-activity-102-${key}`,path=`runtime/skills/${name}/SKILL.md`,text=`---\nname: ${name}\nmetadata:\n  version: 0.1.0\n  primary_execution: agent-v1\n  activity_ref: douyin_video_processing.${key}\n---\n按冻结合同执行当前Activity。`;
  mkdirSync(join(f.runDir,`runtime/skills/${name}`),{recursive:true});writeFileSync(join(f.runDir,path),text);f.frozen.files[path]=sha(text);
  f.frozen.activities.push({reference:{slot_key:key,reference_id:'ref-'+key},version:{id:'av-'+key,payload:{definition_key:'douyin_video_processing.'+key,contract:{budget:{max_duration_s:key==='cleanup'?60:120}},implementation_bindings:[{kind:'skill',name,version:'0.1.0',path:'services/phone-adb-controller/skills/'+name+'/SKILL.md'}]}}});
 }
 return f;
}
const receipt=(q,overrides={})=>({status:'ok',execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,child_run_id:childId,terminal:{runId:childId,status:'ok',endedAt:Date.now()},source_commit:q.source_commit,...overrides});

test('Primary executor只接受server工具结果与官方双停；不把Agent成功文字作为业务产物',async t=>{
 assert.equal(typeof api.createActivitySkillExecutor,'function','缺少正式Primary执行器');
 const f=fixture(t);let prepared=0,settled=0,submitted=0;
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{prepared++;},settle:async()=>{settled++;},inspect:async()=>({business_capabilities:['score']}),phone:async()=>{throw Error('103无手机');},business:async(operation,input)=>{assert.equal(operation,'score');submitted++;return input;},getResult:()=>submitted?{scored:1,score_ids:['actual-pg-id']}:null}),rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};
  assert.equal(q.kind,'activity_skill');
  await callActivityTool(q.request.broker_request_path,'business',{operation:'score',input:{comment_id:'actual-comment'}});
  return {result:receipt(q.request,{terminal:{runId:childId,status:'ok',endedAt:Date.now(),terminalReply:{text:'{"scored":9999,"status":"completed"}'}}})};
 }});
 const result=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId,execution_mode:'agent'},guidance:[],onEvent:async()=>({action:'none'})});
 assert.equal(result.status,'completed');assert.equal(result.execution_stopped,true);assert.equal(result.result.scored,1);assert.deepEqual(result.result.score_ids,['actual-pg-id']);assert.deepEqual([prepared,settled,submitted],[1,1,1]);
});

test('Primary executor没有工具提交即便Agent终态ok也不能声称完成',async t=>{
 assert.equal(typeof api.createActivitySkillExecutor,'function');const f=fixture(t);
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>null}),rpc:async q=>q.kind==='activity_skill_authority'?{authorized:true}:{result:receipt(q.request)}});
 const result=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},onEvent:async()=>({action:'none'})});
 assert.equal(result.status,'partial');assert.match(result.reason,/未交付/);assert.equal(result.execution_stopped,true);
});

test('Primary executor官方child终态未知不封闭native或释放资源，且禁止重复派发',async t=>{
 assert.equal(typeof api.createActivitySkillExecutor,'function');const f=fixture(t);let launches=0,settled=0,released=0;
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{settled++;},release:async()=>{released++;},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>({scored:1})}),rpc:async q=>{if(q.kind==='activity_skill_authority')return {authorized:true};launches++;return {result:{status:'unknown',execution_stopped:false}};}});
 const options={context:{task_id:taskId},onEvent:async()=>({action:'none'})};const actual=await execute({key:'scoring',budget:{max_duration_s:30}},options);
 assert.equal(actual.execution_stopped,false);assert.equal(settled,0);assert.equal(released,0);
 await assert.rejects(()=>execute({key:'scoring',budget:{max_duration_s:30}},options),/ALREADY_REQUESTED/);assert.equal(launches,1);
});

test('Primary官方回执错Source或server原件仍unknown均不封闭原生执行',async t=>{
 assert.equal(typeof api.createActivitySkillExecutor,'function');
 for(const failure of ['source','native']){
  const f=fixture(t);let settled=0;
  const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{settled++;},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>failure==='native'?{execution_stopped:false,external_effect:'unknown'}:{scored:1}}),rpc:async q=>q.kind==='activity_skill_authority'?{authorized:true}:{result:receipt(q.request,failure==='source'?{source_commit:'f'.repeat(40)}:{})}});
  const actual=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId}});
  assert.equal(actual.execution_stopped,false);assert.equal(settled,0);
  if(failure==='source'){assert.equal(actual.owner_execution_stopped,false);assert.equal(actual.child_execution_stopped,false);assert.ok(actual.unknown_reasons.includes('official_source_mismatch'));}
 }
});

for(const stage of ['settle','release'])test(`官方终态后${stage}等待期间合法nonce迟到phone与business不能再执行`,async t=>{
 const f=fixture(t);let request,entered,open,late=0;
 const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{open=resolve;});
 if(stage==='release'){
  const old='runtime/skills/douyin-leadgen-activity-103-scoring/SKILL.md',path='runtime/skills/douyin-leadgen-activity-102-cleanup/SKILL.md';
  const bytes=readFileSync(join(f.runDir,old),'utf8').replaceAll('douyin-leadgen-activity-103-scoring','douyin-leadgen-activity-102-cleanup').replaceAll('douyin_comment_scoring.scoring','douyin_video_processing.cleanup');
  mkdirSync(join(f.runDir,'runtime/skills/douyin-leadgen-activity-102-cleanup'),{recursive:true});writeFileSync(join(f.runDir,path),bytes);delete f.frozen.files[old];f.frozen.files[path]=sha(bytes);
  const entry=f.frozen.activities[0];entry.reference.slot_key='cleanup';entry.version.payload.definition_key='douyin_video_processing.cleanup';Object.assign(entry.version.payload.implementation_bindings[0],{name:'douyin-leadgen-activity-102-cleanup',path:'services/phone-adb-controller/skills/douyin-leadgen-activity-102-cleanup/SKILL.md'});
 }
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{if(stage==='settle'){entered();await gate;}},release:async()=>{entered();await gate;},inspect:async()=>({}),phone:async()=>{late++;return {};},business:async()=>{late++;return {};},getResult:()=>({saved:1})}),rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};request=q.request;return {result:receipt(q.request)};
 }});
 const pending=execute({key:stage==='release'?'cleanup':'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId}});
 await ready;
 try{
  await assert.rejects(()=>callActivityTool(request.broker_request_path,'phone',{command:'window',args:[]}),/SEALED|CLOSED|EXPIRED/);
  await assert.rejects(()=>callActivityTool(request.broker_request_path,'business',{operation:'score',input:{}}),/SEALED|CLOSED|EXPIRED/);
  assert.equal(late,0);
 }finally{open();await pending;}
});

test('官方终态返回时尚有完整工具onEvent管线未结束必须隔离，不能凭active0清场',async t=>{
 const f=fixture(t);let request,entered,open,pendingTool,settled=0;
 const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{open=resolve;});
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{settled++;},inspect:async()=>({}),phone:async()=>({}),business:async()=>({}),getResult:()=>({scored:1})}),rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};
  request=q.request;pendingTool=callActivityTool(request.broker_request_path,'business',{operation:'score',input:{}}).catch(()=>{});await ready;return {result:receipt(q.request)};
 }});
 let actual;
 try{actual=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},onEvent:async()=>{entered();await gate;return {action:'none'};}});}
 finally{open();await pendingTool;await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(actual.execution_stopped,false);assert.equal(settled,0);
});

for(const unknown of [false,true])test(`真实公共Runner与Primary broker Commander abort：${unknown?'官方停止未知保隔离':'双停确认后needs_review'}`,async t=>{
 const f=fixture(t);let stopCalls=0,settled=0,quarantined=0,next=0;
 const handlers={state:{},scoring:async()=>{throw Error('禁止Code');},mark_leads:async()=>{next++;throw Error('不应继续下一Activity');},createAgentTools:async()=>({prepare:async()=>{},settle:async()=>{settled++;},inspect:async()=>({}),phone:async()=>({}),business:async()=>({}),getResult:()=>({scored:1})})};
 const activities=[{key:'scoring',budget:{max_duration_s:30}},{key:'mark_leads',budget:{max_duration_s:30}}];
 const wired=workflow.createWorkflowExecution({...f,activities,handlers,taskId,rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};
  if(q.kind==='activity_skill_stop'){stopCalls++;return {result:{execution_stopped:true}};}
  await callActivityTool(q.request.broker_request_path,'business',{operation:'score',input:{}});
  return {result:receipt(q.request,{status:'aborted',execution_stopped:!unknown,terminal:{runId:childId,status:'aborted',endedAt:Date.now()}})};
 }});
 const actual=await runWorkflow({activities,context:{run_id:f.binding.run_id,task_id:taskId,workflow_key:'douyin_comment_scoring',execution_mode:'agent'},handlers:wired.execution,executeAgent:wired.executeAgent,verify:async()=>({verified:true}),quarantine:async()=>{quarantined++;return {verified:true};},commander:async request=>request.evidence?.operation==='business'?{action:'abort',reason:'原生证据不足，请主理人复核'}:{action:'none'}});
 assert.equal(stopCalls,1);assert.equal(next,0);
 if(unknown){assert.equal(actual.status,'needs_review');assert.equal(settled,0);assert.equal(quarantined,1);assert.equal(actual.results[0].execution_stopped,false);}
 else{assert.equal(actual.status,'needs_review');assert.equal(actual.results[0].status,'needs_review');assert.equal(settled,1);assert.equal(quarantined,0);}
});

test('Primary提交未知只开放server精确声明的读回留证，读回成功仍needs_review并隔离',async t=>{
 const f=fixture(t);let unknown=false,readbacks=0,settled=0,quarantined=0;
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{settled++;},inspect:async()=>({}),phone:async()=>({}),
  canReadback:(operation,input)=>unknown&&operation==='score_readback'&&input.comment_id==='same-comment',
  business:async operation=>{if(operation==='score'){unknown=true;throw Object.assign(Error('RPC_SCORE_COMMIT_UNKNOWN'),{externalEffect:'unknown'});}if(operation==='score_readback'){readbacks++;return {rows:[{id:'same-comment'}]};}throw Error('RPC_UNEXPECTED_OPERATION');},getResult:()=>null}),rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};
  await assert.rejects(()=>callActivityTool(q.request.broker_request_path,'business',{operation:'score',input:{comment_id:'same-comment'}}),/RPC_SCORE_COMMIT_UNKNOWN/);
  await assert.rejects(()=>callActivityTool(q.request.broker_request_path,'business',{operation:'score_readback',input:{comment_id:'other-comment'}}),/EXECUTION_BLOCKED/);
  const actual=await callActivityTool(q.request.broker_request_path,'business',{operation:'score_readback',input:{comment_id:'same-comment'}});assert.equal(actual.result.rows[0].id,'same-comment');
  return {result:receipt(q.request)};
 }});
 const actual=await runWorkflow({activities:[{key:'scoring',budget:{max_duration_s:30}}],context:{run_id:f.binding.run_id,task_id:taskId,workflow_key:'douyin_comment_scoring',execution_mode:'agent'},executeAgent:execute,verify:async()=>({verified:true}),quarantine:async()=>{quarantined++;return {verified:true};}});
 assert.equal(actual.status,'needs_review');assert.equal(actual.results[0].execution_stopped,false);assert.equal(quarantined,1);assert.equal(readbacks,1);assert.equal(settled,0);
 assert.ok(Array.isArray(actual.results[0].unknown_reasons));assert.ok(actual.results[0].unknown_reasons.includes('business_commit_unknown'));
 assert.equal(actual.results[0].owner_execution_stopped,true);assert.equal(actual.results[0].child_execution_stopped,true);
});

for(const failure of ['ack_lost','owner_changed'])test(`真实60秒heartbeat ${failure}且官方双停时仍隔离，不能启动cleanup或释放`,async t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=phoneFixture(t);let heartbeat=0,cleanup=0,released=0,phone=0,settled=0,quarantined=0,stop;
 const abortRead=new Promise(resolve=>{stop=resolve;});
 // Deliberately no legacy nativeStopUnproven/executionUnknown bit: resource
 // uncertainty must independently close the Runner's cleanup admission.
 const handlers={state:{},createAgentTools:async activity=>({prepare:async()=>{if(activity.key==='cleanup')cleanup++;},heartbeat:async()=>{heartbeat++;throw Error(failure==='ack_lost'?'CENTRAL_LOCK_RENEWAL_UNKNOWN':'CENTRAL_LOCK_OWNER_CHANGED');},settle:async()=>{settled++;},release:async()=>{released++;},inspect:async()=>({}),phone:async()=>{phone++;},business:async()=>({}),getResult:()=>({qualified:1})})};
 const activities=[{key:'qualification',budget:{max_duration_s:120}},{key:'cleanup',budget:{max_duration_s:60}}],wired=workflow.createWorkflowExecution({...f,activities,handlers,taskId,rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};
  if(q.kind==='activity_skill_stop'){stop();return {result:{execution_stopped:true}};}
  if(q.request.activity_key==='qualification'){t.mock.timers.tick(60000);await abortRead;}
  return {result:receipt(q.request)};
 }});
 const actual=await runWorkflow({activities,context:{run_id:f.binding.run_id,task_id:taskId,workflow_key:f.env.WF_BRAIN_WORKFLOW,execution_mode:'agent'},executeAgent:wired.executeAgent,verify:async()=>({verified:true}),quarantine:async()=>{quarantined++;return {verified:true};},commander:async()=>({action:'none'})});
 assert.equal(actual.status,'needs_review');assert.equal(heartbeat,1);assert.equal(cleanup,0);assert.equal(released,0);assert.equal(phone,0);assert.equal(settled,0);assert.equal(quarantined,1);
 assert.equal(actual.results[0].execution_stopped,true);assert.equal(actual.results[0].resource_unverified,true);assert.equal(actual.results[0].owner_execution_stopped,true);assert.equal(actual.results[0].child_execution_stopped,true);
});

for(const discovery of [false,true])test(`Agent电话${discovery?'101':'102'}非cleanup截止扣真实预留，业务截止已过仍可合法收尾`,async t=>{
 const f=phoneFixture(t,{discovery});Object.assign(f.env,{WF_RUN_START_TS:String(Math.floor(Date.now()/1000)-160),WF_RUN_MAX_SECONDS:'180'});f.frozen.agent_input=agentInput(f.env);
 let business=0,cleanup=0,released=0,cleanupDeadline=0;
 const activities=[{key:'preflight',budget:{max_duration_s:120}},{key:'cleanup',budget:{max_duration_s:60}}];
 const handlers={state:{},createAgentTools:async(activity,scope)=>{if(activity.key==='cleanup'){cleanup++;cleanupDeadline=scope.deadline_ms;}else business++;return {prepare:async()=>{},settle:async()=>{},release:async()=>{released++;},inspect:async()=>({}),phone:async()=>({}),business:async()=>({}),getResult:()=>({saved:1})};}};
 const wired=workflow.createWorkflowExecution({...f,activities,handlers,taskId,rpc:async q=>q.kind==='activity_skill_authority'?{authorized:true}:{result:receipt(q.request)}});
 await assert.rejects(()=>wired.executeAgent(activities[0],{context:{task_id:taskId}}),/DEADLINE/);assert.equal(business,0);
 const actual=await wired.executeAgent(activities[1],{context:{task_id:taskId}});assert.equal(actual.status,'completed');assert.equal(cleanup,1);assert.equal(released,1);
 assert.ok(cleanupDeadline>Date.now());assert.ok(cleanupDeadline<=(Number(f.env.WF_RUN_START_TS)+180)*1000);
});

test('旧Code102不引入Agent预留语义，103纯Skill无手机预算预留',async t=>{
 const f=phoneFixture(t);Object.assign(f.env,{LEADGEN_EXECUTION_MODE:'code',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)-160),WF_RUN_MAX_SECONDS:'180'});delete f.frozen.execution_mode;delete f.frozen.agent_input;let code=0;
 const wired=workflow.createWorkflowExecution({...f,activities:[{key:'preflight',budget:{max_duration_s:120}},{key:'cleanup',budget:{max_duration_s:60}}],handlers:{state:{},preflight:async()=>{code++;return {saved:1};}}});
 await wired.execution.preflight({});assert.equal(code,1);
 const scoring=fixture(t);Object.assign(scoring.env,{WF_RUN_START_TS:String(Math.floor(Date.now()/1000)-160),WF_RUN_MAX_SECONDS:'180'});scoring.frozen.agent_input=agentInput(scoring.env);let started=0;
 const primary=workflow.createWorkflowExecution({...scoring,activities:[{key:'scoring',budget:{max_duration_s:120}}],handlers:{state:{},createAgentTools:async()=>({prepare:async()=>{started++;},settle:async()=>{},inspect:async()=>({}),phone:async()=>({}),business:async()=>({}),getResult:()=>({scored:1})})},rpc:async q=>q.kind==='activity_skill_authority'?{authorized:true}:{result:receipt(q.request)}});
 const actual=await primary.executeAgent({key:'scoring',budget:{max_duration_s:120}},{context:{task_id:taskId}});assert.equal(actual.status,'completed');assert.equal(started,1);
});

test('Primary executor开始前拒绝非冻结agent mode，不取资源也不派发',async t=>{
 assert.equal(typeof api.createActivitySkillExecutor,'function');const f=fixture(t);delete f.frozen.execution_mode;let prepared=0;
 assert.throws(()=>api.createActivitySkillExecutor({...f,createTools:async()=>{prepared++;},rpc:async()=>{throw Error('不应RPC');}}),/EXECUTION_MODE/);assert.equal(prepared,0);
});

test('Primary executor在取资源之前拒绝只有恢复声明的原Skill',async t=>{
 assert.equal(typeof api.createActivitySkillExecutor,'function');const f=fixture(t);let prepared=0;
 const path='runtime/skills/douyin-leadgen-activity-103-scoring/SKILL.md',bytes=readFileSync(join(f.runDir,path),'utf8').replace('  primary_execution: agent-v1\n','');writeFileSync(join(f.runDir,path),bytes);f.frozen.files[path]=sha(bytes);
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>{prepared++;},rpc:async()=>{throw Error('不应RPC');}});
 await assert.rejects(()=>execute({key:'scoring'},{context:{task_id:taskId}}),/AGENT_PRIMARY_METHOD_UNSUPPORTED/);assert.equal(prepared,0);
});

test('正式workflow执行接点从冻结mode选择Primary工厂，原scoring handler始终不执行',async t=>{
 assert.equal(typeof workflow.createWorkflowExecution,'function','正式main需要消费同一执行接点');
 const f=fixture(t);
 let original=0,submitted=0;
 const handlers={state:{},scoring:async()=>{original++;throw Error('不允许原scoring');},createAgentTools:async()=>({prepare:async()=>{},settle:async()=>{},inspect:async()=>({}),phone:async()=>{},business:async()=>{submitted++;return {};},getResult:()=>submitted?{scored:1}:null})};
 const wired=workflow.createWorkflowExecution({...f,activities:[{key:'scoring',budget:{max_duration_s:30}}],handlers,taskId,root:join(f.runDir,'runtime'),rpc:async q=>{
  if(q.kind==='activity_skill_authority')return {authorized:true};
  await callActivityTool(q.request.broker_request_path,'business',{operation:'score',input:{}});return {result:receipt(q.request)};
 }});
 assert.equal(wired.executionMode,'agent');
 const actual=await wired.executeAgent({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},onEvent:async()=>({action:'none'})});
 assert.equal(actual.result.scored,1);assert.equal(original,0);assert.equal(submitted,1);assert.ok(handlers.state.budgetDeadline>Date.now());
});

test('正式执行接点创建后输入漂移仍在每slot取资源之前拒绝；scope只取冻结输入',async t=>{
 const f=fixture(t);let tools=0;
 const wired=workflow.createWorkflowExecution({...f,activities:[{key:'scoring',budget:{max_duration_s:30}}],taskId,handlers:{state:{},createAgentTools:async()=>{tools++;throw Error('不应取工具');}},rpc:async()=>{throw Error('不应RPC');}});
 f.env.LEADGEN_LIMIT='3';await assert.rejects(()=>wired.executeAgent({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId}}),/AGENT_INPUT/);assert.equal(tools,0);
});

test('真实owner reservation：同run的Observer与Skill执行父会话互不阻塞，单lane重复仍拒绝',async t=>{
 const home=mkdtempSync(join(tmpdir(),'observer-primary-reservation-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const worker={run_id:'same-run__a1',binding_id:bindingId,source_commit:'a'.repeat(40),task_id:taskId},observer={...worker,commander_role:'observer'};
 assert.notEqual(workflowCommanderSession(worker),workflowCommanderSession(observer));
 const one=await reserveWorkflowCommanderTurn(worker,{home}),two=await reserveWorkflowCommanderTurn(observer,{home});
 try{await one.check();await two.check();await assert.rejects(()=>reserveWorkflowCommanderTurn(worker,{home}),/COMMANDER_OWNER_TURN_UNRESOLVED/);}
 finally{await one.returned('worker real result');await two.returned('observer real result');await one.close();await two.close();}
});

test('Primary继承公共Runner剩余绝对截止，给Worker/官方返回/终检在原预算内分期',async t=>{
 const f=fixture(t),absolute=Date.now()+1000;let request;
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>({scored:1})}),rpc:async q=>{request=q.request;return {result:receipt(q.request)};}});
 await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},deadline_ms:absolute});
 assert.ok(request.deadline_ms<=absolute,'不能用now+原Activity预算覆盖公共剩余');
 assert.ok(request.worker_deadline_ms<request.receipt_deadline_ms);
 assert.ok(request.receipt_deadline_ms<request.deadline_ms);
});
test('Primary普通RPC超时也精确请求当前绑定停止，缺双方证明仍不settle/release',async t=>{
 const f=fixture(t);let launches=0,stops=0,settled=0,request;
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{settled++;},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>null}),rpc:async q=>{
  if(q.kind==='activity_skill_stop'){stops++;assert.deepEqual(q.request,request);return {result:{execution_stopped:false,child_execution_stopped:true}};}
  launches++;request=q.request;throw Error('EXECUTION_DEADLINE');
 }});
 await assert.rejects(()=>execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},deadline_ms:Date.now()+1000}),error=>error.message==='EXECUTION_DEADLINE'&&error.executionStopped===false);
 assert.equal(launches,1);assert.equal(stops,1);assert.equal(settled,0);
});

test('公共Runner短预算到Worker截止仍有真实终检与cleanup，未扩大整轮截止',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=phoneFixture(t),start=Date.now();let checked=0,released=0;const slots=[];
 const tools=async activity=>({prepare:async()=>{},settle:async()=>{},release:async()=>{released++;},inspect:async()=>({}),phone:async()=>({}),business:async()=>({}),getResult:()=>activity.key==='cleanup'?{cleaned:true}:null});
 const execute=api.createActivitySkillExecutor({...f,createTools:tools,rpc:async q=>{
  slots.push(q.request.activity_key);
  if(q.request.activity_key==='preflight')t.mock.timers.tick(q.request.worker_deadline_ms-Date.now());
  return {result:receipt(q.request,{status:q.request.activity_key==='cleanup'?'ok':'timeout'})};
 }});
 const result=await runWorkflow({activities:[{key:'preflight',budget:{max_duration_s:1}},{key:'cleanup',budget:{max_duration_s:1}}],context:{run_id:f.binding.run_id,task_id:taskId,workflow_key:f.env.WF_BRAIN_WORKFLOW,execution_mode:'agent'},executeAgent:execute,verify:async()=>{checked++;return {verified:true};},commander:async()=>({action:'none'})});
 assert.equal(result.status,'needs_review');assert.deepEqual(slots,['preflight','cleanup']);assert.equal(released,1);assert.equal(checked,1);
 assert.equal(result.results[0].checks.at(-1).reason,'agent_execution_failed');assert.ok(Date.now()-start<1000);
});
test('Primary在短Activity耗尽前报告早期stall，普通inspect不冒充业务进展',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:Date.now()});const f=fixture(t),seen=[];
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>({scored:1})}),rpc:async q=>{
  t.mock.timers.tick(2500);await new Promise(resolve=>setImmediate(resolve));return {result:receipt(q.request)};
 }});
 await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},onEvent:async event=>{seen.push(event);return {action:'none'};}});
 assert.equal(seen.filter(event=>event.type==='stall').length,1);assert.ok(seen[0].elapsed_ms<10000);
});

test('早期stall的Observer异常仅记unavailable，不触发资源未知或精确停止',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:Date.now()});const f=fixture(t);let stopped=0;
 const execute=api.createActivitySkillExecutor({...f,createTools:async()=>({prepare:async()=>{},settle:async()=>{},inspect:async()=>({}),phone:async()=>{},business:async()=>{},getResult:()=>({scored:1})}),rpc:async q=>{
  if(q.kind==='activity_skill_stop'){stopped++;return {result:{execution_stopped:false}};}
  t.mock.timers.tick(2500);await new Promise(resolve=>setImmediate(resolve));return {result:receipt(q.request)};
 }});
 const result=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId},onEvent:async()=>{throw Error('observer unavailable');}});
 assert.equal(result.status,'completed');assert.equal(result.execution_stopped,true);assert.equal(stopped,0);
 const row=JSON.parse(readFileSync(join(f.runDir,'skill-primary/scoring/broker-events.jsonl'),'utf8').trim());assert.equal(row.commander_status,'unavailable');assert.equal(row.event.type,'stall');
});

test('unproved primary slot is not started; no tools, phone, worker or broker launch is attempted',async t=>{
 const f=fixture(t);let calls=0;
 const execute=api.createActivitySkillExecutor({...f,supportsNativeScope:()=>false,createTools:async()=>{calls++;throw Error('must not allocate');},rpc:async()=>{calls++;throw Error('must not dispatch');}});
 const actual=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId}});
 assert.equal(actual.status,'needs_review');assert.equal(actual.not_started,true);assert.equal(actual.execution_stopped,true);assert.equal(calls,0);
});

test('existing unproved native state remains unknown even when the new launch guard rejects a slot',async t=>{
 const f=fixture(t);let calls=0;const execute=api.createActivitySkillExecutor({...f,supportsNativeScope:()=>false,nativeState:()=>({native_stop_unproven:true}),createTools:async()=>{calls++;throw Error('must not prepare');},rpc:async()=>{calls++;throw Error('must not launch');}});
 const actual=await execute({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId}});assert.equal(actual.not_started,true);assert.equal(actual.execution_stopped,false);assert.equal(actual.resource_unverified,true);assert.equal(calls,0);
});
test('actual generic provider native uncertainty reaches executor even behind a new not-started guard',async t=>{
 const f=phoneFixture(t),{createHandlers}=await import('../leadgen-handlers.mjs'),{digest,commentSamplingInput}=await import('../runtime-definition.mjs');
 const env={...f.env,HOME:f.runDir,WFR_RUN_DIR:f.runDir,WFR_RUN_ID:'douyin_video_processing-'+f.env.WFR_TAG,WFR_ATTEMPT:'a1',DOUYIN_PHONE_ADB:'/fixture/controller',DOUYIN_ADB_BIN:'/fixture/adb'};
 const body={execution_mode:'agent',deployment:{source_commit:'a'.repeat(40)},files:{},sampling_input:commentSamplingInput(env)};writeFileSync(join(f.runDir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
 const h=createHandlers({root:f.runDir,env,taskId,sourceCommit:'a'.repeat(40),centralLease:{async verifyTask(){},async acquire(){},async ensure(){},async verifyHeld(){}},rpc:async()=>({result:{company_id:'company',tenant_id:'tenant',version:1,run_id:env.WFR_TAG,device_binding:{company_id:'company',tenant_id:'tenant',version:1,run_id:env.WFR_TAG,profile:env.P,device_serial:env.SERIAL,douyin_id:'expected-account',verification_status:'verified',enabled:true}}}),execute:async(_command,args)=>({code:0,stdout:args[0]?.endsWith('adb-existing-route.py')?'5042\n':args.includes('get-state')?'device\n':args.includes('preflight')?`serial=${env.SERIAL}\n`:args.includes('lock-acquire')?'lock=acquired\n':'mCallState=0\n',stderr:''})});
 const scope={workflow:env.WF_BRAIN_WORKFLOW,activity:'preflight',run:env.WFR_TAG,run_id:env.WFR_RUN_ID+'__a1',task_id:taskId,binding_id:bindingId,source_commit:'a'.repeat(40),snapshot_sha256:digest(body),profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:env.LEADGEN_SOURCE_RUN,limit:2,comment_limit:5,deadline_ms:Date.now()+20000};
 const tools=await h.createAgentTools({key:'preflight'},scope);await tools.prepare();assert.equal(h.state.nativeStopUnproven,true);assert.equal(tools.getResult().execution_stopped,false);
 let dispatched=0;const execute=api.createActivitySkillExecutor({...f,supportsNativeScope:()=>false,nativeState:h.agentNativeState,createTools:async()=>{dispatched++;return tools;},rpc:async()=>{dispatched++;throw Error('must not launch');}});
 const result=await execute({key:'preflight',budget:{max_duration_s:300}},{context:{task_id:taskId}});assert.equal(result.not_started,true);assert.equal(result.execution_stopped,false);assert.equal(result.resource_unverified,true);assert.equal(dispatched,0);
});

test('正式工作流未声明受信执行能力时在工具分配前停止，JSON和环境标记不能启用',async t=>{
 const f=fixture(t);let calls=0;
 const handlers={state:{},agentNativeState:()=>({}),createAgentTools:async()=>{calls++;throw Error('unsupported tools must not allocate');}};
 const wired=workflow.createWorkflowExecution({...f,env:{...f.env,LEADGEN_NATIVE_SCOPE_SUPPORTED:'true'},activities:[{key:'scoring',budget:{max_duration_s:30}}],handlers,taskId,rpc:async()=>{calls++;throw Error('unsupported worker must not launch');}});
 const actual=await wired.executeAgent({key:'scoring',native_scope_supported:true,budget:{max_duration_s:30}},{context:{task_id:taskId}});
 assert.equal(actual.status,'needs_review');assert.equal(actual.not_started,true);assert.equal(actual.execution_stopped,true);assert.equal(calls,0);
});

test('正式工作流保留原Provider未证明状态，不因尚未启动新Worker而报告停止',async t=>{
 const f=fixture(t);let calls=0;
 const handlers={state:{nativeStopUnproven:true},agentNativeState:()=>({native_stop_unproven:true}),createAgentTools:async()=>{calls++;throw Error('old unknown must not allocate');}};
 const wired=workflow.createWorkflowExecution({...f,activities:[{key:'scoring',budget:{max_duration_s:30}}],handlers,taskId,rpc:async()=>{calls++;throw Error('old unknown must not launch');}});
 const actual=await wired.executeAgent({key:'scoring',budget:{max_duration_s:30}},{context:{task_id:taskId}});
 assert.equal(actual.status,'needs_review');assert.equal(actual.not_started,true);assert.equal(actual.execution_stopped,false);assert.equal(actual.resource_unverified,true);assert.equal(calls,0);
});
