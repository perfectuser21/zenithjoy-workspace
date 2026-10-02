import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import { deploymentTarget } from '../runtime-host.mjs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { freezeDefinition } from '../runtime-definition.mjs';
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
