import{native103PgFixture as fixture}from'./fixtures/native-103-pg-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {RPC_FILES} from '../leadgen-client.mjs';
import lineRoutes from '../line-routes.js';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const root=resolve(import.meta.dirname,'..');
const runtime=await import('../native-scoring-runtime.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const producerModule=await import('../native-scoring-producers.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
// 本人私有PG信息由测试命令显式传入；无缺省PG/组织环境fallback。
const fixturePath=process.env.ZJ_NATIVE_103_PG_FIXTURE;

test('真实隔离PG：103原company freeze与score_scope在父域；不支持操作零PG分配',async t=>{
 assert.equal(typeof runtime.createNativeScoringRuntime,'function','缺公开103实际业务runtime');
 const f=await fixture(t),r=runtime.createNativeScoringRuntime(f);await r.prepare();await r.begin({...f.scope,activity:'scoring'});
 const config=await r.queue('company_config',{step:'103'});assert.equal(config.company_id,f.company.company_id);
 const scoped=await r.queue('score_scope',{});assert.deepEqual(scoped.ids,[f.id]);
 const unsupported=f.allocated();await assert.rejects(()=>r.queue('claim_outreach',{}),/NATIVE_103_UNSUPPORTED/);assert.equal(f.allocated(),unsupported);
 await r.closeActivity();assert.equal(r.snapshot().execution_unknown,false);
});

test('原公司快照COMMIT已执行却ACK丢失：保未知、拒重投与下一写，不能靠Socket关闭洗成功',async t=>{
 assert.equal(typeof runtime.createNativeScoringRuntime,'function');
 const f=await fixture(t),r=runtime.createNativeScoringRuntime(f);await r.prepare();await r.begin({...f.scope,activity:'scoring'});
 f.control.loseCommit=true;
 await assert.rejects(()=>r.queue('company_config',{step:'103'}),/NATIVE_103_COMMIT_UNKNOWN_READBACK_REQUIRED/);
 assert.equal(r.snapshot().external_effect,'unknown');
 const calls=f.calls.length,allocated=f.allocated();
 await assert.rejects(()=>r.queue('company_config',{step:'103'}),/NATIVE_103_COMMIT_UNKNOWN_READBACK_REQUIRED/);
 assert.equal(f.calls.length,calls);assert.equal(f.allocated(),allocated);
 await assert.rejects(()=>r.closeActivity(),/NATIVE_103_STOP_UNVERIFIED/);
 assert.equal(r.seal().execution_stopped,true,'物理Socket已关，但外部效果仍必须是unknown');
 assert.equal(r.snapshot().external_effect,'unknown');
});

test('原claim/source改变后零SQL；不能把别的非空claimer当原claim',async t=>{
 assert.equal(typeof runtime.createNativeScoringRuntime,'function');
 const f=await fixture(t),r=runtime.createNativeScoringRuntime(f);await r.prepare();await r.begin({...f.scope,activity:'scoring'});
 await r.queue('company_config',{step:'103'});
 const n=f.calls.length;f.task.claimed_by='foreign-claimer';
 await assert.rejects(()=>r.queue('score_scope',{}),/NATIVE_103_CLAIM_CHANGED/);assert.equal(f.calls.length,n);
 r.seal();
});

test('父准入HTTP未归还时seal/截止有界返回但保pending，晚结果不分配PG',async t=>{
 assert.equal(typeof runtime.createNativeScoringRuntime,'function');
 const f=await fixture(t);let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
 let reads=0;
 const r=runtime.createNativeScoringRuntime({...f,assertAuthority:async()=>{if(++reads>1){entered();await blocked;}return structuredClone(f.task);}});
 await r.prepare();await r.begin({...f.scope,activity:'scoring'});
 const call=r.queue('score_scope',{});await started;
 const sealed=r.seal();assert.equal(sealed.execution_stopped,false);assert.ok(sealed.pending>0);
 release();await assert.rejects(call,/NATIVE_103_CLOSED/);assert.equal(f.allocated(),0);
});

test('没有同Source发行的模型/parser/订单域时score首IO拒；不能使用成熟模块缺省HTTP兜底',async t=>{
 assert.equal(typeof runtime.createNativeScoringRuntime,'function');
 const f=await fixture(t);let attempts=0;
 // 硬拒替身仅作安全护栏，防止旧WIP落入成熟模型缺省认证/网络读取。
 // 受审producer私有品牌缺失应在任何PG或这个替身之前拒绝。
 const r=runtime.createNativeScoringRuntime({...f,queueDependencies:{judgeComment:async()=>{attempts++;throw Error('UNOWNED_MODEL_FORBIDDEN');}}});
 await r.prepare();await r.begin({...f.scope,activity:'scoring'});
 await r.queue('company_config',{step:'103'});await r.queue('score_scope',{});
 const calls=f.calls.length,allocated=f.allocated();
 await assert.rejects(()=>r.queue('score',{ids:[f.id]}),/NATIVE_103_DEPENDENCY/);
 assert.equal(attempts,0);assert.equal(f.calls.length,calls);assert.equal(f.allocated(),allocated);
 r.seal();
});

test('两Activity完整业务fixture：原评分双审/原生parser/标人事务/原订单锁/同marker Feishu读回',async t=>{
 assert.equal(typeof producerModule.startNativeScoringProducers,'function','缺父owned模型/Python/订单producer，不能启用普通103');
 const f=await fixture(t);await f.seedNative();
 const orders=[],requests=[];let review=0;
 const server=createServer((req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{
  const input=text?JSON.parse(text):null;requests.push({path:req.url,method:req.method});let body;
  if(req.url==='/api/alpha/decisions')body={id:'primary-'+randomUUID(),model:'typesafe/jev-1.13',answers:input.questions.recipient?{recipient:{choice:'passed',confidence:.95}}:{grade:{type:'choice',choice:'A',confidence:.95}}};
  else if(req.url==='/api/v1/chat/completions')body={id:'review-'+(++review),model:'google/gemini-2.5-flash',choices:[{message:{content:JSON.stringify({grade:'A',policy_evidence:{audience_id:'audience',matched_rule:'报名',comment_signal:'在哪里报名',video_signal:'人工智能',exclusion_rule:null,reason:'按原冻结人群核验主动咨询报名'}})}}]};
  else if(req.url==='/open-apis/auth/v3/tenant_access_token/internal')body={code:0,tenant_access_token:'fixture-only-token'};
  else if(req.url.includes('/fields?'))body={code:0,data:{items:[{field_name:'采集时间',type:5}],has_more:false}};
  else if(req.method==='POST'){const record={record_id:'recLocalFixture1',fields:input.fields};orders.push(record);body={code:0,data:{record}};}
  else if(req.url.includes('/records?'))body={code:0,data:{items:orders,has_more:false}};
  else body={code:0,data:{record:orders[0]}};
  res.setHeader('Connection','close');res.end(JSON.stringify(body));
 });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const requestImpl=(url,opts,callback)=>{const target=new URL(url);return httpRequest({hostname:'127.0.0.1',port:server.address().port,path:target.pathname+target.search,method:opts.method,headers:opts.headers,agent:false},callback);};
 const policy=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))),python=policy.hosts.find(h=>h.target==='mmv').executables.python;
 const pd=join(f.directory,'producers');mkdirSync(pd,{mode:0o700});
 const producers=await producerModule.startNativeScoringProducers({root,source:f.source,scope:f.scope,directory:pd,python,deadlineMs:f.scope.deadline_ms,receiptDeadlineMs:f.scope.receipt_deadline_ms,requestImpl,readSource:f.readSource});
 const deps=await producers.queueDependencies({apiKey:'fixture-key',feishuCredentials:{[lineRoutes.routeOf('yuesheng').account]:{appId:'fixture-app',appSecret:'fixture-secret'}},orderDirectory:join(f.directory,'order-locks')});
 const runtimeDirectory=join(f.directory,'runtime');mkdirSync(runtimeDirectory,{mode:0o700});
 const r=runtime.createNativeScoringRuntime({...f,directory:runtimeDirectory,queueDependencies:deps});await r.prepare();await r.begin({...f.scope,activity:'scoring'});
 await r.queue('company_config',{step:'103'});assert.deepEqual((await r.queue('score_scope',{})).ids,[f.id]);
 const scored=await r.queue('score',{ids:[f.id]});assert.equal(scored.scored,1,JSON.stringify(scored));
 assert.equal((await r.queue('score_readback',{ids:[f.id]})).verified,true);
 const policyReview=await r.queue('policy_review',{ids:[f.id]});assert.equal(policyReview.verified,true,JSON.stringify(policyReview));await r.closeActivity();
 await r.begin({...f.scope,activity:'mark_leads'});const marked=await r.queue('mark_leads',{});
 assert.equal(marked.marked,1);assert.equal(marked.lead_ids.length,1);
 assert.equal((await r.queue('mark_readback',{ids:marked.ids,lead_ids:marked.lead_ids})).verified,true);
 const bridge=await r.queue('bridge_outreach',{});assert.equal(bridge.published,1);assert.equal(bridge.verified,true);
 assert.equal((await r.queue('bridge_readback',{ids:bridge.ids})).verified,true);
 await r.closeActivity();const nativeClosed=await producers.close();r.seal();
 assert.equal(nativeClosed.execution_stopped,true);assert.equal(r.snapshot().execution_stopped,true);
 const pg=await f.readRows();assert.equal(pg.comments[0].process_status,'已分拣');assert.equal(pg.comments[0].intent_grade,'A');assert.equal(pg.leads.length,1);assert.equal(pg.outbox[0].state,'confirmed');
 assert.equal(orders.length,1);assert.equal(orders[0].fields['状态'],'待触达');assert.equal(orders[0].fields['发送状态'],'未发送');
 assert.equal(requests.filter(q=>q.method==='POST'&&q.path.endsWith('/records')).length,1);
 assert.equal(requests.some(q=>q.path.includes('im/v1/messages')),false,'103是CRM配送，不能发聊天或运行104');
});

 test('原普通source_run=null独立消费固定server来源，不把空来源误判为来源串线',async t=>{
 const f=await fixture(t);f.scope.source_run=null;f.task.payload.scope.source_run=null;delete f.task.lease_until;const r=runtime.createNativeScoringRuntime(f);await r.prepare();await r.begin({...f.scope,activity:'scoring'});await r.queue('company_config',{step:'103'});const selected=await r.queue('score_scope',{});assert.deepEqual(selected.ids,[f.id]);assert.equal(selected.sources[f.id],'source102');await r.closeActivity();r.seal();assert.equal(r.snapshot().execution_stopped,true);
 });
test('两slot只接受同Source品牌producer；前slot真实封闭后才能更换，不能复开旧域',async t=>{
 const f=await fixture(t),policy=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))),python=policy.hosts.find(h=>h.target==='mmv').executables.python;
 const make=async name=>{const directory=join(f.directory,name);mkdirSync(directory,{mode:0o700});const p=await producerModule.startNativeScoringProducers({root,source:f.source,scope:f.scope,directory,python,deadlineMs:f.scope.deadline_ms,receiptDeadlineMs:f.scope.receipt_deadline_ms,readSource:f.readSource});t.after(()=>p.close());return {p,deps:await p.queueDependencies({apiKey:'fixture-key',feishuCredentials:{[lineRoutes.routeOf('yuesheng').account]:{appId:'fixture-app',appSecret:'fixture-secret'}},orderDirectory:join(directory,'locks')})};};
 const first=await make('scoring-producer'),second=await make('mark-producer'),ledger=join(f.directory,'queue-ledger');mkdirSync(ledger,{mode:0o700});const r=runtime.createNativeScoringRuntime({...f,directory:ledger,queueDependencies:first.deps});await r.prepare();assert.equal(typeof r.bindDependencies,'function','公开两slot不能永远复用同一已封producer');await r.begin({...f.scope,activity:'scoring'});await r.queue('company_config',{step:'103'});const scope=await r.queue('score_scope',{});assert.deepEqual(scope.ids,[f.id]);await r.closeActivity();assert.throws(()=>r.bindDependencies(second.deps),/PREVIOUS_PRODUCER/);await first.p.close();r.bindDependencies(second.deps);assert.throws(()=>r.bindDependencies({}),/DEPENDENCY/);await r.begin({...f.scope,activity:'mark_leads'});await second.p.close();await r.closeActivity();r.seal();assert.equal(r.snapshot().execution_stopped,true);
});
