import test from 'node:test';
import assert from 'node:assert/strict';
import {usingNativePhonePublic,startNativePhoneAdbFixture,startNativePhoneGatewayFixture} from './fixtures/native-phone-public-fixture.mjs';
import {nativePhonePublicPgFixture} from './fixtures/native-phone-public-pg-fixture.mjs';
import {freezePublicPhoneDefinition} from './fixtures/native-phone-public-definition-fixture.mjs';
import {publicPhoneScenario} from './fixtures/native-phone-public-scenario.mjs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
test('public 101 runs original three slots through Commander, real Code transports, PG Judge and cleanup',async t=>{await publicPhoneScenario(t);});
test('a genuinely closed official Caller without a raw model stop proof cannot authorize native cleanup',async t=>{await publicPhoneScenario(t,{invalidStop:true});});
test('a cloned genuine SDK raw model stop proof cannot authorize native cleanup despite actual Caller closure',async t=>{await publicPhoneScenario(t,{invalidStop:'clone'});});
test('real executor missing model startup closes only its unused metadata and proves no local execution',async t=>{await publicPhoneScenario(t,{earlyModelFailure:true});});
test('full public Runner always cleans only unused resources after genuine model startup failure with closed Commander',async t=>{await publicPhoneScenario(t,{earlyRunner:true});});

test('public 101 Handler exposes the actual Code-owned phone factory before any Worker or outer dispatch',async t=>{
 await usingNativePhonePublic(t,async f=>{
  assert.equal(typeof f.handlers.prepareNativePhone,'function',
   '101 must use the actual public prepareNativePhone factory; no supports override, fake brand or private Handler replacement');
 });
});

test('public fixture carries actual native RECV source and reviewed shell-v2 command receipts',async t=>{
 await usingNativePhonePublic(t,async f=>{
  const sha=value=>createHash('sha256').update(value).digest('hex'),program=Buffer.from('synthetic public101 fixture ROM, never production\n'),review='synthetic synchronous fixture-only review\n',output=Buffer.from('UI hierchary dumped to synthetic fixture');
  const adb=await startNativePhoneAdbFixture(t,{serial:f.q.serial,readFile:path=>{assert.equal(path,'/system/bin/uiautomator');return program;},command:command=>{assert.match(command,/^exec \/system\/bin\/uiautomator /);return {stdout:output};}});
  const context={profile:f.q.profile,serial:f.q.serial,width:720,height:1280,package:'com.ss.android.ugc.aweme',keywords:['人工智能']};
  mkdirSync(join(f.runtimeRoot,'config/native-phone-reviews'),{recursive:true});writeFileSync(join(f.runtimeRoot,'config/native-phone-reviews/public-fixture.md'),review);
  writeFileSync(join(f.runtimeRoot,'config/native-phone-command-sources.json'),JSON.stringify({schema_version:1,device_sources:[{...context,device_sdk:31,review:{path:'config/native-phone-reviews/public-fixture.md',sha256:sha(review)},program_files:[{path:'/system/bin/uiautomator',sha256:sha(program)}],commands:['dump']}]}));
  const names=[...new Set([...f.source.files.map(row=>row.path),'native-phone-adb-read.mjs','native-phone-command-source.mjs','adb-shell-v2.mjs','adb-shell-v2-protocol.mjs','runtime-definition.mjs','config/native-phone-command-sources.json','config/native-phone-reviews/public-fixture.md'])],source={commit:f.source.commit,files:names.map(path=>({path,sha256:sha(readFileSync(join(f.runtimeRoot,path)))}))};
  const scope={protocol:'native-phone-adb-read/v1',task_id:f.q.task_id,binding_id:f.q.binding_id,run_id:f.q.run_id,source_commit:f.q.source_commit,profile:f.q.profile,serial:f.q.serial,epoch:1,endpoint:adb.endpoint,worker_deadline_ms:Date.now()+4000,cleanup_deadline_ms:Date.now()+5000,claim:{claimed_by:'fixture-code',claimed_at:new Date().toISOString()}};
  const load=name=>import(pathToFileURL(join(f.runtimeRoot,name))),readModule=await load('native-phone-adb-read.mjs'),sourceModule=await load('native-phone-command-source.mjs'),shell=await load('adb-shell-v2.mjs');
  const directory=name=>{const path=join(f.journalDirectory,name);mkdirSync(path,{mode:0o700});return path;},authority=scope=>async()=>({scope,claimed_by:scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(scope.cleanup_deadline_ms+1000).toISOString()});
  const reader=readModule.createNativePhoneAdbRead({runtimeRoot:f.runtimeRoot,source,directory:directory('ingress'),scope,readAuthority:authority(scope)}),issuer=sourceModule.createNativePhoneSourceIssuer({runtimeRoot:f.runtimeRoot,source,scope,context,reader});
  let observer;try{const commandSource=await issuer.prepare(),commandScope={...scope,protocol:'adb-shell-v2-observation/v1'};observer=shell.createNativePhoneCommandObserver({runtimeRoot:f.runtimeRoot,source,directory:directory('command'),scope:commandScope,commandSource,operation:'dump',args:[],context,readAuthority:authority(commandScope)});const wire=await observer.observeDump(),observed=observer.readReviewedCommandReceipt(wire,{scope:commandScope});assert.deepEqual(observed.stdout,output);assert.equal(observed.reviewed_command_returned,true);assert.equal(observed.android_services,'not_attested');assert.equal((await observer.close()).open_sockets,0);assert.equal(adb.requests.filter(row=>row.id==='RECV').length,1);}
  finally{await observer?.close();await issuer.close();await reader.close();}
 });
});

test('public phone fixture freezes its original company, keyword and exact device through real private PG',async t=>{
 const {Pool}=require('pg'),{queueRequest}=require('../leadgen-queue.js'),{companyKeywords}=require('../next-keywords.js');
 const pg=await nativePhonePublicPgFixture(t,{Pool,profile:'cloud-phone-test',serial:'192.0.2.31:10001',run:'public_fixture'});
 const allocation=await pg.createPool();try{
  const selected=await companyKeywords(allocation.pool,{lineHint:'yuesheng',runId:'public_fixture',limit:2,keywords:['人工智能']});
  const config=await queueRequest(allocation.pool,{op:'company_config',line:'yuesheng',run:'public_fixture',step:'101',device_binding:{profile:'cloud-phone-test',device_serial:'192.0.2.31:10001'}});
  assert.equal(config.company_id,pg.company.company_id);assert.equal(config.device_binding.douyin_id,'actual');
  assert.deepEqual(selected.keywords,['人工智能']);assert.equal(selected.config.company_id,config.company_id);
  const rows=await pg.readRows();assert.equal(rows.configs.length,1);assert.equal(rows.configs[0].task_inputs.limit,2);
 }finally{await allocation.pool.end();await allocation.transport.seal();}
 assert.equal(pg.livePools(),0);
});

test('public fixture uses actual official Caller and SDK for a loopback Worker turn',async t=>{
 await usingNativePhonePublic(t,async f=>{
  const task=f.routes.get('/api/brain/tasks/'+f.q.task_id);task.claimed_at=new Date().toISOString();
  task.payload.scope={source_run:null,limit:f.q.limit,send:0,run_max_seconds:f.q.run_max_seconds,execution_transport:f.q.execution_transport,max_turns:f.q.max_turns};
  const dependencies=await startNativePhoneGatewayFixture(t,[{type:'finish'}]),directory=join(f.journalDirectory,'sdk-control');mkdirSync(directory,{mode:0o700});
  const control=f.createControl({...f.options,journalDirectory:directory,gatewayDependencies:dependencies,gatewayCredential:()=> 'fixture-loopback'});
  try{const receipt=await control.request({kind:'official_agent_turn',request:f.q,turn:{index:0,input:{task:'fixture-only'}}}),verified=control.verifyTurnReceipt(receipt,{request:f.q,index:0});assert.equal(verified.text,'{"type":"finish"}');assert.equal(dependencies.fixtureWorkerTurns(),1);assert.ok(f.count()>=4);}
  finally{await control.close();}
 });
});

test('public definition fixture locks original three-slot methods and issues an actual native Task heartbeat lease',async t=>{
 await usingNativePhonePublic(t,async f=>{
  const keywordFile=join(f.journalDirectory,'keyword');writeFileSync(keywordFile,'人工智能\n',{mode:0o600});
  Object.assign(f.env,{LEADGEN_DISCOVERY_MAX_ATTEMPTS:'1',LEADGEN_MAX_SCREENS:'1',LEADGEN_SOURCE_KIND:'keyword',LEADGEN_SOURCES_FILE:keywordFile});
  const originalUser=os.userInfo(),home=f.env.HOME;t.mock.method(os,'userInfo',()=>({...originalUser,homedir:home}));t.mock.method(os,'homedir',()=>home);syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const load=name=>import(pathToFileURL(join(f.runtimeRoot,name))),pgModule=await load('preflight-pg-dependencies.mjs'),control=await load('preflight-control-scope.mjs');
  await pgModule.installPreflightPg({runtimeRoot:f.runtimeRoot,sourceCommit:f.source.commit});
  const pg=await nativePhonePublicPgFixture(t,{Pool:require('pg').Pool,profile:f.q.profile,serial:f.q.serial,run:f.q.run_tag});
  mkdirSync(join(home,'.credentials'),{recursive:true,mode:0o700});writeFileSync(join(home,'.credentials/zenithjoy-db.env'),'DATABASE_URL=postgresql://postgres:fixture@127.0.0.1:15532/cecelia_scratch\n',{mode:0o600});
  const profileFile=join(f.journalDirectory,'profiles.tsv');writeFileSync(profileFile,'profile\tserial\tmodel\twidth\theight\tenabled\n'+f.q.profile+'\t'+f.q.serial+'\tFixture\t720\t1280\ttrue\n',{mode:0o600});f.env.DOUYIN_PHONE_REGISTRY=profileFile;
  writeFileSync(join(f.runtimeRoot,'config/preflight-control-hosts.json'),JSON.stringify({version:1,database_identity:pg.expectedIdentity,hosts:[{target:'mmv',home,mode:'local'}]}));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),manifest={source_repo:'perfectuser21/zenithjoy-workspace',source_commit:f.source.commit,target:'mmv',files:f.source.files.map(row=>({path:'services/phone-adb-controller/'+row.path,deployed_path:row.path,content_sha256:hash(readFileSync(join(f.runtimeRoot,row.path)))}))};writeFileSync(join(f.runtimeRoot,'deployment-manifest.json'),JSON.stringify(manifest));
  const definition=await freezePublicPhoneDefinition(t,f,{env:f.env,manifest,extraFrozen:{preflight_pg:pgModule.preflightPgLockIdentity({runtimeRoot:f.runtimeRoot}),preflight_control_scope:control.freezePreflightControlScope({root:f.runtimeRoot,env:f.env}),preflight_profile:control.freezePreflightProfile({env:f.env})}});
  assert.deepEqual(definition.activities.map(row=>row.key),['preflight','collect_videos','cleanup']);
  assert.deepEqual(definition.leaseRequests.map(row=>row.method),['POST','GET']);
  const lease=await import(pathToFileURL(join(f.runtimeRoot,'native-task-lease.mjs')));assert.ok(lease.assertFrozenNativeTaskLease(definition.frozen).effective_deadline_ms>Date.now());
  assert.deepEqual(definition.frozen.discovery_input.sources,['人工智能']);
 });
});
