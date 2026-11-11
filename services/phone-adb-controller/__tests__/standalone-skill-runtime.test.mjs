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
  const effects=[];await assert.rejects(startStandaloneSkillRuntime({runDirectory:dir,environment:{BRAIN_INTERNAL_TOKEN:'unit-only'},dependencies:{hostRegistry:path.join(dir,'host-registry'),bootstrap:async()=>true,leaseFactory:()=>({acquire:async()=>effects.push('central-acquire'),release:async()=>effects.push('central-release')}),execute:async(c,args)=>{effects.push(args[2]);return {code:args[2]==='lock-quarantine'?quarantineExit:0,stdout:args[2]==='lock-quarantine'?'lock=quarantined owner=startup-test review_required=true':'lock=acquired'};},guard:async()=>true,producerFactory:async()=>{throw Error('STARTUP_UNVERIFIED');}}}),quarantineExit===0?/STARTUP_UNVERIFIED/:/QUARANTINE_READBACK/);
  assert.deepEqual(effects,['central-acquire','lock-acquire','lock-quarantine']);
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
