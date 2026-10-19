import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClawCommander} from '../activity-commander.mjs';
import {runSkillAgent} from '../leadgen-skill-agent.mjs';
import {handleRpc} from '../leadgen-rpc.mjs';
import {runWorkflow} from '../leadgen-workflow.mjs';

test('同Workflow各节点判断与Skill接手使用同一个work-commander负责人',async()=>{
 const calls=[],home=mkdtempSync(join(tmpdir(),'single-commander-'));
 const scope={run_id:'same-workflow__a1',source_commit:'a'.repeat(40),binding_id:'binding-one'};
 const commander=openClawCommander({execute:async(command,args)=>{
  calls.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:JSON.stringify({action:'continue',reason:'监督原Workflow'})}]})};
 }});
 try{
  await commander({...scope,activity:'preflight',phase:'before'});
  await commander({...scope,activity:'qualification',phase:'after'});
  await runSkillAgent({...scope,protocol:'leadgen-activity-v1',activity_key:'qualification',nonce:'b'.repeat(48),deadline_ms:Date.now()+20000,
   broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.0',text:'isolated fixture'}},
   {home,verifyWorkspace:()=>true,execute:async(_command,args)=>{calls.push(args);return {code:1,stdout:'',stderr:'isolated transport has no child'};}});
  assert.equal(calls.length,3);
  for(const args of calls){assert.equal(args[args.indexOf('--agent')+1],'work-commander');assert.ok(args.includes('--session-key'));}
  const owners=calls.map(args=>args[args.indexOf('--session-key')+1]);
  assert.equal(new Set(owners).size,1,'Activity与Skill不能另建负责人');
  const other=[];await openClawCommander({execute:async(_cmd,args)=>{other.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:'{"action":"continue","reason":"另任务"}'}]})};}})({...scope,run_id:'another-workflow__a1',activity:'preflight'});
  assert.notEqual(other[0][other[0].indexOf('--session-key')+1],owners[0]);
  await openClawCommander({execute:async(_cmd,args)=>{other.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:'{"action":"continue","reason":"另一绑定"}'}]})};}})({...scope,binding_id:'binding-two',activity:'preflight'});
  assert.notEqual(other[1][other[1].indexOf('--session-key')+1],owners[0],'同名run不同冻结绑定不能共享上下文');
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('负责人CLI超时结果未知时不再次咨询、不派Skill、不清理原资源',async()=>{
 let consulted=0,cleaned=0,recovered=0,quarantined=0;
 const commander=openClawCommander({execute:async()=>{consulted++;const error=Error('timeout');error.code='ETIMEDOUT';throw error;}});
 const result=await runWorkflow({context:{run_id:'owner-timeout__a1',binding_id:'timeout-binding',source_commit:'a'.repeat(40)},activities:[{key:'qualification'},{key:'cleanup'}],
  handlers:{qualification:async()=>({}),cleanup:async()=>{cleaned++;return {};}},commander,record:async()=>{},
  recover:async()=>{recovered++;return {status:'completed',execution_stopped:true};},quarantine:async()=>{quarantined++;return {verified:true};}});
 assert.equal(consulted,1);assert.equal(cleaned,0);assert.equal(recovered,0);assert.equal(quarantined,1);assert.equal(result.status,'failed');
});

test('正式获客RPC调用同一work-commander且来源不匹配时零派发',async()=>{
 const calls=[];const receipt={run_id:'rpc-workflow__a1',binding_id:'rpc-binding',source_commit:'a'.repeat(40),activity:'preflight',phase:'before'};
 const deps={verify:()=>{},commanderExecute:async(_cmd,args)=>{calls.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:'{"action":"continue","reason":"原任务"}'}]})};}};
 const ok=await handleRpc({source:{commit:receipt.source_commit},kind:'commander',receipt},deps);
 assert.equal(ok.decision.action,'continue');assert.equal(calls.length,1);
 await assert.rejects(()=>handleRpc({source:{commit:'b'.repeat(40)},kind:'commander',receipt},deps),/COMMANDER_SOURCE_MISMATCH/);
 assert.equal(calls.length,1);
});
