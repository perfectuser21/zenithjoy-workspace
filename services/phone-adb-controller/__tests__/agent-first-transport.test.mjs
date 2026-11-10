import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startPrimaryActivityBroker} from '../activity-skill-primary-broker.mjs';
import {createHash} from 'node:crypto';
import {verifySkillRequest,relayActivityTool,skillRunKey,runSkillAgent,claimSkillSpawn} from '../leadgen-skill-agent.mjs';

const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=x=>createHash('sha256').update(canonical(x)).digest('hex');
function scope(){
 const contract={budget:{max_duration_s:30}},av={payload:{definition_key:'douyin_video_discovery.collect_videos',contract,implementation_bindings:[{kind:'skill',name:'method1',version:'0.2.0',content_sha256:'x',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)}]},contract_sha256:sha(contract)};
 const q={run_id:'primary__a1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'binding1',workflow_key:'douyin_video_discovery',run_tag:'pure_101',profile:'xiaolongxia',serial:'ANGYVB4311010223',line:'yuesheng',source_commit:'a'.repeat(40),workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'s1',activity_key:'collect_videos',broker_host:'mmv',deadline_ms:Date.now()+10000,mode:'execute',method:{reference_id:'ref1',activity_version_id:'av1',name:'method1',version:'0.2.0',sha256:'x',text:'---\nname: method1\nmetadata:\n  primary_execution: agent-v1\n---\n方法正文',support:{sha256:'y',text:'policy'},contract:{activity_version_id:'av1',definition_key:av.payload.definition_key,sha256:sha(contract),payload:contract}}};
 const binding={id:'binding1',run_id:q.run_id,workflow_id:'w1',workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'s1',external_origin:'zenithjoy:mmv',actor:'runtime:phone-adb-controller:agent-v1'};
 const wf={source_commit:q.source_commit,payload:{key:'douyin_video_discovery',activities:[{slot_key:'collect_videos',reference_id:'ref1',activity_id:'a1',activity_version_id:'av1'}]}};
 const task={id:q.task_id,status:'in_progress',claimed_by:'headed-primary',payload:{workflow_key:q.workflow_key,run_tag:q.run_tag,profile:q.profile,device_serial:q.serial,company_line:q.line,source_commit:q.source_commit}};
 Object.assign(q,{source_run:null,limit:2,comment_limit:null,discovery_filters:{sort:'comprehensive',time_layer:'one_week',location:'unlimited'},discovery_input:null,run_max_seconds:1800});
 return {q,binding,wf,task,av,get:async path=>path.includes('/runs/')?{binding}:path.includes('/workflows/')?{version:wf}:path.includes('/tasks/')?task:{version:av}};
}

test('Primary Skill必须核中央ACK的agent actor，不能给Code run自行换mode提权',async()=>{
 const {q,binding,get}=scope();assert.equal(await verifySkillRequest(q,{get,verifyMethod:()=>true}),true);
 for(const actor of [undefined,'runtime:phone-adb-controller','runtime:phone-adb-controller:agent-v1 ']){
  binding.actor=actor;await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_BINDING_REQUIRED/);
 }
});

test('Primary Skill中央准入拒绝104与自报续行代',async()=>{
 const {q,wf,get}=scope();wf.payload.key='douyin_lead_outreach';
 await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_WORKFLOW_UNSUPPORTED/);
 wf.payload.key='douyin_video_discovery';
 await assert.rejects(()=>verifySkillRequest({...q,transport_generation:0},{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_GENERATION_UNSUPPORTED/);
});

test('Primary中央任务必须活跃且同公司来源设备；top/payload歧义不能选一边通过',async()=>{
 const {q,binding,task,get}=scope();
 for(const mutation of [{status:'failed'},{claimed_by:null},{payload:{...task.payload,source_commit:'b'.repeat(40)}},{payload:{...task.payload,company_line:'other-company'}},{payload:{...task.payload,device_serial:'OTHER'}}]){
  const original=structuredClone(task);Object.assign(task,mutation);
  try{await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);}finally{Object.assign(task,original);}
 }
 binding.payload={actor:'runtime:phone-adb-controller'};
 await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_BINDING_CONFLICT/);
});

test('Primary必须读取已验Skill front的agent-v1声明，旧恢复Skill不能自报获得首次执行权',async()=>{
 const {q,get}=scope();
 for(const text of ['旧恢复Skill','---\nname: method1\n---\n正文含 primary_execution: agent-v1','---\nname: method1\nmetadata:\n  primary_execution: agent-v2\n---']){
  await assert.rejects(()=>verifySkillRequest({...q,method:{...q.method,text}},{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_METHOD_UNSUPPORTED/);
 }
});

test('中央Task明确101数量、筛选、关键词与尝试上限时冻结错输入仍拒绝，不误比下游配额',async()=>{
 const {q,task,get}=scope();q.discovery_input={schema_version:2,workflow_key:q.workflow_key,run_tag:q.run_tag,profile:q.profile,serial:q.serial,line:q.line,max_attempts:4,max_screens:1,source_kind:'keyword',sources:['本地部署AI'],source_sha256:'c'.repeat(64)};
 task.payload.scope={video_limit:2,comment_limit:5,score_limit:10,sort:'comprehensive',time_layer:'one_week',location:'unlimited',keyword:'本地部署AI',max_video_attempts:4,send:0};
 assert.equal(await verifySkillRequest(q,{get,verifyMethod:()=>true}),true);
 for(const mutation of [{limit:3},{discovery_filters:{...q.discovery_filters,sort:'latest'}},{discovery_input:{...q.discovery_input,sources:['别的关键词']}},{discovery_input:{...q.discovery_input,max_attempts:5}}])await assert.rejects(()=>verifySkillRequest({...q,...mutation},{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
 task.payload.limit=3;await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);delete task.payload.limit;
 task.payload.scope.send=1;await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
});

for(const scoring of [false,true])test(`中央Task明确${scoring?'103':'102'}来源与配额时不允许合法其他批次或更大数量`,async()=>{
 const {q,task,wf,av,get}=scope(),workflow=scoring?'douyin_comment_scoring':'douyin_video_processing',key=scoring?'scoring':'collection';
 Object.assign(q,{workflow_key:workflow,activity_key:key,source_run:'source_A',limit:scoring?10:2,comment_limit:scoring?null:5,discovery_filters:null,discovery_input:null,...(scoring?{profile:'mmv-scoring',serial:'none'}:{})});
 wf.payload.key=workflow;wf.payload.activities[0].slot_key=key;av.payload.definition_key=workflow+'.'+key;q.method.contract.definition_key=av.payload.definition_key;
 Object.assign(task.payload,{workflow_key:workflow,profile:q.profile,scope:{source_run:'source_A',video_limit:2,comment_limit:5,score_limit:10,send:0}});if(scoring)delete task.payload.device_serial;
 assert.equal(await verifySkillRequest(q,{get,verifyMethod:()=>true}),true);
 for(const mutation of [{source_run:'source_B'},{limit:q.limit+1},...(!scoring?[{comment_limit:6}]:[])])await assert.rejects(()=>verifySkillRequest({...q,...mutation},{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
 task.payload.source_run='source_B';await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
});

for(const mode of ['execute','repair','readback_only'])test(`真实relay仅在${mode}对应允许的操作通道中执行`,async t=>{
 const home=mkdtempSync(join(tmpdir(),'primary-relay-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const q={protocol:'leadgen-activity-v1',run_id:'primary__a1',activity_key:'collect_videos',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),deadline_ms:Date.now()+20000,broker_host:'mmv',broker_request_path:'/Users/fixture/run/request.json',broker_tool_path:'/Users/fixture/run/tool.mjs',mode,method:{name:'fixture',version:'0.1.1',text:'fixture'}};
 const dir=join(home,'.openclaw','leadgen-activity-runs',skillRunKey(q));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'activity-request.json'),JSON.stringify(q));let called=0;
 const deps={home,authorize:async()=>true,execute:async(_cmd,args,opts)=>{called++;assert.equal(args.at(-1),mode==='execute'?'business':'inspect');assert.deepEqual(JSON.parse(opts.input),mode==='execute'?{operation:'discover',input:{videos:[]}}:{});return {code:0,stdout:'{"ok":true,"result":{"accepted":true}}\n',stderr:''};}};
 if(mode==='execute'){
  const actual=await relayActivityTool(dir,'business',{operation:'discover',input:{videos:[]}},deps);assert.equal(actual.result.accepted,true);
  await assert.rejects(()=>relayActivityTool(dir,'resume',{},deps),/RPC_SKILL_TOOL_SCOPE_INVALID/);
 }else{
  await relayActivityTool(dir,'inspect',{},deps);
  await assert.rejects(()=>relayActivityTool(dir,'business',{operation:'discover',input:{}},deps),/RPC_SKILL_TOOL_SCOPE_INVALID/);
 }
 assert.equal(called,1);
});

test('Primary官方transport不能用父CLI普通成功文本冒双方停止证明',async t=>{
 const home=mkdtempSync(join(tmpdir(),'primary-owner-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const q={protocol:'leadgen-activity-v1',run_id:'primary-owner__a1',task_id:null,binding_id:'b1',activity_key:'collect_videos',nonce:'c'.repeat(48),deadline_ms:Date.now()+20000,source_commit:'a'.repeat(40),broker_host:'mmv',broker_request_path:'/Users/fixture/run/request.json',broker_tool_path:'/Users/fixture/run/tool.mjs',mode:'execute',method:{name:'fixture',version:'0.1.1',text:'isolated method'}};
 let dir;
 const actual=await runSkillAgent(q,{home,verifyWorkspace:()=>true,execute:async(command,args)=>{
  if(command==='openclaw'){
   dir=args[args.indexOf('--message-file')+1].replace(/\/parent-message\.txt$/,'');const request=JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'));
   const child='12345678-0000-4000-8000-000000000001',session='agent:skill-factory:subagent:fixture';
   for(const [name,value] of Object.entries({'spawn-claimed.json':{...request,source_commit:q.source_commit},'agent-binding.json':{...request,child_run_id:child,child_session_key:session},'spawn-receipt.json':{runId:child,childSessionKey:session,resolvedProvider:'openai',resolvedModel:'openai/gpt-6.1-sol'},'agent-terminal.json':{runId:child,status:'ok',endedAt:1,terminalReceipt:{runId:child,effective:{provider:'openai',model:'gpt-6.1-sol'}}}}))writeFileSync(join(dir,name),JSON.stringify(value));
   return {code:0,stdout:'parent says success',stderr:''};
  }
  return {code:0,stdout:'',stderr:''};
 }});
 assert.equal(actual.execution_stopped,false);assert.equal(actual.owner_execution_stopped,false);assert.equal(actual.child_execution_stopped,true);
 const message=readFileSync(join(dir,'parent-message.txt'),'utf8');assert.match(message,/Agent-first/);assert.match(message,/business/);
});

for(const kind of ['question','progress','error'])test(`真实relay→工具CLI→primary socket将inspect ${kind}交Commander并保下一轮指导`,async t=>{
 const home=mkdtempSync(join(tmpdir(),'primary-cli-event-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const q={protocol:'leadgen-activity-v1',mode:'execute',run_id:'primary_cli__a1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',activity_key:'preflight',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),runtime_snapshot_sha256:'c'.repeat(64),deadline_ms:Date.now()+10000,broker_host:'mmv',method:{name:'fixture',version:'0.1.0',text:'fixture'}};
 const dir=join(home,'.openclaw','leadgen-activity-runs',skillRunKey(q));mkdirSync(dir,{recursive:true});
 const seen=[];const broker=await startPrimaryActivityBroker({directory:join(home,'broker'),request:q,authorize:async()=>true,inspect:async()=>({pending_write_readbacks:[]}),phone:async()=>({}),business:async()=>({}),onEvent:async event=>{seen.push(event);return {action:'steer',text:'核对原生登录账号'};}});
 t.after(()=>broker.close());Object.assign(q,{broker_request_path:broker.requestPath,broker_tool_path:fileURLToPath(new URL('../activity-skill-tool.mjs',import.meta.url))});
 writeFileSync(join(dir,'activity-request.json'),JSON.stringify(q));
 const deps={home,authorize:async()=>true};
 const first=await relayActivityTool(dir,'inspect',{[kind]:'实际预检事件'},deps);
 assert.equal(first.ok,true);assert.equal(seen[0].type,kind);assert.equal(seen[0].text,'实际预检事件');
 const next=await relayActivityTool(dir,'inspect',{},deps);assert.deepEqual(next.result.commander_guidance,['核对原生登录账号']);
 assert.deepEqual(first.result.pending_write_readbacks,[]);
});

test('真实relay保留受限工具错误码诊断，不泄露子进程stderr正文',async t=>{
 const home=mkdtempSync(join(tmpdir(),'primary-cli-error-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const q={protocol:'leadgen-activity-v1',mode:'execute',run_id:'primary_cli__a1',activity_key:'preflight',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),deadline_ms:Date.now()+10000,broker_host:'mmv',broker_tool_path:'/fixture/tool.mjs',broker_request_path:'/fixture/request.json',method:{name:'fixture',version:'0.1.0',text:'fixture'}};
 const dir=join(home,'.openclaw','leadgen-activity-runs',skillRunKey(q));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'activity-request.json'),JSON.stringify(q));
 await assert.rejects(()=>relayActivityTool(dir,'inspect',{question:'如何处理？'},{home,authorize:async()=>true,execute:async()=>({code:1,stdout:'',stderr:'SKILL_PRIMARY_EXPIRED\nprivate Bearer secret-token'})}),error=>error.message==='RPC_SKILL_TOOL_FAILED'&&error.toolErrorCode==='SKILL_PRIMARY_EXPIRED');
});

test('Agent relay生成可无截断还原的冻结方法原件，parent不重复搬运业务大payload',async t=>{
 const home=mkdtempSync(join(tmpdir(),'primary-compact-relay-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const {q}=scope();Object.assign(q,{protocol:'leadgen-activity-v1',broker_tool_path:'/fixture/tool.mjs',broker_request_path:'/fixture/request.json',nonce:'d'.repeat(48)});
 q.worker_deadline_ms=Date.now()+5000;q.receipt_deadline_ms=Date.now()+7500;
 q.method.text+='a'.repeat(3999-q.method.text.length)+'😀'+'业务方法原文'.repeat(3000);q.method.support.text='b'.repeat(3999)+'😀'+'完整安全边界'.repeat(2000);q.method.contract.payload.note='c'.repeat(3999)+'😀'.repeat(3000);
 let checked=false;
 await runSkillAgent(q,{home,verifyWorkspace:()=>true,execute:async(command,args)=>{
  if(command==='openclaw'){
   const path=args[args.indexOf('--message-file')+1],dir=path.replace(/\/parent-message\.txt$/,'');
   const request=JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'));
   assert.equal(request.expires_at,q.deadline_ms/1000,'handoff读回/停止授权不能随worker提前过期');
   assert.equal(request.worker_expires_at,q.worker_deadline_ms/1000);
   assert.ok(claimSkillSpawn(dir,{home,verifyWorkspace:()=>true}));
   const plan=JSON.parse(readFileSync(join(dir,'child-task.json'),'utf8'));
   assert.equal(plan.scope.run_id,q.run_id);assert.equal(plan.scope.source_commit,q.source_commit);
   for(const [field,bytes] of [['method',q.method.text],['support',q.method.support.text],['contract',JSON.stringify(q.method.contract)]]){
    const pieces=plan[field].parts.map(part=>readFileSync(part,'utf8'));
    assert.ok(pieces.every(part=>part.length<=4000));assert.equal(pieces.join(''),bytes);
   }
   assert.deepEqual(JSON.parse(readFileSync(plan.contract_path,'utf8')),q.method.contract);
   assert.deepEqual(plan.identity_contract.binding_checks,['run_id','task_id','parent_session_key','nonce']);
   assert.equal(plan.inspect_contract.pending_write_readbacks,'unconfirmed_write_operations');
   assert.deepEqual(plan.inspect_contract.defaults,{commander_guidance:[],commander_abort:false});
   assert.ok(readFileSync(path,'utf8').length<6000);assert.ok(!readFileSync(path,'utf8').includes(q.method.text));
   checked=true;return {code:0,stdout:'{}',stderr:''};
  }
  return {code:1,stdout:'',stderr:''};
 }});
 assert.equal(checked,true);
});

test('execute子任务交付binding-ready双模板和canonical exec/process固定路由',async t=>{
 const home=mkdtempSync(join(tmpdir(),'primary-binding-ready-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const {q}=scope();Object.assign(q,{protocol:'leadgen-activity-v1',broker_tool_path:'/fixture/tool.mjs',broker_request_path:'/fixture/request.json',nonce:'e'.repeat(48),worker_deadline_ms:Date.now()+5000,receipt_deadline_ms:Date.now()+7500});
 let delivered;
 await runSkillAgent(q,{home,verifyWorkspace:()=>true,execute:async(command,args)=>{
  if(command==='openclaw'){
   const path=args[args.indexOf('--message-file')+1],dir=path.replace(/\/parent-message\.txt$/,'');
   delivered={dir,message:readFileSync(path,'utf8'),plan:JSON.parse(readFileSync(join(dir,'child-task.json'),'utf8')),request:JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'))};
   return {code:0,stdout:'{}',stderr:''};
  }
  return {code:1,stdout:'',stderr:''};
 }});
 assert.ok(delivered);const {dir,message,plan,request}=delivered;
 assert.equal(plan.scope.run_id,q.run_id);assert.equal(plan.scope.source_commit,q.source_commit);assert.equal(plan.scope.nonce,q.nonce);
 assert.equal(request.worker_expires_at,q.worker_deadline_ms/1000);assert.equal(request.expires_at,q.deadline_ms/1000);
 assert.deepEqual(plan.identity_contract.binding_checks,['run_id','task_id','parent_session_key','nonce']);
 assert.deepEqual(Object.keys(plan.binding_ready_command_files??{}).sort(),['exec_gateway','gateway_exec'],'child必须拿到父绑定只读等待的两组完整调用模板');
 for(const surface of ['gateway_exec','exec_gateway']){
  const path=plan.binding_ready_command_files[surface],invocation=JSON.parse(readFileSync(path,'utf8'));
  assert.ok(path.startsWith(dir+'/'));assert.equal(invocation.tool,surface==='gateway_exec'?'gateway_exec':'exec');
  assert.equal(invocation.parameters.host,surface==='gateway_exec'?undefined:'gateway');
  assert.ok(!['auto','sandbox','node'].includes(invocation.parameters.host));
  assert.ok(Object.keys(invocation.parameters.env??{}).every(key=>key==='LEADGEN_GATEWAY_SURFACE'),'模板env不得开放run/source/nonce/host/PATH等身份注入');
  if(invocation.parameters.env?.LEADGEN_GATEWAY_SURFACE!==undefined)assert.equal(invocation.parameters.env.LEADGEN_GATEWAY_SURFACE,surface);
  const command=invocation.parameters.command;
  assert.match(command,/\/bin\/hostname/);assert.match(command,/aad17-2/);assert.match(command,/r10-7/);assert.match(command,/RPC_SKILL_GATEWAY_HOST_MISMATCH/);
  assert.ok(command.includes('wf-agent-handoff.py'));assert.ok(command.includes('binding-ready'));assert.ok(command.includes(dir));
  assert.ok(invocation.parameters.timeoutSeconds>0&&invocation.parameters.timeoutSeconds<=5,'等待不得超出原worker剩余预算');
  assert.equal(invocation.parameters.yieldMs,1000);
  assert.ok(!('stdin' in invocation.parameters));
 }
 const childInstructions=message+'\n'+plan.rules.join('\n');
 assert.match(childInstructions,/exec\(host=gateway\)/);assert.match(childInstructions,/gateway_process/);assert.match(childInstructions,/process/);
 assert.match(childInstructions,/sessionId/);assert.match(childInstructions,/不切换|不切|不换/);
 assert.match(childInstructions,/未绑定不得执行任何业务/);
});
