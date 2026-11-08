// Real nofork C leaf, private parent IPC only; no ADB/phone/server operation.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {createConnection} from 'node:net';
import {startCollectionLeafProducer} from '../collection-leaf-producer.mjs';
async function rig(t){
 const dir=mkdtempSync(join(tmpdir(),'fenced-leaf-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const binary=join(dir,'client'),marker=join(dir,'called');
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
