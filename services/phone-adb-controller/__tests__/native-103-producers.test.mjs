import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {createServer,request as httpRequest} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {RPC_FILES} from '../leadgen-client.mjs';import lineRoutes from '../line-routes.js';
import {native103TestPython} from './helpers/native-103-test-python.mjs';

const module=await import('../native-scoring-producers.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
async function using(t,respond,options={}){
 const directory=mkdtempSync(join(tmpdir(),'native103-producer-'));mkdirSync(join(directory,'owned'),{mode:0o700});
 const server=createServer(respond);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});});
 const source={commit:'a'.repeat(40),files:[...new Set([...RPC_FILES,'native-scoring-runtime.mjs','native-scoring-producers.mjs'])].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
 const python=native103TestPython(root);
 const scope={task_id:randomUUID(),binding_id:randomUUID(),run_id:'douyin_comment_scoring-producers__a1',source_commit:source.commit,profile:'mmv-scoring',serial:'none',line:'yuesheng',source_run:options.sourceRun??null};
 const deadlineMs=Date.now()+(options.duration??2000),receiptDeadlineMs=deadlineMs+1000;
 const requestImpl=(url,opts,callback)=>httpRequest({hostname:'127.0.0.1',port:server.address().port,path:new URL(url).pathname+new URL(url).search,method:opts.method,headers:opts.headers,agent:false},callback);
 const readSource=(path,...args)=>path===join(root,'deployment-manifest.json')?JSON.stringify({source_commit:source.commit}):readFileSync(path,...args);
 const producer=await module.startNativeScoringProducers({root,source,scope,directory:join(directory,'owned'),python,deadlineMs,receiptDeadlineMs,requestImpl,readSource,brainCredential:()=> 'fixture-brain-token',assertAuthority:options.assertAuthority,readOnly:options.readOnly});
 t.after(()=>producer.close());return {producer,scope,deadlineMs,receiptDeadlineMs};
}
test('原Jev HTTP seam：真正请求/响应/socket归还后才消费；URL/model固定，错目标零IO',async t=>{
 assert.equal(typeof module.startNativeScoringProducers,'function','缺103实际受控HTTP/Python producer');
 let hits=0;const f=await using(t,(req,res)=>{hits++;req.resume();req.on('end',()=>{res.setHeader('Connection','close');res.end(JSON.stringify({id:'local-model-response',answers:{grade:{choice:'A',confidence:.9}}}));});});
 const value=await f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13',state:'仅fixture'},'fixture-key');
 assert.equal(value.id,'local-model-response');assert.equal(hits,1);
 await assert.rejects(()=>f.producer.httpPost('https://other.invalid/api/alpha/decisions',{model:'typesafe/jev-1.13'},'fixture-key'),/NATIVE_103_HTTP_SCOPE/);
 await assert.rejects(()=>f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'other-model'},'fixture-key'),/NATIVE_103_HTTP_SCOPE/);
 assert.equal(hits,1);
 const closed=await f.producer.close();assert.equal(closed.execution_stopped,true);assert.equal(closed.external_effect,'observed');
 assert.ok(closed.http.every(row=>row.request_closed&&row.response_closed&&row.socket_closed));
});
for(const closeFirst of [false,true])test(`completed POST ignores its old abort signal ${closeFirst?'after':'before'} producer close`,async t=>{
 let hits=0;const f=await using(t,(req,res)=>{hits++;req.resume();req.on('end',()=>{res.setHeader('Connection','close');res.end(JSON.stringify({id:'known-completed-post'}));});});
 const controller=new AbortController(),response=await f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13'},'fixture-key',{signal:controller.signal});
 assert.equal(response.id,'known-completed-post');assert.equal(getEventListeners(controller.signal,'abort').length,0);if(closeFirst)await f.producer.close();
 const before=f.producer.snapshot();assert.equal(before.pending,0);assert.equal(before.external_effect,'observed');assert.ok(before.http.every(row=>row.request_closed&&row.response_closed&&row.socket_closed));
 controller.abort();await new Promise(setImmediate);assert.deepEqual(f.producer.snapshot(),before,'a terminal callback cannot turn a fully returned POST into a new unknown');
 const stopped=await f.producer.close();assert.equal(stopped.execution_stopped,true);assert.equal(stopped.external_effect,'observed');assert.equal(hits,1);
});
test('in-flight POST abort keeps the original external effect unknown and never resends',async t=>{
 let arrived,hits=0;const seen=new Promise(resolve=>arrived=resolve),f=await using(t,req=>{hits++;req.resume();req.on('end',arrived);}),controller=new AbortController();
 const call=f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13'},'fixture-key',{signal:controller.signal});await seen;controller.abort();await assert.rejects(call,/NATIVE_103_HTTP_CLOSED|NATIVE_103_HTTP_UNKNOWN/);
 const stopped=await f.producer.close();assert.equal(stopped.pending,0);assert.equal(stopped.external_effect,'unknown');assert.equal(hits,1);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 controller.abort();assert.equal(f.producer.snapshot().external_effect,'unknown');
});
test('正式父Task读取仅固定scope任务；GET也需req/res/socketclose且不调用模型',async t=>{
 assert.equal(typeof module.startNativeScoringProducers,'function');let path,authorization;
 const f=await using(t,(req,res)=>{path=req.url;authorization=req.headers.authorization;res.setHeader('Connection','close');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify({task:{id:req.url.split('/').at(-1),status:'in_progress'}}));});
 assert.equal(typeof f.producer.readTask,'function','缺Code-owned authority HTTP，不得用global fetch冒闭域');
 const task=await f.producer.readTask();assert.equal(task.id,f.scope.task_id);assert.equal(path,'/api/brain/tasks/'+f.scope.task_id);assert.equal(authorization,'Bearer fixture-brain-token');
 const proof=await f.producer.close();assert.equal(proof.external_effect,'none');assert.equal(proof.execution_stopped,true);assert.ok(proof.http.every(x=>!x.post&&x.request_closed&&x.response_closed&&x.socket_closed));
});
test('POST收到后seal：有界返回、外部效果stickyunknown；真实Socket归还不能冒有效模型回复',async t=>{
 assert.equal(typeof module.startNativeScoringProducers,'function');
 let arrived;const seen=new Promise(resolve=>{arrived=resolve;});
 const f=await using(t,(req,res)=>{req.resume();req.on('end',()=>arrived());});
 const call=f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13',state:'fixture'},'fixture-key');
 await seen;f.producer.seal();await assert.rejects(call,/NATIVE_103_HTTP_CLOSED|NATIVE_103_HTTP_UNKNOWN/);
 const closed=await f.producer.close();assert.equal(closed.external_effect,'unknown');
 assert.equal(closed.pending,0);assert.equal(closed.execution_stopped,true);
});
test('严格原parser与原订单锁均沿固定Python：源码/UID不匹配拒绝、不接受Agent自报proof',{skip:process.platform!=='darwin'},async t=>{
 assert.equal(typeof module.startNativeScoringProducers,'function');
 const f=await using(t,(_req,res)=>res.end('{}'));
 const profile=readFileSync(new URL('./fixtures/honor-e1b-recipient/profile.xml',import.meta.url),'utf8');
 const returned=readFileSync(new URL('./fixtures/honor-e1b-recipient/returned.xml',import.meta.url),'utf8');
 const expected={nickname:'测试评论人',douyinId:'fixture-account-102',commentBody:'测试完整评论 首评',commentEncoding:'xml_raw'};
 const parsed=await f.producer.parseNative(profile,returned,expected);
 assert.equal(parsed.native_profile_verified,true);assert.equal(parsed.returned_comment_verified,true);
 await assert.rejects(()=>f.producer.parseNative(profile,returned,{...expected,douyinId:'wrong-uid'}),/NATIVE_103_PARSER_INVALID/);
 let called=0;await f.producer.withOrderLock('yuesheng',async()=>{called++;});assert.equal(called,1);
 const closed=await f.producer.close();assert.equal(closed.execution_stopped,true);
 assert.ok(closed.native.every(leaf=>leaf.process_closed&&leaf.stdin_closed&&leaf.stdout_closed&&leaf.stderr_closed));
});
test('原sample readProof同冻结sourceRun三次受控GET，保原身份归并；错源0HTTP、不读ambient Brain凭据',async t=>{
 let hits=0;const upstream='fixture102',runId=`douyin_video_processing-${upstream}__a1`;
 const f=await using(t,(req,res)=>{hits++;assert.equal(req.headers.authorization,'Bearer fixture-brain-token');const values={};values[`/api/brain/runs/${runId}/definition`]={binding:{id:'binding102',run_id:runId,release_id:'release102',workflow_definition_version_id:'wf102'},workflow:{id:'wf102',source_commit:'a'.repeat(40)}};values[`/api/brain/runs/${runId}/reconciliation`]={run_id:runId,run_binding_id:'binding102',release_id:'release102',business_outcome:'pass',evidence_status:'verified',gaps:[],span_count:0,expected_count:0};values[`/api/brain/runs/${runId}?include=spans`]={spans:[]};const value=values[req.url];res.statusCode=value?200:404;res.end(JSON.stringify(value||{}));},{sourceRun:upstream});
 const deps=await f.producer.queueDependencies({apiKey:'fixture-key',feishuCredentials:{[lineRoutes.routeOf('yuesheng').account]:{appId:'fixture-app',appSecret:'fixture-secret'}}});
 const proof=await deps.sampledAdmission.readProof(upstream);assert.equal(proof.run_id,runId);assert.equal(proof.identity_bound,true);assert.equal(hits,3);await assert.rejects(deps.sampledAdmission.readProof('foreign102'),/SOURCE_PROOF_SCOPE/);assert.equal(hits,3);const closed=await f.producer.close();assert.equal(closed.execution_stopped,true);assert.equal(closed.external_effect,'none');
});

test('HTTP producer每次真实dispatch与消费前核Code authority，迟到授权/seal不得发HTTP',async t=>{
 let authorizeCount=0,hits=0;const f=await using(t,(_q,r)=>{hits++;r.end('{}');},{assertAuthority:async()=>{authorizeCount++;return true;}});await f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13'},'fixture-key');assert.equal(hits,1);assert.equal(authorizeCount,2);
 let entered,release;const wait=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);const second=await using(t,(_q,r)=>{hits++;r.end('{}');},{assertAuthority:async()=>{entered();await blocked;return true;}});const work=second.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13'},'fixture-key');await wait;second.producer.seal();release();await assert.rejects(work,/CLOSED|UNKNOWN/);const closed=await second.producer.close();assert.equal(hits,1);assert.equal(closed.pending,0);assert.equal(closed.external_effect,'none');
});

test('Code Judge readonly producer rejects every POST before HTTP intent while fixed Task GET remains available',async t=>{
 let hits=0;const f=await using(t,(q,r)=>{hits++;r.end(JSON.stringify({task:{id:'fixture'}}));},{readOnly:true});
 await assert.rejects(()=>f.producer.httpPost('https://openrouter.ai/api/alpha/decisions',{model:'typesafe/jev-1.13'},'fixture'),/NATIVE_103_READONLY_POST/);
 assert.equal(hits,0);assert.equal(f.producer.snapshot().external_effect,'none');await f.producer.readTask();assert.equal(hits,1);
});

test('original order lock readiness remains capped at five seconds inside the unchanged absolute producer deadline',async t=>{
 const f=await using(t,(_q,r)=>r.end('{}'),{duration:8000});const cp=await import('node:child_process'),{syncBuiltinESMExports}=await import('node:module'),{EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');let calls=0,kills=0;
 t.mock.method(cp.default,'spawn',()=>{calls++;const c=new EventEmitter();c.pid=99999999;c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{kills++;c.stdin.destroy();c.stdout.destroy();c.stderr.destroy();setImmediate(()=>c.emit('close',null,'SIGKILL'));return true;};return c;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const start=performance.now();await assert.rejects(()=>f.producer.withOrderLock('yuesheng',async()=>assert.fail('无READY不得执行订单体')),/NATIVE_103_/);const elapsed=performance.now()-start;assert.equal(calls,1);assert.ok(kills>=1);assert.ok(elapsed<6500,'必须保原5秒ready上限，不借8秒Activity剩余额度: '+elapsed);assert.equal(f.producer.snapshot().execution_unknown,true);
});
