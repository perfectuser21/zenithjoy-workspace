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
  client.on('data',chunk=>output+=chunk);client.on('error',no);client.on('end',()=>yes(JSON.parse(output)));
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
    await call(b,{op:'inspect'});
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
