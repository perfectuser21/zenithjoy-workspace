import test from 'node:test';import assert from 'node:assert/strict';
const fixture=()=>({root:'/fixed/runtime',environment:{WFR_RUN_DIR:'/fixed/run'},frozen:{agent_input:{profile:'cloud-phone-test',run_tag:'direct101'},discovery_phone_scope:{expected_account:'77980009922'}}});
test('工作截止拒绝启动控制器，收尾使用冻结的独立期限',async()=>{
 const {createStandalonePhoneProvider}=await import('../standalone-skill-runtime.mjs'),base=fixture(),calls=[];
 const now=Date.now(),work=now-1,cleanup=now+10000;
 base.frozen.standalone_skill={deadline_ms:work,cleanup_deadline_ms:cleanup};
 let closing=false;
 const invoke=createStandalonePhoneProvider({...base,isCleanup:()=>closing,execute:async(_,args,options)=>{calls.push({args,options});return {code:0};}});
 const input={profile:'cloud-phone-test',owner:'direct101',args:[],command:'return-safe-desktop'};
 await assert.rejects(invoke(input),{code:'STANDALONE_NATIVE_WORK_DEADLINE'});
 assert.equal(calls.length,0);
 closing=true;
 await invoke(input);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].options.env,base.environment);
 assert.ok(calls[0].options.timeoutMs>0&&calls[0].options.timeoutMs<=10000);
});
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
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{digest}=await import('../runtime-definition.mjs'),f=await runtimeFixture();let producerOptions,workVersion,rpcCalls=0;
 const originalNow=Date.now;
 try{
  const start=originalNow();f.frozen.standalone_skill.deadline_ms=start+30000;f.frozen.standalone_skill.cleanup_deadline_ms=start+90000;delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);f.fs.writeFileSync(f.path.join(f.dir,'run-definition.json'),JSON.stringify(f.frozen));
  f.dependencies.rpcFactory=()=>async()=>{rpcCalls++;return {ok:true,result:{}};};
  f.dependencies.producerFactory=async options=>{producerOptions=options;return {env:{},isReturnUnknown:()=>false,seal:async()=>({requests_returned:true})};};
  f.dependencies.execute=async(c,args)=>{
   if(args.includes('return-safe-desktop')){
    assert.throws(()=>workVersion.assertActive(),/VERSION_PHASE_CHANGED/);
    const cleanupVersion=producerOptions.beginLocalVersion();
    assert.equal(cleanupVersion.deadlineMs,start+90000);
    cleanupVersion.assertActive();
    await producerOptions.assertAdmission();
    await producerOptions.assertAdmission();
    cleanupVersion.assertActive();
   }
   return f.execute(c,args);
  };
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});
  workVersion=producerOptions.beginLocalVersion();
  assert.equal(workVersion.deadlineMs,start+30000);
  workVersion.assertActive();
  Date.now=()=>start+31000;
  assert.throws(()=>workVersion.assertActive(),/WORK_DEADLINE/);
  const before=f.effects.length;await assert.rejects(f.dispatch('phone',{command:'status',args:[]}),/WORK_DEADLINE/);await assert.rejects(f.dispatch('business',{operation:'keywords',input:{}}),/WORK_DEADLINE/);assert.equal(f.effects.length,before);assert.equal(rpcCalls,0);
  assert.equal(producerOptions.admissionDeadlineMs,f.frozen.standalone_skill.cleanup_deadline_ms);
  assert.equal(f.fs.existsSync(f.path.join(f.registry,f.run+'.cleanup')),false);
  const receipt=await host.close();assert.equal(f.fs.readFileSync(f.path.join(f.registry,f.run+'.cleanup'),'utf8'),digest(f.fs.readFileSync(f.path.join(f.registry,f.run+'.json')))+'\n');assert.equal(receipt.native_return_unknown,false);assert.equal(f.effects.includes('return-safe-desktop'),true);assert.equal(f.effects.includes('central-release'),true);assert.equal(f.fs.existsSync(f.unknownPath),false);
 }finally{Date.now=originalNow;f.cleanup();}
});

for (const matchesOwner of [true, false]) test(`长运行收尾先读回原本地租约的续期，所有权匹配=${matchesOwner}`, async () => {
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{digest}=await import('../runtime-definition.mjs'),f=await runtimeFixture();
 const originalNow=Date.now;
 try {
  const startedAt=originalNow();
  f.frozen.standalone_skill.deadline_ms=startedAt+1_200_000;
  f.frozen.standalone_skill.cleanup_deadline_ms=startedAt+1_320_000;
  delete f.frozen.snapshot_sha256;
  f.frozen.snapshot_sha256=digest(f.frozen);
  f.fs.writeFileSync(f.path.join(f.dir,'run-definition.json'),JSON.stringify(f.frozen));
  const leaseFactory=f.dependencies.leaseFactory;
  f.dependencies.leaseFactory=()=>({...leaseFactory(),verifyHeld:async()=>f.effects.push('central-verify')});
  let acquiredAt=startedAt;
  f.dependencies.execute=async (path,args)=>{
   const result=await f.execute(path,args);
   if(args[2]==='lock-refresh'){
    assert.equal(args[3],'window-test');
    acquiredAt=Date.now();
    return {code:0,stdout:'lock=refreshed owner=window-test ttl=1800s'};
   }
   if(args[2]==='lock-status'&&!f.effects.includes('lock-release-exact')){
    return {code:0,stdout:`lock=held owner=${matchesOwner?'window-test':'another-run'} age=0s stale=false reclaimable=false ttl=1800s`};
   }
   if(args.includes('return-safe-desktop')&&Date.now()-acquiredAt>=800_000){
    return {code:1,stdout:'',stderr:'lock lease budget is insufficient'};
   }
   return result;
  };
  Date.now=()=>startedAt;
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});
  Date.now=()=>startedAt+1_026_000;
  if(matchesOwner){
   const result=await host.close();
   assert.equal(result.local_released,true);
   assert.equal(result.central_released,true);
   assert.ok(f.effects.indexOf('central-verify')<f.effects.indexOf('lock-refresh'));
   assert.ok(f.effects.indexOf('lock-status')<f.effects.indexOf('return-safe-desktop'));
  }else{
   await assert.rejects(host.close(),/LOCAL_RENEW_READBACK/);
   assert.ok(f.effects.includes('lock-quarantine'));
   assert.ok(!f.effects.includes('return-safe-desktop'));
   assert.ok(!f.effects.includes('central-release'));
  }
 }finally{Date.now=originalNow;f.cleanup();}
});
test('本地续期尚未写入时到达工作截止，保留独立收尾预算', async () => {
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{digest}=await import('../runtime-definition.mjs'),f=await runtimeFixture();
 const originalNow=Date.now;
 try {
  const startedAt=originalNow();
  const workDeadline=startedAt+401_000;
  f.frozen.standalone_skill.deadline_ms=workDeadline;
  f.frozen.standalone_skill.cleanup_deadline_ms=workDeadline+60_000;
  delete f.frozen.snapshot_sha256;
  f.frozen.snapshot_sha256=digest(f.frozen);
  f.fs.writeFileSync(f.path.join(f.dir,'run-definition.json'),JSON.stringify(f.frozen));
  const leaseFactory=f.dependencies.leaseFactory;
  f.dependencies.leaseFactory=()=>({...leaseFactory(),verifyHeld:async()=>{Date.now=()=>workDeadline+1;}});
  f.dependencies.execute=async (path,args,options)=>{
   const result=await f.execute(path,args);
   if(args[2]==='lock-refresh'){
    assert.ok(options.timeoutMs>0&&options.timeoutMs<=10_000);
    return {code:0,stdout:'lock=refreshed owner=window-test ttl=1800s'};
   }
   if(args[2]==='lock-status'&&!f.effects.includes('lock-release-exact')){
    assert.ok(options.timeoutMs>0&&options.timeoutMs<=10_000);
    return {code:0,stdout:'lock=held owner=window-test age=0s stale=false reclaimable=false ttl=1800s'};
   }
   return result;
  };
  Date.now=()=>startedAt;
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});
  Date.now=()=>workDeadline-1;
  await assert.rejects(f.dispatch('phone',{command:'status',args:[]}),/WORK_DEADLINE/);
  assert.ok(!f.effects.includes('lock-refresh'));
  assert.ok(!f.fs.existsSync(f.unknownPath));
  const receipt=await host.close();
  assert.equal(receipt.local_released,true);
  assert.equal(receipt.central_released,true);
 }finally{Date.now=originalNow;f.cleanup();}
});
test('a local version cannot acknowledge output after its frozen snapshot or host is revoked',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs');
 for(const drift of ['snapshot','revocation']){
  const f=await runtimeFixture();let beginLocalVersion;
  try{
   f.dependencies.producerFactory=async options=>{
    beginLocalVersion=options.beginLocalVersion;
    return {env:{},isReturnUnknown:()=>false,seal:async()=>({empty_requests_returned:true})};
   };
   const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});
   const request=beginLocalVersion();
   request.assertActive();
   if(drift==='snapshot')f.fs.writeFileSync(f.path.join(f.dir,'skill/SKILL.md'),'changed');
   else f.fs.writeFileSync(f.unknownPath,'revoked',{mode:0o600});
   assert.throws(()=>request.assertActive(),drift==='snapshot'?/冻结文件digest不符/:/HOST_REVOKED/);
   assert.equal((await host.close()).native_return_unknown,true);
   assert.equal(f.effects.includes('return-safe-desktop'),false);
   assert.equal(f.effects.includes('central-release'),false);
  }finally{f.cleanup();}
 }
});

test('cleanup deadline denies further desktop leaves and retains the revoked resources',async()=>{
 const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs'),{digest}=await import('../runtime-definition.mjs'),f=await runtimeFixture(),originalNow=Date.now;
 try{
  const start=originalNow();f.frozen.standalone_skill.deadline_ms=start+30000;f.frozen.standalone_skill.cleanup_deadline_ms=start+90000;delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);f.fs.writeFileSync(f.path.join(f.dir,'run-definition.json'),JSON.stringify(f.frozen));
  const host=await startStandaloneSkillRuntime({runDirectory:f.dir,dependencies:f.dependencies});Date.now=()=>start+91000;
  await assert.rejects(host.close(),/CLEANUP_DEADLINE/);assert.equal(f.fs.existsSync(f.unknownPath),true);assert.equal(f.effects.includes('return-safe-desktop'),false);assert.equal(f.effects.includes('lock-release-exact'),false);assert.equal(f.effects.includes('central-release'),false);
 }finally{Date.now=originalNow;f.cleanup();}
});

test('受管 102 启动只验证应用前台，保留旧调用和真实设备错误', async () => {
  const { createStandalonePhoneProvider } = await import('../standalone-skill-runtime.mjs');
  const base = fixture();
  base.frozen.agent_input.workflow_key = 'douyin_video_processing';
  const calls = [];
  let result = { code: 0, stdout: 'open_app=app_foreground\n' };
  const execute = async (_command, args) => { calls.push(args.slice(4)); return result; };
  const invoke = createStandalonePhoneProvider({ ...base, execute });
  const input = { command: 'open-app', args: [], profile: 'cloud-phone-test', owner: 'direct101' };
  await invoke(input);
  assert.deepEqual(calls, [['open-app', '--foreground-only']]);
  result = { code: 0, stdout: 'open_app=foreground_timeout\n' };
  await assert.rejects(invoke(input), { code: 'STANDALONE_NATIVE_APP_FOREGROUND_TIMEOUT' });
  result = { code: 0, stdout: 'unexpected\n' };
  await assert.rejects(invoke(input), { code: 'STANDALONE_NATIVE_COMMAND' });
  result = { code: 124, stdout: '', stderr: 'guard timeout' };
  await assert.rejects(invoke(input), { code: 'STANDALONE_NATIVE_COMMAND', controller_exit_code: 124 });
  result = { code: 0, stdout: 'legacy\n' };
  await createStandalonePhoneProvider({ ...fixture(), execute })(input);
  assert.deepEqual(calls.at(-1), ['open-app']);
});

test('102 将读树失败交还给 Agent，截图点击后使用只读账号复核',async()=>{
 const {createStandalonePhoneProvider}=await import('../standalone-skill-runtime.mjs');
 const base=fixture(),calls=[];
 base.frozen.agent_input.workflow_key='douyin_video_processing';
 const invoke=createStandalonePhoneProvider({...base,execute:async (_,args)=>{
  calls.push(args.slice(4));
  return {code:0,stdout:'account_status=visual_required\n'};
 }});
 const use=(command,args,verifyAccountOnly)=>invoke({command,args,profile:'cloud-phone-test',owner:'direct101',verifyAccountOnly});
 assert.equal((await use('account-current',['direct101-entry'])).stdout.trim(),'account_status=visual_required');
 await use('account-current',['direct101-readback'],true);
 assert.deepEqual(calls,[['account-current','direct101-entry','--single-dump'],['account-current','direct101-readback','--verify-own-profile']]);
});

test('102 设备状态读回包含受管 ADB 的后置身份复核，并服从原运行截止',async()=>{
  const {readStandaloneCallRegistry}=await import('../standalone-skill-runtime.mjs');
  const args={root:'/sealed/runtime',environment:{DOUYIN_ADB_PORT:'5045'},serial:'physical',now:()=>1000,deadlineMs:61000};
  let recorded;
  const execute=async(file,argv,options)=>{
    recorded={file,argv,budget:options.timeoutMs};
    assert.ok(options.timeoutMs>32000,'一次原生动作加前后身份复核超过原 15 秒');
    return {code:0,stdout:'mCallState=0\nmCallState=0\n'};
  };
  await readStandaloneCallRegistry({...args,execute});
  assert.equal(recorded.budget,60000);
  assert.deepEqual(recorded.argv,['-H','127.0.0.1','-P','5045','-s','physical','shell','dumpsys','telephony.registry']);
  await assert.rejects(readStandaloneCallRegistry({...args,deadlineMs:1000,execute:()=>assert.fail('超出截止不启动')}),/WORK_DEADLINE/);
  await assert.rejects(readStandaloneCallRegistry({...args,execute:async()=>({code:0,stdout:'mCallState=0\nmCallState=2\n'})}),/DEVICE_CONTEXT/);
  await assert.rejects(readStandaloneCallRegistry({...args,execute:async()=>{throw Error('EXECUTION_DEADLINE');}}),/DEVICE_CONTEXT_TIMEOUT/);
});
