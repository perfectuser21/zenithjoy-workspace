import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSkillAgent} from '../leadgen-skill-agent.mjs';

test('isolated transport fixture: actual parent CLI args, official child receipt required, never plain parent text success',async()=>{
 const home=mkdtempSync(join(tmpdir(),'skill-agent-'));const seen=[];
 try {
  const r=await runSkillAgent({protocol:'leadgen-activity-v1',run_id:'fixture__a1',task_id:null,binding_id:'fixture-binding',activity_key:'scoring',nonce:'a'.repeat(48),deadline_ms:Date.now()+20000,source_commit:'b'.repeat(40),broker_host:'mmv',broker_request_path:'/private/tmp/fixture/broker-request.json',broker_tool_path:'/private/tmp/fixture/activity-skill-tool.mjs',mode:'repair',method:{name:'fixture',version:'0.2.0',text:'fixture method only'}},{home,verifyWorkspace:()=>true,execute:async(command,args)=>{
   seen.push({command,args});
   if(command==='openclaw'){
    return {code:0,stdout:'parent says success',stderr:''};
   }
   return {code:1,stdout:'',stderr:'fixture no official child receipt'};
  }});
  const {args}=seen.find(x=>x.command==='openclaw');
    assert.ok(args.includes('--session-key'));assert.ok(args.includes('--message-file'));assert.equal(args.includes('--deliver'),false);
  const message=readFileSync(args[args.indexOf('--message-file')+1],'utf8');
  assert.match(message,/gateway_exec/,'actual Codex projection uses gateway_exec, unlike native core exec catalog');
  assert.match(message,/不设置taskName/,'omit optional taskName rather than alter business run identity');
  const identityLine=message.split('\n').find(line=>line.startsWith('child身份合同：'));
  assert.ok(identityLine,'child needs its own available caller identity tool, not inherited parent session_status');
  const policy=JSON.parse(identityLine.slice('child身份合同：'.length));
  assert.deepEqual(policy.tool,{name:'subagents',parameters:{action:'list'}});
  assert.deepEqual(policy.caller,{callerIsSubagent:true,callerSessionKey:{file:join(args[args.indexOf('--message-file')+1].replace(/\/parent-message\.txt$/,''),'agent-binding.json'),field:'child_session_key',comparison:'exact'}});
  assert.deepEqual(policy.binding_checks,['run_id','task_id','parent_session_key','nonce']);
  assert.equal(policy.on_missing_or_mismatch,'blocked');
  assert.deepEqual(policy.forbidden_identity_sources,['session_status','list.active','model_self_report','connector_alias']);

  assert.equal(r.execution_stopped,false);assert.equal(r.status,'unknown');assert.equal(seen.filter(x=>x.command==='openclaw').length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('missing or stale loaded Commander workspace cannot launch parent CLI',async()=>{
 const home=mkdtempSync(join(tmpdir(),'skill-workspace-'));let started=0;
 try{await assert.rejects(()=>runSkillAgent({protocol:'leadgen-activity-v1',run_id:'fixture__a1',binding_id:'fixture-binding',activity_key:'scoring',nonce:'c'.repeat(48),deadline_ms:Date.now()+20000,source_commit:'b'.repeat(40),broker_host:'mmv',broker_request_path:'/private/tmp/fixture/broker-request.json',broker_tool_path:'/private/tmp/fixture/activity-skill-tool.mjs',mode:'repair',method:{name:'fixture',version:'0.2.0',text:'fixture'}},{home,execute:async()=>{started++;return {code:0,stdout:'',stderr:''};}}));assert.equal(started,0);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('parent must claim one durable spawn right; second claim cannot replace child attribution',async()=>{
 const {claimSkillSpawn,skillRunKey}=await import('../leadgen-skill-agent.mjs');
 const home=mkdtempSync(join(tmpdir(),'skill-claim-spawn-'));const q={protocol:'leadgen-activity-v1',run_id:'fixture__a1',activity_key:'scoring',nonce:'d'.repeat(48),source_commit:'a'.repeat(40),deadline_ms:Date.now()+20000,broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.1',text:'fixture'}};
 try{const dir=join(home,'.openclaw','leadgen-activity-runs',skillRunKey(q));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'activity-request.json'),JSON.stringify(q));writeFileSync(join(dir,'agent-request.json'),JSON.stringify({run_id:q.run_id,task_id:null,parent_session_key:'agent:work-commander:fixture',nonce:q.nonce,expires_at:q.deadline_ms/1000}));
 assert.equal(claimSkillSpawn(dir,{home,verifyWorkspace:()=>true}).nonce,q.nonce);
 assert.throws(()=>claimSkillSpawn(dir,{home,verifyWorkspace:()=>true}));
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('single-slot tool relay uses managed strict M4 alias and cannot accept arbitrary commands',async()=>{
 const {relayActivityTool,skillRunKey}=await import('../leadgen-skill-agent.mjs');
 const home=mkdtempSync(join(tmpdir(),'skill-relay-'));const q={protocol:'leadgen-activity-v1',run_id:'fixture__a1',activity_key:'qualification',nonce:'e'.repeat(48),source_commit:'a'.repeat(40),deadline_ms:Date.now()+20000,broker_host:'xian-m4',broker_request_path:'/Users/fixture/run/broker-request.json',broker_tool_path:'/Users/fixture/run/activity-skill-tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.1',text:'fixture'}};
 try{const dir=join(home,'.openclaw','leadgen-activity-runs',skillRunKey(q));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'activity-request.json'),JSON.stringify(q));let called=0;
 const deps={home,authorize:async()=>true,execute:async(cmd,args)=>{called++;assert.equal(cmd,'ssh');assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.equal(args.includes('-J'),false);assert.equal(args.some(x=>x.startsWith('HostName=')),false);assert.ok(args.includes('xian-m4'));return {code:0,stdout:'{"ok":true,"result":{"fixture":true}}\n',stderr:''};}};
 assert.equal((await relayActivityTool(dir,'inspect',{},deps)).result.fixture,true);await assert.rejects(()=>relayActivityTool(dir,'shell',{},deps));assert.equal(called,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('real public inspect CLI validates without waiting for an unrelated open stdin channel',async()=>{
 const {spawn}=await import('node:child_process');const child=spawn(process.execPath,[new URL('../leadgen-skill-agent.mjs',import.meta.url).pathname,'tool','/nonexistent/isolated-fixture-handoff','inspect'],{stdio:['pipe','pipe','pipe']});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},1500);
 try{const code=await new Promise(resolve=>child.once('close',resolve));assert.equal(timedOut,false);assert.equal(code,1);}finally{clearTimeout(timer);child.stdin.destroy();child.kill('SIGKILL');}
});

test('official spawn raw full model reference is accepted without rewriting; exact provider/model negatives remain blocked (isolated lifecycle fixture)',async()=>{
 const {dirname}=await import('node:path');
 for(const [provider,model,accepted] of [['openai','openai/gpt-6.1-sol',true],['openai','gpt-6.1-sol',true],['anthropic','openai/gpt-6.1-sol',false],['openai','openrouter/gpt-6.1-sol',false],['openai','openai/openai/gpt-6.1-sol',false],['openai','openai/gpt-6.1-sol ',false],['openai','openai/gpt-6.1-sol-fallback',false]]){
  const home=mkdtempSync(join(tmpdir(),'spawn-model-raw-fixture-'));let dir,raw;
  try{
   const q={protocol:'leadgen-activity-v1',run_id:'fixture__a1',task_id:null,binding_id:'fixture-binding',activity_key:'scoring',nonce:'f'.repeat(48),deadline_ms:Date.now()+20000,source_commit:'a'.repeat(40),broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.1',text:'isolated method'}};
   const r=await runSkillAgent(q,{home,verifyWorkspace:()=>true,execute:async(command,args)=>{
    if(command==='openclaw'){
     dir=dirname(args[args.indexOf('--message-file')+1]);const request=JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'));
     const child='12345678-0000-4000-8000-000000000001',session='agent:skill-factory:subagent:fixture';
     writeFileSync(join(dir,'spawn-claimed.json'),JSON.stringify({...request,source_commit:q.source_commit}));
     writeFileSync(join(dir,'agent-binding.json'),JSON.stringify({...request,child_run_id:child,child_session_key:session}));
     raw=JSON.stringify({status:'accepted',runId:child,childSessionKey:session,resolvedProvider:provider,resolvedModel:model});writeFileSync(join(dir,'spawn-receipt.json'),raw);
     // Official wait effective.model is bare ID, unlike spawn resolvedModel.
     writeFileSync(join(dir,'agent-terminal.json'),JSON.stringify({runId:child,status:'ok',endedAt:1,terminalReceipt:{runId:child,effective:{provider:'openai',model:'gpt-6.1-sol'}}}));
     return {code:0,stdout:'isolated parent transport',stderr:''};
    }
    return {code:args.includes('await')?0:1,stdout:'',stderr:''};
   }});
   assert.equal(r.status,accepted?'ok':'unknown',provider+' '+model);assert.equal(r.execution_stopped,accepted);
   assert.equal(readFileSync(join(dir,'spawn-receipt.json'),'utf8'),raw,'original official receipt remains unchanged');
  }finally{rmSync(home,{recursive:true,force:true});}
 }
});


test('isolated child invocation fixture selects only exact gateway surfaces with literal env and explicit canonical host',async()=>{
 const agent=await import('../leadgen-skill-agent.mjs');
 assert.equal(typeof agent.activityToolInvocation,'function','single-slot child needs an executable schema-correct MMV command');
 const body={command:'tree',args:['literal $(touch forbidden) `false`\n中文']};
 for(const surface of ['gateway_exec','exec_gateway']){
  const spec=agent.activityToolInvocation('/private/tmp/fixture', 'phone',surface,body);
  assert.equal(spec.tool,surface==='gateway_exec'?'gateway_exec':'exec');
  assert.deepEqual(Object.keys(spec.parameters.env).sort(),['LEADGEN_ACTIVITY_TOOL_JSON','LEADGEN_GATEWAY_SURFACE']);
  assert.deepEqual(JSON.parse(spec.parameters.env.LEADGEN_ACTIVITY_TOOL_JSON),body);
  assert.equal(spec.parameters.env.LEADGEN_GATEWAY_SURFACE,surface);
  assert.equal(spec.parameters.command.includes(body.args[0]),false,'business JSON never enters shell command');
  assert.equal(spec.parameters.stdin,undefined,'official gateway tools have no stdin field');
  assert.equal(spec.parameters.host,surface==='exec_gateway'?'gateway':undefined);
  assert.equal(spec.parameters.ask,undefined);assert.equal(spec.parameters.security,undefined);
 }
 for(const surface of ['exec','auto','node_exec','gateway_exec_like','codex_apps.notion.get-session-status'])assert.throws(()=>agent.activityToolInvocation('/private/tmp/fixture','phone',surface,{}));
});

test('actual generated child command fixture guards each host and pipes literal JSON to the original CLI',async()=>{
 const agent=await import('../leadgen-skill-agent.mjs');
 assert.equal(typeof agent.activityToolInvocation,'function');
 const {spawnSync}=await import('node:child_process');const {chmodSync,existsSync}=await import('node:fs');
 const home=mkdtempSync(join(tmpdir(),'child-command-fixture-'));const hostname=join(home,'hostname'),relay=join(home,'relay.mjs'),marker=join(home,'called');
 try{
  writeFileSync(hostname,'#!/bin/sh\n[ "$FIXTURE_HOST" != fail ] || exit 9\nprintf "%s\\n" "$FIXTURE_HOST"\n');chmodSync(hostname,0o700);
  writeFileSync(relay,"import{writeFileSync,readFileSync}from'node:fs';writeFileSync(process.env.FIXTURE_MARKER,'called');process.stdout.write(readFileSync(0));");
  for(const host of ['r10-7','aad17-2','r10-70','','fail']){
   rmSync(marker,{force:true});const body={command:'tree',args:['literal $(false) `false`\n中文']};
   const spec=agent.activityToolInvocation('/private/tmp/fixture','phone','exec_gateway',body);
   // Only the two OS executable dependencies are replaced with isolated fixtures;
   // run the real generated guard/pipe script, not a mirror implementation.
   const command=spec.parameters.command.replace(JSON.stringify('/bin/hostname'),JSON.stringify(hostname)).replace(JSON.stringify(new URL('../leadgen-skill-agent.mjs',import.meta.url).pathname),JSON.stringify(relay));
   assert.notEqual(command,spec.parameters.command);
   const r=spawnSync('/bin/sh',['-c',command],{env:{...process.env,...spec.parameters.env,FIXTURE_HOST:host,FIXTURE_MARKER:marker},encoding:'utf8'});
   if(['r10-7','aad17-2'].includes(host)){assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),body);assert.equal(existsSync(marker),true);}
   else{assert.notEqual(r.status,0);assert.equal(existsSync(marker),false,'wrong/empty/failed hostname never launches relay');}
  }
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('authorized relay durably pins its gateway surface before transport; unknown cannot switch route (isolated fixture)',async()=>{
 const {relayActivityTool,skillRunKey}=await import('../leadgen-skill-agent.mjs');
 const home=mkdtempSync(join(tmpdir(),'skill-route-fixture-'));const q={protocol:'leadgen-activity-v1',run_id:'fixture__a1',activity_key:'qualification',nonce:'e'.repeat(48),source_commit:'a'.repeat(40),deadline_ms:Date.now()+20000,broker_host:'xian-m4',broker_request_path:'/Users/fixture/run/broker-request.json',broker_tool_path:'/Users/fixture/run/activity-skill-tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.1',text:'fixture'}};
 try{
  const dir=join(home,'.openclaw','leadgen-activity-runs',skillRunKey(q));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'activity-request.json'),JSON.stringify(q));let calls=0;
  const deps={home,authorize:async()=>true,surface:'exec_gateway',requireSurface:true,execute:async()=>{calls++;throw Error('EXECUTION_OUTPUT_LIMIT');}};
  await assert.rejects(()=>relayActivityTool(dir,'inspect',{},deps),/EXECUTION_OUTPUT_LIMIT/);
  await assert.rejects(()=>relayActivityTool(dir,'inspect',{}, {...deps,surface:'gateway_exec'}),/SURFACE/);assert.equal(calls,1);
  await assert.rejects(()=>relayActivityTool(dir,'inspect',{}, {...deps,surface:undefined}),/SURFACE/);assert.equal(calls,1);
  assert.equal(JSON.parse(readFileSync(join(dir,'gateway-surface.json'),'utf8')).surface,'exec_gateway');
 }finally{rmSync(home,{recursive:true,force:true});}
});
