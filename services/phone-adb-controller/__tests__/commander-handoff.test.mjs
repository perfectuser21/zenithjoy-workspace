import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const HELPER=join(dirname(fileURLToPath(import.meta.url)),'../commander/wf-agent-handoff.py');
const parent='agent:work-commander:test-parent';
function call(dir,cmd,data,...args){return spawnSync('python3',[HELPER,cmd,dir,...args],{input:data==null?undefined:JSON.stringify(data),encoding:'utf8'});}
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'wf-handoff-'));
 writeFileSync(join(dir,'state.env'),'RUN_ID=wfd-test\nTASK_ID=1234abcd-0000-4000-8000-000000000001\nAGENT=skill-factory\n');
 const p=call(dir,'init',null,parent,'60');assert.equal(p.status,0,p.stderr);
 const request=JSON.parse(readFileSync(join(dir,'agent-request.json')));
 const identity=Object.fromEntries(['run_id','task_id','parent_session_key','nonce'].map(k=>[k,request[k]]));
 const receipt={...identity,child_session_key:'agent:skill-factory:subagent:1234',child_run_id:'1234abcd-0000-4000-8000-000000000002'};
 return {dir,request,identity,receipt};
}
test('正式交接：绑定父子run后接收原始完成结果，重复同回执幂等',()=>{
 const {dir,receipt}=setup();
 assert.equal(call(dir,'bind',receipt).status,0);
 assert.equal(call(dir,'bind',receipt).status,0);
 const result={...receipt,status:'ok',result:'WF_DELIVERY {"claimed_result":"success"}'};
 assert.equal(call(dir,'complete',result).status,0);
 assert.equal(call(dir,'complete',result).status,0);
 assert.equal(JSON.parse(readFileSync(join(dir,'agent-delivery.json'))).claimed_result,'success');
 assert.equal(readFileSync(join(dir,'agent.log'),'utf8'),result.result);
});
test('拒绝跨run、父会话、子会话、nonce错配以及先完成后绑定',()=>{
 const {dir,receipt}=setup();
 assert.notEqual(call(dir,'complete',{...receipt,status:'ok',result:'WF_DELIVERY {}'}).status,0);
 assert.equal(call(dir,'bind',receipt).status,0);
 for(const key of ['run_id','task_id','parent_session_key','nonce','child_session_key','child_run_id']){
  assert.notEqual(call(dir,'complete',{...receipt,[key]:'wrong',status:'ok',result:'WF_DELIVERY {}'}).status,0,key);
 }
 assert.equal(existsSync(join(dir,'agent-delivery.json')),false);
});
test('过期或已关闭的run拒绝晚到交付，不把失败伪装成功',()=>{
 const {dir,receipt,request}=setup();
 assert.equal(call(dir,'bind',receipt).status,0);
 writeFileSync(join(dir,'agent-request.json'),JSON.stringify({...request,expires_at:1}));
 assert.notEqual(call(dir,'complete',{...receipt,status:'ok',result:'WF_DELIVERY {"claimed_result":"success"}'}).status,0);
 assert.equal(existsSync(join(dir,'agent-delivery.json')),false);
});

test('关闭后拒绝绑定/交付；官方失败不能采信模型自报success',()=>{
 const {dir,receipt}=setup();
 assert.equal(call(dir,'stop',null).status,0);
 assert.notEqual(call(dir,'bind',receipt).status,0);
 const next=setup();
 assert.equal(call(next.dir,'bind',next.receipt).status,0);
 assert.equal(call(next.dir,'complete',{...next.receipt,status:'error',result:'WF_DELIVERY {"claimed_result":"success"}'}).status,0);
 assert.equal(JSON.parse(readFileSync(join(next.dir,'agent-delivery.json'))).claimed_result,'failed');
});

test('官方await不yield早退：等绑定child终态，原始terminalReply直接交付',()=>{
 const {dir,receipt}=setup();assert.equal(call(dir,'bind',receipt).status,0);
 const cli=join(dir,'openclaw');
 writeFileSync(cli,'#!/usr/bin/env python3\nimport sys,json,time\nassert sys.argv[1:4]==["gateway","call","agent.wait"]\np=json.loads(sys.argv[sys.argv.index("--params")+1])\ntime.sleep(.15)\nprint(json.dumps({"runId":p["runId"],"status":"ok","endedAt":1,"terminalReceipt":{"runId":p["runId"],"effective":{"provider":"openai","model":"gpt-6.1-sol"}},"terminalReply":{"text":"WF_DELIVERY {\\"claimed_result\\":\\"blocked\\",\\"fail_reason\\":\\"probe\\"}"}}))\n');chmodSync(cli,0o755);
 const r=spawnSync('python3',[HELPER,'await',dir],{env:{...process.env,OPENCLAW:cli},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(readFileSync(join(dir,'agent-delivery.json'))).fail_reason,'probe');
 const terminal=JSON.parse(readFileSync(join(dir,'agent-terminal.json')));
 assert.equal(terminal.runId,receipt.child_run_id);
});


test('官方await拒绝串run、错误模型和缺失终态；错误终态不能转成业务成功',()=>{
 for(const variant of ['cross-run','wrong-model','missing-terminal','error']){
  const {dir,receipt}=setup();assert.equal(call(dir,'bind',receipt).status,0);
  const cli=join(dir,'openclaw');
  const terminal={runId:receipt.child_run_id,status:'ok',endedAt:1,
   terminalReceipt:{runId:receipt.child_run_id,effective:{provider:'openai',model:'gpt-6.1-sol'}},
   terminalReply:{text:'WF_DELIVERY {"claimed_result":"success"}'}};
  if(variant==='cross-run')terminal.runId='another-run';
  if(variant==='wrong-model')terminal.terminalReceipt.effective.provider='anthropic';
  if(variant==='missing-terminal')delete terminal.endedAt;
  if(variant==='error')terminal.status='error';
  writeFileSync(cli,'#!/usr/bin/env python3\nprint('+JSON.stringify(JSON.stringify(terminal))+')\n');chmodSync(cli,0o755);
  const r=spawnSync('python3',[HELPER,'await',dir],{env:{...process.env,OPENCLAW:cli},encoding:'utf8'});
  if(variant==='error'){
   assert.equal(r.status,0,r.stderr);
   assert.equal(JSON.parse(readFileSync(join(dir,'agent-delivery.json'))).claimed_result,'failed');
  }else{
   assert.notEqual(r.status,0,variant);
   assert.equal(existsSync(join(dir,'agent-completion.json')),false,variant);
  }
 }
});
