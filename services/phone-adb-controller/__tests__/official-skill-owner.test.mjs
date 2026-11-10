import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execInput} from '../leadgen-client.mjs';
import {reserveWorkflowCommanderTurn,workflowCommanderSession,ownerPending} from '../commander-owner-state.mjs';
const api=await import('../official-skill-owner.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
function fixture(t,variant='ok'){
 const directory=mkdtempSync(join(tmpdir(),'official-owner-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const request={protocol:'leadgen-activity-v1',mode:'execute',primary_host:'official-child-v1',run_id:'fixture__a1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),deadline_ms:Date.now()+10000,receipt_deadline_ms:Date.now()+8000};
 const parent=workflowCommanderSession(request),cli=join(directory,'gateway-fixture');
 writeFileSync(join(directory,'activity-request.json'),JSON.stringify(request),{mode:0o600});
 const child={run_id:request.run_id,task_id:request.task_id,nonce:request.nonce,parent_session_key:parent,child_run_id:'33333333-3333-4333-8333-333333333333',child_session_key:'agent:skill-factory:subagent:fixture'};
 writeFileSync(join(directory,'agent-binding.json'),JSON.stringify(child),{mode:0o600});
 writeFileSync(cli,`#!/usr/bin/python3
import sys,json,time,pathlib
d=pathlib.Path(${JSON.stringify(directory)});v=${JSON.stringify(variant)}
assert sys.argv[1:3]==['gateway','call']
method=sys.argv[3];params=json.loads(sys.argv[sys.argv.index('--params')+1])
intent=json.loads((d/'owner-rpc-intent.json').read_text())
assert '--expect-final' not in sys.argv
with (d/'calls.jsonl').open('a') as f:f.write(json.dumps({'method':method,'params':params})+'\\n')
if method=='agent':
 assert params['idempotencyKey']==intent['owner_run_id'] and params['sessionKey']==intent['parent_session_key']
 assert 'runId' not in params
 if v=='acklost':sys.exit(2)
 print(json.dumps({'runId':'wrong' if v=='wrong-ack' else params['idempotencyKey'],'sessionKey':params['sessionKey'],'agentId':'work-commander','status':'accepted','acceptedAt':int(time.time()*1000)}))
elif method=='agent.wait':
 assert params['runId']==intent['owner_run_id']
 if v=='pending':print(json.dumps({'runId':params['runId'],'status':'timeout'}))
 else:print(json.dumps({'runId':'wrong' if v=='wrong-terminal' else params['runId'],'status':'error','startedAt':intent['started_at_ms'],'endedAt':intent['receipt_deadline_ms']+1 if v=='outside-budget' else int(time.time()*1000)}))
elif method in ['sessions.describe','chat.history','tools.invoke']:
 p=d/'closure-count';n=int(p.read_text())+1 if p.exists() else 1;p.write_text(str(n))
 if method=='sessions.describe':
  completion=(v in ['completion-active-first','completion-session-changed'] and n==1) or (v=='completion-active-tail-first' and n==7)
  active=completion or (v=='second-active' and n>=4) or (v=='tail-active' and n>=7)
  changed=(v=='session-changed' and n>=4) or (v=='completion-session-changed' and n>=2)
  row={'key':intent['parent_session_key'],'sessionId':'changed' if changed else 'fixture-session','hasActiveRun':active,'status':'running' if active else 'done','snapshotAt':int(time.time()*1000)}
  if not completion and v!='idle-census-missing':row['activeRunIds']=['late-parent'] if active else []
  print(json.dumps({'session':row}))
 elif method=='chat.history':
  pending=v=='queue-pending' or (v=='queue-pending-first' and n==2)
  print(json.dumps({'sessionKey':intent['parent_session_key'],'sessionId':'fixture-session','pendingInputs':{'total':1 if pending else 0,'items':[{'id':'late-callback'}] if pending else [],'queuedCount':1 if pending else 0}}))
 else:
  child=json.loads((d/'agent-binding.json').read_text())
  pending=v=='delivery-pending' or (v=='delivery-pending-first' and n==3)
  print(json.dumps({'ok':True,'toolName':'subagents','source':'core','output':{'details':{'status':'ok','action':'list','callerIsSubagent':False,'callerSessionKey':intent['parent_session_key'],'requesterSessionKey':intent['parent_session_key'],'active':[],'recent':[{'runId':child['child_run_id'],'sessionKey':child['child_session_key'],'execution':{'state':'finished'},'pendingDescendants':0,'deliveryStatus':'pending' if pending else 'delivered'}]}}}))
else:raise RuntimeError('unexpected RPC')
`,{mode:0o700});
 return {directory,request,parent,child,message:'parent instruction literal $(false)',authorize:async()=>true,execute:(_command,args,options)=>execInput(cli,args,options)};
}
for(const variant of ['ok','acklost'])test('real fixed CLI persists owner key before one agent RPC; '+variant+' follows exact-key wait',async t=>{
 assert.equal(typeof api.runOfficialSkillOwner,'function');const f=fixture(t,variant);
 const result=await api.runOfficialSkillOwner(f);
 assert.equal(api.officialOwnerRunTerminated(result,f.request),true);assert.equal(api.officialOwnerTerminated(result,f.request),false,'single run terminal is not whole owner scope closure');
 assert.equal(api.officialOwnerTerminated({...result},f.request),false);
 assert.equal(api.officialOwnerTerminated(result,{...f.request,nonce:'c'.repeat(48)}),false);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls.map(c=>c.method),['agent','agent.wait']);
 assert.equal(calls[0].params.idempotencyKey,calls[1].params.runId);
 assert.equal(existsSync(join(f.directory,'parent-cli-result.json')),false);
 await assert.rejects(()=>api.runOfficialSkillOwner(f));
 assert.equal(readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').length,2,'existing intent cannot relaunch');
});
for(const variant of ['wrong-ack','wrong-terminal','pending'])test('official owner '+variant+' remains unknown without another agent dispatch',async t=>{
 assert.equal(typeof api.runOfficialSkillOwner,'function');const f=fixture(t,variant);
 if(variant==='pending'){f.request.receipt_deadline_ms=Date.now()+1000;writeFileSync(join(f.directory,'activity-request.json'),JSON.stringify(f.request));}
 const result=await api.runOfficialSkillOwner(f);assert.equal(api.officialOwnerTerminated(result,f.request),false);assert.equal(result.execution_stopped,false);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.filter(c=>c.method==='agent').length,1);assert.ok(calls.filter(c=>c.method==='agent.wait').length>=1);
});
test('official terminal archives only its real branded owner reservation without minting a CLI-returned record',async t=>{
 const f=fixture(t,'acklost'),turn=await reserveWorkflowCommanderTurn(f.request,{home:f.directory});
 try{
  assert.equal(typeof turn.observedTerminal,'function');const run=await api.runOfficialSkillOwner(f);await assert.rejects(()=>turn.observedTerminal(run));
  const result=await api.closeOfficialSkillOwner({...f,result:run});assert.equal(result.session_quiescent,true);
  await assert.rejects(()=>turn.observedTerminal({...result}));
  await turn.observedTerminal(result);
  const file=ownerPending(f.request,f.directory).file;
  assert.equal(existsSync(file),false);
  const {readdirSync}=await import('node:fs');const files=readdirSync(join(f.directory,'.openclaw/leadgen-owner-turns'));
  assert.equal(files.some(name=>name.endsWith('.returned.json')),false);
  assert.equal(files.filter(name=>name.endsWith('.official_terminal.json')).length,1);
 }finally{await turn.close();}
});
test('合法completion父回合结束后在原截止内取得完整owner关闭证明，不再派发Agent',async t=>{
 const f=fixture(t,'completion-active-first'),deadline=f.request.receipt_deadline_ms,turn=await reserveWorkflowCommanderTurn(f.request,{home:f.directory});
 try{
  const run=await api.runOfficialSkillOwner(f);const result=await api.closeOfficialSkillOwner({...f,result:run});
  assert.equal(result.execution_stopped,true);assert.equal(result.session_quiescent,true);assert.equal(api.officialOwnerTerminated(result,f.request),true);
  assert.equal(f.request.receipt_deadline_ms,deadline);assert.ok(Date.now()<deadline);
  const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(call=>call.method==='agent').length,1);assert.ok(calls.filter(call=>call.method==='sessions.describe').length>=4,'active之后仍须双轮核对和最终重读');
  assert.ok(calls.filter(call=>call.method==='chat.history').length>=2);assert.ok(calls.filter(call=>call.method==='tools.invoke').length>=2);
  await turn.observedTerminal(result);assert.equal(existsSync(ownerPending(f.request,f.directory).file),false);
 }finally{await turn.close();}
});
test('空闲回执缺少原必需census字段仍保持unknown，不能默认成空数组',async t=>{
 const f=fixture(t,'idle-census-missing'),run=await api.runOfficialSkillOwner(f);
 const result=await api.closeOfficialSkillOwner({...f,result:run});
 assert.equal(result.execution_stopped,false);assert.equal(api.officialOwnerTerminated(result,f.request),false);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.filter(call=>call.method==='agent').length,1);assert.equal(calls.some(call=>call.method==='tools.invoke'),false,'缺少官方census即不能签发关闭证明');
});
for(const variant of ['queue-pending-first','delivery-pending-first','completion-active-tail-first'])test('合法中间态结束后重新完成两轮关闭核对：'+variant,async t=>{
 const f=fixture(t,variant),deadline=f.request.receipt_deadline_ms,run=await api.runOfficialSkillOwner(f);
 const result=await api.closeOfficialSkillOwner({...f,result:run});assert.equal(result.execution_stopped,true);assert.equal(f.request.receipt_deadline_ms,deadline);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.filter(call=>call.method==='agent').length,1);assert.ok(calls.filter(call=>call.method==='sessions.describe').length>=4);
 assert.ok(calls.filter(call=>call.method==='tools.invoke').length>=(variant==='completion-active-tail-first'?4:2));
});
test('首个合法active快照固定session身份，后续漂移不能重读成成功',async t=>{
 const f=fixture(t,'completion-session-changed'),run=await api.runOfficialSkillOwner(f),result=await api.closeOfficialSkillOwner({...f,result:run});
 assert.equal(result.execution_stopped,false);const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.filter(call=>call.method==='sessions.describe').length,2);assert.equal(calls.some(call=>call.method==='tools.invoke'),false);
});
for(const variant of ['caller','active-schema','delivery-schema','queue-schema'])test('不可信关闭回执立即保持unknown：'+variant,async t=>{
 const f=fixture(t),execute=f.execute;
 f.execute=async(command,args,options)=>{
  const raw=await execute(command,args,options),body=JSON.parse(raw.stdout),method=args[2];
  if(method==='chat.history'&&variant==='queue-schema')body.pendingInputs={total:1,queuedCount:1,items:[null]};
  if(method==='tools.invoke'){
   const details=body.output.details;
   if(variant==='caller')details.callerIsSubagent=true;
   if(variant==='active-schema')details.active=[{}];
   if(variant==='delivery-schema')details.recent[0].deliveryStatus='unrecognized';
  }
  return {...raw,stdout:JSON.stringify(body)};
 };
 const run=await api.runOfficialSkillOwner(f),result=await api.closeOfficialSkillOwner({...f,result:run});assert.equal(result.execution_stopped,false);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.filter(call=>call.method==='agent').length,1);assert.equal(calls.filter(call=>call.method==='chat.history').length,1);assert.ok(calls.filter(call=>call.method==='tools.invoke').length<=1);
});
for(const variant of ['delivery-pending','queue-pending','second-active','session-changed','tail-active'])test('finished owner and child cannot clear the original reservation while '+variant,async t=>{
 assert.equal(typeof api.closeOfficialSkillOwner,'function');const f=fixture(t,variant),turn=await reserveWorkflowCommanderTurn(f.request,{home:f.directory});
 try{
  const run=await api.runOfficialSkillOwner(f);assert.equal(api.officialOwnerRunTerminated(run,f.request),true);
  const result=await api.closeOfficialSkillOwner({...f,result:run});assert.equal(result.execution_stopped,false);assert.equal(api.officialOwnerTerminated(result,f.request),false);
  await assert.rejects(()=>turn.observedTerminal(result));assert.equal(existsSync(ownerPending(f.request,f.directory).file),true);
 }finally{await turn.close();}
});
test('mutable source during trusted admission cannot dispatch a mismatched frozen owner intent',async t=>{
 const f=fixture(t);f.authorize=async()=>{f.request.source_commit='c'.repeat(40);return true;};
 await assert.rejects(()=>api.runOfficialSkillOwner(f));assert.equal(existsSync(join(f.directory,'calls.jsonl')),false);assert.equal(existsSync(join(f.directory,'owner-rpc-intent.json')),false);
});
test('a terminal timestamp beyond the unchanged receipt deadline cannot mint an owner stop proof',async t=>{
 const f=fixture(t,'outside-budget');f.request.receipt_deadline_ms=Date.now()+900;writeFileSync(join(f.directory,'activity-request.json'),JSON.stringify(f.request));
 const result=await api.runOfficialSkillOwner(f);assert.equal(result.execution_stopped,false);assert.equal(api.officialOwnerTerminated(result,f.request),false);
});
test('mutating a nested official terminal cannot reuse its in-process stop capability',async t=>{
 const f=fixture(t),run=await api.runOfficialSkillOwner(f);assert.equal(api.officialOwnerRunTerminated(run,f.request),true);
 run.terminal.runId='foreign-run';assert.equal(api.officialOwnerRunTerminated(run,f.request),false);
 await assert.rejects(()=>api.closeOfficialSkillOwner({...f,result:run}));
});

for(const interruption of ['nonzero','throw'])test('原截止内owner只读wait'+interruption+'中断后仍读回同run终态并严格关闭',async t=>{
 const f=fixture(t),execute=f.execute,original=structuredClone(f.request),requestBytes=readFileSync(join(f.directory,'activity-request.json'),'utf8');
 const turn=await reserveWorkflowCommanderTurn(f.request,{home:f.directory});let waits=0;
 f.execute=async(command,args,options)=>{
  const raw=await execute(command,args,options);
  if(args[2]==='agent.wait'&&++waits===1){
   if(interruption==='nonzero')return {...raw,code:2,stdout:'',stderr:'fixture read transport interrupted'};
   throw Object.assign(Error('fixture read transport interrupted'),{code:'EXECUTION_DEADLINE'});
  }
  return raw;
 };
 try{
  const run=await api.runOfficialSkillOwner(f);
  assert.equal(api.officialOwnerRunTerminated(run,f.request),true,'只读传输中断不能在原截止前丢弃下一次合法同run终态');
  assert.equal(api.officialOwnerTerminated(run,f.request),false,'读到单run终态仍须独立关闭owner域');
  assert.equal(api.officialOwnerRunTerminated({...run},f.request),false,'恢复读回仍不能用复制对象伪造品牌');
  const result=await api.closeOfficialSkillOwner({...f,result:run});
  assert.equal(result.execution_stopped,true);assert.equal(result.session_quiescent,true);assert.equal(api.officialOwnerTerminated(result,f.request),true);
  const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse),intent=JSON.parse(readFileSync(join(f.directory,'owner-rpc-intent.json'),'utf8'));
  assert.equal(calls.filter(call=>call.method==='agent').length,1,'恢复只读不能重新派发写agent');
  assert.equal(calls.filter(call=>call.method==='agent.wait').length,2);
  assert.ok(calls.filter(call=>call.method==='agent.wait').every(call=>call.params.runId===intent.owner_run_id));
  assert.equal(calls[0].params.idempotencyKey,intent.owner_run_id);
  assert.equal(intent.source_commit,original.source_commit);assert.equal(intent.nonce,original.nonce);assert.equal(intent.scope_sha256,run.scope_sha256);
  const diagnostics=readdirSync(f.directory).filter(name=>name.endsWith('.json')).map(name=>({name,text:readFileSync(join(f.directory,name),'utf8')}));
  const failure=diagnostics.find(({text})=>text.includes(intent.owner_run_id)&&(interruption==='nonzero'?/"code"\s*:\s*2(?:\s*[,}])/.test(text):text.includes('EXECUTION_DEADLINE')));
  assert.ok(failure,'失败读回必须留下关联原owner的非零退出码或安全异常码，不锁侧车文件名');
  assert.ok(Buffer.byteLength(failure.text)<=65536,'诊断原件必须有限，不能无限收录传输输出');
  assert.deepEqual(calls.filter(call=>!['agent','agent.wait'].includes(call.method)).map(call=>call.method),['sessions.describe','chat.history','tools.invoke','sessions.describe','chat.history','tools.invoke','sessions.describe'],'恢复后原严格双轮及最终重读完整保留');
  assert.deepEqual(f.request,original);assert.equal(readFileSync(join(f.directory,'activity-request.json'),'utf8'),requestBytes);assert.ok(Date.now()<original.receipt_deadline_ms);
  await turn.observedTerminal(result);assert.equal(existsSync(ownerPending(f.request,f.directory).file),false);
 }finally{await turn.close();}
});

for(const change of ['request-memory','request-file','generation-revoked','deadline'])test('只读wait中断后不得越过原scope守卫 '+change,async t=>{
 const f=fixture(t),execute=f.execute;let waits=0;
 if(change==='deadline'){f.request.receipt_deadline_ms=Date.now()+2000;writeFileSync(join(f.directory,'activity-request.json'),JSON.stringify(f.request));}
 const originalDeadline=f.request.receipt_deadline_ms;
 f.execute=async(command,args,options)=>{
  const raw=await execute(command,args,options);
  if(args[2]==='agent.wait'){
   waits++;
   if(change==='request-memory')f.request.nonce='c'.repeat(48);
   if(change==='request-file')writeFileSync(join(f.directory,'activity-request.json'),JSON.stringify({...f.request,source_commit:'c'.repeat(40)}));
   if(change==='generation-revoked')writeFileSync(join(f.directory,'generation-revoked.json'),'{}');
   if(change==='deadline')await new Promise(resolve=>setTimeout(resolve,Math.max(1,originalDeadline-Date.now()+10)));
   return {...raw,code:2,stdout:'',stderr:'fixture read transport interrupted'};
  }
  return raw;
 };
 const result=await api.runOfficialSkillOwner(f);
 assert.equal(result.execution_stopped,false);assert.equal(api.officialOwnerRunTerminated(result,f.request),false);assert.equal(api.officialOwnerTerminated(result,f.request),false);
 assert.equal(waits,1);assert.equal(f.request.receipt_deadline_ms,originalDeadline);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls.map(call=>call.method),['agent','agent.wait']);
 await assert.rejects(()=>api.closeOfficialSkillOwner({...f,result}));
});
