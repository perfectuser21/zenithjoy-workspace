#!/usr/bin/env node
// 仅消费本仓同一次主线成功run；artifact作为JSON数据读取，绝不解包执行代码。
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,realpathSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const REPO='perfectuser21/zenithjoy-workspace',WORKFLOW='.github/workflows/pilot-release-verification.yml';
const ensure=(ok,why)=>{if(!ok)throw Error(`部署CI来源拒绝: ${why}`);};
export function validateSourceRun(run,mainSha){
 ensure(run?.repository?.full_name===REPO&&run.head_repository?.full_name===REPO&&run.repository.id===run.head_repository.id,'同仓身份');
 ensure(Number.isSafeInteger(run.id)&&run.status==='completed'&&run.conclusion==='success','成功run');
 ensure(['push','workflow_dispatch'].includes(run.event)&&run.head_branch==='main'&&run.path===WORKFLOW,'主线事件/工作流');
 ensure(/^[0-9a-f]{40}$/.test(mainSha)&&run.head_sha===mainSha,'固定当前main SHA（禁止旧run回退）');return run;
}
export function selectArtifact(artifacts,name,run){
 const matches=artifacts.filter(a=>a.name===name);ensure(matches.length===1,'artifact缺失/歧义');
 const a=matches[0],w=a.workflow_run;
 ensure(Number.isSafeInteger(a.id)&&!a.expired&&w?.id===run.id&&w.head_sha===run.head_sha&&w.head_branch==='main'&&w.repository_id===run.repository.id&&w.head_repository_id===run.repository.id,'artifact所属run/仓库');return a;
}
export function readArtifactJson(bytes,name){
 ensure(['head.json','report.json','receipt.json'].includes(name)&&bytes.length<32*1024*1024,'artifact限制');
 const dir=mkdtempSync(join(tmpdir(),'phone-deploy-evidence-')),file=join(dir,'input.zip');
 try{writeFileSync(file,bytes,{mode:0o600});const names=execFileSync('unzip',['-Z1',file],{encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n');
  ensure(names.filter(n=>n===name).length===1,'固定JSON文件缺失/重复');
  return JSON.parse(execFileSync('unzip',['-p',file,name],{encoding:'utf8',maxBuffer:16*1024*1024}));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
function scopedEvidence(zip,scope,sha){
 const snapshot=readArtifactJson(zip,'head.json').snapshot,report=readArtifactJson(zip,'report.json'),receipt=readArtifactJson(zip,'receipt.json');
 const sourceMatches=source=>source?.repo===REPO&&source.head_revision===sha;
 ensure(snapshot?.scope===scope&&snapshot.repo===REPO&&snapshot.revision===sha,'snapshot scope/来源');
 ensure(report?.scope===scope&&sourceMatches(report.source),'report scope/来源');
 ensure(receipt?.scope==='declared_pilot_regressions'&&sourceMatches(receipt.source),'receipt scope/来源');
 ensure(/^[0-9a-f]{64}$/.test(snapshot.snapshot_sha256||'')&&report.snapshot_sha256===snapshot.snapshot_sha256&&receipt.snapshot_sha256===snapshot.snapshot_sha256,'scope快照回执绑定');
 ensure(/^[0-9a-f]{64}$/.test(report.assertion_plan_sha256||'')&&receipt.assertion_plan_sha256===report.assertion_plan_sha256&&receipt.report_sha256===createHash('sha256').update(JSON.stringify(report)).digest('hex'),'scope报告回执绑定');
 return {snapshot,report,receipt};
}
export async function downloadDeploymentEvidence(runId,github){
 ensure(/^\d+$/.test(String(runId)),'run_id');
 const run=validateSourceRun(await github(`repos/${REPO}/actions/runs/${runId}`),(await github(`repos/${REPO}/git/ref/heads/main`)).object.sha);
 const listing=await github(`repos/${REPO}/actions/runs/${run.id}/artifacts?per_page=100`);
 ensure(listing.total_count===listing.artifacts?.length,'artifact分页不完整');
 ensure(run.id===Number(runId),'请求run身份');
 // 两份唯一scope都准入后才下载；缺任何一份不回退旧命名或另一范围。
 const selected=['zenithjoy','commander-generic'].map(scope=>({scope,artifact:selectArtifact(listing.artifacts,`pilot-release-verification-${scope}-${run.head_sha}`,run)}));
 const [zenithjoy,commander]=await Promise.all(selected.map(async({scope,artifact})=>scopedEvidence(await github(`repos/${REPO}/actions/artifacts/${artifact.id}/zip`,true),scope,run.head_sha)));
 return {run:{id:run.id,sha:run.head_sha,repo:REPO,event:run.event,path:run.path,branch:'main'},...zenithjoy,commander};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{const github=async(path,binary=false)=>{const bytes=execFileSync('gh',['api',path],{maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});return binary?bytes:JSON.parse(bytes.toString());};
  const bundle=await downloadDeploymentEvidence(process.argv[2],github);
  writeFileSync(process.argv[3],JSON.stringify(bundle)+'\n',{mode:0o600});
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`sha=${bundle.run.sha}\nrun_id=${bundle.run.id}\n`);
 }catch{process.stderr.write('部署CI证据来源或固定JSON不满足要求；未发起部署。\n');process.exitCode=1;}
}
