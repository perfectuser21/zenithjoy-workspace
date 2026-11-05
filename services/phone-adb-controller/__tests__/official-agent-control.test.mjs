import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {using} from './fixtures/official-control-fixture.mjs';

test('原真实Skill/中央绑定/私有official原件经本机只读HTTP授权，无outer Node或SSH',async()=>using(async({instance,q,count})=>{
 const value=await instance.request({kind:'activity_skill_authority',request:q});
 assert.deepEqual(value,{ok:true,authorized:true});assert.equal(count(),4);
 assert.equal(instance.snapshot().execution_stopped,false,'idle不等于sealed');
 await instance.close();assert.equal(instance.snapshot().execution_stopped,true);
}));
test('换Task、nonce、profile、source或broker host在任何IO之前拒绝',async()=>using(async({instance,q,count})=>{
 for(const change of [{task_id:'44444444-4444-4444-8444-444444444444'},{nonce:'d'.repeat(48)},{profile:'other'},{source_commit:'e'.repeat(40)},{broker_host:'xian-m4'}])await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:{...q,...change}}),/OFFICIAL_CONTROL_SCOPE/);
 assert.equal(count(),0);
}));
test('尚未闭域的launch/stop/commander及其它业务不回退旧RPC，零HTTP',async()=>using(async({instance,q,count})=>{
 for(const kind of ['activity_skill','activity_skill_stop','commander','queue','outreach'])await assert.rejects(()=>instance.request({kind,request:q}),/OFFICIAL_CONTROL_UNSUPPORTED/);
 assert.equal(count(),0);
}));
test('中央Task错身份仍沿原校验拒绝，不借本地transport获得权限',async()=>using(async({instance,q,routes})=>{
 routes.get('/api/brain/tasks/'+q.task_id).payload.device_serial='47.100.213.173:10002';
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
}));
test('seal取消在途读；真实request/socket关闭前保留pending，晚回调不发第二GET',async()=>using(async({instance,q,firstRequest,count})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_CLOSED/);
 await Promise.race([firstRequest,work.then(()=>{throw Error('authority returned before fixture request');})]);assert.equal(instance.snapshot().pending,1);
 const closed=instance.close();await rejected;await closed;
 assert.equal(count(),1);assert.equal(instance.snapshot().pending,0);assert.equal(instance.snapshot().execution_stopped,true);
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_CLOSED/);
},{delay:true}));

test('缺失request close回执不得卡死收尾或伪停止；真实socket虽关仍保unknown',async()=>using(async({instance,q,firstRequest})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_CLOSED/);
 await Promise.race([firstRequest,work]);
 const result=await Promise.race([instance.close(),new Promise(r=>setTimeout(()=>r('unbounded'),1000))]);
 assert.notEqual(result,'unbounded','close必须在receipt预算内返回unknown，不能无限等close事件');
 assert.equal(result.execution_stopped,false);assert.equal(result.execution_unknown,true);assert.equal(result.pending,1);
 await rejected;
},{delay:true,suppressClose:true}));

test('绝对deadline取消真实挂起HTTP，之后无新GET且本机关闭可证',async()=>using(async({instance,q,firstRequest,count})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_DEADLINE/);
 await Promise.race([firstRequest,work]);await rejected;await instance.close();
 assert.equal(count(),1);assert.equal(instance.snapshot().execution_stopped,true);
},{delay:true,shortDeadline:true}));
test('日志ACL被改时在HTTP前拒绝并保unknown，close不洗掉记录失败',async()=>using(async({instance,q,count,journalDirectory})=>{
 const file=readdirSync(journalDirectory).find(x=>x.endsWith('.jsonl'));chmodSync(join(journalDirectory,file),0o644);
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_JOURNAL/);assert.equal(count(),0);
 await instance.close();assert.equal(instance.snapshot().execution_stopped,false);assert.equal(instance.snapshot().execution_unknown,true);
}));
test('依赖原件被改仍由原source verifier拒绝；不为了本机调用绕过摘要',async()=>using(async({instance,q,count,runtimeRoot})=>{
 const file=join(runtimeRoot,'leadgen-rpc.mjs');writeFileSync(file,readFileSync(file,'utf8')+'\n');
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_SOURCE/);assert.equal(count(),0);
}));
test('错误模型的私有spawn原件不可获得authority，凭据不进入记录',async()=>using(async({instance,q,runDir,journalDirectory})=>{
 const file=join(runDir,'spawn-receipt.json'),receipt=JSON.parse(readFileSync(file));receipt.resolvedModel='different';writeFileSync(file,JSON.stringify(receipt));
 assert.deepEqual(await instance.request({kind:'activity_skill_authority',request:q}),{ok:true,authorized:false});
 for(const name of readdirSync(journalDirectory))assert.equal(readFileSync(join(journalDirectory,name),'utf8').includes('fixture-private-token'),false);
}));
