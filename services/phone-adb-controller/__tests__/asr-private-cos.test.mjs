import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), legacyAsr=require('../transcribe-qwen-audio.js');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,options={}){
 const {createPrivateCosSource,PRIVATE_COS_CONFIG}=await import('../asr-private-cos.mjs');
 const {transcribeCompatible}=await import('../asr-protocol.mjs');
 const dir=fs.mkdtempSync(join(tmpdir(),'asr-private-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const audio=join(dir,'audio.wav'),bytes=Buffer.alloc(44+32000);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);fs.writeFileSync(audio,bytes);
 const scope={task_id:'11111111-1111-4111-8111-111111111111',run_id:'fixture-run',action_id:'asr-1',video_id:'1234567890123456789',owner:'fixture-owner',audio_sha256:sha(bytes)};
 let clock=1700000000000,object=null,version='fixture-version',privateAcl=true;const calls=[],audits=[];
 const request=async q=>{
  calls.push({...q,body:undefined});
  if(options.request)return options.request(q,{calls,bytes});
  const u=new URL(q.url);
  if(u.hostname==='dashscope.aliyuncs.com'){
   const body=JSON.parse(q.body);assert.equal(body.model,legacyAsr.MODEL);assert.equal(body.parameters.format,'wav');assert.equal(body.input.messages[0].content[0].type,'input_audio');assert.ok(body.input.messages[0].content[0].input_audio.data.startsWith('https://'));
   if(options.asrUnknown)throw Error('network SECRET_SIGNATURE');
   if(options.badJson)return {status:200,headers:{},body:Buffer.from('{')};
   const payload={output:{output:{sentence:{text:'已确认转写'}}},...(options.echo?{echo:body.input.messages[0].content[0].input_audio.data}: {})};
   return {status:200,headers:{'x-request-id':'fixture-request'},body:Buffer.from(JSON.stringify(payload))};
  }
  if(q.method==='PUT'){if(options.putUnknown)throw Error('PUT SECRET_SIGNATURE');object=Buffer.from(q.body);return {status:200,headers:{'x-cos-version-id':version},body:Buffer.alloc(0)};}
  if(q.method==='DELETE'){if(options.deleteUnknown)throw Error('delete SECRET_SIGNATURE');object=null;return {status:204,headers:{},body:Buffer.alloc(0)};}
  if(u.searchParams.has('acl'))return {status:200,headers:{},body:Buffer.from(privateAcl?'private':'public')};
  if(!q.headers?.Authorization)return {status:403,headers:{},body:Buffer.alloc(0)};
  if(q.method==='HEAD')return {status:object?200:404,headers:{'x-cos-version-id':version},body:Buffer.alloc(0)};
  return {status:200,headers:{'x-cos-version-id':options.wrongVersion?'foreign':version},body:options.badDigest?Buffer.from('bad'):object};
 };
 const config={...PRIVATE_COS_CONFIG},journalPath=join(dir,'source.json');
 const source=()=>createPrivateCosSource({config,scope,journalPath,deadlineMs:clock+120000,credentials:{SecretId:'fixture-id',SecretKey:'fixture-secret'},request,now:()=>clock,signer:()=>`q-sign-algorithm=sha1&q-ak=fixture-id&q-sign-time=${Math.floor(clock/1000)};${Math.floor(clock/1000)+180}&q-key-time=${Math.floor(clock/1000)};${Math.floor(clock/1000)+180}&q-header-list=host&q-url-param-list=&q-signature=SECRET_SIGNATURE`,parseAcl:b=>b.toString()==='private'});
 const run=()=>transcribeCompatible(audio,{legacyAsr,source:source(),apiKey:'fixture-key',audit:r=>{audits.push(r);fs.writeFileSync(join(dir,'response.json'),JSON.stringify(r));}});
 return {audio,bytes,scope,config,journalPath,calls,audits,run,source,clock:v=>clock=v,privateAcl:v=>privateAcl=v,transcribeCompatible,dir};
}
test('private COS preserves legacy contract and sends only verified URL once',async t=>{
 const f=await fixture(t);assert.equal(await f.run(),'已确认转写');
 assert.equal(f.calls.filter(x=>x.method==='PUT').length,1);assert.equal(f.calls.filter(x=>new URL(x.url).hostname==='dashscope.aliyuncs.com').length,1);
 const put=f.calls.find(x=>x.method==='PUT');assert.equal(put.headers['x-cos-acl'],'private');assert.equal(put.headers['x-cos-forbid-overwrite'],'true');
 assert.equal(f.calls.filter(x=>x.method==='DELETE').length,1);assert.equal(f.audits.length,1);
 assert.equal(await f.run(),'已确认转写');assert.equal(f.calls.filter(x=>x.method==='PUT').length,1);
});
for(const [name,option] of [['upload unknown','putUnknown'],['ASR unknown','asrUnknown'],['bad JSON','badJson']])test(name+' never resubmits or deletes unknown work',async t=>{
 const f=await fixture(t,{[option]:true});await assert.rejects(f.run);const before=f.calls.length;await assert.rejects(f.run);assert.equal(f.calls.length,before);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);
 assert.ok(!fs.readFileSync(f.journalPath,'utf8').includes('SECRET_SIGNATURE'));
});
for(const option of ['badDigest','wrongVersion'])test(option+' blocks ASR before dispatch',async t=>{
 const f=await fixture(t,{[option]:true});await assert.rejects(f.run);assert.equal(f.calls.filter(x=>new URL(x.url).hostname==='dashscope.aliyuncs.com').length,0);
});
test('nonprivate ACL blocks ASR',async t=>{const f=await fixture(t);f.privateAcl(false);await assert.rejects(f.run);assert.ok(!f.calls.some(x=>new URL(x.url).hostname==='dashscope.aliyuncs.com'));});
test('changed input and missing owner cannot upload',async t=>{
 const f=await fixture(t);f.scope.owner='';await assert.rejects(f.run);assert.equal(f.calls.length,0);f.scope.owner='fixture-owner';fs.appendFileSync(f.audio,'changed');await assert.rejects(f.run);assert.equal(f.calls.length,0);
});
test('confirmed transcript is durable before cleanup and survives cleanup failure',async t=>{
 const f=await fixture(t,{deleteUnknown:true});assert.equal(await f.run(),'已确认转写');const j=JSON.parse(fs.readFileSync(f.journalPath));assert.equal(j.cleanup,'unknown');assert.equal(j.text,'已确认转写');assert.equal(await f.run(),'已确认转写');assert.equal(f.calls.filter(x=>x.method==='PUT').length,1);
});
test('provider URL echoes and SDK errors never persist signatures or keys',async t=>{
 const f=await fixture(t,{echo:true});await f.run();for(const n of ['source.json','response.json']){const s=fs.readFileSync(join(f.dir,n),'utf8');assert.ok(!s.includes('SECRET_SIGNATURE'));assert.ok(!s.includes('fixture-secret'));assert.ok(!s.includes('q-sign-algorithm'));}
});
test('expired deadline and changed frozen configuration refuse before upload',async t=>{
 const f=await fixture(t);f.clock(1700000120001);const s=f.source();f.clock(1700000241002);await assert.rejects(()=>f.transcribeCompatible(f.audio,{legacyAsr,source:s,apiKey:'fixture',audit:()=>{}}));assert.equal(f.calls.length,0);
 f.config.bucket='other-bucket';assert.throws(f.source);assert.equal(f.calls.length,0);
});
test('deployment declares the actual source and protocol modules',()=>{
 const src=fs.readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');assert.match(src,/asr-private-cos\.mjs/);assert.match(src,/asr-protocol\.mjs/);
});
