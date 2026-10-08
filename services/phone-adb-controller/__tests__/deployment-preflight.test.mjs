import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {digest} from '../runtime-definition.mjs';
import {normalizedDescriptions} from './fixtures/normalized-description-bindings.mjs';
const moduleUrl=new URL('../deployment-preflight.mjs',import.meta.url);
async function implementation(){assert.ok(existsSync(moduleUrl),'部署必须具备真实release预检');return import(moduleUrl);}
const repo='perfectuser21/zenithjoy-workspace',sha='a'.repeat(40);
const wid=[101,102,103,104].map(n=>`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
const vid=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888'];
const avId='33333333-3333-4333-8333-333333333333',aid='44444444-4444-4444-8444-444444444444';
const file='services/phone-adb-controller/entry.sh',bytes=Buffer.from('fixed code\n');
function row(id,payload,extra={}){const source={repo,path:'product-map/contracts/phone.json',commit:sha};return {id,...extra,source_repo:repo,source_path:source.path,source_commit:sha,payload,payload_sha256:digest({source,payload})};}
export function fixture(){
 const binding={kind:'code',scope:'activity',repo,path:file,revision:sha,digest:'sha256:'+digest(bytes),status:'verified'};
 const activities=[row(avId,{activity_id:aid,implementation_bindings:[binding],steps:[]},{activity_id:aid})];
 const workflows=wid.map((id,i)=>row(vid[i],{workflow_id:id,key:['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'][i],activities:[{activity_id:aid,activity_version_id:avId}]},{workflow_id:id}));
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision:sha,status:'verified',gaps:[],definitions:{workflows,activities}};
 snapshot.snapshot_sha256=digest(snapshot);
 const report={source:{repo,base_revision:'b'.repeat(40),head_revision:sha,changed_files:[file]},mapping_status:'verified',truncated:false,gaps:[],
  protocol:'pilot_release_verification_v1',purpose:'release_verification',scope:'zenithjoy',snapshot_sha256:snapshot.snapshot_sha256,verification_status:'verified',assertion_source:'current_registration',definition_versions:{workflows,activities},expected_usages:wid.map(workflow_id=>({workflow_id})),required_assertions:[{assertion_ref:'test.sh'}]};
 report.source={repo,head_revision:sha};
 report.assertion_plan_sha256=digest(Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]])));
 const receipt={purpose:'release_verification',actor:'pilot_release_verification',verdict:'PASS',scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,source:report.source,report_sha256:digest(Buffer.from(JSON.stringify(report))),assertions:[{assertion_ref:'test.sh',source_repo:repo,source_revision:sha,test_sha256:'c'.repeat(64),exit_code:0}]};
 const manifest={source_repo:repo,source_commit:sha,files:[{path:file,content_sha256:digest(bytes)}]};
 return {bundle:{snapshot,report,receipt},manifest};
}
function release(f,target='xian-m4'){
 const payload={...f.bundle.snapshot.definitions,components:[{kind:'repo',repo,revision:sha},{kind:'code',repo,path:file,revision:sha,digest:'sha256:'+digest(bytes)}],verification:{status:'verified'}};
 const r={id:target==='xian-m4'?vid[0]:target==='xian-m1'?vid[1]:vid[2],environment:'production',target,payload};r.manifest_sha256=digest({environment:r.environment,target:r.target,payload});return r;
}
test('固定证据生成三目标release；真实Brain回读后才返回可部署映射',async()=>{
 const {prepareDeploymentReleases}=await implementation();const f=fixture(),calls=[];
 const request=async(path,body)=>{calls.push({path,body});if(body)return {release:release(f,body.target)};return {release:release(f,path.endsWith(vid[0])?'xian-m4':path.endsWith(vid[1])?'xian-m1':'mmv')};};
 const result=await prepareDeploymentReleases({...f,sha,environment:'production',attemptKey:'github:1:1',request,readFile:path=>{assert.equal(path,file);return bytes;}});
 assert.deepEqual(Object.keys(result).sort(),['mmv','xian-m1','xian-m4']);assert.equal(calls.filter(c=>c.body).length,3);
 for(const c of calls.filter(c=>c.body)){assert.equal(c.body.ci_evidence[0].receipt,f.bundle.receipt);assert.equal(c.body.workflows.length,4);}
});
test('错误固定SHA、PR/unknown/admission_only或篡改快照在创建release前拒绝',async()=>{
 const {prepareDeploymentReleases}=await implementation();
 for(const mutate of [f=>f.bundle.report.source.head_revision='b'.repeat(40),f=>f.bundle.report.verification_status='unknown',f=>f.bundle.receipt.purpose='admission_only',f=>f.bundle.snapshot.definitions.activities[0].payload.steps.push({key:'forged'})]){
  const f=fixture();mutate(f);let calls=0;await assert.rejects(prepareDeploymentReleases({...f,sha,environment:'production',attemptKey:'test',request:async()=>{calls++;},readFile:()=>bytes}));assert.equal(calls,0);
 }
});
test('预检拒缺release、错目标/环境/来源、unknownCI与内容漂移',async()=>{
 const {preflightDeploymentReleases}=await implementation();
 for(const mutate of [r=>null,r=>({...r,target:'unrelated'}),r=>({...r,environment:'staging'}),r=>({...r,payload:{...r.payload,verification:{status:'unknown'}}}),r=>({...r,payload:{...r.payload,components:[]}})]){
  const f=fixture();await assert.rejects(preflightDeploymentReleases({manifest:f.manifest,environment:'production',releaseIds:{'xian-m4':vid[0],'xian-m1':vid[1],'mmv':vid[2]},request:async path=>({release:mutate(release(f,path.endsWith(vid[0])?'xian-m4':path.endsWith(vid[1])?'xian-m1':'mmv'))})}));
 }
});
test('凭据镜像仅接受安全权限的CECELIA_INTERNAL_TOKEN，不执行env内容',async()=>{
 const {readDeploymentToken}=await implementation(),dir=mkdtempSync(join(tmpdir(),'phone-token-')),path=join(dir,'token.env');
 writeFileSync(path,'CECELIA_INTERNAL_TOKEN=fixture-only-token\n',{mode:0o600});assert.equal(readDeploymentToken(path),'fixture-only-token');
 chmodSync(path,0o644);assert.throws(()=>readDeploymentToken(path),/权限/);chmodSync(path,0o600);
 writeFileSync(path,'CECELIA_INTERNAL_TOKEN=$(touch /tmp/never-run-phone-fixture)\n');assert.throws(()=>readDeploymentToken(path));
});
test('真实deploy.sh在任何目标SSH/scp前拒绝无真实release（不只是参数非空）',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'deploy-before-side-effect-')),bin=join(dir,'bin'),marker=join(dir,'side-effect');mkdirSync(bin);
 for(const name of ['ssh','scp'])writeFileSync(join(bin,name),`#!/bin/sh\nprintf invoked > '${marker}'\nexit 99\n`,{mode:0o755});
 const server=createServer((req,res)=>{res.writeHead(404,{'Content-Type':'application/json'});res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const child=spawn('bash',[new URL('../deploy.sh',import.meta.url).pathname],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-only',WF_RELEASE_IDS:JSON.stringify({'xian-m4':vid[0],'xian-m1':vid[1],'mmv':vid[2]}),WF_DEPLOY_ENVIRONMENT:'production',WF_DEPLOY_COLLECTOR:'phone-adb-deployer',WF_DEPLOY_ATTEMPT_KEY:'fixture'}});
 let stderr='';child.stdout.resume();child.stderr.on('data',v=>stderr+=v);const code=await new Promise(r=>child.on('close',r));
 assert.notEqual(code,0);assert.equal(existsSync(marker),false,`缺真实release已触目标副作用: ${stderr}`);
});
test('同一CI证据重试部署时release声明完全相同，attempt只用于部署观测',async()=>{
 const {prepareDeploymentReleases}=await implementation(),f=fixture(),posted=[];
 const request=async(path,body)=>{if(body){posted.push(body);return {release:release(f,body.target)};}return {release:release(f,path.endsWith(vid[0])?'xian-m4':path.endsWith(vid[1])?'xian-m1':'mmv')};};
 for(const attemptKey of ['github:42:100:1','github:42:101:2'])await prepareDeploymentReleases({...f,sha,environment:'production',attemptKey,request,readFile:()=>bytes});
 assert.deepEqual(posted[0],posted[3]);assert.deepEqual(posted[1],posted[4]);
});
test('不同受信CI run即使报告相同仍有独立不可变release key',async()=>{
 const {prepareDeploymentReleases}=await implementation(),f=fixture(),keys=[];
 const request=async(path,body)=>{if(body){keys.push(body.release_key);return {release:release(f,body.target)};}return {release:release(f,path.endsWith(vid[0])?'xian-m4':path.endsWith(vid[1])?'xian-m1':'mmv')};};
 for(const attemptKey of ['github:42:100:1','github:43:101:1'])await prepareDeploymentReleases({...f,sha,environment:'production',attemptKey,request,readFile:()=>bytes});
 assert.notEqual(keys[0],keys[3]);
});

function withBindings(bindings){
 const f=fixture(),{snapshot,report,receipt}=f.bundle,a=snapshot.definitions.activities[0];
 a.payload.implementation_bindings=bindings;a.payload_sha256=digest({source:{repo:a.source_repo,path:a.source_path,commit:a.source_commit},payload:a.payload});
 delete snapshot.snapshot_sha256;snapshot.snapshot_sha256=digest(snapshot);report.snapshot_sha256=snapshot.snapshot_sha256;
 report.assertion_plan_sha256=digest(Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]])));
 Object.assign(receipt,{snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:digest(Buffer.from(JSON.stringify(report)))});
 return f;
}
const validBinding=()=>fixture().bundle.snapshot.definitions.activities[0].payload.implementation_bindings[0];
test('raw规范声明原样保留但不列组件，Activity固定Skill仍可作为入口',async()=>{
 const {validateDeploymentEvidence}=await implementation();
 for(const kind of ['code','skill']){
  const bindings=[{...validBinding(),kind},...structuredClone(normalizedDescriptions)],before=structuredClone(bindings),f=withBindings(bindings);
  const result=validateDeploymentEvidence(f.bundle,sha,()=>bytes);
  assert.deepEqual(result.definitions.activities[0].payload.implementation_bindings,before);
  assert.equal(result.components.length,2);assert.deepEqual(result.components.map(c=>c.kind).sort(),[kind,'repo'].sort());
 }
});
const rejectedBindings={
 '只有raw没有固定入口':()=>structuredClone(normalizedDescriptions),
 '只有Step代码不能冒充Activity入口':()=>[{...validBinding(),scope:'step',step_key:'open_search'},...normalizedDescriptions],
 '无scope不能冒充Activity入口':()=>[{...validBinding(),scope:undefined}],
 '未知kind不能静默过滤':()=>[validBinding(),{kind:'extension',status:'unresolved'}],
 'raw伪标verified不能放行':()=>[validBinding(),{...normalizedDescriptions[0],status:'verified'}],
 '额外坏Code仍拒':()=>[validBinding(),{...validBinding(),status:'unresolved'}],
 '额外坏Skill仍拒':()=>[validBinding(),{...validBinding(),kind:'skill',status:'unresolved'}],
 '组件错固定SHA仍拒':()=>[validBinding(),{...validBinding(),revision:'b'.repeat(40)}],
 '组件路径穿越仍拒':()=>[validBinding(),{...validBinding(),path:'../entry.sh'}],
};
for(const [name,bindings] of Object.entries(rejectedBindings))test(name+'，网络前拒绝',async()=>{
 const {prepareDeploymentReleases}=await implementation(),f=withBindings(bindings());let calls=0;
 await assert.rejects(prepareDeploymentReleases({...f,sha,environment:'production',attemptKey:'github:42:100:1',readFile:()=>bytes,request:async()=>{calls++;}}),/部署预检: (缺Activity固定实现|实现绑定未核验|组件路径无效)/);
 assert.equal(calls,0);
});
test('raw共存不放宽固定实现实际字节核验',async()=>{
 const {validateDeploymentEvidence}=await implementation(),f=withBindings([validBinding(),...normalizedDescriptions]);
 assert.throws(()=>validateDeploymentEvidence(f.bundle,sha,()=>Buffer.from('drift')),/本机部署组件字节不符/);
});

test('四新流程冻结集合缺项、重复或夹带旧入口均在发布前拒绝',async()=>{
 const {validateDeploymentEvidence}=await implementation();
 for(const mutate of [rows=>rows.pop(), rows=>rows[3]=structuredClone(rows[0]), rows=>rows.push(structuredClone(rows[0])), rows=>{rows[0].workflow_id='b1000000-0000-4000-8000-000000000001';rows[0].payload.workflow_id=rows[0].workflow_id;}]){
  const f=fixture();mutate(f.bundle.snapshot.definitions.workflows);
  const {snapshot,report,receipt}=f.bundle;
  for(const row of snapshot.definitions.workflows)row.payload_sha256=digest({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});
  delete snapshot.snapshot_sha256;snapshot.snapshot_sha256=digest(snapshot);report.snapshot_sha256=snapshot.snapshot_sha256;
  Object.assign(receipt,{snapshot_sha256:snapshot.snapshot_sha256,report_sha256:digest(Buffer.from(JSON.stringify(report)))});
  assert.throws(()=>validateDeploymentEvidence(f.bundle,sha,()=>bytes),/四流程唯一Workflow/);
 }
});

test('发布映射缺MMV或夹带未知目标，在任何回读前拒绝',async()=>{
 const {preflightDeploymentReleases}=await implementation();
 for(const releaseIds of [{'xian-m4':vid[0],'xian-m1':vid[1]},{'xian-m4':vid[0],'xian-m1':vid[1],mmv:vid[2],forged:vid[3]}]){
  let calls=0;await assert.rejects(preflightDeploymentReleases({manifest:fixture().manifest,environment:'production',releaseIds,request:async()=>{calls++;}}),/目标release/);assert.equal(calls,0);
 }
});
