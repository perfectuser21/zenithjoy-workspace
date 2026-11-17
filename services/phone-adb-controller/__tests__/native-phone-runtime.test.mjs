import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {usingNativePhonePublic} from './fixtures/native-phone-public-fixture.mjs';
import {freezePublicPhoneDefinition} from './fixtures/native-phone-public-definition-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Prepare the actual runtime and its branded preflight provider. Only the lease
// fixture uses loopback HTTP; no phone, model, PG pool or worker is launched.
async function prepared(t,check){
 return usingNativePhonePublic(t,async f=>{
  const load=name=>import(pathToFileURL(join(f.runtimeRoot,name))),scope=await load('preflight-control-scope.mjs');
  const user=os.userInfo();t.mock.method(os,'userInfo',()=>({...user,homedir:f.env.HOME}));syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  fs.mkdirSync(join(f.env.HOME,'.credentials'),{recursive:true,mode:0o700});
  fs.writeFileSync(join(f.env.HOME,'.credentials/zenithjoy-db.env'),'DATABASE_URL=postgresql://postgres:fixture@127.0.0.1:15532/cecelia_scratch\n',{mode:0o600});
  fs.writeFileSync(join(f.runtimeRoot,'config/preflight-control-hosts.json'),JSON.stringify({version:1,database_identity:{database:'cecelia_scratch',role:'postgres',system_identifier:'1'},hosts:[{target:'mmv',home:f.env.HOME,mode:'local'}]}));
  const profiles=join(f.journalDirectory,'profiles.tsv'),keywords=join(f.journalDirectory,'keywords');
  fs.writeFileSync(profiles,`profile\tserial\tmodel\twidth\theight\tenabled\n${f.q.profile}\t${f.q.serial}\tFixture\t720\t1280\ttrue\n`);
  fs.writeFileSync(keywords,'人工智能\n');
  Object.assign(f.env,{DOUYIN_PHONE_REGISTRY:profiles,LEADGEN_SOURCE_KIND:'keyword',LEADGEN_SOURCES_FILE:keywords});
  const policyPath=join(f.runtimeRoot,'config/native-phone-command-sources.json'),policy=JSON.parse(fs.readFileSync(policyPath));
  policy.device_sources.find(row=>row.profile===f.q.profile).serial=f.q.serial;
  fs.writeFileSync(policyPath,JSON.stringify(policy));
  const native=await load('native-phone-runtime.mjs'),names=[...new Set([...f.source.files.map(row=>row.path),...native.NATIVE_PHONE_FILES])];
  const manifest={source_repo:'perfectuser21/zenithjoy-workspace',source_commit:f.source.commit,target:'mmv',files:names.map(path=>({path:'services/phone-adb-controller/'+path,deployed_path:path,content_sha256:sha(fs.readFileSync(join(f.runtimeRoot,path)))}))};
  fs.writeFileSync(join(f.runtimeRoot,'deployment-manifest.json'),JSON.stringify(manifest));
  const definition=await freezePublicPhoneDefinition(t,f,{env:f.env,manifest,extraFrozen:{preflight_pg:(await load('preflight-pg-dependencies.mjs')).preflightPgLockIdentity({runtimeRoot:f.runtimeRoot}),preflight_control_scope:scope.freezePreflightControlScope({root:f.runtimeRoot,env:f.env}),preflight_profile:scope.freezePreflightProfile({env:f.env}),discovery_phone_scope:{task_id:f.q.task_id,run_id:f.q.run_id,source_commit:f.source.commit,profile:f.q.profile,serial:f.q.serial,policy:{endpoint:'tcp:127.0.0.1:1'}}}});
  const poolFactory=()=>{throw Error('NO_DATABASE_ALLOWED');},preflight=(await load('preflight-phone-scope.mjs')).createPreflightRuntime({root:f.runtimeRoot,env:f.env,...definition,taskId:f.q.task_id,poolFactory});
  const runtime=native.createNativePhoneRuntime({root:f.runtimeRoot,env:f.env,frozen:definition.frozen,binding:definition.binding,taskId:f.q.task_id,preflightRuntime:preflight,poolFactory});
  await runtime.prepare();assert.equal(runtime.snapshot().prepared,true);
  try{await check({runtime,root:f.runtimeRoot});}finally{await preflight.metadata.close();}
 });
}

test('each runtime admission keeps the snapshot scan and one fresh source scan without duplicate reads',async t=>prepared(t,async({runtime,root})=>{
 const paths=['leadgen-queue.js','leadgen-db-lib.js','nickname-match-lib.js'].map(name=>join(root,name)),counts=new Map(),read=fs.readFileSync;
 t.mock.method(fs,'readFileSync',function(path,...args){if(paths.includes(path))counts.set(path,(counts.get(path)||0)+1);return read(path,...args);});
 syncBuiltinESMExports();
 try{
  for(let admission=1;admission<=2;admission++){
   assert.equal(runtime.supports({key:'preflight'}),true);
   // readFrozen independently validates every frozen file; source admission
   // then performs its own fresh metadata/content check, without a third scan.
   for(const path of paths)assert.equal(counts.get(path),2*admission,`${path}: snapshot plus one fresh source read per admission`);
  }
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
}));

for(const drift of ['same-size-content','permissions','symlink'])test(`next runtime admission rejects ${drift} drift after a successful check`,async t=>prepared(t,async({runtime,root})=>{
 const path=join(root,'leadgen-queue.js'),bytes=fs.readFileSync(path),stat=fs.statSync(path),copy=join(root,'..','original-queue');
 assert.equal(runtime.supports({key:'preflight'}),true);
 try{
  if(drift==='same-size-content'){const changed=Buffer.from(bytes);changed[changed.length-1]^=1;fs.writeFileSync(path,changed);fs.utimesSync(path,stat.atime,stat.mtime);}
  else if(drift==='permissions')fs.chmodSync(path,0o666);
  else{fs.renameSync(path,copy);fs.symlinkSync(copy,path);}
  assert.equal(runtime.supports({key:'preflight'}),false,'changed dependency must not grant an activity');
 }finally{
  if(drift==='symlink'){fs.unlinkSync(path);fs.renameSync(copy,path);}
  else{fs.writeFileSync(path,bytes);fs.chmodSync(path,stat.mode&0o777);}
 }
 assert.equal(runtime.supports({key:'preflight'}),true,'restored bytes are reread rather than a cached verdict');
}));
