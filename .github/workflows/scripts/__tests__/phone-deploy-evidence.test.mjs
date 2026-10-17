import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {digest as deploymentDigest} from '../../../../services/phone-adb-controller/runtime-definition.mjs';
import {deploymentAssertionPlan} from '../../../../services/phone-adb-controller/deployment-preflight.mjs';
const url=new URL('../phone-deploy-evidence.mjs',import.meta.url),sha='a'.repeat(40),repo='perfectuser21/zenithjoy-workspace';
async function implementation(){assert.ok(existsSync(url),'必须验证实际GitHub run/artifact来源');return import(url);}
function run(){return {id:42,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:sha,path:'.github/workflows/pilot-release-verification.yml',repository:{id:1,full_name:repo},head_repository:{id:1,full_name:repo}};}
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function evidence(scope){
 if(scope==='cecelia-device-patrol-definitions'){
  const source={repo,path:'fixture.json',commit:sha};
  const row=(id,payload)=>({id,source_repo:repo,source_path:source.path,source_commit:sha,payload,payload_sha256:deploymentDigest({source,payload})});
  const activity=row('00000000-0000-4000-8000-000000000001',{activity_id:'00000000-0000-4000-8000-000000000002',implementation_bindings:[]});
  const workflow=row('00000000-0000-4000-8000-000000000003',{workflow_id:'00000000-0000-4000-8000-000000000004',activities:[{activity_id:activity.payload.activity_id,activity_version_id:activity.id}]});
  const snapshot={schema_version:1,scope,repo,revision:sha,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]}};
  snapshot.snapshot_sha256=deploymentDigest(snapshot);
  const report={protocol:'pilot_release_verification_v1',purpose:'release_verification',scope,source:{repo,head_revision:sha},snapshot_sha256:snapshot.snapshot_sha256,verification_status:'verified',gaps:[],assertion_source:'current_registration',definition_versions:snapshot.definitions,expected_usages:[{workflow_id:workflow.payload.workflow_id}],required_assertions:[{assertion_ref:'fixture.sh',source_bindings:[]}]};
  report.assertion_plan_sha256=deploymentDigest(deploymentAssertionPlan(report,snapshot));
  return {snapshot,report,receipt:{purpose:'release_verification',actor:'pilot_release_verification',source:report.source,scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated',verdict:'PASS',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:digest(report),assertions:[{assertion_ref:'fixture.sh',source_repo:repo,source_revision:sha,test_sha256:'b'.repeat(64),source_bindings:[],exit_code:0}]}};
 }
 const snapshot={scope,repo,revision:sha,snapshot_sha256:(scope==='zenithjoy'?'b':'c').repeat(64)};
 const report={scope,source:{repo,head_revision:sha},purpose:'release_verification',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:'d'.repeat(64)};
 return {snapshot,report,receipt:{source:report.source,scope:'declared_pilot_regressions',verdict:'PASS',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:digest(report)}};
}
function zip(data){
 const dir=mkdtempSync(join(tmpdir(),'phone-evidence-download-'));
 for(const [name,value] of Object.entries({'head.json':{snapshot:data.snapshot},'report.json':data.report,'receipt.json':data.receipt}))writeFileSync(join(dir,name),JSON.stringify(value));
 execFileSync('zip',['-q','bundle.zip','head.json','report.json','receipt.json'],{cwd:dir});return readFileSync(join(dir,'bundle.zip'));
}
function githubFixture(scopes=['zenithjoy','commander-generic','cecelia-device-patrol-definitions'],payloads={},artifactChanges={}){
 const requests=[];const github=async(path,binary)=>{requests.push(path);
  if(path.includes('/artifacts?'))return {total_count:scopes.length,artifacts:scopes.map((scope,index)=>({...{id:55+index,name:`pilot-release-verification-${scope?scope+'-':''}${sha}`,expired:false,workflow_run:{id:42,head_branch:'main',head_sha:sha,repository_id:1,head_repository_id:1}},...(artifactChanges[scope]||{})}))};
  if(path.endsWith('/zip')){assert.equal(binary,true);const index=Number(path.split('/').at(-2))-55;return zip(payloads[scopes[index]]||evidence(scopes[index]));}
  return path.includes('/git/ref/')?{object:{sha}}:run();};
 return {github,requests};
}
test('拒绝PR/fork/错workflow/非主线/旧SHA/未成功run，接受主线push和dispatch',async()=>{
 const {validateSourceRun}=await implementation();assert.equal(validateSourceRun(run(),sha).id,42);assert.equal(validateSourceRun({...run(),event:'workflow_dispatch'},sha).id,42);
 for(const change of [{event:'pull_request'},{head_repository:{id:2,full_name:repo}},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{conclusion:'failure'},{head_sha:'b'.repeat(40)},{status:'in_progress'}])assert.throws(()=>validateSourceRun({...run(),...change},sha));
});
test('固定同run SHA artifact；过期/重复/不同run与fork来源均拒绝',async()=>{
 const {selectArtifact}=await implementation();const name=`pilot-release-verification-zenithjoy-${sha}`;
 const good={id:55,name,expired:false,workflow_run:{id:42,head_branch:'main',head_sha:sha,repository_id:1,head_repository_id:1}};
 assert.equal(selectArtifact([good],name,run()).id,55);
 for(const items of [[good,good],[{...good,expired:true}],[{...good,workflow_run:{...good.workflow_run,id:43}}],[{...good,workflow_run:{...good.workflow_run,head_repository_id:2}}],[]])assert.throws(()=>selectArtifact(items,name,run()));
});
test('真实ZIP只读取固定JSON，不释放旁带代码或路径',async()=>{
 const {readArtifactJson}=await implementation();const dir=mkdtempSync(join(tmpdir(),'phone-artifact-'));writeFileSync(join(dir,'head.json'),'{"snapshot":{"revision":"fixed"}}');writeFileSync(join(dir,'extra-tool.mjs'),'throw Error("must not execute")');
 execFileSync('zip',['-q','bundle.zip','head.json','extra-tool.mjs'],{cwd:dir});
 assert.deepEqual(readArtifactJson(readFileSync(join(dir,'bundle.zip')),'head.json'),{snapshot:{revision:'fixed'}});
 assert.throws(()=>readArtifactJson(readFileSync(join(dir,'bundle.zip')),'receipt.json'));
});
test('固定JSON重复、损坏ZIP及超限正文均拒绝',async()=>{
 const {readArtifactJson}=await implementation();const dir=mkdtempSync(join(tmpdir(),'phone-artifact-bad-')),file=join(dir,'duplicate.zip');
 execFileSync('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr("head.json","{}")\n z.writestr("head.json","{}")',file]);
 assert.throws(()=>readArtifactJson(readFileSync(file),'head.json'));
 assert.throws(()=>readArtifactJson(Buffer.from('not a zip'),'head.json'));
 assert.throws(()=>readArtifactJson(Buffer.alloc(32*1024*1024),'head.json'));
});
test('同main成功run精确下载三个scope完整证据，保留原两scope，忽略旧名',async()=>{
 const {downloadDeploymentEvidence}=await implementation();const {github,requests}=githubFixture(['commander-generic','','zenithjoy','cecelia-device-patrol-definitions']);
 const result=await downloadDeploymentEvidence('42',github);assert.equal(result.run.sha,sha);
 assert.deepEqual({snapshot:result.snapshot,report:result.report,receipt:result.receipt},evidence('zenithjoy'));
 assert.deepEqual(result.commander,evidence('commander-generic'));
 assert.deepEqual(result.patrol,evidence('cecelia-device-patrol-definitions'));
 assert.deepEqual(requests.filter(p=>p.endsWith('/zip')).sort(),[55,57,58].map(id=>`repos/${repo}/actions/artifacts/${id}/zip`));
});
test('第三scope缺失、重复及来源错误在下载前拒绝',async()=>{
 const {downloadDeploymentEvidence}=await implementation(),patrol='cecelia-device-patrol-definitions';
 for(const scopes of [['zenithjoy','commander-generic'],['zenithjoy','commander-generic',patrol,patrol]]){
  const {github,requests}=githubFixture(scopes);await assert.rejects(downloadDeploymentEvidence('42',github));assert.equal(requests.some(p=>p.endsWith('/zip')),false);
 }
 for(const change of [{expired:true},{workflow_run:{id:43,head_branch:'main',head_sha:sha,repository_id:1,head_repository_id:1}},{workflow_run:{id:42,head_branch:'main',head_sha:sha,repository_id:2,head_repository_id:1}},{workflow_run:{id:42,head_branch:'main',head_sha:'b'.repeat(40),repository_id:1,head_repository_id:1}}]){
  const {github,requests}=githubFixture(undefined,{}, {[patrol]:change});await assert.rejects(downloadDeploymentEvidence('42',github));assert.equal(requests.some(p=>p.endsWith('/zip')),false);
 }
});
test('第三scope固定JSON来源及重算摘要不符时整包拒绝',async()=>{
 const {downloadDeploymentEvidence}=await implementation(),scope='cecelia-device-patrol-definitions';
 const mutations=[d=>d.snapshot.scope='wrong',d=>d.snapshot.repo='fork/repo',d=>d.snapshot.revision='b'.repeat(40),d=>d.report.scope='wrong',d=>d.report.source={repo:'fork/repo',head_revision:sha},d=>d.receipt.scope='wrong',d=>d.receipt.source={repo,head_revision:'b'.repeat(40)},d=>d.report.snapshot_sha256='f'.repeat(64),d=>d.receipt.assertion_plan_sha256='f'.repeat(64),d=>d.snapshot.status='tampered',d=>{d.report.expected_usages.push({workflow_id:'tampered'});d.receipt.report_sha256=digest(d.report)}];
 for(const mutate of mutations){const data=evidence(scope);mutate(data);const {github}=githubFixture(undefined,{[scope]:data});await assert.rejects(downloadDeploymentEvidence('42',github));}
});
test('非法run ID及不完整分页在ZIP下载前拒绝',async()=>{
 const {downloadDeploymentEvidence}=await implementation();
 for(const id of ['','0','-1','42/zip','9'.repeat(200)]){let called=false;await assert.rejects(downloadDeploymentEvidence(id,async()=>{called=true}));assert.equal(called,false);}
 const {github,requests}=githubFixture();await assert.rejects(downloadDeploymentEvidence('42',async(path,binary)=>{const value=await github(path,binary);return path.includes('/artifacts?')?{...value,total_count:value.total_count+1}:value}));
 assert.equal(requests.some(p=>p.endsWith('/zip')),false);
});
test('缺任一scope或重复均拒绝下载，不回退旧名或另一scope',async()=>{
 const {downloadDeploymentEvidence}=await implementation();
 for(const scopes of [[''],['commander-generic'],['zenithjoy'],['','commander-generic'],['zenithjoy',''],['zenithjoy','zenithjoy','commander-generic'],['zenithjoy','commander-generic','commander-generic']]){
  const {github,requests}=githubFixture(scopes);await assert.rejects(downloadDeploymentEvidence('42',github),/artifact缺失\/歧义/);
  assert.equal(requests.some(path=>path.endsWith('/zip')),false);
 }
});
test('artifact名正确仍拒绝scope串用、错误来源SHA或交叉回执',async()=>{
 const {downloadDeploymentEvidence}=await implementation();
 for(const scope of ['zenithjoy','commander-generic'])for(const mutate of [d=>d.snapshot.scope='wrong',d=>d.report.scope='wrong',d=>d.snapshot.repo='fork/repo',d=>d.report.source={repo,head_revision:'f'.repeat(40)},d=>d.receipt.scope='admission_only',d=>d.receipt.source={repo,head_revision:'f'.repeat(40)},d=>d.receipt=evidence(scope==='zenithjoy'?'commander-generic':'zenithjoy').receipt]){
  const data=evidence(scope);mutate(data);const {github}=githubFixture(undefined,{[scope]:data});await assert.rejects(downloadDeploymentEvidence('42',github),/scope|回执/);
 }
});
