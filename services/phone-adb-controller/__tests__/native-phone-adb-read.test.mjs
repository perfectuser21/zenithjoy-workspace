import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const module=await import('../native-phone-adb-read.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url===new URL('../native-phone-adb-read.mjs',import.meta.url).href)return {};throw e;});
const root=dirname(fileURLToPath(new URL('../native-phone-runtime.mjs',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
function frame(id,bytes=Buffer.alloc(0)){const h=Buffer.alloc(8);h.write(id);h.writeUInt32LE(bytes.length,4);return Buffer.concat([h,bytes]);}
async function fixture(t,{fault,file='/system/bin/uiautomator'}={}){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'native-adb-read-'))),sockets=new Set(),requests=[];t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const serial='47.100.213.173:10001',payload=Buffer.from('#!/system/bin/sh\nexec app_process fixture\n');
 const server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let phase=0,buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){if(phase<2){if(buffer.length<4)return;const n=parseInt(buffer.subarray(0,4).toString(),16);if(buffer.length<4+n)return;const service=buffer.subarray(4,4+n).toString();buffer=buffer.subarray(4+n);requests.push(service);assert.equal(service,phase===0?'host:transport:'+serial:'sync:');phase++;socket.write('OKAY');}else{if(buffer.length<8)return;const id=buffer.subarray(0,4).toString(),n=buffer.readUInt32LE(4);if(buffer.length<8+n)return;const path=buffer.subarray(8,8+n).toString();buffer=buffer.subarray(8+n);requests.push({id,path});if(id==='RECV'){assert.equal(path,file);if(fault==='fail'){socket.end(frame('FAIL',Buffer.from('fixture-error-do-not-log')));return;}if(fault==='partial'){socket.end(frame('DATA',payload).subarray(0,10));return;}socket.write(frame('DATA',payload));if(fault!=='missing-done')socket.write(frame('DONE'));if(fault==='trailing')socket.write(frame('DATA',Buffer.from('late')));}else{assert.equal(id,'QUIT');assert.equal(n,0);if(fault!=='missing-close')socket.end();return;}}}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const scope={protocol:'native-phone-adb-read/v1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',run_id:'douyin_video_discovery-fixture__a1',source_commit:'a'.repeat(40),profile:'fixture',serial,epoch:1,endpoint:'tcp:127.0.0.1:'+server.address().port,worker_deadline_ms:Date.now()+700,cleanup_deadline_ms:Date.now()+1100,claim:{claimed_by:'fixture-code',claimed_at:'2026-11-06T00:00:00.000Z'}};
 const source={commit:scope.source_commit,files:['native-phone-adb-read.mjs','adb-shell-v2-protocol.mjs','runtime-definition.mjs'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
 const authority=async()=>({scope,claimed_by:scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(Date.now()+5000).toISOString()});
 return {directory,scope,source,authority,requests,payload,file};
}
test('fixed read-only RECV consumes DATA/DONE then QUIT and real peer EOF/close; JSON cannot forge receipt',async t=>{
 assert.equal(typeof module.createNativePhoneAdbRead,'function');const f=await fixture(t),reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:f.authority});
 try{const receipt=await reader.read(f.file);assert.deepEqual(reader.readReceipt(receipt,{scope:f.scope}).bytes,f.payload);assert.throws(()=>reader.readReceipt({...receipt},{scope:f.scope}),/NATIVE_PHONE_READ_BRAND/);assert.deepEqual(f.requests.filter(v=>typeof v==='object'),[{id:'RECV',path:f.file},{id:'QUIT',path:''}]);const end=await reader.close();assert.equal(end.pending,0);assert.equal(end.channel_stopped,true);assert.equal(end.remote_execution_stopped,'not_attested');}finally{await reader.close();}
});
for(const fault of ['fail','partial','missing-done','trailing','missing-close'])test(`RECV ${fault} is sticky unknown without resend`,async t=>{
 assert.equal(typeof module.createNativePhoneAdbRead,'function');const f=await fixture(t,{fault}),reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:f.authority});
 try{await assert.rejects(reader.read(f.file),/NATIVE_PHONE_READ/);await assert.rejects(reader.read(f.file),/NATIVE_PHONE_READ/);const end=await reader.close();assert.equal(end.unknown,true);assert.equal(end.channel_stopped,false);assert.ok(f.requests.filter(v=>v.id==='RECV').length<=1);}finally{await reader.close();}
});
test('exact authority serial mismatch refuses before any socket write',async t=>{
 assert.equal(typeof module.createNativePhoneAdbRead,'function');const f=await fixture(t),reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:async()=>({...await f.authority(),scope:{...f.scope,serial:'other'}})});
 try{await assert.rejects(reader.read(f.file),/NATIVE_PHONE_READ_AUTHORITY/);assert.equal(f.requests.length,0);}finally{await reader.close();}
});
test('last authority remains in the original deadline pipeline after peer channel already closed',async t=>{
 assert.equal(typeof module.createNativePhoneAdbRead,'function');const f=await fixture(t);f.scope.worker_deadline_ms=Date.now()+500;f.scope.cleanup_deadline_ms=Date.now()+800;let release,reached;
 const waiting=new Promise(r=>{release=r;}),atFinal=new Promise(r=>{reached=r;});
 const reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:async()=>{if(f.requests.some(v=>v.id==='QUIT')){reached();await waiting;}return f.authority();}});
 try{const work=reader.read(f.file),rejected=assert.rejects(work,/NATIVE_PHONE_READ_(DEADLINE|UNKNOWN)/);await atFinal;await rejected;const end=await reader.close();assert.equal(end.pending,1);assert.equal(end.unknown,true);assert.equal(end.channel_stopped,false);assert.equal(f.requests.filter(v=>v.id==='RECV').length,1);}
 finally{release();await reader.close();await new Promise(setImmediate);assert.equal(reader.snapshot().pending,0);assert.equal(reader.snapshot().unknown,true);assert.equal(reader.snapshot().channel_stopped,false);}
});
test('wrong source and unapproved paths or expired admission cannot allocate a target connection',async t=>{
 assert.equal(typeof module.createNativePhoneAdbRead,'function');const f=await fixture(t);
 assert.throws(()=>module.createNativePhoneAdbRead({runtimeRoot:root,source:{...f.source,files:f.source.files.map(x=>({...x,sha256:'0'.repeat(64)}))},directory:f.directory,scope:f.scope,readAuthority:f.authority}),/NATIVE_PHONE_READ_SOURCE/);
 const reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:f.authority});
 try{for(const path of ['/data/local/tmp/secret','/system/bin/../data/secret','/system/bin/uiautomator\u0000x'])await assert.rejects(reader.read(path),/NATIVE_PHONE_READ_PATH/);assert.equal(f.requests.length,0);}finally{await reader.close();}
 const expired=await fixture(t);expired.scope.worker_deadline_ms=Date.now()-1;expired.scope.cleanup_deadline_ms=Date.now()+100;
 const inactive=module.createNativePhoneAdbRead({runtimeRoot:root,source:expired.source,directory:expired.directory,scope:expired.scope,readAuthority:expired.authority});
 try{await assert.rejects(inactive.read(expired.file),/NATIVE_PHONE_READ_DEADLINE/);assert.equal(expired.requests.length,0);}finally{await inactive.close();}
});

for(const file of ['/system/bin/sh','/system/framework/monkey.jar','/system/framework/android.test.runner.jar'])test('reviewed finite ROM dependency consumes actual bounded RECV '+file,async t=>{
 const f=await fixture(t,{file}),reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:f.authority});
 try{const cap=await reader.read(file);assert.deepEqual(reader.readReceipt(cap,{scope:f.scope}).bytes,f.payload);assert.equal((await reader.close()).channel_stopped,true);assert.equal(f.requests.filter(v=>v.id==='RECV').length,1);}finally{await reader.close();}
});
test('nearby undeclared ROM framework path remains rejected without target IO',async t=>{
 const f=await fixture(t),reader=module.createNativePhoneAdbRead({runtimeRoot:root,source:f.source,directory:f.directory,scope:f.scope,readAuthority:f.authority});try{await assert.rejects(reader.read('/system/framework/framework.jar'),/PATH/);assert.equal(f.requests.length,0);}finally{await reader.close();}
});
