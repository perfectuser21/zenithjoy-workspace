import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,lstatSync,existsSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
const load=()=>import('../standalone-skill-ipc.mjs');
function dir(t){const d=mkdtempSync(join(realpathSync(tmpdir()),'skill-ipc-test-'));chmodSync(d,0o700);return d;}
function raw(c,body,{nonce=c.nonce,method='POST'}={}){return new Promise((resolve,reject)=>{const req=request({socketPath:c.socket,path:'/tool',method,headers:{'content-type':'application/json','x-standalone-nonce':nonce}},res=>{let b='';res.on('data',x=>b+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)}));});req.on('error',reject);req.end(body);});}
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
 for(const [body,options,status]of [[JSON.stringify({operation:'phone',input:{}}),{nonce:'incorrect'},403],[JSON.stringify({operation:'phone',input:{},override:'secret'}),{},400],['{bad',{},400],[JSON.stringify({operation:'phone',input:{}}),{method:'GET'},400],[JSON.stringify({operation:'phone',input:{text:'a'.repeat(65536)}}),{},413]]){
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
