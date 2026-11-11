import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,chmodSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {createPhonePeerOperationClient,phonePeerStopped} from '../official-phone-peer-protocol.mjs';
import {createFixedPhonePeerTransport} from '../official-phone-peer-transport.mjs';
test('PATH假ssh不得继承签名key并伪造真实peer关闭能力',async()=>{
const dir=realpathSync(mkdtempSync(join(tmpdir(),'independent-local-fake-ssh-'))),key='independent-dummy-key-not-production-credential';
const session={protocol:'official-phone-peer-session/v1',session_id:randomUUID(),run_id:randomUUID(),task_id:randomUUID(),nonce:'a'.repeat(48),descriptor_sha256:'b'.repeat(64),source_commit:'c'.repeat(40),deadline_ms:Date.now()+8000};
const source=`#!${process.execPath}
import {createInterface} from 'node:readline';
import {phonePeerEnvelope,peerHash,verifyPhonePeerEnvelope} from '${new URL('../official-phone-peer-protocol.mjs',import.meta.url).href}';
const session=JSON.parse(process.env.LOCAL_DUMMY_SESSION),key=process.env.KERNEL_FLEET_BRIDGE_TOKEN;
for await(const line of createInterface({input:process.stdin})){const q=verifyPhonePeerEnvelope(JSON.parse(line),key);const result={protocol:'official-phone-peer-result/v1',status:'completed',scope_sha256:peerHash(session),operation_id:q.operation_id,sequence:q.sequence,request_sha256:peerHash(q),input_sha256:q.input_sha256,operation:q.operation,source_commit:session.source_commit,descriptor_sha256:session.descriptor_sha256,host:'xian-m4',host_identity:null,start_ms:Date.now(),end_ms:Date.now(),result:{execution_stopped:true},state:{pending:0,active:false,execution_unknown:false},physical_sealed:true};process.stdout.write(JSON.stringify(phonePeerEnvelope(result,key))+'\\n');}
`;
try{const path=join(dir,'ssh');writeFileSync(path,source.replaceAll("+'\\\\n'","+'\\n'"));chmodSync(path,0o700);
const transport=createFixedPhonePeerTransport({ssh:{path:'/usr/bin/ssh',sha256:(await import('node:crypto')).createHash('sha256').update(readFileSync('/usr/bin/ssh')).digest('hex')},descriptor:{host:'xian-m4',runtime_root:'/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/'+session.source_commit+'/runtime',deployment:{source_commit:session.source_commit}},deadline_ms:session.deadline_ms,environment:{PATH:dir,KERNEL_FLEET_BRIDGE_TOKEN:key,LOCAL_DUMMY_SESSION:JSON.stringify(session)}});
const client=createPhonePeerOperationClient({session,key,exchange:transport.exchange,closeTransport:transport.close});let proof,error;try{proof=await client.close();}catch(e){error=e.message;}
assert.equal(proof?phonePeerStopped(proof,session,client):false,false,'0真实SSH/M4不能品牌化');assert.ok(error);
}finally{rmSync(dir,{recursive:true,force:true});}

});
