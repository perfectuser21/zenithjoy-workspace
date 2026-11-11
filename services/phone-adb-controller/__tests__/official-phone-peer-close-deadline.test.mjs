import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createPhonePeerOperationHost,createPhonePeerOperationClient,phonePeerStopped} from '../official-phone-peer-protocol.mjs';
test('模拟transport在原截止后归还时真实协议client不能授停止品牌',async()=>{
const key='independent-local-dummy-signing-material',directory=realpathSync(mkdtempSync(join(tmpdir(),'peer-expired-review-'))),session={protocol:'official-phone-peer-session/v1',session_id:randomUUID(),run_id:randomUUID(),task_id:randomUUID(),nonce:'a'.repeat(48),descriptor_sha256:'b'.repeat(64),source_commit:'c'.repeat(40),deadline_ms:Date.now()+150};
const host=createPhonePeerOperationHost({session,key,directory,authorize:async()=>true,execute:async()=>null,snapshot:()=>({pending:0,active:false,execution_unknown:false}),seal:async()=>({execution_stopped:true})});
const client=createPhonePeerOperationClient({session,key,exchange:host.handle,closeTransport:async()=>{await new Promise(r=>setTimeout(r,Math.max(1,session.deadline_ms-Date.now()+25)));return {closed:true,code:0};}});
try{let proof,error;try{proof=await client.close();}catch(e){error=e.message;}assert.equal(Date.now()>=session.deadline_ms,true);assert.equal(proof?phonePeerStopped(proof,session,client):false,false);assert.ok(error);}finally{rmSync(directory,{recursive:true,force:true});}

});
