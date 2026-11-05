import {preflightTestPython} from './helpers/preflight-test-python.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {dirname} from 'node:path';
import {privatePgSsh} from './helpers/preflight-private-pg-ssh.mjs';
for(const kind of ['SSH','local','ADB'])test('no '+kind+' second calibration spawn after the first probe consumes the original deadline',{skip:process.platform!=='darwin'},async t=>{
 const f=await privatePgSsh(t),originalSpawn=cp.spawn,originalNow=Date.now;let clock=originalNow(),spawned=0;
 t.after(()=>{Date.now=originalNow;cp.spawn=originalSpawn;syncBuiltinESMExports();});
 Date.now=()=>clock;
 cp.spawn=(...args)=>{const p=originalSpawn(...args);if(args[0]==='/usr/bin/sandbox-exec'){spawned++;p.once('close',()=>{clock+=2000;});}return p;};syncBuiltinESMExports();
 if(kind==='SSH'){
  const {createPreflightPgStream}=await import('../preflight-pg-stream.mjs');
  await assert.rejects(()=>createPreflightPgStream({directory:f.directory,policy:f.policy,deadlineMs:clock+1000}),/PREFLIGHT_TRANSPORT_DEADLINE/);
 }else if(kind==='local'){
  const {startPreflightLocalLeaves}=await import('../preflight-local-leaves.mjs'),root=dirname(new URL('../leadgen-handlers.mjs',import.meta.url).pathname),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
  await assert.rejects(()=>startPreflightLocalLeaves({root,directory:f.directory,python:{path:preflightTestPython,sha256:sha(preflightTestPython)},sourceFiles:{'preflight-local-step.py':sha(root+'/preflight-local-step.py')},deadlineMs:clock+1000}),/PREFLIGHT_LOCAL_CLOSED/);
 }else{
  const {startCollectionLeafProducer}=await import('../collection-leaf-producer.mjs'),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
  let opened;try{await assert.rejects(()=>startCollectionLeafProducer({directory:f.directory,policy:{adb_bin:'/usr/bin/true',adb_sha256:sha('/usr/bin/true'),endpoint:'tcp:127.0.0.1:12345'},serial:'SERIAL',deadlineMs:clock+10000,admissionDeadlineMs:clock+1000}).then(value=>{opened=value;return value;}),/COLLECTION_LEAF_ADMISSION_DEADLINE/);}finally{await opened?.close();}
 }
 assert.equal(spawned,1,'expired calibration must not start another actual native leaf');
});
