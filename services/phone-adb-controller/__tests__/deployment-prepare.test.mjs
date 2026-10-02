import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {prepareAndDeploy} from '../deployment-prepare.mjs';
import {digest} from '../runtime-definition.mjs';
const repo='perfectuser21/zenithjoy-workspace';
const uuid=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
async function fixture(t){
 const temp=mkdtempSync(join(tmpdir(),'phone-prepare-http-')),root=join(temp,'repo'),dir=join(root,'services/phone-adb-controller');mkdirSync(dir,{recursive:true});
 const marker=join(temp,'deployed.json'),path='services/phone-adb-controller/entry.sh';writeFileSync(join(root,path),'fixed implementation\n');
 // 假部署入口仅记录显式参数；不调用任何机器或设备。
 writeFileSync(join(dir,'deploy.sh'),`#!/bin/bash\nnode -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({ids:JSON.parse(process.env.WF_RELEASE_IDS),collector:process.env.WF_DEPLOY_COLLECTOR,environment:process.env.WF_DEPLOY_ENVIRONMENT,attempt:process.env.WF_DEPLOY_ATTEMPT_KEY,token_present:process.env.BRAIN_INTERNAL_TOKEN==="fixture-private-token"}))' '${marker}'\n`);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','-q','-b','cp-fixture');git('config','core.hooksPath','/dev/null');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 const sha=git('rev-parse','HEAD');git('remote','add','origin',`https://github.com/${repo}.git`);git('update-ref','refs/remotes/origin/main',sha);
 const make=(id,payload,extra)=>({id,...extra,source_repo:repo,source_path:'product-map/contracts/phone.yaml',source_commit:sha,payload,payload_sha256:digest({source:{repo,path:'product-map/contracts/phone.yaml',commit:sha},payload})});
 const activities=[make(uuid(3),{activity_id:uuid(4),steps:[],implementation_bindings:[{kind:'code',status:'verified',repo,path,revision:sha,digest:'sha256:'+digest(readFileSync(join(root,path)))}]},{activity_id:uuid(4)})];
 const workflows=[1,2].map(n=>{const workflow_id=`b1000000-0000-4000-8000-00000000000${n}`;return make(uuid(n),{workflow_id,activities:[{activity_id:uuid(4),activity_version_id:uuid(3)}]},{workflow_id});});
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision:sha,status:'verified',gaps:[],definitions:{workflows,activities}};snapshot.snapshot_sha256=digest(snapshot);
 const report={source:{repo,base_revision:'b'.repeat(40),head_revision:sha,changed_files:[path]},mapping_status:'verified',truncated:false,gaps:[],protocol:'pilot_release_verification_v1',purpose:'release_verification',scope:'zenithjoy',snapshot_sha256:snapshot.snapshot_sha256,verification_status:'verified',assertion_source:'current_registration',definition_versions:{workflows,activities},expected_usages:[{workflow_id:'b1000000-0000-4000-8000-000000000001'}],required_assertions:[{assertion_ref:'fixture.test.sh'}]};
 report.source={repo,head_revision:sha};
 report.assertion_plan_sha256=digest(Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]])));
 const receipt={purpose:'release_verification',actor:'pilot_release_verification',verdict:'PASS',scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,source:report.source,report_sha256:digest(Buffer.from(JSON.stringify(report))),assertions:[{assertion_ref:'fixture.test.sh',source_repo:repo,source_revision:sha,test_sha256:'c'.repeat(64),exit_code:0}]};
 const bundlePath=join(temp,'bundle.json');writeFileSync(bundlePath,JSON.stringify({run:{id:42,sha,repo,branch:'main',event:'push',path:'.github/workflows/pilot-release-verification.yml'},snapshot,report,receipt}));
 const tokenPath=join(temp,'token.env');writeFileSync(tokenPath,'CECELIA_INTERNAL_TOKEN=fixture-private-token\n',{mode:0o600});
 const releases=new Map(),requests=[];let mode='valid';
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture-private-token');let body='';for await(const part of req)body+=part;requests.push({method:req.method,path:req.url});
  let release;
  if(req.method==='POST'){
   const input=JSON.parse(body),id=input.target==='xian-m4'?uuid(5):uuid(6);
   release={id,environment:input.environment,target:input.target,payload:{...snapshot.definitions,components:input.components,verification:{status:mode==='unknown'?'unknown':'verified'}}};
   if(mode==='wrong_target')release.target='elsewhere';
   release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});releases.set(id,release);
  }else release=releases.get(req.url.split('/').at(-1));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({release}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 return {root,sha,bundlePath,attemptKey:'github:42:100:1',brainUrl:`http://127.0.0.1:${server.address().port}`,tokenPath,marker,requests,setMode:value=>mode=value};
}
test('真实Git+HTTP两release创建与固定回读后wrapper才调用部署入口，凭据不入请求body',async t=>{
 const f=await fixture(t);await prepareAndDeploy(f);const actual=JSON.parse(readFileSync(f.marker));
 assert.equal(actual.collector,'phone-adb-deployer');assert.equal(actual.environment,'production');assert.equal(actual.token_present,true);assert.equal(actual.attempt,'github:42:100:1');assert.equal(Object.keys(actual.ids).length,2);
 assert.deepEqual(f.requests.map(r=>r.method),['POST','POST','GET','GET']);
});
for(const mode of ['unknown','wrong_target'])test(`真实Brain ${mode}回执阻止部署子进程`,async t=>{
 const f=await fixture(t);f.setMode(mode);await assert.rejects(prepareAndDeploy(f));assert.equal(existsSync(f.marker),false);
});
test('工作区字节漂移在创建release前拒绝',async t=>{
 const f=await fixture(t);writeFileSync(join(f.root,'services/phone-adb-controller/entry.sh'),'changed');await assert.rejects(prepareAndDeploy(f));assert.equal(f.requests.length,0);assert.equal(existsSync(f.marker),false);
});
