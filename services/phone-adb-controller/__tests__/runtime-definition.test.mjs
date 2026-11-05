import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import { deploymentTarget } from '../runtime-host.mjs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { freezeDefinition,agentInput } from '../runtime-definition.mjs';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
function canonical(x) { return JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v); }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-freeze-')); const sha='a'.repeat(40);
  writeFileSync(join(dir,'entry.sh'), '#!/bin/sh\necho frozen\n');
  writeFileSync(join(dir,'steps.json'), JSON.stringify({steps:[{key:'run.execute',activity:'run'}]}));
  writeFileSync(join(dir,'workflow.plan'), 'WF_CAP=test\n');
  const source={repo:'test/repo',path:'contracts/test.yaml',commit:sha};
  const contract={id:'test',capability:'test',workflow:'social-test',activities:[{id:'run',steps:[{id:'execute'}]}]};
  const ap={activity_id:'activity-1',definition_key:'test.run',contract:contract.activities[0],steps:[{step_id:null,locator:{activity_id:'activity-1',step_key:'execute'},contract:{id:'execute'}}],implementation_bindings:[{kind:'code',status:'verified',repo:source.repo,path:'services/phone-adb-controller/entry.sh',revision:sha,content_sha256:hash(readFileSync(join(dir,'entry.sh'),'utf8'))}]};
  const wp={workflow_id:'workflow-1',key:'brain-test',contract,activities:[{reference_id:'ref-1',slot_key:'run',sequence_no:1,activity_id:'activity-1',activity_version_id:'av-1'}]};
  const version=(id,payload)=>({id,source_repo:source.repo,source_path:source.path,source_commit:sha,contract_sha256:hash(payload.contract),payload_sha256:hash({source,payload}),payload});
  const routes={'/api/brain/workflows':[{id:'workflow-1',key:'brain-test',current_definition_version_id:'wv-1'}],'/api/brain/workflows/workflow-1/versions/wv-1':{version:version('wv-1',wp)},'/api/brain/activities/activity-1/versions/av-1':{version:version('av-1',ap)}};
  writeFileSync(join(dir,'deployment-manifest.json'),JSON.stringify({source_repo:source.repo,source_commit:sha,files:[{path:ap.implementation_bindings[0].path,deployed_path:'entry.sh',content_sha256:ap.implementation_bindings[0].content_sha256},...['workflow.plan','steps.json'].map(name=>({path:`services/phone-adb-controller/${name}`,deployed_path:name,content_sha256:hash(readFileSync(join(dir,name),'utf8'))}))]}));
  return {dir,routes,options:{runDir:join(dir,'run'),planPath:join(dir,'workflow.plan'),stepSpecPath:join(dir,'steps.json'),deploymentRoot:dir,workflowKey:'brain-test',rawContractSha256:hash(contract),runtimeFiles:[{path:'services/phone-adb-controller/entry.sh',content_sha256:ap.implementation_bindings[0].content_sha256}],get:async path=>structuredClone(routes[path])}};
}
test('执行模式只接受显式agent或code；104不可变成Agent发送路径',async()=>{
 const {executionModeInput}=await import('../runtime-definition.mjs');
 assert.equal(executionModeInput({}),'code');
 for(const workflow of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'])assert.equal(executionModeInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:workflow}),'agent');
 for(const mode of ['', 'skill', 'AGENT', 'unknown'])assert.throws(()=>executionModeInput({LEADGEN_EXECUTION_MODE:mode,WF_BRAIN_WORKFLOW:'douyin_video_discovery'}),/EXECUTION_MODE/);
 assert.throws(()=>executionModeInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_lead_outreach'}),/EXECUTION_MODE/);
});
test('旧快照缺执行模式仍为Code，不能把已冻结Code静默改成Agent或反向切回',async()=>{
 const {assertExecutionMode}=await import('../runtime-definition.mjs');
 const env={WF_BRAIN_WORKFLOW:'douyin_video_discovery'};
 const agent={execution_mode:'agent',workflow_version:{payload:{key:env.WF_BRAIN_WORKFLOW}}};
 assert.equal(assertExecutionMode({},env),'code');
 assert.equal(assertExecutionMode(agent,{...env,LEADGEN_EXECUTION_MODE:'agent'}),'agent');
 assert.throws(()=>assertExecutionMode({}, {...env,LEADGEN_EXECUTION_MODE:'agent'}),/EXECUTION_MODE/);
 assert.throws(()=>assertExecutionMode(agent,env),/EXECUTION_MODE/);
 assert.throws(()=>assertExecutionMode({execution_mode:'invalid'},env),/EXECUTION_MODE/);
});
function primaryFixture({skill=true}={}){
 const f=fixture(),workflow='douyin_video_discovery';f.options.workflowKey=workflow;f.routes['/api/brain/workflows'][0].key=workflow;
 const w=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;w.payload.key=workflow;
 w.payload_sha256=hash({source:{repo:w.source_repo,path:w.source_path,commit:w.source_commit},payload:w.payload});
 if(skill){
  const name='skills/douyin-leadgen-activity-101-collect-videos/SKILL.md',path=join(f.dir,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'---\nname: douyin-leadgen-activity-101-collect-videos\nmetadata:\n  version: 0.1.0\n---\n按合同交付视频。\n');
  const sha=hash(readFileSync(path,'utf8')),av=f.routes['/api/brain/activities/activity-1/versions/av-1'].version;
  av.payload.implementation_bindings.push({kind:'skill',name:'douyin-leadgen-activity-101-collect-videos',version:'0.1.0',status:'verified',repo:av.source_repo,path:'services/phone-adb-controller/'+name,revision:av.source_commit,content_sha256:sha});
  av.payload_sha256=hash({source:{repo:av.source_repo,path:av.source_path,commit:av.source_commit},payload:av.payload});
  const manifest=join(f.dir,'deployment-manifest.json'),body=JSON.parse(readFileSync(manifest));body.files.push({path:'services/phone-adb-controller/'+name,deployed_path:name,content_sha256:sha});writeFileSync(manifest,JSON.stringify(body));
 }
 f.agentInput=agentInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:workflow,WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',WFR_TAG:'primary101',P:'xiaolongxia',SERIAL:'ANGYVB4311010223',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',WF_RUN_MAX_SECONDS:'1800',WF_RUN_START_TS:'1700000000'});
 return f;
}
test('Agent执行模式进入真实冻结摘要；原Code及Agent运行都不能续跑换模式',async()=>{
 const f=primaryFixture();const frozen=await freezeDefinition({...f.options,executionMode:'agent',agentInput:f.agentInput});
 assert.equal(frozen.execution_mode,'agent');assert.equal(frozen.snapshot_sha256,hash(Object.fromEntries(Object.entries(frozen).filter(([k])=>k!=='snapshot_sha256'))));
 await assert.rejects(freezeDefinition({...f.options,executionMode:'code'}),/EXECUTION_MODE/);
 await assert.rejects(freezeDefinition(f.options),/EXECUTION_MODE/);
 const code=primaryFixture();await freezeDefinition(code.options);await assert.rejects(freezeDefinition({...code.options,executionMode:'agent'}),/EXECUTION_MODE/);
});
test('Agent冻结缺本机已验证Skill时在起跑前拒绝，不能只凭Code binding启动',async()=>{
 const f=primaryFixture({skill:false});await assert.rejects(freezeDefinition({...f.options,executionMode:'agent',agentInput:f.agentInput}),/AGENT.*SKILL/);
});
test('真实Agent快照保存完整输入，冻结续跑不能改配额、来源、筛选、任务或预算，也不能撤输入',async()=>{
 const f=primaryFixture(),options={...f.options,executionMode:'agent',agentInput:f.agentInput};
 const first=await freezeDefinition(options);assert.deepEqual(first.agent_input,f.agentInput);
 for(const mutation of [{limit:3},{task_id:'22222222-2222-4222-8222-222222222222'},{source_run:'other101'},{run_max_seconds:1801},{run_start_ts:1700000001},{discovery_filters:{sort:'comprehensive',time_layer:'one_week',location:'unlimited'}}])await assert.rejects(freezeDefinition({...options,agentInput:{...f.agentInput,...mutation}}),/AGENT_INPUT/);
 await assert.rejects(freezeDefinition({...options,agentInput:undefined}),/AGENT_INPUT/);
 const code=primaryFixture(),legacy=await freezeDefinition(code.options),explicit=primaryFixture(),same=await freezeDefinition({...explicit.options,executionMode:'code'});
 assert.equal(Object.hasOwn(legacy,'agent_input'),false);assert.equal(Object.hasOwn(legacy,'execution_mode'),false);assert.equal(legacy.snapshot_sha256,same.snapshot_sha256);
});
test('真实prepare CLI把Agent规范输入写入发布冻结件；续跑改配额或撤Task不生成新快照',async t=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process'),{rmSync}=await import('node:fs');
 const f=primaryFixture(),wf=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version; t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
 wf.payload.key='douyin_comment_scoring';wf.payload_sha256=hash({source:{repo:wf.source_repo,path:wf.source_path,commit:wf.source_commit},payload:wf.payload});
 const release={id:'primary-input-release',environment:'scratch',target:deploymentTarget(hostname()),payload:{schema_version:1,workflows:[wf],activities:[f.routes['/api/brain/activities/activity-1/versions/av-1'].version]}};release.manifest_sha256=hash({environment:release.environment,target:release.target,payload:release.payload});
 const manifest=join(f.dir,'deployment-manifest.json');writeFileSync(manifest,JSON.stringify({...JSON.parse(readFileSync(manifest)),release_id:release.id,observation_id:'primary-input-observation',environment:release.environment,target:release.target}));
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/brain/machines/mac-mini-m4-us')res.end(JSON.stringify({id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',status:'active',metadata:{tailscale_ip:'100.1.1.1',public_ip:'38.1.1.1'}}));else if(req.url==='/api/brain/releases/'+release.id)res.end(JSON.stringify({release}));else{res.statusCode=404;res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const env={...process.env,LEADGEN_EXECUTION_MODE:'agent',BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'fixture-token',WFR_RUN_DIR:f.options.runDir,WF_DEPLOYMENT_ROOT:f.dir,WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',BRAIN_TASK_ID:undefined,WFR_BRAIN_TASK_ID:undefined,WF_CONTRACT_RAW_SHA256:f.options.rawContractSha256,WF_PLAN_PATH:f.options.planPath,WF_STEP_SPEC:'steps.json',WF_ARG_CAP:'test',WFR_TAG:'primary103',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_RUN_ID:'run',WFR_HOME:f.dir,WF_RUN_START_TS:'1700000000',WF_RUN_MAX_SECONDS:'1800',LEADGEN_LIMIT:'2',LEADGEN_SOURCE_RUN:'primary102'};
 const run=change=>new Promise(resolve=>{const child=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,'prepare'],{env:{...env,...change}});let err='';child.stderr.on('data',bytes=>err+=bytes);child.on('exit',code=>resolve({code,err}));});
 assert.deepEqual(await run({}),{code:0,err:''});const original=readFileSync(join(f.options.runDir,'run-definition.json'),'utf8'),actual=JSON.parse(original);assert.deepEqual(actual.agent_input,agentInput(env));
 for(const change of [{LEADGEN_LIMIT:'3'},{WF_BRAIN_TASK_ID:undefined}]){const changed=await run(change);assert.notEqual(changed.code,0);assert.match(changed.err,/AGENT_INPUT/);assert.equal(readFileSync(join(f.options.runDir,'run-definition.json'),'utf8'),original);}
});
test('起跑冻结指定Workflow/Activity版本、引用位置和真实代码，之后latest变化不改run副本', async()=>{
  const f=fixture(); const result=await freezeDefinition(f.options);
  assert.equal(result.workflow_version.id,'wv-1'); assert.equal(result.activities[0].reference.reference_id,'ref-1');
  assert.equal(result.activities[0].version.payload.steps[0].locator.step_key,'execute');
  f.routes['/api/brain/workflows'][0].current_definition_version_id='wv-2';
  writeFileSync(join(f.dir,'steps.json'),'changed');
  const second=await freezeDefinition(f.options); assert.equal(second.workflow_version.id,'wv-1');
  assert.equal(JSON.parse(readFileSync(join(f.dir,'run','step-dod.json'),'utf8')).steps.length,1);
});
test('无版本、被篡改快照或相同SHA标签下实际文件不同，均拒绝起跑',async()=>{
  let f=fixture(); delete f.routes['/api/brain/workflows'][0].current_definition_version_id;
  await assert.rejects(freezeDefinition(f.options),/version|版本/);
  f=fixture(); f.routes['/api/brain/activities/activity-1/versions/av-1'].version.payload.contract.id='tampered';
  await assert.rejects(freezeDefinition(f.options),/digest|摘要/);
  f=fixture(); writeFileSync(join(f.dir,'entry.sh'),'changed\n');
  await assert.rejects(freezeDefinition(f.options),/digest|摘要/);
});

test('104精确订单输入冻结到run，改comment来源或撤掉输入均不能续跑',async()=>{
 const {outreachScopeInput,assertOutreachScope,readFrozen}=await import('../runtime-definition.mjs');
 const f=fixture(),file=join(f.dir,'outreach-scope.json');
 const requested={record_id:'recABC123456',comment_id:'comment-123',company_id:'company1',source_run:'source102',mark_run:'mark103',target_douyin_id:'person987',line_key:'jinuo'};
 writeFileSync(file,JSON.stringify(requested),{mode:0o600});
 const env={WF_BRAIN_WORKFLOW:'douyin_lead_outreach',LEADGEN_SEND:'1',LEADGEN_OUTREACH_SCOPE_FILE:file,WFR_TAG:'contact104',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo'};
 f.options.workflowKey=env.WF_BRAIN_WORKFLOW;f.routes['/api/brain/workflows'][0].key=env.WF_BRAIN_WORKFLOW;
 const v=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;v.payload.key=env.WF_BRAIN_WORKFLOW;v.payload_sha256=hash({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});
 const scope=outreachScopeInput(env);const frozen=await freezeDefinition({...f.options,outreachScope:scope});
 assert.deepEqual(readFrozen(f.options.runDir).outreach_scope,scope);assert.deepEqual(assertOutreachScope(frozen,env),scope);
 writeFileSync(file,JSON.stringify({...requested,comment_id:'other-comment'}));
 assert.throws(()=>assertOutreachScope(frozen,env),/OUTREACH_SCOPE/);
 await assert.rejects(freezeDefinition({...f.options,outreachScope:outreachScopeInput(env)}),/OUTREACH_SCOPE/);
 assert.throws(()=>assertOutreachScope(frozen,{...env,LEADGEN_OUTREACH_SCOPE_FILE:undefined}),/OUTREACH_SCOPE/);
});
test('104普通派发可无精确文件；显式exact缺文件不得退回公司队列',async()=>{
 const {outreachScopeInput,assertOutreachScope}=await import('../runtime-definition.mjs');
 const env={WF_BRAIN_WORKFLOW:'douyin_lead_outreach',LEADGEN_SEND:'1',WFR_TAG:'daily104',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo'};
 assert.equal(outreachScopeInput(env),null);
 assert.equal(assertOutreachScope({outreach_scope:null},env),null);
 assert.throws(()=>outreachScopeInput({...env,LEADGEN_OUTREACH_MODE:'exact'}),/OUTREACH_SCOPE_REQUIRED/);
 assert.throws(()=>outreachScopeInput({...env,LEADGEN_OUTREACH_MODE:'invalid'}),/OUTREACH_SCOPE_MODE_MISMATCH/);
});

test('HTTP→符号链接真实prepare CLI→冻结目录：读取精确历史版本，运行后latest和步骤清单变化不替换冻结快照',async t=>{
 const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');const f=fixture();const seen=[];
 const payload={schema_version:1,workflows:[f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version],activities:[f.routes['/api/brain/activities/activity-1/versions/av-1'].version]};
 const release={id:'release-fixed',environment:'scratch',target:deploymentTarget(hostname()),payload};release.manifest_sha256=hash({environment:release.environment,target:release.target,payload});
 f.routes['/api/brain/releases/release-fixed']={release};
 const manifestFile=join(f.dir,'deployment-manifest.json');const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
 writeFileSync(manifestFile,JSON.stringify({...manifest,release_id:release.id,observation_id:'observation-fixed',environment:release.environment,target:release.target}));
 const server=createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(f.routes[req.url]));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const cli=join(f.dir,'runtime-cli-link.mjs');
 symlinkSync(new URL('../runtime-receipts.mjs',import.meta.url).pathname,cli);
 const env={...process.env,BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-token',WFR_RUN_DIR:f.options.runDir,WF_DEPLOYMENT_ROOT:f.dir,WF_BRAIN_WORKFLOW:'brain-test',WF_CONTRACT_RAW_SHA256:f.options.rawContractSha256,WF_PLAN_PATH:f.options.planPath,WF_STEP_SPEC:'steps.json',WF_ARG_CAP:'test',WFR_TAG:'fixture',P:'p',SERIAL:'S',WFR_RUN_ID:'run',WFR_HOME:f.dir};
 const run=()=>new Promise(resolve=>{const child=spawn(process.execPath,[cli,'prepare'],{env});let err='';child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({code,err}));});
 assert.deepEqual(await run(),{code:0,err:''});
 const {locateRun}=await import('../runtime-definition.mjs');
 assert.equal(locateRun(join(f.dir,'run-index'),{capability:'test',tag:'fixture',profile:'p',serial:'S'}),f.options.runDir);
 assert.throws(()=>locateRun(join(f.dir,'run-index'),{capability:'test',tag:'fixture',profile:'other',serial:'S'}),/身份不匹配/);
 assert.deepEqual(seen,['/api/brain/releases/release-fixed']);
 f.routes['/api/brain/workflows'][0].current_definition_version_id='wv-2';writeFileSync(f.options.stepSpecPath,'global changed');
 assert.deepEqual(await run(),{code:0,err:''});assert.equal(seen.length,1);assert.equal(JSON.parse(readFileSync(join(f.options.runDir,'run-definition.json'),'utf8')).workflow_version.id,'wv-1');
});
test('部署清单未覆盖实际plan/step清单时拒绝，不能借正确契约摘要注入其它执行文件',async()=>{
 const f=fixture();
 await assert.rejects(freezeDefinition({...f.options,planPath:(()=>{const p=join(f.dir,'injected.plan');writeFileSync(p,'WF_DISCOVER_CMD=other.sh\n');return p;})()}),/部署清单|manifest/);
});
test('冻结全部本机实现：全局入口和依赖被部署替换后，续跑实际执行仍为旧字节',async()=>{
 const {execFileSync}=await import('node:child_process');const f=fixture();
 writeFileSync(join(f.dir,'entry.sh'),'#!/bin/sh\n. "$(dirname "$0")/dependency.sh"\nprintf "%s" "$VALUE"\n');
 writeFileSync(join(f.dir,'dependency.sh'),'VALUE=frozen\n');
 const manifest=JSON.parse(readFileSync(join(f.dir,'deployment-manifest.json'),'utf8'));
 manifest.files[0].content_sha256=hash(readFileSync(join(f.dir,'entry.sh'),'utf8'));
 manifest.files.push({path:'services/phone-adb-controller/dependency.sh',deployed_path:'dependency.sh',content_sha256:hash(readFileSync(join(f.dir,'dependency.sh'),'utf8'))});
 writeFileSync(join(f.dir,'deployment-manifest.json'),JSON.stringify(manifest));
 const av=f.routes['/api/brain/activities/activity-1/versions/av-1'].version;av.payload.implementation_bindings[0].content_sha256=manifest.files[0].content_sha256;
 av.payload_sha256=hash({source:{repo:av.source_repo,path:av.source_path,commit:av.source_commit},payload:av.payload});
 await freezeDefinition(f.options);writeFileSync(join(f.dir,'entry.sh'),'echo changed\n');writeFileSync(join(f.dir,'dependency.sh'),'VALUE=changed\n');
 await freezeDefinition(f.options);
 assert.equal(execFileSync('bash',[join(f.options.runDir,'runtime','entry.sh')],{encoding:'utf8'}),'frozen');
});
test('Activity版本读取期间全局plan/spec被替换，冻结只能使用首次已核验字节',async()=>{
 const f=fixture();const plan=readFileSync(f.options.planPath,'utf8');const spec=readFileSync(f.options.stepSpecPath,'utf8');const get=f.options.get;
 f.options.get=async path=>{if(path.includes('/activities/')){writeFileSync(f.options.planPath,'WF_CAP=changed_after_verification\n');writeFileSync(f.options.stepSpecPath,'{"steps":[{"key":"injected"}]}');}return get(path);};
 await freezeDefinition(f.options);
 assert.equal(readFileSync(join(f.options.runDir,'workflow.plan'),'utf8'),plan);
 assert.equal(readFileSync(join(f.options.runDir,'step-dod.json'),'utf8'),spec);
 assert.equal(readFileSync(join(f.options.runDir,'runtime','workflow.plan'),'utf8'),plan);
});

function splitFixture(key='douyin_video_discovery'){
 const f=fixture();const version=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;
 version.payload.contract.capability='keyword_acquisition';version.payload.contract.contract_key=key;
 version.contract_sha256=hash(version.payload.contract);version.payload_sha256=hash({source:{repo:version.source_repo,path:version.source_path,commit:version.source_commit},payload:version.payload});
 f.options.rawContractSha256=version.contract_sha256;f.options.runIdentity={capability:key,tag:'split-fixture',profile:'work',serial:'PHONE',run_id:'run'};return f;
}

test('四新技术contract_key保留业务capability并真实冻结、登记及locate续跑',async()=>{
 const {registerRun,locateRun}=await import('../runtime-definition.mjs');
 for(const key of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach']){
  const f=splitFixture(key),frozen=await freezeDefinition(f.options),index=join(f.dir,'run-index');
  assert.equal(frozen.workflow_version.payload.contract.capability,'keyword_acquisition');assert.equal(frozen.run_identity.capability,key);
  registerRun(index,f.options.runDir,f.options.runIdentity);assert.equal(locateRun(index,f.options.runIdentity),f.options.runDir);
  f.routes['/api/brain/workflows'][0].current_definition_version_id='new-current';
  assert.equal((await freezeDefinition(f.options)).workflow_version.id,'wv-1');
 }
});
test('新技术key不能被业务分类或另一技术key冒认，起跑与既有冻结续跑均拒绝',async()=>{
 const {registerRun,locateRun}=await import('../runtime-definition.mjs');
 const wrong=splitFixture();wrong.options.runIdentity.capability='keyword_acquisition';await assert.rejects(freezeDefinition(wrong.options),/capability身份不匹配/);
 const f=splitFixture();await freezeDefinition(f.options);const index=join(f.dir,'run-index');registerRun(index,f.options.runDir,f.options.runIdentity);
 const different={...f.options.runIdentity,capability:'douyin_video_processing'};
 assert.throws(()=>registerRun(index,f.options.runDir,different),/capability身份不匹配/);
 writeFileSync(join(index,`${hash([different.capability,different.tag])}.json`),JSON.stringify({run_dir:f.options.runDir}));
 assert.throws(()=>locateRun(index,different),/capability身份不匹配/);
 await assert.rejects(freezeDefinition({...f.options,runIdentity:different}),/capability身份不匹配/);
 await assert.rejects(freezeDefinition({...f.options,runIdentity:{...f.options.runIdentity,profile:'another'}}),/身份不匹配/);
});

test('冻结manifest副本和中央路由；全局变化不替换，冻结副本篡改拒绝续跑',async()=>{
 const {readFrozen}=await import('../runtime-definition.mjs');const f=fixture();
 const transport={machine_id:'mmv-fixture',ssh_hostname:'100.71.151.105',ssh_hostkey_alias:'38.23.47.81'};
 await freezeDefinition({...f.options,runtimeTransport:transport});
 const file=join(f.options.runDir,'runtime','deployment-manifest.json');
 const original=readFileSync(file,'utf8');assert.deepEqual(readFrozen(f.options.runDir).runtime_transport,transport);
 writeFileSync(join(f.dir,'deployment-manifest.json'),'changed global');
 await freezeDefinition({...f.options,runtimeTransport:{...transport,ssh_hostname:'100.0.0.1'}});
 assert.equal(readFileSync(file,'utf8'),original);
 assert.deepEqual(readFrozen(f.options.runDir).runtime_transport,transport);
 writeFileSync(file,'tampered');assert.throws(()=>readFrozen(f.options.runDir),/摘要|digest|篡改/);
});

test('评论采样真实冻结到run-definition摘要，改值/取消/改上游或快照篡改均拒绝',async()=>{
 const {commentSamplingInput,assertCommentSampling,readFrozen}=await import('../runtime-definition.mjs');const f=fixture();
 const env={WF_BRAIN_WORKFLOW:'douyin_video_processing',LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101',WFR_TAG:'sample-run',P:'work',SERIAL:'SER',LEADGEN_LINE:'jinuo'};
 f.options.workflowKey=env.WF_BRAIN_WORKFLOW;f.routes['/api/brain/workflows'][0].key=env.WF_BRAIN_WORKFLOW;
 const v=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;v.payload.key=env.WF_BRAIN_WORKFLOW;v.payload_sha256=hash({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});
 const samplingInput=commentSamplingInput(env);await freezeDefinition({...f.options,samplingInput});const fixed=readFrozen(f.options.runDir);assert.deepEqual(fixed.sampling_input,samplingInput);assert.deepEqual(assertCommentSampling(fixed,env),samplingInput);
 await freezeDefinition({...f.options,samplingInput});
 for(const bad of [{...env,LEADGEN_COMMENT_LIMIT:'6'},{...env,LEADGEN_SOURCE_RUN:'other101'},Object.fromEntries(Object.entries(env).filter(([k])=>k!=='LEADGEN_COMMENT_LIMIT'))]){assert.throws(()=>assertCommentSampling(fixed,bad));await assert.rejects(freezeDefinition({...f.options,samplingInput:commentSamplingInput(bad)}));}
 const file=join(f.options.runDir,'run-definition.json');const tampered=JSON.parse(readFileSync(file));tampered.sampling_input.comment_limit=6;writeFileSync(file,JSON.stringify(tampered));assert.throws(()=>readFrozen(f.options.runDir),/digest/);
});
test('采样请求仅合法102整数配额，source/run/profile/serial/line均必有',async()=>{
 const {commentSamplingInput}=await import('../runtime-definition.mjs');const good={WF_BRAIN_WORKFLOW:'douyin_video_processing',LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101',WFR_TAG:'run',P:'p',SERIAL:'s',LEADGEN_LINE:'line'};
 assert.equal(commentSamplingInput({}),null);for(const value of ['0','-1','51','abc','','1.5','05'])assert.throws(()=>commentSamplingInput({...good,LEADGEN_COMMENT_LIMIT:value}));
 for(const k of ['LEADGEN_SOURCE_RUN','WFR_TAG','P','SERIAL','LEADGEN_LINE'])assert.throws(()=>commentSamplingInput({...good,[k]:''}));assert.throws(()=>commentSamplingInput({...good,WF_BRAIN_WORKFLOW:'douyin_video_discovery'}));
});
test('显式collection预算是可选采样冻结字段，改变/删除均拒绝',async()=>{
 const {commentSamplingInput,assertCommentSampling,readFrozen}=await import('../runtime-definition.mjs');const f=fixture();const env={WF_BRAIN_WORKFLOW:'douyin_video_processing',LEADGEN_COMMENT_LIMIT:'5',QUEUED_VIDEO_COLLECTION_SECONDS:'1620',LEADGEN_SOURCE_RUN:'source101',WFR_TAG:'sample-run',P:'work',SERIAL:'SER',LEADGEN_LINE:'jinuo'};
 const samplingInput=commentSamplingInput(env);assert.equal(samplingInput.collection_budget_s,1620);f.options.workflowKey=env.WF_BRAIN_WORKFLOW;f.routes['/api/brain/workflows'][0].key=env.WF_BRAIN_WORKFLOW;const v=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;v.payload.key=env.WF_BRAIN_WORKFLOW;v.payload_sha256=hash({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});await freezeDefinition({...f.options,samplingInput});const fixed=readFrozen(f.options.runDir);assert.equal(fixed.sampling_input.collection_budget_s,1620);assert.deepEqual(assertCommentSampling(fixed,env),samplingInput);
 for(const bad of [{...env,QUEUED_VIDEO_COLLECTION_SECONDS:'1621'},Object.fromEntries(Object.entries(env).filter(([k])=>k!=='QUEUED_VIDEO_COLLECTION_SECONDS'))]){assert.throws(()=>assertCommentSampling(fixed,bad));await assert.rejects(freezeDefinition({...f.options,samplingInput:commentSamplingInput(bad)}));}
});


test('真实部署闭包冻结后导入新handler；缺文件、错hash或冻结后漂移均拒绝',async t=>{
 const {execFileSync,spawnSync}=await import('node:child_process');
 const {copyFileSync,rmSync}=await import('node:fs');const {dirname}=await import('node:path');const {fileURLToPath,pathToFileURL}=await import('node:url');
 const source=fileURLToPath(new URL('../',import.meta.url));
 const deploy=readFileSync(join(source,'deploy.sh'),'utf8'),arrays=deploy.slice(deploy.indexOf('MMV_JS_FILES=('),deploy.indexOf('# 在任何SSH前'));
 const declared=execFileSync('bash',['-c',arrays+'\nprintf "%s\\n" "${MMV_RUNTIME_FILES[@]}"'],{encoding:'utf8'}).trim().split('\n');
 const files=declared.filter(x=>/\.(?:mjs|js|json)$/.test(x));assert.ok(files.includes('leadgen-handlers.mjs'),'official MMV runtime omitted actual handler');
 for(const name of ['leadgen-comment-admission.js','leadgen-comment-admission-authority.js'])
  assert.ok(files.includes(name),`official MMV runtime omitted ${name}`);
 const setup=()=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  const manifest=JSON.parse(readFileSync(join(f.dir,'deployment-manifest.json')));
  for(const name of files){const to=join(f.dir,name);mkdirSync(dirname(to),{recursive:true});copyFileSync(join(source,name),to);manifest.files.push({path:'services/phone-adb-controller/'+name,deployed_path:name,content_sha256:createHash('sha256').update(readFileSync(to)).digest('hex')});}
  writeFileSync(join(f.dir,'deployment-manifest.json'),JSON.stringify(manifest));
  symlinkSync(fileURLToPath(new URL('../../../node_modules',import.meta.url)),join(f.dir,'node_modules'),'dir');
  return f;
 };
 const good=setup();await freezeDefinition(good.options);
 const launch=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(pathToFileURL(join(good.options.runDir,'runtime','leadgen-workflow.mjs')).href)});if(typeof m.createHandlers!=='function'||typeof m.runWorkflow!=='function')throw Error('real module exports missing');`],{encoding:'utf8'});
 assert.equal(launch.status,0,launch.stderr);
 const {readFrozen}=await import('../runtime-definition.mjs');
 rmSync(join(good.options.runDir,'runtime','leadgen-handlers.mjs'));writeFileSync(join(good.options.runDir,'runtime','leadgen-handlers.mjs'),'export const forged=true;');
 assert.throws(()=>readFrozen(good.options.runDir),/冻结文件digest不符/);
 const missing=setup();rmSync(join(missing.dir,'leadgen-handlers.mjs'));await assert.rejects(freezeDefinition(missing.options),/ENOENT/);
 const wrong=setup();writeFileSync(join(wrong.dir,'leadgen-handlers.mjs'),'export const forged=true;');await assert.rejects(freezeDefinition(wrong.options),/实际部署文件digest不符/);
});

test('冻结期间正式manifest切换时不发布旧run身份',async()=>{
 const f=fixture(),get=f.options.get;let changed=false;
 f.options.get=async path=>{
  if(!changed){changed=true;const p=join(f.dir,'deployment-manifest.json');const m=JSON.parse(readFileSync(p));m.source_commit='c'.repeat(40);writeFileSync(p,JSON.stringify(m));}
  return get(path);
 };
 await assert.rejects(freezeDefinition(f.options),/部署声明.*变化/);
});

test('生产入口遇未收尾事务拒绝新冻结，独立候选不冒充生产路径',async()=>{
 const {assertDeploymentAdmission}=await import('../runtime-definition.mjs');
 const home=mkdtempSync(join(tmpdir(),'phone-admission-'));
 mkdirSync(join(home,'bin-harvest'));
 const state=join(home,'.local/share/zenithjoy/phone-transactions');mkdirSync(state,{recursive:true});writeFileSync(join(state,'active.json'),'{}');
 assert.throws(()=>assertDeploymentAdmission(join(home,'bin-harvest'),home),/整包部署/);
 const candidate=join(home,'candidate');mkdirSync(candidate);assert.doesNotThrow(()=>assertDeploymentAdmission(candidate,home));
});


test('明确collection_phone_scope纳入冻结摘要，续跑不得替换scope输入', async()=>{
 const f=fixture(),scope={version:1,source_commit:'a'.repeat(40),target:'xian-m4',profile:'fixture',serial:'NO-DEVICE',policy:{adb_sha256:'1'.repeat(64)}};
 const manifestPath=join(f.dir,'deployment-manifest.json');writeFileSync(manifestPath,JSON.stringify({...JSON.parse(readFileSync(manifestPath,'utf8')),target:'xian-m4'}));
 const first=await freezeDefinition({...f.options,collectionPhoneScope:scope});
 assert.deepEqual(first.collection_phone_scope,scope);
 await assert.rejects(freezeDefinition({...f.options,collectionPhoneScope:{...scope,serial:'OTHER'}}),/collection.*scope|手机.*scope/i);
});

for(const automatic of [false,true])test(`正式prepare${automatic?'默认模板':'文件参数'}冻结Task scope，原bind-run public ACK仍无task_id`,async t=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process');const f=fixture(),target=deploymentTarget(hostname());f.options.runDir=join(f.dir,'formal-scope');
 const workflow=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;
 workflow.payload.key='douyin_video_processing';workflow.payload_sha256=hash({source:{repo:workflow.source_repo,path:workflow.source_path,commit:workflow.source_commit},payload:workflow.payload});
 const release={id:'scope-cli-release',environment:'scratch',target,payload:{schema_version:1,workflows:[workflow],activities:[f.routes['/api/brain/activities/activity-1/versions/av-1'].version]}};
 release.manifest_sha256=hash({environment:release.environment,target,payload:release.payload});
 const manifestFile=join(f.dir,'deployment-manifest.json');writeFileSync(manifestFile,JSON.stringify({...JSON.parse(readFileSync(manifestFile,'utf8')),release_id:release.id,observation_id:'scope-cli-observation',environment:'scratch',target}));
 const taskId='11111111-2222-4333-8444-555555555555';
 const tool={path:'/usr/bin/true',sha256:'1'.repeat(64)},scope={version:1,task_id:taskId,run_id:'formal-scope__a1',attempt:'a1',source_commit:'a'.repeat(40),profile:'p',serial:'S',target,evidence_root:'/private/tmp/fixture/evidence/p',policy:{schema_version:1,host_id:target,transport:target==='xian-m4'?'usb':'tcp',endpoint:'tcp:127.0.0.1:5042',forbidden_ports:[],adb_bin:'/fixture/adb',adb_sha256:'1'.repeat(64)},executables:{python:tool,node:tool,zsh:tool}};
 const input=join(f.dir,'scope-input.json');writeFileSync(input,JSON.stringify(scope),{mode:0o600});let binding;
 const server=createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/brain/machines/mac-mini-m4-us')res.end(JSON.stringify({id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',status:'active',metadata:{tailscale_ip:'100.1.1.1',public_ip:'38.1.1.1'}}));else if(req.url==='/api/brain/releases/'+release.id)res.end(JSON.stringify({release}));else if(req.url==='/api/brain/runs/formal-scope__a1/definition'){if(req.method==='POST')binding={id:'public-scope-binding',run_id:'formal-scope__a1',...JSON.parse(raw),task_run_id:null};res.end(JSON.stringify({binding}));}else{res.statusCode=404;res.end('{}');}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const cli=new URL('../runtime-receipts.mjs',import.meta.url).pathname,env={...process.env,BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'fixture-token',WFR_RUN_DIR:f.options.runDir,WF_DEPLOYMENT_ROOT:f.dir,WF_BRAIN_WORKFLOW:'douyin_video_processing',WF_BRAIN_TASK_ID:taskId,WF_CONTRACT_RAW_SHA256:f.options.rawContractSha256,WF_PLAN_PATH:f.options.planPath,WF_STEP_SPEC:'steps.json',WF_ARG_CAP:'test',WFR_TAG:'formal',P:'p',SERIAL:'S',WFR_RUN_ID:'formal-scope',WFR_HOME:f.dir};
 const run=args=>new Promise(resolve=>{const child=spawn(process.execPath,[cli,...args],{env});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('close',code=>resolve({code,stdout,stderr}));});
 if(!automatic){writeFileSync(input,JSON.stringify({...scope,task_id:null}));const wrong=await run(['prepare','--collection-phone-scope',input]);assert.notEqual(wrong.code,0);assert.match(wrong.stderr,/CENTRAL_TASK_FROZEN_SCOPE_MISMATCH/);writeFileSync(input,JSON.stringify(scope));}
 if(automatic){mkdirSync(join(f.dir,'config'));const template=join(f.dir,'config/collection-phone-hosts.json');writeFileSync(template,JSON.stringify({version:1,hosts:[{target,profile:'p',serial:'S',expected_account:'44997267357',evidence_root:scope.evidence_root,policy:scope.policy,executables:scope.executables}]}));const m=JSON.parse(readFileSync(manifestFile));m.files.push({path:'services/phone-adb-controller/config/collection-phone-hosts.json',deployed_path:'config/collection-phone-hosts.json',content_sha256:hash(readFileSync(template,'utf8'))});writeFileSync(manifestFile,JSON.stringify(m));scope.expected_account='44997267357';}
 const prepared=await run(automatic?['prepare']:['prepare','--collection-phone-scope',input]);assert.equal(prepared.code,0,prepared.stderr);
 const bound=await run(['bind-run']);assert.equal(bound.code,0,bound.stderr);assert.match(bound.stdout,/WFR_ATTEMPT=a1/);
 const {readFrozen}=await import('../runtime-definition.mjs'),{readBinding}=await import('../runtime-binding.mjs'),frozen=readFrozen(f.options.runDir),actual=readBinding(f.options.runDir,'a1',frozen);
 assert.deepEqual(frozen.collection_phone_scope,scope);assert.equal(actual.task_id,null);assert.equal(frozen.collection_phone_scope.task_id,taskId);assert.equal(actual.run_id,scope.run_id);
 if(automatic){writeFileSync(join(f.dir,'config/collection-phone-hosts.json'),JSON.stringify({version:1,hosts:[]}));const resumed=await run(['prepare']);assert.equal(resumed.code,0,resumed.stderr);assert.deepEqual(readFrozen(f.options.runDir).collection_phone_scope,scope);}
});

test('101独立discovery_phone_scope入冻结摘要，不能变更或借给102',async()=>{
 const f=fixture(),scope={version:1,source_commit:'a'.repeat(40),target:'xian-m4',profile:'fixture',serial:'NO-DEVICE',policy:{adb_sha256:'1'.repeat(64)}};
 f.options.workflowKey='douyin_video_discovery';f.routes['/api/brain/workflows'][0].key=f.options.workflowKey;
 const v=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;v.payload.key=f.options.workflowKey;v.payload_sha256=hash({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});
 const manifest=join(f.dir,'deployment-manifest.json');writeFileSync(manifest,JSON.stringify({...JSON.parse(readFileSync(manifest)),target:'xian-m4'}));
 const first=await freezeDefinition({...f.options,discoveryPhoneScope:scope});assert.deepEqual(first.discovery_phone_scope,scope);assert.equal(first.collection_phone_scope,undefined);
 await assert.rejects(freezeDefinition({...f.options,discoveryPhoneScope:{...scope,serial:'OTHER'}}),/discovery phone scope/);
 const other=fixture();await assert.rejects(freezeDefinition({...other.options,discoveryPhoneScope:scope}),/discovery phone scope部署来源不符/);
});
test('显式producer真实冻结进入digest；续跑不得改变或移除，CLI始终可解析',async()=>{
 const {spawnSync}=await import('node:child_process');const d={schema_version:1,workflow_key:'douyin_video_discovery',run_tag:'cicd24c9_101_20261023_2013',source_commit:'24c9e6b97b81ae144985474d9e33665bf65a6a8e',profile:'legacy',serial:'ANGYVB4402004137',line:'jinuo',company_id:'ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant_id:'a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61',company_config_version:14,policy_id:'jinoshengyuan-existing-acquisition-rules-v1',snapshot_sha256:'a'.repeat(64),progress_sha256:'b'.repeat(64),video_ids:['7699316353698753663']};
 const f=fixture();f.routes['/api/brain/workflows'][0].key='douyin_video_processing';Object.assign(f.options,{workflowKey:'douyin_video_processing',producerDescriptor:d,runIdentity:{capability:'test',tag:'consumer',profile:'legacy',serial:d.serial,run_id:'run'},samplingInput:{schema_version:1,workflow_key:'douyin_video_processing',run_tag:'consumer',profile:'legacy',serial:d.serial,line:'jinuo',source_run:d.run_tag,comment_limit:5}});
 const v=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;v.payload.key='douyin_video_processing';v.payload_sha256=hash({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});const s=await freezeDefinition(f.options);assert.deepEqual(s.producer_descriptor,d);assert.equal(s.snapshot_sha256,hash(Object.fromEntries(Object.entries(s).filter(([k])=>k!=='snapshot_sha256'))));
 await assert.rejects(freezeDefinition({...f.options,producerDescriptor:null}),/PRODUCER_DESCRIPTOR_RESUME/);
 await assert.rejects(freezeDefinition({...f.options,producerDescriptor:{...d,progress_sha256:'c'.repeat(64)}}),/PRODUCER_DESCRIPTOR_RESUME/);
 const syntax=spawnSync(process.execPath,['--check',new URL('../runtime-receipts.mjs',import.meta.url).pathname],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
});


test('v2来源交接冻结必须保采样≤5及原480预算，不影响v1',async()=>{
 const {pendingDescriptor:d}=await import('./fixtures/producer-pending-descriptor.mjs');
 const options=()=>{const f=fixture();f.routes['/api/brain/workflows'][0].key='douyin_video_processing';Object.assign(f.options,{workflowKey:'douyin_video_processing',producerDescriptor:d,runIdentity:{capability:'test',tag:'pendingconsumer',profile:'legacy',serial:d.serial,run_id:'run'},samplingInput:{schema_version:1,workflow_key:'douyin_video_processing',run_tag:'pendingconsumer',profile:'legacy',serial:d.serial,line:'jinuo',source_run:d.run_tag,comment_limit:5,collection_budget_s:480}});const v=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;v.payload.key='douyin_video_processing';v.payload_sha256=hash({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});return f.options;};
 for(const change of [o=>o.samplingInput=null,o=>o.samplingInput.comment_limit=6,o=>o.samplingInput.collection_budget_s=481,o=>o.samplingInput.line='yuesheng']){const o=options();change(o);await assert.rejects(freezeDefinition(o),/PRODUCER_DESCRIPTOR_SAMPLING_SCOPE_INVALID/);}
 const o=options(),s=await freezeDefinition(o);assert.deepEqual(s.producer_descriptor,d);assert.equal(s.sampling_input.comment_limit,5);assert.equal(s.deployment.source_commit,'a'.repeat(40));
});


test('真实HTTP prepare仅取精确MMV活记录，全量不可用仍冻结路由；坏登记或release/source失败不冻结',async t=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process'),{existsSync,rmSync}=await import('node:fs');
 const f=primaryFixture(),wf=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;
 t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
 wf.payload.key='douyin_comment_scoring';wf.payload_sha256=hash({source:{repo:wf.source_repo,path:wf.source_path,commit:wf.source_commit},payload:wf.payload});
 const release={id:'exact-mmv-release',environment:'scratch',target:deploymentTarget(hostname()),payload:{schema_version:1,workflows:[wf],activities:[f.routes['/api/brain/activities/activity-1/versions/av-1'].version]}};
 release.manifest_sha256=hash({environment:release.environment,target:release.target,payload:release.payload});
 const manifest=join(f.dir,'deployment-manifest.json');
 writeFileSync(manifest,JSON.stringify({...JSON.parse(readFileSync(manifest)),release_id:release.id,observation_id:'exact-mmv-observation',environment:release.environment,target:release.target}));
 const valid={id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',name:'mac-mini-m4-us',status:'active',metadata:{tailscale_ip:'100.1.2.3',public_ip:'38.1.2.3'}};
 let machine=valid,machineStatus=200,releaseStatus=200;const seen=[];
 const server=createServer((req,res)=>{
  seen.push(req.url);assert.equal(req.headers.authorization,'Bearer fixture-token');res.setHeader('Content-Type','application/json');
  if(req.url==='/api/brain/machines/mac-mini-m4-us'){res.statusCode=machineStatus;res.end(typeof machine==='string'?machine:JSON.stringify(machine));}
  else if(req.url==='/api/brain/machines'){res.statusCode=503;res.end('{"error":"inventory projection unavailable"}');}
  else if(req.url==='/api/brain/releases/'+release.id){res.statusCode=releaseStatus;res.end(JSON.stringify({release}));}
  else{res.statusCode=404;res.end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const env={...process.env,HOME:f.dir,LEADGEN_EXECUTION_MODE:'agent',BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'fixture-token',WF_DEPLOYMENT_ROOT:f.dir,WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',BRAIN_TASK_ID:undefined,WFR_BRAIN_TASK_ID:undefined,WF_CONTRACT_RAW_SHA256:f.options.rawContractSha256,WF_PLAN_PATH:f.options.planPath,WF_STEP_SPEC:'steps.json',WF_ARG_CAP:'test',WFR_TAG:'exact103',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_RUN_ID:'exact-run',WFR_HOME:f.dir,WF_RUN_START_TS:'1700000000',WF_RUN_MAX_SECONDS:'1800',LEADGEN_LIMIT:'10',LEADGEN_SOURCE_RUN:'new102'};
 let sequence=0;
 async function prepare(route='tailscale'){
  const dir=join(f.dir,'run-'+(++sequence));
  const result=await new Promise((done,reject)=>{const child=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,'prepare'],{env:{...env,WFR_RUN_DIR:dir,WFR_RUN_ID:'run-'+sequence,WFR_HOME:join(f.dir,'home-'+sequence),WF_MMV_SSH_ROUTE:route}});let err='';child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>done({code,err}));});
  assert.equal(existsSync(join(dir,'run-bindings')),false,'prepare不能绑定或执行业务');
  assert.equal(existsSync(join(dir,'native-operations')),false,'prepare不能执行phone');
  return {...result,dir};
 }
 for(const route of ['tailscale','public']){
  const result=await prepare(route);assert.equal(result.code,0,result.err);
  const frozen=JSON.parse(readFileSync(join(result.dir,'run-definition.json')));
  assert.deepEqual(frozen.runtime_transport,{machine_id:valid.id,ssh_hostname:route==='public'?'38.1.2.3':'100.1.2.3',ssh_hostkey_alias:'38.1.2.3'});
  assert.equal(frozen.execution_mode,'agent');assert.equal(frozen.agent_input.source_run,'new102');
 }
 const invalid=[{label:'null record',body:null},{label:'array shape',body:[valid]},{label:'duplicate records',body:[valid,valid]},{label:'wrong id',body:{...valid,id:'other'}},{label:'inactive',body:{...valid,status:'offline'}},{label:'missing tailscale',body:{...valid,metadata:{public_ip:'38.1.2.3'}}},{label:'missing alias',body:{...valid,metadata:{tailscale_ip:'100.1.2.3'}}},{label:'malformed address',body:{...valid,metadata:{...valid.metadata,tailscale_ip:'100.1.2.3;command'}}},{label:'missing machine',body:{},status:404},{label:'malformed JSON',body:'not-json'}];
 for(const sample of invalid){
  machine=sample.body;machineStatus=sample.status||200;const result=await prepare();
  assert.notEqual(result.code,0,sample.label);assert.equal(existsSync(join(result.dir,'run-definition.json')),false,sample.label);
 }
 machine=valid;machineStatus=200;releaseStatus=404;
 let result=await prepare();assert.notEqual(result.code,0);assert.match(result.err,/Brain HTTP 404/);assert.equal(existsSync(join(result.dir,'run-definition.json')),false);
 releaseStatus=200;writeFileSync(join(f.dir,'entry.sh'),'changed source after release\n');
 result=await prepare();assert.notEqual(result.code,0);assert.equal(existsSync(join(result.dir,'run-definition.json')),false,'源码与发布清单不符不能冻结');
 assert.ok(seen.includes('/api/brain/machines/mac-mini-m4-us'));
 assert.ok(!seen.includes('/api/brain/machines'),'不回退全库存或缓存');
 assert.ok(seen.every(path=>path==='/api/brain/machines/mac-mini-m4-us'||path==='/api/brain/releases/'+release.id),'无别名/任意机器fallback');
});

test('Agent preflight private dependency/control identities freeze together and cannot drift or disappear on resume',async()=>{
 const f=primaryFixture(),deps=await import('../preflight-pg-dependencies.mjs');await deps.installPreflightPg({runtimeRoot:f.dir,sourceCommit:'a'.repeat(40)});
 const preflightPg=deps.preflightPgLockIdentity({runtimeRoot:f.dir}),manifestPath=join(f.dir,'deployment-manifest.json'),manifest=JSON.parse(readFileSync(manifestPath)),descriptor='preflight-pg-lock.json',bytes=readFileSync(join(f.dir,descriptor));
 manifest.files.push({path:'services/phone-adb-controller/'+descriptor,deployed_path:descriptor,content_sha256:hash(bytes.toString('utf8'))});manifest.dependencies={preflight_pg:deps.preflightPgDeployment({runtimeRoot:f.dir,sourceCommit:'a'.repeat(40)})};writeFileSync(manifestPath,JSON.stringify(manifest));
 const av=f.routes['/api/brain/activities/activity-1/versions/av-1'].version;av.payload.implementation_bindings.push({kind:'code',status:'verified',repo:av.source_repo,path:'services/phone-adb-controller/'+descriptor,revision:av.source_commit,content_sha256:hash(bytes.toString('utf8'))});av.payload_sha256=hash({source:{repo:av.source_repo,path:av.source_path,commit:av.source_commit},payload:av.payload});
 const preflightControlScope={version:1,source_commit:'a'.repeat(40),target:'mmv',policy_sha256:'e'.repeat(64),credentials_sha256:'f'.repeat(64)};
 const preflightProfile={schema_version:1,path:join(f.dir,'cloud-phone-test-profiles.tsv'),sha256:'1'.repeat(64),profile:f.agentInput.profile,serial:f.agentInput.serial,model:'iPad Pro',width:720,height:1280,enabled:true};
 const options={...f.options,executionMode:'agent',agentInput:f.agentInput,preflightPg,preflightControlScope,preflightProfile};
 const frozen=await freezeDefinition(options);const runtimeRoot=join(f.options.runDir,'runtime'),pool=new (deps.loadPreflightPg({runtimeRoot,frozen}).Pool)({max:1});await pool.end();assert.deepEqual(deps.preflightPgDeployment({runtimeRoot,sourceCommit:'a'.repeat(40)}),manifest.dependencies.preflight_pg);assert.deepEqual(frozen.preflight_pg,preflightPg);assert.deepEqual(frozen.preflight_control_scope,preflightControlScope);assert.deepEqual(frozen.preflight_profile,preflightProfile);
 const code=await freezeDefinition({...f.options,runDir:join(f.dir,'code-run')});assert.equal(Object.hasOwn(code,'preflight_pg'),false);assert.equal(Object.hasOwn(code,'preflight_control_scope'),false);assert.equal(Object.hasOwn(code,'preflight_profile'),false);assert.deepEqual(deps.preflightPgDeployment({runtimeRoot:join(f.dir,'code-run/runtime'),sourceCommit:'a'.repeat(40)}),manifest.dependencies.preflight_pg);
 const wf=f.routes['/api/brain/workflows/workflow-1/versions/wv-1'].version;f.routes['/api/brain/workflows'][0].key='douyin_lead_outreach';wf.payload.key='douyin_lead_outreach';wf.payload_sha256=hash({source:{repo:wf.source_repo,path:wf.source_path,commit:wf.source_commit},payload:wf.payload});
 const outreach=await freezeDefinition({...f.options,workflowKey:'douyin_lead_outreach',runDir:join(f.dir,'outreach-code-run')});assert.equal(Object.hasOwn(outreach,'preflight_pg'),false);assert.equal(Object.hasOwn(outreach,'execution_mode'),false);assert.equal(Object.hasOwn(outreach,'preflight_profile'),false);assert.deepEqual(deps.preflightPgDeployment({runtimeRoot:join(f.dir,'outreach-code-run/runtime'),sourceCommit:'a'.repeat(40)}),manifest.dependencies.preflight_pg);
 for(const change of [{preflightProfile:undefined},...Object.entries(preflightProfile).map(([k,v])=>({preflightProfile:{...preflightProfile,[k]:typeof v==='number'?v+1:typeof v==='boolean'?!v:String(v)+'changed'}})),{preflightPg:undefined},{preflightControlScope:undefined},{preflightPg:{...preflightPg,lock_sha256:'0'.repeat(64)}},{preflightControlScope:{...preflightControlScope,credentials_sha256:'0'.repeat(64)}}])await assert.rejects(freezeDefinition({...options,...change}),/PREFLIGHT_INPUT_RESUME/);
});

const cloudAgentEnv=()=>({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',WFR_TAG:'cloud101',P:'cloud-phone-test',SERIAL:'47.100.213.173:10001',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',WF_RUN_MAX_SECONDS:'1800',WF_RUN_START_TS:'1700000000'});
test('云手机原生序列号可冻结并读回；续跑不可换同IP的端口或其他身份',async()=>{
 const {validateAgentInput,assertAgentInput}=await import('../runtime-definition.mjs');
 const env=cloudAgentEnv(),input=agentInput(env),snapshot={execution_mode:'agent',workflow_version:{payload:{key:env.WF_BRAIN_WORKFLOW}},agent_input:input};
 assert.equal(input.serial,env.SERIAL);assert.deepEqual(validateAgentInput(input),input);assert.deepEqual(assertAgentInput(snapshot,env),input);
 for(const change of [{SERIAL:'47.100.213.173:10002'},{SERIAL:'47.100.213.174:10001'},{P:'other'},{WF_BRAIN_TASK_ID:'22222222-2222-4222-8222-222222222222'}])assert.throws(()=>assertAgentInput(snapshot,{...env,...change}),/AGENT_INPUT/);
 for(const key of ['WFR_TAG','P','LEADGEN_LINE'])assert.throws(()=>agentInput({...env,[key]:'47.100.213.173:10001'}),/AGENT_INPUT/);
});
test('TCP设备身份只认规范IPv4和十进制端口，不接受主机名、参数或歧义表示',()=>{
 const env=cloudAgentEnv();
 for(const serial of ['cloud.example:10001','047.100.213.173:10001','47.100.213.256:10001','47.100.213.173:010001','47.100.213.173:0','47.100.213.173:65536','47.100.213.173:10001 -H remote','47.100.213.173:10001\n','[::1]:10001','47.100.213.173:1:2'])assert.throws(()=>agentInput({...env,SERIAL:serial}),/AGENT_INPUT/);
 for(const serial of ['ANGYVB4311010223','e6c7ef34'])assert.equal(agentInput({...env,SERIAL:serial}).serial,serial);
});
test('101来源输入保留规范云serial；普通标签语法保持原限制',async()=>{
 const {validateDiscoveryInput}=await import('../runtime-definition.mjs');
 const input={schema_version:2,workflow_key:'douyin_video_discovery',run_tag:'cloud101',profile:'cloud-phone-test',serial:'47.100.213.173:10001',line:'yuesheng',max_attempts:2,max_screens:1,source_kind:'keyword',sources:['悦升'],source_sha256:'a'.repeat(64)};
 assert.deepEqual(validateDiscoveryInput(input),input);
 for(const change of [{serial:'47.100.213.173:010001'},{profile:'47.100.213.173:10001'},{line:'yuesheng:10001'}])assert.throws(()=>validateDiscoveryInput({...input,...change}),/DISCOVERY_INPUT/);
});
