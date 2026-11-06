import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {RPC_FILES} from '../leadgen-client.mjs';

const module=await import('../native-scoring-producers.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
async function using(t,respond,options={}){
 const directory=mkdtempSync(join(tmpdir(),'native103-producer-'));mkdirSync(join(directory,'owned'),{mode:0o700});
 const server=createServer(respond);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});});
 const source={commit:'a'.repeat(40),files:[...new Set([...RPC_FILES,'native-scoring-runtime.mjs','native-scoring-producers.mjs'])].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
 const pins=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.filter(row=>row.target==='mmv').map(row=>row.executables.python);
 assert.ok(pins.length);assert.ok(pins.every(pin=>JSON.stringify(pin)===JSON.stringify(pins[0])));
 const scope={task_id:randomUUID(),binding_id:randomUUID(),run_id:'douyin_comment_scoring-producers__a1',source_commit:source.commit,profile:'mmv-scoring',serial:'none',line:'yuesheng'};
 const deadlineMs=Date.now()+(options.duration??2000),receiptDeadlineMs=deadlineMs+1000;
 const requestImpl=(url,opts,callback)=>httpRequest({hostname:'127.0.0.1',port:server.address().port,path:new URL(url).pathname,method:opts.method,headers:opts.headers,agent:false},callback);
 const readSource=(path,...args)=>path===join(root,'deployment-manifest.json')?JSON.stringify({source_commit:source.commit}):readFileSync(path,...args);
 const producer=await module.startNativeScoringProducers({root,source,scope,directory:join(directory,'owned'),python:pins[0],deadlineMs,receiptDeadlineMs,requestImpl,readSource,brainCredential:()=> 'fixture-brain-token'});
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
test('正式父Task读取仅固定scope任务；GET也需req/res/socketclose且不调用模型',async t=>{
 assert.equal(typeof module.startNativeScoringProducers,'function');let path,authorization;
 const f=await using(t,(req,res)=>{path=req.url;authorization=req.headers.authorization;res.setHeader('Connection','close');res.end(JSON.stringify({task:{id:req.url.split('/').at(-1),status:'in_progress'}}));});
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
