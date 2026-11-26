// Real nofork C leaf, private parent IPC only; no ADB/phone/server operation.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {createConnection} from 'node:net';
import {startCollectionLeafProducer} from '../collection-leaf-producer.mjs';
async function rig(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'fenced-leaf-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));const binary=join(dir,'client'),marker=join(dir,'called');
 writeFileSync(binary+'.c','#include <stdio.h>\n#include <stdlib.h>\nint main(){FILE*f=fopen('+JSON.stringify(marker)+',"a");if(f){fputs("called\\n",f);fclose(f);}if(getenv("BRAIN_INTERNAL_TOKEN")||getenv("DATABASE_URL")||getenv("OPENAI_API_KEY"))return 13;puts("device");return 0;}');
 const cc=spawnSync('cc',[binary+'.c','-o',binary],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 const options={directory:dir,policy:{schema_version:2,instance_id:'fixture-fenced',adb_bin:binary,adb_realpath:binary,adb_sha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),endpoint:'tcp:127.0.0.1:12345'},serial:'NO-DEVICE',deadlineMs:Date.now()+15000,env:{PATH:'/usr/bin:/bin',HOME:dir}};
 const call=p=>new Promise((resolve,reject)=>{const c=createConnection(p.env.WFR_COLLECTION_LEAF_SOCKET);let raw='';c.on('error',reject);c.on('connect',()=>c.end(JSON.stringify({nonce:p.env.WFR_COLLECTION_LEAF_NONCE,argv:['-H','127.0.0.1','-P','12345','-s','NO-DEVICE','get-state']})));c.on('data',b=>raw+=b);c.on('end',()=>resolve(JSON.parse(raw)));});return {options,marker,call};
}
test('schema2 parent cannot admit a leaf without the fixed epoch validator',{skip:process.platform!=='darwin'},async t=>{
 const f=await rig(t);let p;try{await assert.rejects(async()=>{p=await startCollectionLeafProducer(f.options);},/COLLECTION_FENCED_ADMISSION_REQUIRED/);assert.equal(existsSync(f.marker),false);}finally{await p?.close();}
});
test('failed pre-leaf epoch admission does not launch the client',{skip:process.platform!=='darwin'},async t=>{
 const f=await rig(t),p=await startCollectionLeafProducer({...f.options,assertAdmission:async()=>{throw Object.assign(Error('EPOCH_FIXTURE_LOST'),{epochFenceLost:true});}});t.after(()=>p.close());const reply=await f.call(p);assert.equal(reply.ok,false);assert.equal(existsSync(f.marker),false);const end=await p.seal();assert.equal(end.epoch_fence_lost,true);assert.equal(end.leaves.length,0);
});
test('post-leaf epoch drift preserves its real close facts and prevents any following leaf',{skip:process.platform!=='darwin'},async t=>{
 const f=await rig(t);let checks=0;const p=await startCollectionLeafProducer({...f.options,assertAdmission:async()=>{if(++checks===2)throw Object.assign(Error('EPOCH_FIXTURE_LOST'),{epochFenceLost:true});}});t.after(()=>p.close());assert.equal((await f.call(p)).ok,false);assert.equal((await f.call(p)).ok,false);const end=await p.seal();assert.equal(end.epoch_fence_lost,true);assert.equal(end.leaves.length,1);assert.equal(end.leaves[0].code,0);assert.equal(end.leaves[0].request_returned,true);assert.equal(end.requests_returned,true,'new native leaf returned; epoch safety is a separate failed premise');
});
test('schema2 actual native client receives no Brain database or model credentials',{skip:process.platform!=='darwin'},async t=>{
 const f=await rig(t),p=await startCollectionLeafProducer({...f.options,env:{...f.options.env,BRAIN_INTERNAL_TOKEN:'fixture-only',DATABASE_URL:'fixture-only',OPENAI_API_KEY:'fixture-only'},assertAdmission:async()=>{}});t.after(()=>p.close());const reply=await f.call(p);assert.equal(reply.code,0,'private credentials must remain in the Code validator process');assert.equal((await p.seal()).complete,true);
});

async function requestLeaf(producer, argv, nonce=producer.env.WFR_COLLECTION_LEAF_NONCE){
 return new Promise((resolve,reject)=>{
  const socket=createConnection(producer.env.WFR_COLLECTION_LEAF_SOCKET);
  let reply='';
  socket.on('error',reject);
  socket.on('connect',()=>socket.end(JSON.stringify({nonce,argv})));
  socket.on('data',bytes=>reply+=bytes);
  socket.on('end',()=>resolve(JSON.parse(reply)));
 });
}

test('standalone local version keeps the native ledger and cannot connect or inherit the ADB route',{skip:process.platform!=='darwin'},async t=>{
 const f=await rig(t),binary=f.options.policy.adb_bin;
 writeFileSync(binary+'.c',`#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
int main(int argc,char **argv){
 if(argc!=2||strcmp(argv[1],"version")||getenv("ADB_SERVER_SOCKET"))return 9;
 int fd=socket(AF_INET,SOCK_STREAM,0);
 if(fd<0){if(errno!=EPERM&&errno!=EACCES)return 10;}
 else {
  struct sockaddr_in address={.sin_family=AF_INET,.sin_port=htons(1),.sin_addr={.s_addr=htonl(INADDR_LOOPBACK)}};
  if(connect(fd,(void*)&address,sizeof(address))==0||(errno!=EPERM&&errno!=EACCES))return 11;
 }
 puts("Android Debug Bridge version 1.0.41");return 0;
}`);
 const cc=spawnSync('cc',[binary+'.c','-o',binary],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 f.options.policy.adb_sha256=createHash('sha256').update(readFileSync(binary)).digest('hex');
 let guarded=0,local=0;
 const producer=await startCollectionLeafProducer({...f.options,
  assertAdmission:async()=>{guarded++;},
  beginLocalVersion:()=>({deadlineMs:f.options.deadlineMs,assertActive:()=>{local++;}}),
 });
 t.after(()=>producer.close());
 const result=await requestLeaf(producer,['version']);
 assert.equal(result.code,0,JSON.stringify(result));
 assert.equal(Buffer.from(result.stdout,'base64').toString(),'Android Debug Bridge version 1.0.41\n');
 assert.equal(guarded,0);
 assert.equal(local,2);
 const sealed=await producer.seal();
 assert.equal(sealed.complete,true);
 assert.equal(sealed.leaves.length,1);
 assert.equal(sealed.leaves[0].argv_sha256,createHash('sha256').update(JSON.stringify(['version'])).digest('hex'));
});

for(const revokedAt of [1,2]){
 test(`standalone local version does not affect actual device guard rejection at check ${revokedAt}`,{skip:process.platform!=='darwin'},async t=>{
  const f=await rig(t);let guarded=0,beforeDevice=0;
  const producer=await startCollectionLeafProducer({...f.options,
   assertAdmission:async()=>{
    assert.equal(beforeDevice,2);
    if(++guarded===revokedAt)throw Object.assign(Error('EPOCH_FIXTURE_LOST'),{epochFenceLost:true});
   },
   beginLocalVersion:()=>({deadlineMs:f.options.deadlineMs,assertActive:()=>{beforeDevice++;}}),
  });
  t.after(()=>producer.close());
  assert.equal((await requestLeaf(producer,['version'])).code,0);
  assert.equal(readFileSync(f.marker,'utf8'),'called\n');
  assert.equal((await f.call(producer)).ok,false);
  assert.equal((await f.call(producer)).ok,false);
  assert.equal(guarded,revokedAt);
  const sealed=await producer.seal();
  assert.equal(sealed.epoch_fence_lost,true);
  assert.equal(sealed.leaves.length,revokedAt);
  assert.equal(readFileSync(f.marker,'utf8'),'called\n'.repeat(revokedAt));
 });
}

test('standalone local version still rejects a wrong IPC nonce before a native launch',{skip:process.platform!=='darwin'},async t=>{
 const f=await rig(t);let guarded=0;
 const producer=await startCollectionLeafProducer({...f.options,assertAdmission:async()=>{guarded++;},
  beginLocalVersion:()=>({deadlineMs:f.options.deadlineMs,assertActive:()=>{guarded++;}}),
 });
 t.after(()=>producer.close());
 assert.equal((await requestLeaf(producer,['version'],'0'.repeat(48))).ok,false);
 assert.equal((await producer.seal()).leaves.length,0);
 assert.equal(existsSync(f.marker),false);
 assert.equal(guarded,0);
});
