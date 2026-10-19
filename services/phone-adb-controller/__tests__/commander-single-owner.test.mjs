import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClawCommander} from '../activity-commander.mjs';
import {runSkillAgent} from '../leadgen-skill-agent.mjs';

test('同Workflow各节点判断与Skill接手使用同一个work-commander负责人',async()=>{
 const calls=[],home=mkdtempSync(join(tmpdir(),'single-commander-'));
 const scope={run_id:'same-workflow__a1',source_commit:'a'.repeat(40)};
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
 }finally{rmSync(home,{recursive:true,force:true});}
});
