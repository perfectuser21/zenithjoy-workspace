import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createConnection} from 'node:net';

const module=await import('../activity-skill-primary-broker.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const request=()=>({protocol:'leadgen-activity-v1',mode:'execute',run_id:'primary_fixture__a1',task_id:'28f30d70-7248-434b-a1d4-29afed626017',binding_id:'00000000-0000-4000-8000-000000000001',activity_key:'collect_videos',nonce:'a'.repeat(48),source_commit:'a'.repeat(40),runtime_snapshot_sha256:'b'.repeat(64),deadline_ms:Date.now()+20000});
const call=(broker,body)=>new Promise((yes,no)=>{
  const q=JSON.parse(readFileSync(broker.requestPath,'utf8')),client=createConnection(q.socket);let output='';
  client.on('connect',()=>client.end(JSON.stringify({...q,...body})));
  client.on('data',chunk=>output+=chunk);client.on('error',no);client.on('end',()=>{try{yes(JSON.parse(output));}catch(error){no(error);}});
});
async function using(fn,options={}){
  assert.equal(typeof module.startPrimaryActivityBroker,'function','独立primary broker必须存在；不能用旧resume broker替代');
  const directory=mkdtempSync(join(tmpdir(),'primary-broker-'));
  const result={videos:[]};let writes=0;
  const broker=await module.startPrimaryActivityBroker({directory,request:request(),authorize:async()=>true,
    inspect:async()=>({business_capabilities:['discover']}),phone:async()=>({native:true}),
    business:async(operation,input)=>{writes++;result.videos.push(input.video_id);return {operation,inserted:1};},
    getActivityResult:()=>structuredClone(result),...options});
  try{await fn(broker,()=>writes);}finally{await broker.close();rmSync(directory,{recursive:true,force:true});}
}
test('primary从第一轮调用业务工具并保存server结果；没有Code resume',async()=>using(async(b,count)=>{
  assert.equal((await call(b,{op:'business',operation:'discover',input:{video_id:'1234567890123456'}})).ok,true);
  assert.deepEqual(b.getResult().result,{videos:['1234567890123456']});
  assert.equal((await call(b,{op:'resume'})).ok,false);assert.equal(count(),1);
}));
test('primary拒绝错误scope、未绑定child及非法工具且不调用业务',async()=>using(async(b,count)=>{
  for(const patch of [{nonce:'c'.repeat(48)},{run_id:'foreign'},{task_id:'00000000-0000-4000-8000-000000000002'},{source_commit:'c'.repeat(40)},{binding_id:'foreign'},{activity_key:'send_dm'}])assert.equal((await call(b,{op:'business',operation:'discover',input:{},...patch})).ok,false);
  assert.equal((await call(b,{op:'workflow'})).ok,false);assert.equal(count(),0);
}));
test('primary默认关闭授权；授权耗时越过截止不得启动原语',async()=>{
  await using(async(b,count)=>{assert.equal((await call(b,{op:'business',operation:'discover',input:{}})).ok,false);assert.equal(count(),0);},{authorize:async()=>false});
  await using(async(b,count)=>{assert.equal((await call(b,{op:'business',operation:'discover',input:{}})).ok,false);assert.equal(count(),0);},{request:{...request(),deadline_ms:Date.now()+20},authorize:async()=>{await new Promise(r=>setTimeout(r,40));return true;}});
});
test('primary将Commander指导留到下一inspect且完整记录交流',async()=>{
  let turns=0;
  await using(async b=>{
    await call(b,{op:'inspect',question:'如何核对指标？'});
    assert.deepEqual((await call(b,{op:'inspect'})).result.commander_guidance,['核对本视频原生指标']);
    assert.match(readFileSync(join(b.directory,'broker-events.jsonl'),'utf8'),/如何核对指标/);
  },{onEvent:async()=>++turns===1?{action:'steer',text:'核对本视频原生指标'}:{action:'none'}});
});
test('primary Commander abort和未知执行阻断写入且不宣称已停止',async()=>{
  let stops=0;
  await using(async(b,count)=>{
    await call(b,{op:'inspect',progress:'请求中止前的预检进度'});
    assert.equal((await call(b,{op:'business',operation:'discover',input:{}})).ok,false);
    assert.equal(count(),0);assert.equal(stops,1);assert.equal(b.getResult().execution_unknown,true);
  },{onEvent:async()=>({action:'abort',reason:'证据冲突'}),onAbort:async()=>{stops++;return {execution_stopped:false};}});
});
test('primary未知业务结果后只准inspect，不能把Agent状态文本变为结果',async()=>using(async(b)=>{
  assert.equal((await call(b,{op:'business',operation:'discover',input:{},status:'completed'})).ok,false);
  assert.equal(b.getResult().result.videos.length,0);
  await call(b,{op:'business',operation:'discover',input:{}});
  assert.equal(b.getResult().execution_unknown,true);
  assert.equal((await call(b,{op:'phone',command:'open-search',args:[]})).ok,false);
  assert.equal((await call(b,{op:'inspect'})).ok,true);
},{business:async()=>{throw Object.assign(Error('RPC_EXECUTION_STOP_UNKNOWN'),{executionStopped:false});}}));
test('primary撤销监听不会等待未知原语无限返回，也不会把socket关闭当业务已停',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'primary-close-'));let release,entered=false;
  const broker=await module.startPrimaryActivityBroker({directory,request:request(),authorize:async()=>true,inspect:async()=>({}),phone:async()=>({}),
    business:async()=>{entered=true;await new Promise(resolve=>release=resolve);return {};}});
  const operation=call(broker,{op:'business',operation:'discover',input:{}}).catch(()=>{});
  try{
    while(!entered)await new Promise(resolve=>setTimeout(resolve,1));
    const close=broker.close();
    await Promise.race([close,new Promise((_,reject)=>setTimeout(()=>reject(Error('close等待了未确认返回的业务')),100))]);
    assert.equal(broker.getResult().active,1);assert.equal(broker.getResult().execution_unknown,true);
  }finally{release?.();await operation;await broker.close();rmSync(directory,{recursive:true,force:true});}
});
test('primary provider异常只返回固定错误码，Agent和事件账均不接收凭据正文',async()=>using(async b=>{
  const out=await call(b,{op:'business',operation:'discover',input:{}});
  assert.equal(out.error,'SKILL_PRIMARY_OPERATION_FAILED');
  const raw=JSON.stringify(out)+readFileSync(join(b.directory,'broker-events.jsonl'),'utf8');
  for(const secret of ['secret-token','secret-password','secret-db'])assert.equal(raw.includes(secret),false);
},{business:async()=>{throw Error('connect postgres://alice:secret-db@db/private Bearer secret-token password=secret-password');}}));
test('primary同步seal拒绝晚到业务且不会触发新的Commander回合',async()=>{
  let events=0;
  await using(async(b,count)=>{
    await call(b,{op:'inspect',progress:'检查已完成'});assert.equal(events,1);
    assert.deepEqual(b.seal(),{sealed:true,pending:0,active:0,execution_unknown:false});
    assert.equal((await call(b,{op:'business',operation:'discover',input:{}})).ok,false);
    assert.equal((await call(b,{op:'inspect'})).ok,false);
    assert.equal(count(),0);assert.equal(events,1);assert.equal(b.getResult().execution_unknown,false);
  },{onEvent:async()=>{events++;return {action:'none'};}});
});
test('primary seal覆盖等待授权及事件记录中的请求，并在授权返回后拒绝执行',async()=>{
  let release,entered=false;
  await using(async(b,count)=>{
    const pending=call(b,{op:'business',operation:'discover',input:{}});
    while(!entered)await new Promise(resolve=>setTimeout(resolve,1));
    const seal=b.seal();assert.equal(seal.pending,1);assert.equal(seal.active,0);assert.equal(seal.execution_unknown,true);
    release();assert.equal((await pending).ok,false);assert.equal(count(),0);assert.equal(b.getResult().execution_unknown,true);
  },{authorize:async()=>{entered=true;await new Promise(resolve=>release=resolve);return true;}});
});

for(const reason of ['throws','hangs'])test(`Observer ${reason}不伪装成native或commit未知，工具结果和不可用记录仍保留`,async()=>using(async b=>{
 let timer;const out=await Promise.race([call(b,{op:'business',operation:'discover',input:{video_id:'1234567890123456'}}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Observer阻塞了工具返回')),200);})]).finally(()=>clearTimeout(timer));
 assert.equal(out.ok,true);assert.equal(b.getResult().execution_unknown,false);
 assert.deepEqual(b.getResult().result.videos,['1234567890123456']);
 const row=JSON.parse(readFileSync(join(b.directory,'broker-events.jsonl'),'utf8').trim());
 assert.equal(row.commander_status,'unavailable');assert.equal(row.response.ok,true);
},{observerTimeoutMs:20,onEvent:async()=>{if(reason==='throws')throw Error('Observer unavailable Bearer private-secret');await new Promise(()=>{});}}));
test('无显式事件的inspect只读上下文，不为工具完成再等待一轮Observer',async()=>{
 let turns=0;await using(async b=>{const out=await call(b,{op:'inspect'});assert.equal(out.ok,true);assert.equal(turns,0);}, {onEvent:async()=>{turns++;return {action:'none'};}});
});

test('Observer晚到steer记录为未应用，不能在工具返回后暗改业务结果',async()=>{
 let release;
 await using(async b=>{
  const out=await call(b,{op:'inspect',question:'请指导预检'});assert.equal(out.ok,true);
  release({action:'steer',text:'读取原生账号证据'});await new Promise(resolve=>setImmediate(resolve));
  const late=JSON.parse(readFileSync(join(b.directory,'broker-observer-late-events.jsonl'),'utf8').trim());
  assert.equal(late.action_applied,false);assert.equal(late.action.text,'读取原生账号证据');assert.equal(b.getResult().execution_unknown,false);
  assert.equal((await call(b,{op:'inspect'})).result.commander_guidance,undefined);
 },{observerTimeoutMs:20,onEvent:()=>new Promise(resolve=>{release=resolve;})});
});

test('primary在Worker截止后拒新业务，原handoff余量只用于inspect和停止读证',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const q={...request(),worker_deadline_ms:Date.now()+1000,receipt_deadline_ms:Date.now()+2000};
 await using(async(b,count)=>{t.mock.timers.tick(1000);assert.equal((await call(b,{op:'business',operation:'discover',input:{}})).error,'SKILL_PRIMARY_WORKER_EXPIRED');assert.equal((await call(b,{op:'inspect'})).ok,true);assert.equal(count(),0);},{request:q});
});
test('primary不接受放宽或颠倒阶段截止，不能把额外阶段字段当延预算入口',async()=>{
 const q=request();for(const patch of [{worker_deadline_ms:q.deadline_ms+1,receipt_deadline_ms:q.deadline_ms+2},{worker_deadline_ms:q.deadline_ms-1},{worker_deadline_ms:q.deadline_ms-2,receipt_deadline_ms:q.deadline_ms-2}])await assert.rejects(()=>using(async()=>{},{request:{...q,...patch}}),/SKILL_PRIMARY_REQUEST_INVALID/);
});

test('report的Observer在seal后才返回abort只留未应用记录，不再stop或加入指导',async()=>{
 let release,entered,stops=0,turns=0;const ready=new Promise(resolve=>{entered=resolve;});
 await using(async b=>{
  const pending=b.report({type:'stall',elapsed_ms:1000});await ready;
  assert.deepEqual(b.seal(),{sealed:true,pending:0,active:0,execution_unknown:false});
  release({action:'abort',reason:'已经晚到'});assert.equal((await pending).action,'none');
  assert.equal(stops,0);assert.equal(b.getResult().commander_aborted,false);assert.equal(b.getResult().execution_unknown,false);
  const row=JSON.parse(readFileSync(join(b.directory,'broker-events.jsonl'),'utf8').trim());assert.equal(row.action_applied,false);assert.equal(row.commander_action.action,'abort');
  await b.report({type:'stall',elapsed_ms:2000});assert.equal(turns,1);
 },{onEvent:async()=>{turns++;entered();return await new Promise(resolve=>{release=resolve;});},onAbort:async()=>{stops++;return {execution_stopped:false};}});
});
