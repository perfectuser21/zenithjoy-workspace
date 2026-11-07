import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync,realpathSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createAdbShellV2Observer} from '../adb-shell-v2.mjs';
import {createNativePhoneAdbRead} from '../native-phone-adb-read.mjs';
const root=dirname(fileURLToPath(new URL('../adb-shell-v2.mjs',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
const syncFrame=(id,b=Buffer.alloc(0))=>{const h=Buffer.alloc(8);h.write(id);h.writeUInt32LE(b.length,4);return Buffer.concat([h,b]);};
const shellFrame=(id,b)=>{const h=Buffer.alloc(5);h[0]=id;h.writeUInt32LE(b.length,1);return Buffer.concat([h,b]);};
async function fixture(t,kind,{atTransport,atResult,split=false}={}){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'adb-inflight-'))),sockets=new Set(),requests=[];let calls=0,revoked=false,lease=Date.now()+5000;
 const extra='inflight-test-'+randomUUID()+'.txt';writeFileSync(join(root,extra),'original',{mode:0o600});
 t.after(()=>{unlinkSync(join(root,extra));rmSync(directory,{recursive:true,force:true});});
 const reply=(socket,bytes)=>{if(!split){socket.write(bytes);return;}let i=0;const next=()=>{if(socket.destroyed)return;if(i<bytes.length){socket.write(bytes.subarray(i,i+1));i++;setImmediate(next);}};next();};
 const server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0),sync=false,shell=false;socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length){if(shell){if(buffer.length<5)return;const n=buffer.readUInt32LE(1);if(buffer.length<5+n)return;buffer=buffer.subarray(5+n);requests.push('stdin-close');atResult?.(f);const bytes=Buffer.concat([shellFrame(1,Buffer.from('actual-output')),shellFrame(3,Buffer.from([0]))]);reply(socket,bytes);setTimeout(()=>socket.end(),split?50:1);return;}if(sync){if(buffer.length<8)return;const id=buffer.subarray(0,4).toString(),n=buffer.readUInt32LE(4);if(buffer.length<8+n)return;buffer=buffer.subarray(8+n);requests.push(id);if(id==='RECV'){atResult?.(f);reply(socket,Buffer.concat([syncFrame('DATA',Buffer.from('actual-file')),syncFrame('DONE')]));}else socket.end();continue;}
 if(buffer.length<4)return;const n=parseInt(buffer.subarray(0,4).toString(),16);if(buffer.length<4+n)return;const service=buffer.subarray(4,4+n).toString();buffer=buffer.subarray(4+n);requests.push(service);
 if(service.endsWith(':features')){socket.end('OKAY0008shell_v2');return;}socket.write('OKAY');if(service.startsWith('host:transport:'))atTransport?.(f);else if(service==='sync:')sync=true;else if(service.startsWith('shell,v2,raw:'))shell=true;
 }});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const scope={protocol:kind==='shell'?'adb-shell-v2-observation/v1':'native-phone-adb-read/v1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',run_id:'inflight-fixture',source_commit:'a'.repeat(40),serial:'fixture',profile:'fixture',endpoint:'tcp:127.0.0.1:'+server.address().port,epoch:1,claim:{claimed_by:'fixture',claimed_at:'2026-11-06T00:00:00.000Z'},worker_deadline_ms:Date.now()+2000,cleanup_deadline_ms:Date.now()+2500};
 const files=['adb-shell-v2.mjs','adb-shell-v2-protocol.mjs','native-phone-adb-read.mjs','runtime-definition.mjs',extra];
 const source={commit:scope.source_commit,files:files.map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
 const authority=async()=>{calls++;return {scope,claimed_by:revoked?'revoked':scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(lease).toISOString()};};
 const observer=(kind==='shell'?createAdbShellV2Observer:createNativePhoneAdbRead)({runtimeRoot:root,directory,source,scope,readAuthority:authority});
 const f={observer,requests,scope,run:()=>kind==='shell'?observer.observeDump():observer.read('/system/bin/uiautomator'),calls:()=>calls,revoke:()=>{revoked=true;},expire:()=>{lease=Date.now()-1;},mutate:()=>writeFileSync(join(root,extra),'changed')};t.after(()=>observer.close());return f;
}
for(const kind of ['shell','read']){
 test(kind+' frame fragmentation reuses only its owned inflight admission',async t=>{const f=await fixture(t,kind,{split:true});await f.run();assert.equal(f.observer.snapshot().unknown,false);assert.equal(f.calls(),kind==='shell'?7:6);});
 test(kind+' transport ACK revocation prevents physical request write',async t=>{const f=await fixture(t,kind,{atTransport:f=>f.revoke()});await assert.rejects(f.run(),/AUTHORITY/);assert.equal(f.requests.some(x=>x==='RECV'||x.startsWith('shell,v2,raw:')),false);assert.equal(f.observer.snapshot().unknown,true);});
 for(const change of ['revoke','mutate'])test(kind+' '+change+' during response cannot mint receipt or resend',async t=>{const f=await fixture(t,kind,{atResult:f=>f[change]()});await assert.rejects(f.run(),change==='revoke'?/AUTHORITY/:/SOURCE/);const count=f.requests.length;await assert.rejects(f.run());assert.equal(f.requests.length,count);assert.equal(f.observer.snapshot().unknown,true);});
 test(kind+' seal during response rejects late bytes and stays unknown',async t=>{const f=await fixture(t,kind,{atResult:f=>f.observer.seal(),split:true});await assert.rejects(f.run());await new Promise(r=>setTimeout(r,70));assert.equal(f.observer.snapshot().unknown,true);});
}
