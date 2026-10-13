import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const url=new URL('../phone-deploy-evidence.mjs',import.meta.url),sha='a'.repeat(40),repo='perfectuser21/zenithjoy-workspace';
async function implementation(){assert.ok(existsSync(url),'必须验证实际GitHub run/artifact来源');return import(url);}
function run(){return {id:42,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:sha,path:'.github/workflows/pilot-release-verification.yml',repository:{id:1,full_name:repo},head_repository:{id:1,full_name:repo}};}
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function evidence(scope){
 const snapshot={scope,repo,revision:sha,snapshot_sha256:(scope==='zenithjoy'?'b':'c').repeat(64)};
 const report={scope,source:{repo,head_revision:sha},purpose:'release_verification',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:'d'.repeat(64)};
 return {snapshot,report,receipt:{source:report.source,scope:'declared_pilot_regressions',verdict:'PASS',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:digest(report)}};
}
function zip(data){
 const dir=mkdtempSync(join(tmpdir(),'phone-evidence-download-'));
 for(const [name,value] of Object.entries({'head.json':{snapshot:data.snapshot},'report.json':data.report,'receipt.json':data.receipt}))writeFileSync(join(dir,name),JSON.stringify(value));
 execFileSync('zip',['-q','bundle.zip','head.json','report.json','receipt.json'],{cwd:dir});return readFileSync(join(dir,'bundle.zip'));
}
function githubFixture(scopes=['zenithjoy','commander-generic'],payloads={}){
 const requests=[];const github=async(path,binary)=>{requests.push(path);
  if(path.includes('/artifacts?'))return {total_count:scopes.length,artifacts:scopes.map((scope,index)=>({id:55+index,name:`pilot-release-verification-${scope?scope+'-':''}${sha}`,expired:false,workflow_run:{id:42,head_branch:'main',head_sha:sha,repository_id:1,head_repository_id:1}}))};
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
test('同main成功run精确下载两个scope完整证据，保留顶层zenithjoy与commander，忽略旧名',async()=>{
 const {downloadDeploymentEvidence}=await implementation();const {github,requests}=githubFixture(['commander-generic','','zenithjoy']);
 const result=await downloadDeploymentEvidence('42',github);assert.equal(result.run.sha,sha);
 assert.deepEqual({snapshot:result.snapshot,report:result.report,receipt:result.receipt},evidence('zenithjoy'));
 assert.deepEqual(result.commander,evidence('commander-generic'));
 assert.deepEqual(requests.filter(p=>p.endsWith('/zip')).sort(),[`repos/${repo}/actions/artifacts/55/zip`,`repos/${repo}/actions/artifacts/57/zip`]);
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
