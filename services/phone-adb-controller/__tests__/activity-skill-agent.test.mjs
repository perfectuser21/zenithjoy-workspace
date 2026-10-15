import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSkillAgent} from '../leadgen-skill-agent.mjs';

test('isolated transport fixture: actual parent CLI args, official child receipt required, never plain parent text success',async()=>{
 const home=mkdtempSync(join(tmpdir(),'skill-agent-'));const seen=[];
 try {
  const r=await runSkillAgent({protocol:'leadgen-activity-v1',run_id:'fixture__a1',task_id:null,binding_id:'fixture-binding',activity_key:'scoring',nonce:'a'.repeat(48),deadline_ms:Date.now()+20000,source_commit:'b'.repeat(40),broker_host:'mmv',broker_request_path:'/private/tmp/fixture/broker-request.json',broker_tool_path:'/private/tmp/fixture/activity-skill-tool.mjs',mode:'repair',method:{name:'fixture',version:'0.2.0',text:'fixture method only'}},{home,execute:async(command,args)=>{
   seen.push({command,args});
   if(command==='openclaw'){
    assert.ok(args.includes('--session-key'));assert.ok(args.includes('--message-file'));assert.equal(args.includes('--deliver'),false);
    return {code:0,stdout:'parent says success',stderr:''};
   }
   return {code:1,stdout:'',stderr:'fixture no official child receipt'};
  }});
  assert.equal(r.execution_stopped,false);assert.equal(r.status,'unknown');assert.equal(seen.filter(x=>x.command==='openclaw').length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('missing or stale loaded Commander workspace cannot launch parent CLI',async()=>{
 const home=mkdtempSync(join(tmpdir(),'skill-workspace-'));let started=0;
 try{await assert.rejects(()=>runSkillAgent({protocol:'leadgen-activity-v1',run_id:'fixture__a1',binding_id:'fixture-binding',activity_key:'scoring',nonce:'c'.repeat(48),deadline_ms:Date.now()+20000,source_commit:'b'.repeat(40),broker_host:'mmv',broker_request_path:'/private/tmp/fixture/broker-request.json',broker_tool_path:'/private/tmp/fixture/activity-skill-tool.mjs',mode:'repair',method:{name:'fixture',version:'0.2.0',text:'fixture'}},{home,execute:async()=>{started++;return {code:0,stdout:'',stderr:''};}}));assert.equal(started,0);
 }finally{rmSync(home,{recursive:true,force:true});}
});
