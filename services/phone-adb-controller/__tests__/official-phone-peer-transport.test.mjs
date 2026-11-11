import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPhonePeerOperationHost,createPhonePeerOperationClient,phonePeerStopped} from '../official-phone-peer-protocol.mjs';
import {createFixedPhonePeerTransport} from '../official-phone-peer-transport.mjs';
test('未请求尾帧即使SSH exit0也不能授予stop品牌',async()=>{
const key='independent-local-fixture-authentication-material';
const directory=realpathSync(mkdtempSync(join(tmpdir(),'peer-poison-review-')));
const session={protocol:'official-phone-peer-session/v1',session_id:randomUUID(),run_id:randomUUID(),task_id:randomUUID(),nonce:'a'.repeat(48),descriptor_sha256:'b'.repeat(64),source_commit:'c'.repeat(40),deadline_ms:Date.now()+5000};
const state={pending:0,active:false,execution_unknown:false};
const host=createPhonePeerOperationHost({session,key,directory,authorize:async()=>true,execute:async()=>null,snapshot:()=>state,seal:async()=>({execution_stopped:true})});
const child=new EventEmitter();child.pid=123456;child.stdout=new PassThrough();child.stderr=new PassThrough();
child.stdin=new Writable({write(bytes,encoding,done){
 host.handle(JSON.parse(bytes.toString())).then(reply=>{
  child.stdout.write(JSON.stringify(reply)+'\n');
  child.stdout.write('{"unrequested":true}\n');
  done();
 }).catch(done);
},final(done){queueMicrotask(()=>child.emit('close',0,null));done();}});
const descriptor={host:'xian-m4',runtime_root:'/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/'+session.source_commit+'/runtime',deployment:{source_commit:session.source_commit}};
const transport=createFixedPhonePeerTransport({descriptor,deadline_ms:session.deadline_ms,spawnProcess:()=>child});
const client=createPhonePeerOperationClient({session,key,exchange:transport.exchange,closeTransport:transport.close});
try{
 let proof,error;
 try{proof=await client.close();}catch(e){error=e.code??e.message;}
 assert.ok(error,'transport污染必须拒绝关闭');assert.equal(proof?phonePeerStopped(proof,session,client):false,false);
}finally{rmSync(directory,{recursive:true,force:true});}

});
