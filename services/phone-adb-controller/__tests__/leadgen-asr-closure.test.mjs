import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
import {sourceArchive} from '../leadgen-foundation/assembly.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

test('actual assembled 102 has the complete original ASR SDK closure and signs offline before any action',async()=>{
 const f=await foundationFixture('102');
 try{
  const a=await prepareLeadgenHost(f),root=path.join(a.profile.cwd,'asr-runtime');
  const {verifyAsrCosSdk}=await import(pathToFileURL(path.join(root,'asr-cos-dependencies.mjs')));
  const {manifest}=verifyAsrCosSdk();assert.equal(manifest.files.length,72);
  for(const item of manifest.files){const bytes=fs.readFileSync(path.join(root,'_dependencies/asr-cos',item.path));assert.equal(hash(bytes),item.sha256,item.path);}
  const {officialSign}=await import(pathToFileURL(path.join(root,'asr-cos-http.mjs')));
  const oldRequest=https.request,oldGet=https.get;let calls=0;
  try{
   https.request=https.get=()=>{calls++;throw Error('NETWORK_FORBIDDEN');};
   const signature=officialSign({SecretId:'offline-fixture',SecretKey:'offline-fixture',Method:'GET',Pathname:'/offline',KeyTime:'1700000000;1700000180'});
   assert.equal(new URLSearchParams(signature).get('q-sign-algorithm'),'sha1');assert.equal(calls,0);
  }finally{https.request=oldRequest;https.get=oldGet;}
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'receipts')),false);
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'qualification-receipts')),false);
  await a.verifySource();
 }finally{f.close();}
});

test('ASR locked tarball archive bytes are binary and reject malformed or unapproved encoding',()=>{
 const root=fs.mkdtempSync('/tmp/asr-archive-'),file=path.join(root,'archive.json');
 const name='_dependencies/asr-cos/tarballs/cos-nodejs-sdk-v5-3.0.0.tgz',bytes=Buffer.from([31,139,8,0,255,128,0,254]);
 const entry={encoding:'base64',source:bytes.toString('base64'),sha256:hash(bytes)};
 const write=(key,value)=>fs.writeFileSync(file,JSON.stringify({schema:'leadgen-host-source/v1',files:{[key]:value}}));
 try{
  write(name,entry);assert.deepEqual(sourceArchive(file)[name],bytes);
  for(const [key,value]of [[name,{...entry,source:entry.source+'\n'}],[name,{...entry,sha256:'0'.repeat(64)}],['arbitrary.bin',entry],[name,{...entry,encoding:'utf8'}]]){
   write(key,value);assert.throws(()=>sourceArchive(file),/SOURCE/);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('formal 102 preparation refuses incomplete frozen ASR before returning an executable host',async()=>{
 const f=await foundationFixture('102'),read=fs.readFileSync;
 const archive=new URL('../leadgen-foundation/sources/asr.json',import.meta.url);
 const broken=JSON.parse(read(archive));delete broken.files['_dependencies/asr-cos/node_modules/cos-nodejs-sdk-v5/sdk/util.js'];
 try{
  fs.readFileSync=function(file,...args){return String(file)===archive.pathname?JSON.stringify(broken):read.call(this,file,...args);};
  await assert.rejects(prepareLeadgenHost(f),/ASR_COS_DEPENDENCY_UNVERIFIED/);
  const host=path.join(f.profile.cwd,'.leadgen-run/host');assert.equal(fs.existsSync(path.join(host,'receipts')),false);
  assert.equal(fs.existsSync(path.join(host,'qualification-receipts')),false);
 }finally{fs.readFileSync=read;f.close();}
});

for(const kind of ['missing_text','extra_file','self_consistent_bad_tarball'])test('original SDK lock rejects '+kind+' during actual preparation',async()=>{
 const f=await foundationFixture('102'),read=fs.readFileSync;
 const archive=new URL('../leadgen-foundation/sources/asr.json',import.meta.url),broken=JSON.parse(read(archive));
 const prefix='_dependencies/asr-cos/';
 if(kind==='missing_text')delete broken.files[prefix+'node_modules/cos-nodejs-sdk-v5/LICENSE'];
 if(kind==='extra_file')broken.files[prefix+'unexpected.txt']={source:'extra',sha256:hash('extra')};
 if(kind==='self_consistent_bad_tarball'){
  const entry=broken.files[prefix+'tarballs/cos-nodejs-sdk-v5-3.0.0.tgz'],bytes=Buffer.from(entry.source,'base64');bytes[bytes.length-1]^=1;
  entry.source=bytes.toString('base64');entry.sha256=hash(bytes);
 }
 try{
  fs.readFileSync=function(file,...args){return String(file)===archive.pathname?JSON.stringify(broken):read.call(this,file,...args);};
  await assert.rejects(prepareLeadgenHost(f),/ASR_COS_DEPENDENCY_UNVERIFIED/);
  assert.equal(fs.existsSync(path.join(f.profile.cwd,'.leadgen-run/host/receipts')),false);
 }finally{fs.readFileSync=read;f.close();}
});
