import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPhonePeerOperationHost,createPhonePeerOperationClient,phonePeerStopped} from '../official-phone-peer-protocol.mjs';
const key='fixture-peer-authentication-material-20261111';
function fixture(t,extra={}){
 const directory=mkdtempSync(join(tmpdir(),'phone-peer-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
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
 const f=fixture(t);const proof=await f.client.close();assert.equal(phonePeerStopped(proof,f.session),true);assert.equal(phonePeerStopped({...proof},f.session),false);
});
