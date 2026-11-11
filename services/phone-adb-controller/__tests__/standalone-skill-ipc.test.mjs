import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,lstatSync,existsSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=()=>import('../standalone-skill-ipc.mjs');
function dir(t){const d=mkdtempSync(join(realpathSync(tmpdir()),'skill-ipc-test-'));chmodSync(d,0o700);return d;}
function raw(c,body,{nonce=c.nonce,method='POST'}={}){return new Promise((resolve,reject)=>{const req=request({socketPath:c.socket,path:'/tool',method,headers:{'content-type':'application/json','x-standalone-nonce':nonce}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));});req.on('error',reject);req.end(body);});}
test('a real private IPC request dispatches one step and close removes its connection and socket',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),directory=dir(t),calls=[];
 const host=await serveStandaloneSkillTools({directory,call:async(op,input)=>{calls.push({op,input});return {value:input.value};}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});
 const connection=JSON.parse(readFileSync(host.connectionPath,'utf8'));
 assert.equal(lstatSync(host.connectionPath).mode&0o777,0o600);assert.equal(lstatSync(connection.socket).mode&0o777,0o600);
 assert.deepEqual(await callStandaloneSkillTool(host.connectionPath,'inspect',{value:7}),{ok:true,result:{value:7}});
 assert.deepEqual(calls,[{op:'inspect',input:{value:7}}]);
 await host.close();assert.equal(existsSync(host.connectionPath),false);assert.equal(existsSync(connection.socket),false);
 await assert.rejects(callStandaloneSkillTool(host.connectionPath,'inspect',{}),/IPC_CONNECTION_INVALID/);
});
test('bad credentials, shape, JSON, method and oversize requests never dispatch',async t=>{
 const {serveStandaloneSkillTools}=await load(),directory=dir(t);let effects=0;
 const host=await serveStandaloneSkillTools({directory,call:async()=>{effects++;return {};}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});const c=JSON.parse(readFileSync(host.connectionPath));
 for(const [body,options,status]of [[JSON.stringify({operation:'phone',input:{}}),{nonce:'incorrect'},403],[JSON.stringify({operation:'phone',input:{},override:'secret'}),{},400],['{bad',{},400],[JSON.stringify({operation:'phone',input:{}}),{method:'GET'},400],[JSON.stringify({operation:'phone',input:{text:'a'.repeat(4*1024*1024)}}),{},413]]){
  const response=await raw(c,body,options);assert.equal(response.status,status);assert.equal(response.body.ok,false);
 }
 assert.equal(effects,0);
});
test('concurrent requests reject busy and provider errors expose no sensitive message or stack',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),directory=dir(t);let unblock,started;const ready=new Promise(r=>started=r);let count=0;
 const host=await serveStandaloneSkillTools({directory,call:async(op)=>{count++;if(op==='hold'){started();await new Promise(r=>unblock=r);return 'done';}throw Error('secret-token-should-not-leak');}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});
 const pending=callStandaloneSkillTool(host.connectionPath,'hold',{});await ready;
 await assert.rejects(callStandaloneSkillTool(host.connectionPath,'inspect',{}),/IPC_BUSY/);assert.equal(count,1);unblock();await pending;
 const c=JSON.parse(readFileSync(host.connectionPath));const failed=await raw(c,JSON.stringify({operation:'fail',input:{}}));assert.deepEqual(failed.body,{ok:false,error:'IPC_CALL_FAILED'});assert.equal(JSON.stringify(failed).includes('secret-token'),false);
});
test('directory and client connection permissions or links cannot grant access',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),directory=dir(t),link=directory+'-link';symlinkSync(directory,link);t.after(()=>rmSync(link,{force:true}));
 await assert.rejects(serveStandaloneSkillTools({directory:link,call:async()=>{}}),/IPC_DIRECTORY_INVALID/);
 chmodSync(directory,0o755);await assert.rejects(serveStandaloneSkillTools({directory,call:async()=>{}}),/IPC_DIRECTORY_INVALID/);chmodSync(directory,0o700);
 const host=await serveStandaloneSkillTools({directory,call:async()=>({})});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});chmodSync(host.connectionPath,0o644);
 await assert.rejects(callStandaloneSkillTool(host.connectionPath,'inspect',{}),/IPC_CONNECTION_INVALID/);chmodSync(host.connectionPath,0o600);
});

test('client timeout never retries or asserts provider stop and close waits for the pending call',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),directory=dir(t);let release,started,count=0;
 const ready=new Promise(r=>started=r),host=await serveStandaloneSkillTools({directory,call:async()=>{count++;started();await new Promise(r=>release=r);return 'returned';}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});
 const pending=callStandaloneSkillTool(host.connectionPath,'phone',{}, {timeoutMs:20});await ready;
 await assert.rejects(pending,error=>error.code==='IPC_TIMEOUT'&&error.execution_stopped===undefined);assert.equal(count,1);
 let closed=false;const closing=host.close().then(()=>closed=true);await new Promise(r=>setTimeout(r,10));assert.equal(closed,false);
 release();await closing;assert.equal(count,1);
});

test('IPC preserves only reviewed finite provider codes while unknown prefixes and messages remain private',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),directory=dir(t);
 const codes=['EPOCH_STANDALONE_IDENTITY','EPOCH_SOURCE_COMPATIBILITY','EPOCH_BUSINESS_TASK','EPOCH_BUSINESS_BINDING','EPOCH_BUSINESS_TASK_RUN','EPOCH_BUSINESS_CENTRAL','EPOCH_LOCAL_HANDOFF','EPOCH_SOURCE_POLICY','EPOCH_LIVE_ROUTES','STANDALONE_NATIVE_ACCOUNT','STANDALONE_NATIVE_CARD','STANDALONE_NATIVE_CARD_IDENTITY','STANDALONE_NATIVE_COMMAND','STANDALONE_TOOL_QUOTA','STANDALONE_TOOL_COMMIT_UNKNOWN','STANDALONE_TOOL_KEYWORD','STANDALONE_TOOL_FILTER_SCOPE','STANDALONE_TOOL_BUSY','STANDALONE_TOOL_EVIDENCE_REUSED'];
 const host=await serveStandaloneSkillTools({directory,call:async(op,input)=>{throw Object.assign(Error('private secret-token-should-not-leak'),{code:input.code});}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});
 for(const code of codes)await assert.rejects(callStandaloneSkillTool(host.connectionPath,'phone',{code}),error=>error.code===code&&error.message===code&&error.stack.includes('secret-token')===false);
 const c=JSON.parse(readFileSync(host.connectionPath));
 for(const code of ['EPOCH_BUSINESS_TASK_secret-token','STANDALONE_TOOL_UNREVIEWED','STANDALONE_NATIVE_ACCOUNT:private']){
  const response=await raw(c,JSON.stringify({operation:'phone',input:{code}}));assert.deepEqual(response.body,{ok:false,error:'IPC_CALL_FAILED'});assert.equal(JSON.stringify(response).includes('secret-token'),false);
 }
});


test('valid inline native observations larger than 64KiB cross both the client and real server intact',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),{buildObservation}=createRequire(import.meta.url)('../discovery-metrics.js'),directory=dir(t);
 const xml='<hierarchy><node content-desc="未点赞，喜欢1，按钮"/><node content-desc="评论2，按钮"/><node text="'+'合法观测'.repeat(6000)+'"/></hierarchy>';
 const metrics=buildObservation({run:'fixture-direct101',run_id:'00000000-0000-4000-8000-000000000001',profile:'cloud-phone-test',source_commit:'a'.repeat(40),line_key:'yuesheng',video_id:'7646309328911907195',video_url:'https://www.douyin.com/video/7646309328911907195',observed_at:'2026-11-11T08:00:00.000Z',evidence_id:'fixture-direct101-candidate1-link-t1',xml});
 const input={operation:'discover',input:{video:{videoId:metrics.video_id,videoUrl:metrics.video_url,title:'离线原生指标传输夹具',keyword:'AI办公',metrics}}};
 const body=JSON.stringify({operation:'business',input});assert.ok(Buffer.byteLength(body)>65536);assert.ok(Buffer.byteLength(xml)<=1024*1024);
 const effects=[],host=await serveStandaloneSkillTools({directory,call:async(operation,received)=>{effects.push({operation,request_sha256:hash(JSON.stringify(received))});return {metrics_digest:received.input.video.metrics.digest,xml_sha256:hash(received.input.video.metrics.evidence.xml)};}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});
 assert.deepEqual(await callStandaloneSkillTool(host.connectionPath,'business',input),{ok:true,result:{metrics_digest:metrics.digest,xml_sha256:hash(xml)}});
 const c=JSON.parse(readFileSync(host.connectionPath)),serverReply=await raw(c,body);assert.equal(serverReply.status,200);assert.deepEqual(serverReply.body,{ok:true,result:{metrics_digest:metrics.digest,xml_sha256:hash(xml)}});
 assert.deepEqual(effects,[{operation:'business',request_sha256:hash(JSON.stringify(input))},{operation:'business',request_sha256:hash(JSON.stringify(input))}]);
});
test('requests above 4MiB are rejected by the client and real server without invoking the provider',async t=>{
 const {serveStandaloneSkillTools,callStandaloneSkillTool}=await load(),directory=dir(t);let effects=0;
 const host=await serveStandaloneSkillTools({directory,call:async()=>{effects++;return {};}});t.after(async()=>{await host.close();rmSync(directory,{recursive:true,force:true});});
 const input={evidence:{xml:'x'.repeat(4*1024*1024)}},body=JSON.stringify({operation:'business',input});assert.ok(Buffer.byteLength(body)>4*1024*1024);
 await assert.rejects(callStandaloneSkillTool(host.connectionPath,'business',input),error=>error.code==='IPC_REQUEST_INVALID');assert.equal(effects,0);
 const c=JSON.parse(readFileSync(host.connectionPath)),response=await raw(c,body);assert.equal(response.status,413);assert.deepEqual(response.body,{ok:false,error:'IPC_REQUEST_INVALID'});assert.equal(effects,0);
});
