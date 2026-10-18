import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {prepareAndDeploy} from '../deployment-prepare.mjs';
import {digest} from '../runtime-definition.mjs';
import {normalizedDescriptions} from './fixtures/normalized-description-bindings.mjs';
const repo='perfectuser21/zenithjoy-workspace';
const uuid=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
async function fixture(t,{migrated=false}={}){
 const temp=mkdtempSync(join(tmpdir(),'phone-prepare-http-')),root=join(temp,'repo'),dir=join(root,'services/phone-adb-controller');mkdirSync(dir,{recursive:true});
 const marker=join(temp,'deployed.json'),path=migrated?'services/phone-adb-controller/commander/skills/workflow-commander/SKILL.md':'services/phone-adb-controller/entry.sh';mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),'fixed implementation\n');
 if(migrated){
  const source=join(root,'.skills-source');mkdirSync(join(source,'distribution'),{recursive:true});mkdirSync(join(root,'scripts'));
  writeFileSync(join(root,'scripts/skills-source.py'),readFileSync(new URL('../../../scripts/skills-source.py',import.meta.url)));
  writeFileSync(join(source,'manual.md'),'fixed implementation\n');
  writeFileSync(join(source,'distribution/catalog.json'),JSON.stringify({profiles:{zenithjoy:{files:[{path,source:'manual.md',sha256:digest(Buffer.from('fixed implementation\n'))}]}}}));
  const sg=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
  sg('init','-q','-b','cp-fixture');sg('config','core.hooksPath','/dev/null');sg('add','.');sg('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','source');
  writeFileSync(join(root,'.skills-source.json'),JSON.stringify({repository:'perfectuser21/zenithjoy-skills',revision:sg('rev-parse','HEAD'),profile:'zenithjoy',loader_sha256:'0'.repeat(64)}));
  writeFileSync(join(root,'.gitignore'),'.skills-source/\n'+path+'\n');
 }
 // 假部署入口仅记录显式参数；不调用任何机器或设备。
 writeFileSync(join(dir,'deploy.sh'),`#!/bin/bash\nnode -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({ids:JSON.parse(process.env.WF_RELEASE_IDS),plan:JSON.parse(fs.readFileSync(process.env.WF_DEPLOY_PLAN_FILE)),map:JSON.parse(fs.readFileSync(process.env.WF_COMMANDER_RELEASES_FILE)),collector:process.env.WF_DEPLOY_COLLECTOR,environment:process.env.WF_DEPLOY_ENVIRONMENT,attempt:process.env.WF_DEPLOY_ATTEMPT_KEY,token_present:process.env.BRAIN_INTERNAL_TOKEN==="fixture-private-token"}))' '${marker}'\n`);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','-q','-b','cp-fixture');git('config','core.hooksPath','/dev/null');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 const sha=git('rev-parse','HEAD');git('remote','add','origin',`https://github.com/${repo}.git`);git('update-ref','refs/remotes/origin/main',sha);
 const make=(id,payload,extra)=>({id,...extra,source_repo:repo,source_path:'product-map/contracts/phone.yaml',source_commit:sha,payload,payload_sha256:digest({source:{repo,path:'product-map/contracts/phone.yaml',commit:sha},payload})});
 const activities=[make(uuid(3),{activity_id:uuid(4),steps:[],implementation_bindings:[{kind:'code',scope:'activity',status:'verified',repo,path,revision:sha,digest:'sha256:'+digest(readFileSync(join(root,path)))},...structuredClone(normalizedDescriptions)]},{activity_id:uuid(4)})];
 const workflows=[101,102,103,104].map((n,i)=>{const workflow_id=`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;return make(uuid(i+1),{workflow_id,key:['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'][i],activities:[{activity_id:uuid(4),activity_version_id:uuid(3)}]},{workflow_id});});
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision:sha,status:'verified',gaps:[],definitions:{workflows,activities}};snapshot.snapshot_sha256=digest(snapshot);
 const report={source:{repo,base_revision:'b'.repeat(40),head_revision:sha,changed_files:[path]},mapping_status:'verified',truncated:false,gaps:[],protocol:'pilot_release_verification_v1',purpose:'release_verification',scope:'zenithjoy',snapshot_sha256:snapshot.snapshot_sha256,verification_status:'verified',assertion_source:'current_registration',definition_versions:{workflows,activities},expected_usages:workflows.map(w=>({workflow_id:w.workflow_id})),required_assertions:[{assertion_ref:'fixture.test.sh',source_bindings:[]}]};
 report.source={repo,head_revision:sha};
 report.assertion_plan_sha256=digest(Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]])));
 const receipt={purpose:'release_verification',actor:'pilot_release_verification',verdict:'PASS',scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,source:report.source,report_sha256:digest(Buffer.from(JSON.stringify(report))),assertions:[{assertion_ref:'fixture.test.sh',source_bindings:[],source_repo:repo,source_revision:sha,test_sha256:'c'.repeat(64),exit_code:0}]};
 const makeExtra=(n,key)=>make(`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,{workflow_id:`00000000-0000-4000-8000-${String(n+100).padStart(12,'0')}`,key,activities:[{activity_id:uuid(4),activity_version_id:uuid(3)}]},{workflow_id:`00000000-0000-4000-8000-${String(n+100).padStart(12,'0')}`});
 workflows.push(makeExtra(20,'douyin_video_publish.android'));
 const commanderWorkflows=[makeExtra(21,'workflow_report.internal'),makeExtra(22,'workflow_commander.internal')];
 const refresh=e=>{delete e.snapshot.snapshot_sha256;e.snapshot.snapshot_sha256=digest(e.snapshot);e.report.snapshot_sha256=e.snapshot.snapshot_sha256;e.report.definition_versions=e.snapshot.definitions;e.report.assertion_plan_sha256=digest(Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,e.report[k]])));Object.assign(e.receipt,{snapshot_sha256:e.snapshot.snapshot_sha256,assertion_plan_sha256:e.report.assertion_plan_sha256,report_sha256:digest(Buffer.from(JSON.stringify(e.report)))});};
 refresh({snapshot,report,receipt});
 const commander=structuredClone({snapshot,report,receipt});commander.snapshot.scope='commander-generic';commander.snapshot.definitions.workflows=commanderWorkflows;commander.report.scope='commander-generic';refresh(commander);
 const patrol=structuredClone(commander);patrol.snapshot.scope='cecelia-device-patrol-definitions';patrol.snapshot.definitions.workflows=[makeExtra(23,'single-phone-account-patrol')];patrol.report.scope='cecelia-device-patrol-definitions';refresh(patrol);
 const bundlePath=join(temp,'bundle.json');writeFileSync(bundlePath,JSON.stringify({run:{id:42,sha,repo,branch:'main',event:'push',path:'.github/workflows/pilot-release-verification.yml'},snapshot,report,receipt,commander,patrol}));
 const tokenPath=join(temp,'token.env');writeFileSync(tokenPath,'CECELIA_INTERNAL_TOKEN=fixture-private-token\n',{mode:0o600});
 const releases=new Map(),requests=[];let mode='valid';
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture-private-token');let body='';for await(const part of req)body+=part;requests.push({method:req.method,path:req.url});
  let release;
  if(req.method==='POST'){
   const input=JSON.parse(body);assert.ok(input.components.every(c=>c.kind!=='raw'));assert.deepEqual(snapshot.definitions.activities[0].payload.implementation_bindings.slice(1),normalizedDescriptions);const id=input.target==='xian-m4'?uuid(5):input.target==='xian-m1'?uuid(6):uuid(7);
   release={id,environment:input.environment,target:input.target,payload:{workflows:[...workflows,...commanderWorkflows].filter(w=>input.workflows.some(r=>r.workflow_definition_version_id===w.id)),activities,components:input.components,verification:{status:mode==='unknown'?'unknown':'verified'}}};
   if(mode==='wrong_target')release.target='elsewhere';
   release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});releases.set(id,release);
  }else release=releases.get(req.url.split('/').at(-1));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({release}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 if(migrated)rmSync(join(root,path));
 return {root,sha,bundlePath,attemptKey:'github:42:100:1',brainUrl:`http://127.0.0.1:${server.address().port}`,tokenPath,marker,requests,setMode:value=>mode=value};
}
test('真实normalized描述保留unknown，Git+HTTP两release回读后才部署固定组件',async t=>{
 const f=await fixture(t);await prepareAndDeploy(f);const actual=JSON.parse(readFileSync(f.marker));
 assert.equal(actual.collector,'phone-adb-deployer');assert.equal(actual.environment,'production');assert.equal(actual.token_present,true);assert.equal(actual.attempt,'github:42:100:1');assert.deepEqual(Object.keys(actual.ids).sort(),['mmv','xian-m4']);
 assert.equal(actual.plan.releases.mmv.payload.workflows.length,7);assert.equal(actual.plan.releases['xian-m4'].payload.workflows.length,4);assert.deepEqual(actual.map,actual.plan.commander_releases);assert.deepEqual(Object.keys(actual.map),[actual.ids.mmv]);assert.equal(Object.keys(actual.map[actual.ids.mmv].workflows).length,7);
 assert.deepEqual(f.requests.map(r=>r.method),['POST','POST','GET','GET']);
});
for(const mode of ['unknown','wrong_target'])test(`真实Brain ${mode}回执阻止部署子进程`,async t=>{
 const f=await fixture(t);f.setMode(mode);await assert.rejects(prepareAndDeploy(f));assert.equal(existsSync(f.marker),false);
});
test('工作区字节漂移在创建release前拒绝',async t=>{
 const f=await fixture(t);writeFileSync(join(f.root,'services/phone-adb-controller/entry.sh'),'changed');await assert.rejects(prepareAndDeploy(f));assert.equal(f.requests.length,0);assert.equal(existsSync(f.marker),false);
});

test('真实prepareAndDeploy在全新迁移checkout从固定catalog恢复Skill后才构造正式release',async t=>{
 const f=await fixture(t,{migrated:true});await prepareAndDeploy(f);assert.ok(existsSync(f.marker));
 assert.equal(readFileSync(join(f.root,'services/phone-adb-controller/commander/skills/workflow-commander/SKILL.md'),'utf8'),'fixed implementation\n');
});
