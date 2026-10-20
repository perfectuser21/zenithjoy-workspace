import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {REPO,parseTargets} from './acceptance-record.mjs';
const workflow='nightly-real-machine-staging.yml';
const need=(ok,message)=>{if(!ok)throw Error('夜间真机证据: '+message);};
// 保留既有分车道策略：真微信/真抖音阻塞；真安卓单独告警。
export function verifyNightly({api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8'})),now=Date.now()}={}){
 const page=api(`repos/${REPO}/actions/workflows/${workflow}/runs?branch=main&status=completed&per_page=2`);
 const runs=[...(page.workflow_runs||[])].sort((a,b)=>b.id-a.id).slice(0,2);
 need(runs.length===2&&new Set(runs.map(r=>r.id)).size===2,'至少需要最近两次完整运行');
 const age=now-Date.parse(runs[0].created_at);
 need(Number.isFinite(age)&&age>=0&&age<=36*3600000,'最新运行缺日期、日期异常或超过36小时');
 const android_warning_runs=[];
 for(const run of runs){
  need(Number.isSafeInteger(run.id)&&run.id>0&&run.repository?.full_name===REPO&&run.head_branch==='main'
   &&run.path===`.github/workflows/${workflow}`&&['schedule','workflow_dispatch'].includes(run.event)&&run.status==='completed','运行来源不符');
  const response=api(`repos/${REPO}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  need(Array.isArray(response.jobs)&&response.total_count===response.jobs.length,'job清单缺失或不完整');
  const passed=prefix=>{const matches=response.jobs.filter(j=>j.name?.startsWith(prefix));return matches.length>0&&matches.every(j=>j.status==='completed'&&j.conclusion==='success');};
  for(const prefix of ['真微信','真抖音'])need(passed(prefix),`run ${run.id} ${prefix}未通过`);
  if(!passed('真安卓'))android_warning_runs.push(run.id);
 }
 return {run_ids:runs.map(r=>r.id),android_warning_runs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const targets=parseTargets(process.argv[2]);
  if(targets.some(t=>['api','dashboard'].includes(t))){
   const result=verifyNightly();console.log(JSON.stringify(result));
   if(result.android_warning_runs.length){
    const warning=`真安卓车道未通过（run ${result.android_warning_runs.join(', ')}）；按既有分车道策略不阻塞本次API/前端发布。`;
    console.log('::warning::'+warning);
    if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n## 真安卓回归告警\n\n'+warning+'\n');
   }
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
