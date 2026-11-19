import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture({usb=false,asr=true}={}){
 const f=await foundationFixture('102');
 try{
  const config=JSON.parse(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG));
  if(usb)config.bindings.customer.context.adb_serial=config.bindings.customer.context.serial;
  fs.writeFileSync(f.environment.LEADGEN_HOST_CONFIG,JSON.stringify(config));f.environment.LEADGEN_HOST_CONFIG_SHA256=hash(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG));
  const a=await prepareLeadgenHost(f),root=a.profile.cwd,c=a.context,run=c.tasks['102'].run_tag,video=c.verification['102'].video_ids[0],eid=run+'-v'+video+'-capture';
  const put=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),file=path.join(root,name);fs.writeFileSync(file,bytes,{mode:0o600});return {path:file,sha256:hash(bytes)};};
  const stage={evidence_id:eid,serial:c.adb_serial,owner:c.local_owner,execution_stop_unknown:false};
  const runtime=put('native/'+eid+'.capture-runtime.json',{stage});
  const receipt=command=>({task_id:c.tasks['102'].task_id,run_id:run,serial:c.serial,exit_code:0,args:[command,eid],stdout:'capture_runtime_evidence_sha256='+runtime.sha256});
  const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(100,i);
  const spec={serial:c.serial,local_owner:c.local_owner,runtime,start:put('receipts/start.json',receipt('record-start')),stop:put('receipts/stop.json',receipt('record-stop')),wav:put('native/'+eid+'.wav',wav)};
  if(asr)spec.asr=put('qualification-receipts/asr.json',{http_status:200,body:{request_id:'fixture-request',output:{output:{sentence:{text:'fixture transcript'}}}}});
  const proof=JSON.parse(fs.readFileSync(c.verification.proof_manifest_path));proof.qualification_evidence={[video]:spec};fs.writeFileSync(c.verification.proof_manifest_path,JSON.stringify(proof));
  const originals=new Map([c.verification.proof_manifest_path,...Object.values(spec).filter(x=>x&&typeof x==='object'&&x.path).map(x=>x.path)].map(file=>[file,fs.readFileSync(file)]));
  const {readFacts}=await import(pathToFileURL(path.join(root,'checker-facts.mjs'))),{factDependencies,readFrozenContext}=await import(pathToFileURL(path.join(root,'checker-facts-runtime.mjs')));
  const contextFile=path.join(root,'context.json'),contextSha=hash(fs.readFileSync(contextFile));let mediaReads=0;
  const deps={...factDependencies,readAuthority:async()=>readFrozenContext(contextFile,contextSha),mediaRead:async(...args)=>{mediaReads++;return factDependencies.mediaRead(...args);}};
  const read=(override={})=>readFacts({identity:c.tasks['102'],nonce:'recording-transport-fixture',context:{...c,...override},operation:'media.inspect',args:{name:path.basename(spec.wav.path)}},deps);
  return {f,a,spec,read,mediaReads:()=>mediaReads,assertOriginals:()=>{for(const[file,bytes]of originals)assert.deepEqual(fs.readFileSync(file),bytes);}};
 }catch(error){f.close();throw error;}
}
function noBusinessVerdict(r){for(const key of ['verified','outcome','checks','coverage_verified','qualification_verified']){assert.equal(r[key],undefined);assert.equal(r.facts?.[key],undefined);}}
for(const usb of [false,true])test('emitted fact provider preserves hardware and transport identities for '+(usb?'USB':'cloud transport'),async()=>{
 const f=await fixture({usb});try{
  const c=f.a.context,r=await f.read();assert.equal(r.status,'available',JSON.stringify(r));assert.equal(f.mediaReads(),1);
  assert.equal(r.facts.sha256,f.spec.wav.sha256);assert.ok(r.facts.metadata.streams.some(s=>s.codec_type==='audio'&&Number(s.sample_rate)===16000));
  assert.equal(f.spec.serial,c.serial);assert.equal(JSON.parse(fs.readFileSync(f.spec.runtime.path)).stage.serial,c.adb_serial);assert.equal(c.serial===c.adb_serial,usb);
  noBusinessVerdict(r);f.assertOriginals();
  assert.equal(fs.existsSync(path.join(f.a.profile.cwd,'production-readback-local.mjs')),false);assert.equal(fs.existsSync(path.join(f.a.profile.cwd,'native_artifacts.py')),false);
 }finally{f.f.close();}
});
for(const[key,value]of [['serial','foreign-hardware'],['adb_serial','foreign:15555'],['local_owner','foreign-owner']])test('frozen recording '+key+' cannot be replaced before any media read',async()=>{
 const f=await fixture();try{const r=await f.read({[key]:value});assert.equal(r.status,'unavailable');assert.equal(r.reason,'FACT_SCOPE_REJECTED');assert.equal(r.facts,null);assert.equal(f.mediaReads(),0);noBusinessVerdict(r);f.assertOriginals();}finally{f.f.close();}
});
test('media facts do not create missing ASR evidence or claim qualification success',async()=>{
 const f=await fixture({asr:false});try{
  const r=await f.read();assert.equal(r.status,'available',JSON.stringify(r));assert.equal(f.spec.asr,undefined);assert.deepEqual(fs.readdirSync(path.join(f.a.profile.cwd,'qualification-receipts')),['.keep']);noBusinessVerdict(r);f.assertOriginals();
  assert.ok(f.a.run.contract.activities.find(x=>x.key==='qualification').acceptance.document);
 }finally{f.f.close();}
});
