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

function durableFixture(variant='error'){
 const f=setup();assert.equal(call(f.dir,'bind',f.receipt).status,0);
 const now=Date.now();writeFileSync(join(f.dir,'agent-request.json'),JSON.stringify({...f.request,protocol:'commander-v2',expires_at:now/1000+40}));
 writeFileSync(join(f.dir,'envelope.json'),JSON.stringify({cleanup_deadline_at:new Date(now+60000).toISOString()}));
 const run={runId:f.receipt.child_run_id,sessionKey:f.receipt.child_session_key,status:'terminal',outcome:{status:variant==='timeout'?'timeout':'error',error:'original failure'},startedAt:now-2000,endedAt:now-1000};
 const details={status:'ok',action:'wait',reason:'completed',runs:[run],completed:[run.runId],attention:[]};
 const response={ok:true,toolName:'subagents',source:'core',output:{details}};
 if(variant==='cross-run')run.runId='00000000-0000-4000-8000-000000000099';
 if(variant==='cross-session')run.sessionKey='agent:skill-factory:subagent:other-turn';
 if(['ok','unknown','aborted'].includes(variant))run.outcome.status=variant;
 if(variant==='missing-end')delete run.endedAt;
 if(variant==='future-end')run.endedAt=now+120000;
 if(variant==='duplicate')details.runs.push({...run});
 if(variant==='not-completed')details.completed=[];
 if(variant==='attention')details.attention=[run.runId];
 if(variant==='bad-wrapper')response.ok=false;
 if(variant==='pending'){details.reason='timeout';details.completed=[];run.status='running';delete run.outcome;delete run.endedAt;}
 const cli=join(f.dir,'openclaw');
 writeFileSync(cli,`#!/usr/bin/env python3
import json,sys,pathlib
root=pathlib.Path(${JSON.stringify(f.dir)})
method=sys.argv[3];params=json.loads(sys.argv[sys.argv.index('--params')+1])
with (root/'rpc-calls.jsonl').open('a') as out:out.write(json.dumps({'method':method,'params':params})+'\\n')
if method=='agent.wait':print(json.dumps({'runId':${JSON.stringify(run.runId===f.receipt.child_run_id?run.runId:f.receipt.child_run_id)},'status':'timeout'}))
elif method=='sessions.abort':print(json.dumps({'aborted':False,'reason':'no-active-run'}))
elif method=='tools.invoke':
 assert params=={'name':'subagents','sessionKey':${JSON.stringify(parent)},'args':{'action':'wait','runIds':[${JSON.stringify(f.receipt.child_run_id)}],'timeoutSeconds':0}}
 print(${JSON.stringify(JSON.stringify(response))})
else:raise AssertionError('unexpected lifecycle method')
`,{mode:0o755});
 f.env={...process.env,OPENCLAW:cli};f.response=response;return f;
}
function awaitOnce(f){return spawnSync('python3',['-c',`import importlib.util,pathlib
s=importlib.util.spec_from_file_location('handoff',${JSON.stringify(HELPER)});h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
h.await_result(pathlib.Path(${JSON.stringify(f.dir)}),once=True)
`],{env:f.env,encoding:'utf8'});}
test('网关wait缓存丢失后官方持久失败精确收口，原wait及tools回执永久保留',()=>{
 for(const variant of ['error','timeout','aborted']){
  const f=durableFixture(variant),r=awaitOnce(f);assert.equal(r.status,0,r.stderr);
  const completion=JSON.parse(readFileSync(join(f.dir,'agent-completion.json')));assert.equal(completion.status,variant);assert.equal(completion.result,'');
  const terminal=JSON.parse(readFileSync(join(f.dir,'agent-terminal.json')));assert.equal(terminal.runId,f.receipt.child_run_id);assert.equal(terminal.terminalSource,'subagents.wait');
  assert.deepEqual(JSON.parse(readFileSync(join(f.dir,'child-durable-readback.json'))).response,f.response);
  assert.equal(JSON.parse(readFileSync(join(f.dir,'child-await-readback.json'))).status,'timeout');
  assert.notEqual(JSON.parse(readFileSync(join(f.dir,'agent-delivery.json'))).claimed_result,'success');
 }
});
test('闭nonce的stop在无活跃run且wait缓存丢失时只核实原失败，不重新开放交付',()=>{
 const f=durableFixture();const before=readFileSync(join(f.dir,'agent-request.json'),'utf8');
 const r=spawnSync('python3',[HELPER,'stop',f.dir],{env:f.env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 assert.equal(existsSync(join(f.dir,'handoff-closed.json')),true);assert.equal(existsSync(join(f.dir,'agent-completion.json')),false);
 assert.equal(JSON.parse(readFileSync(join(f.dir,'child-stop-readback.json'))).status,'error');assert.equal(readFileSync(join(f.dir,'agent-request.json'),'utf8'),before);
 assert.notEqual(call(f.dir,'complete',{...f.receipt,status:'ok',result:'WF_DELIVERY {"claimed_result":"success"}'}).status,0);
 assert.deepEqual(readFileSync(join(f.dir,'rpc-calls.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l).method),['sessions.abort','agent.wait','tools.invoke']);
});
test('持久fallback拒绝其他turn、伪terminal、成功文本与不完整证明，未知仍保留锁',()=>{
 for(const variant of ['cross-run','cross-session','ok','unknown','missing-end','future-end','duplicate','not-completed','attention','bad-wrapper']){
  const f=durableFixture(variant),r=awaitOnce(f);assert.notEqual(r.status,0,variant);
  assert.equal(existsSync(join(f.dir,'agent-terminal.json')),false,variant);assert.equal(existsSync(join(f.dir,'agent-completion.json')),false,variant);
 }
});
test('闭nonce的await只保留失败证明，绑定竞争或预算耗尽不得伪造停止',()=>{
 const closed=durableFixture();writeFileSync(join(closed.dir,'handoff-closed.json'),'{}');const cr=awaitOnce(closed);
 assert.notEqual(cr.status,0);assert.match(cr.stderr,/handoff already closed/);assert.equal(JSON.parse(readFileSync(join(closed.dir,'agent-terminal.json'))).status,'error');assert.equal(existsSync(join(closed.dir,'agent-completion.json')),false);
 const expired=durableFixture();writeFileSync(join(expired.dir,'envelope.json'),JSON.stringify({cleanup_deadline_at:new Date(Date.now()-1000).toISOString()}));const er=awaitOnce(expired);
 assert.notEqual(er.status,0);assert.equal(existsSync(join(expired.dir,'rpc-calls.jsonl')),false);assert.equal(existsSync(join(expired.dir,'agent-terminal.json')),false);
 const raced=durableFixture(),cli=join(raced.dir,'openclaw');writeFileSync(cli,readFileSync(cli,'utf8').replace(' print('," binding=json.loads((root/'agent-binding.json').read_text());binding['nonce']='changed';(root/'agent-binding.json').write_text(json.dumps(binding))\n print("));const rr=awaitOnce(raced);
 assert.notEqual(rr.status,0);assert.match(rr.stderr,/identity changed/);assert.equal(existsSync(join(raced.dir,'agent-terminal.json')),false);
});

test('原child仍运行或持久记录不可用时保持await，不从缓存miss推断失败',()=>{
 const f=durableFixture('pending'),r=awaitOnce(f);assert.equal(r.status,0,r.stderr);
 assert.equal(existsSync(join(f.dir,'agent-terminal.json')),false);assert.equal(existsSync(join(f.dir,'agent-completion.json')),false);
});

test('官方durable读回耗尽原cleanup预算后拒绝落停止证明',()=>{
 const f=durableFixture();const r=spawnSync('python3',['-c',`import importlib.util,pathlib,json
s=importlib.util.spec_from_file_location('h',${JSON.stringify(HELPER)});h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
d=pathlib.Path(${JSON.stringify(f.dir)});now=h.time.time();end=h.cleanup_end(d)
def rpc(method,params,timeout=20):
 if method=='agent.wait':return {'runId':${JSON.stringify(f.receipt.child_run_id)},'status':'timeout'}
 h.time.time=lambda:end+1
 return json.loads(${JSON.stringify(JSON.stringify(f.response))})
h.rpc=rpc
h.await_result(d,once=True)
`],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/outside frozen cleanup budget/);assert.equal(existsSync(join(f.dir,'agent-terminal.json')),false);assert.equal(existsSync(join(f.dir,'agent-completion.json')),false);
});
