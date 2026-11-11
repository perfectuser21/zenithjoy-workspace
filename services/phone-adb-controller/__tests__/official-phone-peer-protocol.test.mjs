import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPhonePeerOperationHost,createPhonePeerOperationClient,phonePeerStopped} from '../official-phone-peer-protocol.mjs';
const key='fixture-peer-authentication-material-20261111';
function fixture(t,extra={}){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'phone-peer-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const session={protocol:'official-phone-peer-session/v1',session_id:randomUUID(),run_id:randomUUID(),task_id:randomUUID(),nonce:'a'.repeat(48),descriptor_sha256:'b'.repeat(64),source_commit:'c'.repeat(40),deadline_ms:Date.now()+60000};
 let calls=0;const state={active:false,pending:0,execution_unknown:false};
 const host=createPhonePeerOperationHost({session,key,directory,authorize:async()=>true,execute:async(operation,input)=>{calls++;return {operation,input};},snapshot:()=>state,seal:async()=>({execution_stopped:!state.active}),...extra});
 const client=createPhonePeerOperationClient({session,key,exchange:request=>host.handle(request),closeTransport:async()=>({code:0,signal:null,closed:true})});
 return {session,host,client,state,calls:()=>calls};
}
test('远端同一op只执行一次；失ACK只能读回原op，不能再次执行',async t=>{
 const f=fixture(t),id=randomUUID();const first=await f.client.request('phone',{command:'status',args:[]},{operationId:id});
 const second=await f.client.readOperation(id);assert.deepEqual(second,first);assert.equal(f.calls(),1);
 await assert.rejects(()=>f.client.request('phone',{command:'wake',args:[]},{operationId:id}));assert.equal(f.calls(),1);
});
test('SSH exit0不能把仍活的远端producer变成closed能力',async t=>{
 const f=fixture(t);f.state.active=true;await assert.rejects(()=>f.client.close());assert.equal(phonePeerStopped({},f.session),false);
});
test('只有已封闭producer、完整签名回执和真实transport close同时成立才授本实例能力',async t=>{
 const f=fixture(t);const proof=await f.client.close();assert.equal(phonePeerStopped(proof,f.session,f.client),true);assert.equal(phonePeerStopped({...proof},f.session,f.client),false);
});
test('失ACK保留原op且禁止后继动作，读回成功后才恢复，不重放',async t=>{
 const f=fixture(t);let lose=true;const client=createPhonePeerOperationClient({session:f.session,key,exchange:async q=>{const response=await f.host.handle(q);if(lose){lose=false;throw Error('ACK_LOST');}return response;},closeTransport:async()=>({closed:true,code:0})});
 const id=randomUUID();await assert.rejects(client.request('phone',{command:'tap',args:['10','20']},{operationId:id}),/ACK_UNKNOWN/);assert.equal(f.calls(),1);assert.equal(client.snapshot().pending_operation_id,id);
 await assert.rejects(client.request('phone',{command:'tap',args:['10','20']}),/CLOSED/);assert.equal(f.calls(),1);await client.readOperation(id);assert.equal(f.calls(),1);assert.equal(client.snapshot().pending_operation_id,null);
});
test('错误签名、nonce、来源或序号在任何物理动作前拒绝',async t=>{
 const f=fixture(t);const {phonePeerEnvelope,peerHash}=await import('../official-phone-peer-protocol.mjs');
 const q={protocol:'official-phone-peer-operation/v1',scope_sha256:peerHash(f.session),operation_id:randomUUID(),sequence:1,operation:'phone',input:{command:'status',args:[]},deadline_ms:f.session.deadline_ms};q.input_sha256=peerHash(q.input);
 await assert.rejects(f.host.handle(phonePeerEnvelope(q,key+'wrong')),/SIGNATURE/);
 for(const patch of [{scope_sha256:peerHash({...f.session,nonce:'d'.repeat(48)})},{scope_sha256:peerHash({...f.session,source_commit:'d'.repeat(40)})},{sequence:2},{deadline_ms:q.deadline_ms+1}])await assert.rejects(f.host.handle(phonePeerEnvelope({...q,...patch},key)));
 assert.equal(f.calls(),0);
});
test('原claim撤销和过期session不能产生新物理动作',async t=>{
 let authorized=false;const f=fixture(t,{authorize:async()=>authorized});await assert.rejects(f.client.request('phone',{command:'status',args:[]}),error=>error.cause?.code==='OFFICIAL_PHONE_PEER_AUTHORITY');assert.equal(f.calls(),0);
});
test('SSH断连与非零退出即使producer已sealed也不能品牌化',async t=>{
 const f=fixture(t);const client=createPhonePeerOperationClient({session:f.session,key,exchange:q=>f.host.handle(q),closeTransport:async()=>({closed:true,code:255,signal:null})});await assert.rejects(client.close(),/TRANSPORT_CLOSE/);assert.equal(phonePeerStopped({},f.session),false);
});
