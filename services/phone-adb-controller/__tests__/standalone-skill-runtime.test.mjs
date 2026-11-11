import test from 'node:test';import assert from 'node:assert/strict';
const fixture=()=>({root:'/fixed/runtime',environment:{WFR_RUN_DIR:'/fixed/run'},frozen:{agent_input:{profile:'cloud-phone-test',run_tag:'direct101'},discovery_phone_scope:{expected_account:'77980009922'}}});
test('semantic card uses a fresh selected video grid and returned native card coordinates under the exact owner',async()=>{
 const {createStandalonePhoneProvider}=await import('../standalone-skill-runtime.mjs');const calls=[];
 const invoke=createStandalonePhoneProvider({...fixture(),execute:async(command,args)=>{calls.push({command,args});if(args.includes('search-video-cards'))return {code:0,stdout:'123\t456\t00:15\t一个真实搜索卡片的标题\t作者\nvideo_tab=1\nloading=0\n'};return {code:0,stdout:args.includes('current-video-link')?'video_id=1234567890123456789\ncontent_type=video\n':'ok'};}});
 const result=await invoke({command:'open-search-card',args:[0,'direct101-candidate1'],profile:'cloud-phone-test',owner:'direct101'});
 assert.equal(calls.length,3);assert.deepEqual(calls[1].args.slice(-5),['tap-evidence','123','456','direct101-candidate1-open','800']);
 for(const c of calls)assert.deepEqual(c.args.slice(0,4),['--profile','cloud-phone-test','--lock-owner','direct101']);
 assert.match(result.stdout,/video_id=1234567890123456789/);
});
test('semantic card refuses a loading, wrong-tab or missing grid without tapping',async()=>{
 const {createStandalonePhoneProvider}=await import('../standalone-skill-runtime.mjs');for(const stdout of ['video_tab=0\nloading=0\n','123\t456\t\ttitle\t\nvideo_tab=1\nloading=1\n','video_tab=1\nloading=0\n']){const calls=[];const invoke=createStandalonePhoneProvider({...fixture(),execute:async(c,a)=>{calls.push(a);return {code:0,stdout};}});await assert.rejects(invoke({command:'open-search-card',args:[0,'direct101-candidate1'],profile:'cloud-phone-test',owner:'direct101'}),/STANDALONE_NATIVE_CARD/);assert.equal(calls.length,1);}
});
test('account preflight rejects another native account instead of accepting its display name',async()=>{
 const {createStandalonePhoneProvider}=await import('../standalone-skill-runtime.mjs');const invoke=createStandalonePhoneProvider({...fixture(),execute:async()=>({code:0,stdout:'douyin_id=another-account\n'})});await assert.rejects(invoke({command:'account-current',args:['direct101-account'],profile:'cloud-phone-test',owner:'direct101'}),/STANDALONE_NATIVE_ACCOUNT/);
});

test('bootstrap requires matching live Task, running execution and internal binding before resource acquisition',async()=>{
 const {verifyStandaloneBootstrap}=await import('../standalone-skill-runtime.mjs');const p={task_id:'t',run_id:'r',task_run_id:'tr',run_binding:{run_binding_id:'b'}},scope={task_id:'t'};
 // Task identity itself is checked by the strict authority module; incomplete identities cannot reach resources.
 const calls=[];await assert.rejects(verifyStandaloneBootstrap({frozen:{standalone_skill:p},scope,read:async(path)=>{calls.push(path);return {};}}),/STANDALONE_NATIVE_BOOTSTRAP/);
 assert.ok(calls.every(p=>/\/tasks\/|\/runs\//.test(p)));
});

for(const quarantineExit of [0,2])test(`failed producer startup preserves both locks; quarantine exit=${quarantineExit}`,async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{agentInput,digest}=await import('../runtime-definition.mjs'),{standaloneScope}=await import('../standalone-skill-authority.mjs');
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os'),{randomUUID:id}=await import('node:crypto');
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'standalone-start-'));const prior=process.env.BRAIN_INTERNAL_TOKEN;process.env.BRAIN_INTERNAL_TOKEN='unit-only';
 try{
  fs.mkdirSync(path.join(dir,'runtime'));fs.mkdirSync(path.join(dir,'skill'));fs.writeFileSync(path.join(dir,'skill/SKILL.md'),'skill');
  const task=id(),run=id(),company={company_id:id(),tenant_id:id(),version:1,policy_id:'original'},source='a'.repeat(40),ref={reference_id:id(),activity_id:id(),activity_definition_version_id:id()};
  const input=agentInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_BRAIN_TASK_ID:task,WFR_TAG:'startup-test',P:'cloud-phone-test',SERIAL:'47.100.213.173:10001',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'1',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'120'});
  const frozen={execution_mode:'agent',primary_host:'codex-exec-v1',agent_input:input,run_identity:{tag:input.run_tag},deployment:{source_commit:source},workflow_version:{payload:{key:input.workflow_key}},files:{'skill/SKILL.md':digest('skill')},discovery_phone_scope:{profile:input.profile,serial:input.serial,expected_account:'77980009922',policy:{endpoint:'tcp:127.0.0.1:5042'},policy_binding:{policy_path:'/fixed/policy'}},standalone_skill:{protocol:'codex-exec-v1',task_id:task,run_id:run,task_run_id:id(),claimer:'direct-codex',claimed_at:new Date().toISOString(),machine_id:'us-mac-m4',profile_sha256:'b'.repeat(64),scope_sha256:'c'.repeat(64),approved_keywords:['AI办公'],skill:{name:'example',version:'0.1',source_commit:source,path:'skill/SKILL.md',sha256:digest('skill')},run_binding:{run_binding_id:id(),workflow_id:id(),workflow_definition_version_id:id(),attempt_key:'a1',activities:{collect:ref}},company,deadline_ms:Date.now()+60000,cleanup_deadline_ms:Date.now()+120000}};
  frozen.standalone_skill.scope=standaloneScope(frozen);frozen.standalone_skill.scope_sha256=digest(frozen.standalone_skill.scope);frozen.snapshot_sha256=digest(frozen);fs.writeFileSync(path.join(dir,'run-definition.json'),JSON.stringify(frozen));
  const effects=[];await assert.rejects(startStandaloneSkillRuntime({runDirectory:dir,environment:{BRAIN_INTERNAL_TOKEN:'unit-only'},dependencies:{hostRegistry:path.join(dir,'host-registry'),bootstrap:async()=>true,leaseFactory:()=>({acquire:async()=>effects.push('central-acquire'),release:async()=>effects.push('central-release')}),execute:async(c,args)=>{effects.push(args[2]);return {code:args[2]==='lock-quarantine'?quarantineExit:0,stdout:args[2]==='lock-quarantine'?'lock=quarantined owner=startup-test review_required=true':'lock=acquired owner=startup-test'};},guard:async()=>true,producerFactory:async()=>{throw Error('STARTUP_UNVERIFIED');}}}),quarantineExit===0?/STARTUP_UNVERIFIED/:/QUARANTINE_READBACK/);
  assert.deepEqual(effects,['central-acquire','lock-acquire-new','lock-quarantine']);
  if(quarantineExit!==0){assert.equal(fs.existsSync(path.join(dir,'standalone-cleanup.json')),false);return;}
  const cleanup=JSON.parse(fs.readFileSync(path.join(dir,'standalone-cleanup.json'),'utf8'));assert.equal(cleanup.native_return_unknown,true);assert.equal(cleanup.local_released,false);assert.equal(cleanup.central_released,false);assert.equal(cleanup.quarantine_verified,true);
 }finally{if(prior===undefined)delete process.env.BRAIN_INTERNAL_TOKEN;else process.env.BRAIN_INTERNAL_TOKEN=prior;fs.rmSync(dir,{recursive:true,force:true});}
});

test('serve refuses credentials or undeclared controls in an artifact configuration without echoing their values',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{spawnSync}=await import('node:child_process');const d=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'direct-env-'));
 try{
  for(const config of [{OPENAI_API_KEY:'PRIVATE_SENTINEL'},{BRAIN_INTERNAL_TOKEN:'PRIVATE_SENTINEL'},{NODE_OPTIONS:'PRIVATE_SENTINEL'}]){
   fs.writeFileSync(path.join(d,'environment.json'),JSON.stringify(config),{mode:0o600});const r=spawnSync(process.execPath,[new URL('../standalone-skill-runtime.mjs',import.meta.url).pathname,'serve',d],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/STANDALONE_NATIVE_ENVIRONMENT/);assert.doesNotMatch(r.stderr+r.stdout,/PRIVATE_SENTINEL/);
  }
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('a canonical run can claim only one host across different run directories',async()=>{
 const {claimStandaloneHost}=await import('../standalone-skill-runtime.mjs'),fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os'),{randomUUID}=await import('node:crypto');
 const d=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'direct-global-host-'));
 try{
  const runId=randomUUID(),registry=path.join(d,'registry');const first=claimStandaloneHost({runId,runDirectory:path.join(d,'first'),registry});const bytes=fs.readFileSync(first,'utf8');
  assert.throws(()=>claimStandaloneHost({runId,runDirectory:path.join(d,'second'),registry}),/STANDALONE_NATIVE_HOST_ALREADY_STARTED/);
  assert.equal(fs.readFileSync(first,'utf8'),bytes);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

async function runtimeFixture(){
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os'),{randomUUID:id}=await import('node:crypto'),{agentInput,digest}=await import('../runtime-definition.mjs'),{standaloneScope}=await import('../standalone-skill-authority.mjs');
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'standalone-window-')),run=id(),task=id(),ref={reference_id:id(),activity_id:id(),activity_definition_version_id:id()},company={company_id:id(),tenant_id:id(),version:1,policy_id:'original'};
 fs.mkdirSync(path.join(dir,'runtime'));fs.mkdirSync(path.join(dir,'skill'));fs.writeFileSync(path.join(dir,'skill/SKILL.md'),'skill');
 const input=agentInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_BRAIN_TASK_ID:task,WFR_TAG:'window-test',P:'cloud-phone-test',SERIAL:'47.100.213.173:10001',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'1',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'120'});
 const frozen={execution_mode:'agent',primary_host:'codex-exec-v1',agent_input:input,run_identity:{tag:input.run_tag},deployment:{source_commit:'a'.repeat(40)},workflow_version:{payload:{key:input.workflow_key}},files:{'skill/SKILL.md':digest('skill')},discovery_phone_scope:{profile:input.profile,serial:input.serial,expected_account:'77980009922',policy:{schema_version:2,endpoint:'tcp:127.0.0.1:5042'},policy_binding:{policy_path:'/fixed/policy'}},standalone_skill:{protocol:'codex-exec-v1',task_id:task,run_id:run,task_run_id:id(),claimer:'fixture-direct-codex',claimed_at:new Date().toISOString(),machine_id:'us-mac-m4',profile_sha256:'b'.repeat(64),scope_sha256:'c'.repeat(64),approved_keywords:['AI办公'],skill:{name:'example',version:'0.1',source_commit:'a'.repeat(40),path:'skill/SKILL.md',sha256:digest('skill')},run_binding:{run_binding_id:id(),workflow_id:id(),workflow_definition_version_id:id(),attempt_key:'a1',activities:{collect:ref}},company,deadline_ms:Date.now()+60000,cleanup_deadline_ms:Date.now()+120000}};
 frozen.standalone_skill.scope=standaloneScope(frozen);frozen.standalone_skill.scope_sha256=digest(frozen.standalone_skill.scope);frozen.snapshot_sha256=digest(frozen);fs.writeFileSync(path.join(dir,'run-definition.json'),JSON.stringify(frozen));
 const effects=[],registry=path.join(dir,'host-registry'),unknownPath=path.join(registry,run+'.unknown.json');let dispatch,leafUnknown=false;
 const execute=async(_command,args)=>{const op=args[2]==='--lock-owner'?args[4]:args[2];effects.push(op);if(op==='lock-acquire-new'||op==='lock-acquire')return {code:0,stdout:'lock=acquired owner=window-test'};if(op==='lock-quarantine')return {code:0,stdout:'lock=quarantined owner=window-test review_required=true'};if(op==='lock-status')return {code:0,stdout:'lock=free'};return {code:0,stdout:'ok'};};
 const dependencies={hostRegistry:registry,bootstrap:async()=>true,leaseFactory:()=>({acquire:async()=>effects.push('central-acquire'),release:async()=>effects.push('central-release')}),execute,guard:async()=>{effects.push('fresh-guard');return {authorized:true};},producerFactory:async()=>{effects.push('producer-start');return {env:{},isReturnUnknown:()=>leafUnknown,seal:async()=>{effects.push('leaf-seal');return {requests_returned:true};}};},rpcFactory:()=>async()=>({ok:true,result:{}}),ipcFactory:async({call})=>{dispatch=call;return {connectionPath:path.join(dir,'fake-test-connection.json'),close:async()=>effects.push('ipc-close')};}};
 return {dir,run,task,frozen,dependencies,effects,registry,unknownPath,execute,setLeafUnknown:v=>leafUnknown=v,dispatch:(...args)=>dispatch(...args),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true}),fs,path};
}
test('runtime claims the real host proof then fresh local ownership and closes in verified resource order',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();
 try{
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});
  const proof=JSON.parse(f.fs.readFileSync(f.path.join(f.registry,f.run+'.json'),'utf8'));
  assert.equal(proof.protocol,'standalone-skill-host-proof/v1');assert.equal(proof.task_id,f.task);assert.equal(proof.snapshot_sha256,f.frozen.snapshot_sha256);assert.equal(proof.process_identity.pid,process.pid);assert.ok(proof.process_identity.start_identity);
  assert.ok(f.effects.includes('lock-acquire-new'));assert.ok(!f.effects.includes('lock-acquire'));
  const cleanup=await host.close();assert.equal(cleanup.native_return_unknown,false);assert.equal(f.fs.existsSync(f.unknownPath),false);assert.equal(f.fs.existsSync(f.path.join(f.registry,f.run+'.json')),true);
  const ordered=['ipc-close','return-safe-desktop','leaf-seal','lock-release-exact','lock-status','central-release'];for(let i=1;i<ordered.length;i++)assert.ok(f.effects.indexOf(ordered[i-1])<f.effects.indexOf(ordered[i]),f.effects.join(','));
  const before=f.effects.length;await assert.rejects(f.dispatch('inspect',{}),/CLOSING/);assert.equal(f.effects.length,before);
 }finally{f.cleanup();}
});
for(const failed of ['lock-acquire-new','lock-status'])test(`nonzero ${failed} cannot be disguised by acquired/free stdout`,async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();
 try{
  f.dependencies.execute=async(c,args)=>{const r=await f.execute(c,args),op=args[2];return op===failed?{...r,code:2}:r;};
  if(failed==='lock-acquire-new')await assert.rejects(startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies}),/STANDALONE_NATIVE_COMMAND/);
  else{const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});await assert.rejects(host.close(),/STANDALONE_NATIVE_COMMAND/);}
  assert.equal(f.fs.existsSync(f.unknownPath),true);assert.equal(f.effects.includes('central-release'),false);if(failed==='lock-acquire-new')assert.equal(f.effects.includes('producer-start'),false);
 }finally{f.cleanup();}
});
for(const phase of ['ipc-close','leaf-seal'])test(`${phase} failure revokes the global host before preserving locks`,async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();
 try{
  if(phase==='ipc-close')f.dependencies.ipcFactory=async()=>({connectionPath:'test',close:async()=>{f.effects.push('ipc-close');throw Error('TEST_CLOSE_FAILURE');}});
  else f.dependencies.producerFactory=async()=>({env:{},isReturnUnknown:()=>false,seal:async()=>{f.effects.push('leaf-seal');throw Error('TEST_CLOSE_FAILURE');}});
  f.dependencies.execute=async(c,args)=>{if(args[2]==='lock-quarantine')assert.equal(f.fs.existsSync(f.unknownPath),true,'global revoke precedes quarantine');return f.execute(c,args);};
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});await assert.rejects(host.close(),/TEST_CLOSE_FAILURE/);
  assert.equal(f.fs.existsSync(f.unknownPath),true);assert.equal(f.effects.includes('lock-release-exact'),false);assert.equal(f.effects.includes('central-release'),false);
 }finally{f.cleanup();}
});
test('a malformed existing global unknown marker permanently blocks providers without rewriting it',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();
 try{
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});f.fs.writeFileSync(f.unknownPath,'bad existing revocation',{mode:0o600,flag:'wx'});const before=f.fs.statSync(f.unknownPath);
  const effects=f.effects.length;await assert.rejects(f.dispatch('inspect',{}),/HOST_REVOKED/);await assert.rejects(f.dispatch('inspect',{}),/HOST_REVOKED/);assert.equal(f.effects.length,effects);
  const cleanup=await host.close();assert.equal(cleanup.native_return_unknown,true);assert.equal(f.effects.includes('return-safe-desktop'),false);assert.equal(f.effects.includes('central-release'),false);assert.equal(f.fs.readFileSync(f.unknownPath,'utf8'),'bad existing revocation');assert.equal(f.fs.statSync(f.unknownPath).ino,before.ino);
 }finally{f.cleanup();}
});
test('leaf unknown persists global revocation before any new provider or cleanup action',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();
 try{
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});f.setLeafUnknown(true);
  await assert.rejects(f.dispatch('inspect',{}),/HOST_REVOKED/);assert.equal(f.fs.existsSync(f.unknownPath),true);
  const receipt=await host.close();assert.equal(receipt.native_return_unknown,true);assert.equal(f.effects.includes('return-safe-desktop'),false);assert.equal(f.effects.includes('central-release'),false);
 }finally{f.cleanup();}
});

test('cleanup leaf admission remains fresh while normal closing rejects new business calls',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();let admit;
 try{
  f.dependencies.producerFactory=async options=>{admit=options.assertAdmission;return {env:{},isReturnUnknown:()=>false,seal:async()=>({requests_returned:true})};};
  f.dependencies.execute=async(c,args)=>{if(args.includes('return-safe-desktop')){await admit();await admit();}return f.execute(c,args);};
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies}),before=f.effects.filter(v=>v==='fresh-guard').length;
  await host.close();assert.ok(f.effects.filter(v=>v==='fresh-guard').length>=before+3);assert.equal(f.effects.includes('central-release'),true);assert.equal(f.fs.existsSync(f.unknownPath),false);
 }finally{f.cleanup();}
});
for(const flags of [{receiptMissing:true},{executionStopped:false}])test(`business commit unknown ${Object.keys(flags)[0]} preserves exact readback without a native revocation`,async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();const rpc=[];
 try{
  const video={videoId:'7646309328911907195',videoUrl:'https://www.douyin.com/video/7646309328911907195',title:'fixture',keyword:'AI办公',metrics:{fixture:true}};
  f.dependencies.rpcFactory=()=>async request=>{rpc.push(request);if(request.request.op==='discover')throw Object.assign(Error('COMMIT_ACK_UNKNOWN'),flags);assert.equal(request.request.op,'discover_readback');assert.deepEqual(request.request.video,video);return {ok:true,result:{metrics_verified:true,status:'matched'}};};
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies}),phoneBefore=f.effects.filter(v=>v!=='fresh-guard');
  await assert.rejects(f.dispatch('business',{operation:'discover',input:{video}}),/COMMIT_ACK_UNKNOWN/);assert.equal(f.fs.existsSync(f.unknownPath),false);
  await assert.rejects(f.dispatch('business',{operation:'discover',input:{video}}),/STANDALONE_TOOL_COMMIT_UNKNOWN/);
  const other={...video,videoId:'7646309328911907196',videoUrl:'https://www.douyin.com/video/7646309328911907196'};await assert.rejects(f.dispatch('business',{operation:'discover_readback',input:{video:other}}),/STANDALONE_TOOL_COMMIT_UNKNOWN/);assert.equal(rpc.length,1);
  const result=await f.dispatch('business',{operation:'discover_readback',input:{video}});assert.equal(result.result.status,'matched');assert.equal(rpc.length,2);assert.deepEqual(f.effects.filter(v=>v!=='fresh-guard'),phoneBefore);assert.equal(f.fs.existsSync(f.unknownPath),false);
  const receipt=await host.close();assert.equal(receipt.native_return_unknown,false);assert.equal(f.effects.includes('central-release'),true);
 }finally{f.cleanup();}
});
test('revocation fsync failure terminates the actual dedicated child with exit 70 and no releases',async()=>{
 const {spawnSync}=await import('node:child_process'),fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'standalone-fatal-child-')),script=path.join(base,'child.mjs'),effectsPath=path.join(base,'effects.log');let childDirectory;
 try{
  const helper=runtimeFixture.toString().replace(/import\('\.\.\/([^']+)'\)/g,(_all,name)=>`import(${JSON.stringify(new URL('../'+name,import.meta.url).href)})`);
  fs.writeFileSync(script,`import fs from 'node:fs';\n${helper}\nconst f=await runtimeFixture();console.log(JSON.stringify({directory:f.dir}));\nconst log=${JSON.stringify(effectsPath)};\nf.dependencies.revocationFsync=()=>{throw Error('INJECTED_FSYNC_FAILURE');};\nf.dependencies.producerFactory=async()=>{throw Error('STARTUP_UNVERIFIED');};\nf.dependencies.leaseFactory=()=>({acquire:async()=>fs.appendFileSync(log,'central-acquire\\n'),release:async()=>fs.appendFileSync(log,'central-release\\n')});\nf.dependencies.execute=async(c,args)=>{fs.appendFileSync(log,args[2]+'\\n');return f.execute(c,args);};\nconst {startStandaloneSkillRuntime}=await import(${JSON.stringify(new URL('../standalone-skill-runtime.mjs',import.meta.url).href)});\ntry{await startStandaloneSkillRuntime({runDirectory:f.dir,environment:{BRAIN_INTERNAL_TOKEN:process.env.BRAIN_INTERNAL_TOKEN},dependencies:f.dependencies});process.exitCode=92;}catch{fs.appendFileSync(log,'returned-from-failed-revocation\\n');process.exitCode=91;}\n`,{mode:0o600});
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:10000});childDirectory=JSON.parse(result.stdout.trim()).directory;
  assert.equal(result.status,70,result.stderr);const effects=fs.readFileSync(effectsPath,'utf8');assert.match(effects,/lock-acquire-new/);assert.doesNotMatch(effects,/release|returned-from-failed-revocation/);
 }finally{if(childDirectory)fs.rmSync(childDirectory,{recursive:true,force:true});fs.rmSync(base,{recursive:true,force:true});}
});

test('an unexpected leaf-state exception during close still revokes globally and keeps resources',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();let broken=false;
 try{
  f.dependencies.producerFactory=async()=>({env:{},isReturnUnknown:()=>{if(broken)throw Error('LEAF_STATE_UNAVAILABLE');return false;},seal:async()=>({requests_returned:true})});
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});broken=true;await assert.rejects(host.close(),/LEAF_STATE_UNAVAILABLE/);
  assert.equal(f.fs.existsSync(f.unknownPath),true);assert.equal(f.effects.includes('lock-release-exact'),false);assert.equal(f.effects.includes('central-release'),false);
 }finally{f.cleanup();}
});

for(const failed of [false,true])test(`leaf-state read throws after dispatch ${failed?'error':'success'} and revokes before another provider`,async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),f=await runtimeFixture();let reads=0,rpcCalls=0;
 try{
  f.dependencies.producerFactory=async()=>({env:{},isReturnUnknown:()=>{if(++reads===3)throw Error('DISPATCH_LEAF_STATE_UNAVAILABLE');return false;},seal:async()=>({requests_returned:true})});
  if(failed)f.dependencies.rpcFactory=()=>async()=>{rpcCalls++;throw Error('RPC_READ_FAILED');};
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});
  await assert.rejects(failed?f.dispatch('business',{operation:'keywords',input:{}}):f.dispatch('inspect',{}),/DISPATCH_LEAF_STATE_UNAVAILABLE/);assert.equal(f.fs.existsSync(f.unknownPath),true);
  await assert.rejects(f.dispatch('business',{operation:'keywords',input:{}}),/HOST_REVOKED/);assert.equal(rpcCalls,failed?1:0);
  const receipt=await host.close();assert.equal(receipt.native_return_unknown,true);assert.equal(f.effects.includes('central-release'),false);
 }finally{f.cleanup();}
});
test('work deadline refuses new phone and business work while cleanup leaves retain their reserved deadline',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{digest}=await import('../runtime-definition.mjs'),f=await runtimeFixture();let admit,producerOptions,rpcCalls=0;
 const originalNow=Date.now;
 try{
  const start=originalNow();f.frozen.standalone_skill.deadline_ms=start+30000;f.frozen.standalone_skill.cleanup_deadline_ms=start+90000;delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);f.fs.writeFileSync(f.path.join(f.dir,'run-definition.json'),JSON.stringify(f.frozen));
  f.dependencies.rpcFactory=()=>async()=>{rpcCalls++;return {ok:true,result:{}};};
  f.dependencies.producerFactory=async options=>{producerOptions=options;admit=options.assertAdmission;return {env:{},isReturnUnknown:()=>false,seal:async()=>({requests_returned:true})};};
  f.dependencies.execute=async(c,args)=>{if(args.includes('return-safe-desktop')){await admit();await admit();}return f.execute(c,args);};
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});Date.now=()=>start+31000;
  const before=f.effects.length;await assert.rejects(f.dispatch('phone',{command:'status',args:[]}),/WORK_DEADLINE/);await assert.rejects(f.dispatch('business',{operation:'keywords',input:{}}),/WORK_DEADLINE/);assert.equal(f.effects.length,before);assert.equal(rpcCalls,0);
  assert.equal(producerOptions.admissionDeadlineMs,f.frozen.standalone_skill.cleanup_deadline_ms);
  const receipt=await host.close();assert.equal(receipt.native_return_unknown,false);assert.equal(f.effects.includes('return-safe-desktop'),true);assert.equal(f.effects.includes('central-release'),true);assert.equal(f.fs.existsSync(f.unknownPath),false);
 }finally{Date.now=originalNow;f.cleanup();}
});

test('cleanup deadline denies further desktop leaves and retains the revoked resources',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{digest}=await import('../runtime-definition.mjs'),f=await runtimeFixture(),originalNow=Date.now;
 try{
  const start=originalNow();f.frozen.standalone_skill.deadline_ms=start+30000;f.frozen.standalone_skill.cleanup_deadline_ms=start+90000;delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);f.fs.writeFileSync(f.path.join(f.dir,'run-definition.json'),JSON.stringify(f.frozen));
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});Date.now=()=>start+91000;
  await assert.rejects(host.close(),/CLEANUP_DEADLINE/);assert.equal(f.fs.existsSync(f.unknownPath),true);assert.equal(f.effects.includes('return-safe-desktop'),false);assert.equal(f.effects.includes('lock-release-exact'),false);assert.equal(f.effects.includes('central-release'),false);
 }finally{Date.now=originalNow;f.cleanup();}
});
