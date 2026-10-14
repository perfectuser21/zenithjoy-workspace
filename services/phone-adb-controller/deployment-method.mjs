#!/usr/bin/env node
// 显式发布完整业务方法；不覆盖当前Commander、workspace、指针或其它目标ACK。
import {readFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {digest} from './runtime-definition.mjs';
import {DEPLOY_REPO,brainRequest,readDeploymentToken} from './deployment-preflight.mjs';
import {checkScope,subset} from './deployment-targets.mjs';
import {methodManifest,methodComponents} from './method-definition.mjs';
import {observeDeployment} from './deployment-release.mjs';
const need=(v,m)=>{if(!v)throw Error('方法部署: '+m);};
export async function prepareMethodRelease({evidence,sha,workflowKey,runId,readFile,request}){
 need(/^[a-f0-9]{40}$/.test(sha)&&Number.isSafeInteger(runId)&&runId>0,'固定来源或Pilot run无效');
 const scope=evidence?.snapshot?.scope;need(['commander-generic','zenithjoy'].includes(scope),'未知完整scope');
 const all=checkScope(evidence,scope,sha),workflows=all.workflows.filter(w=>w.payload.key===workflowKey);
 need(workflows.length===1&&workflowKey!=='workflow_commander.internal','必须唯一业务方法');
 const definitions=subset(all,workflows),components=methodComponents(definitions,sha);
 const manifest=methodManifest({payload:{...definitions,components}}),hash=digest(manifest),target='mmv--method--'+hash;
 for(const b of manifest.bindings)need('sha256:'+digest(readFile(b.path))===b.digest,'固定Git源码字节不符');
 // 核心仍收到完整当前注册CI报告，由核心严格比较计划；历史资格不是这里伪造的PASS。
 const input={release_key:`commander-method:${hash}:${runId}:${digest(evidence.report)}`,environment:'production',target,actor:'phone-adb-deployer',workflows:workflows.map(w=>({workflow_definition_version_id:w.id,payload_sha256:w.payload_sha256})),components,ci_evidence:[{report:evidence.report,receipt:evidence.receipt,evidence_ref:`https://github.com/${DEPLOY_REPO}/actions/runs/${runId}`}]};
 const release=(await request('/api/brain/releases',input)).release;
 need(release?.id&&release.target===target&&release.environment==='production'&&release.payload?.verification?.status==='verified'&&release.manifest_sha256===digest({environment:release.environment,target:release.target,payload:release.payload}),'正式release未验证');
 need(digest(methodManifest(release))===hash&&digest(release.payload.workflows)===digest(definitions.workflows)&&digest(release.payload.activities)===digest(definitions.activities),'正式release不是所选完整方法');
 need(digest((await request('/api/brain/releases/'+release.id)).release)===digest(release),'正式release回读变化');
 return {release,method_manifest:manifest,method_manifest_sha256:hash};
}
export async function observeMethod({plan,request,brainUrl,stateDir=join(homedir(),'.config/zenithjoy/method-deployments'),attemptKey,collect,home=homedir()}){
 need(digest(methodManifest(plan.release))===plan.method_manifest_sha256&&digest(plan.method_manifest)===plan.method_manifest_sha256,'方法计划被改');
 return observeDeployment({host:'mmv',methodTarget:plan.release.target,methodHome:home,releaseId:plan.release.id,environment:'production',collector:'phone-adb-deployer',attemptKey,request,brainUrl,stateDir,collect,manifest:{}});
}
export async function installAndObserve({plan,sourceRoot,request,brainUrl,stateDir,attemptKey,home=homedir()}){
 // 安装器自身必须取当前版本，历史checkout仅提供固定Git对象；不执行旧安装器。
 const installer=fileURLToPath(new URL('./method-package.py',import.meta.url));
 const collect=async()=>JSON.parse(execFileSync('python3',[installer,'install',plan.release.id,sourceRoot],{encoding:'utf8',maxBuffer:4000000,timeout:120000,env:{...process.env,WF_BRAIN_URL:brainUrl}}));
 return observeMethod({plan,request,brainUrl,stateDir,attemptKey,home,collect});
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{
  const spec=JSON.parse(readFileSync(process.argv[3],'utf8')),brainUrl=process.env.BRAIN_URL||'http://localhost:5221';
  const request=brainRequest(brainUrl,readDeploymentToken(join(homedir(),'.credentials/cecelia-internal.env')));let result;
  if(process.argv[2]==='prepare'){
   need(spec.bundle?.run?.repo===DEPLOY_REPO&&spec.bundle.run.sha===spec.sha&&spec.bundle.run.branch==='main'&&spec.bundle.run.path==='.github/workflows/pilot-release-verification.yml'&&['push','workflow_dispatch'].includes(spec.bundle.run.event),'受信Pilot run身份不符');
   const evidence=spec.scope==='commander-generic'?spec.bundle.commander:spec.bundle;
   result=await prepareMethodRelease({...spec,evidence,runId:spec.bundle.run.id,request,readFile:path=>execFileSync('git',['-C',spec.sourceRoot,'show',spec.sha+':'+path])});
  }else {need(process.argv[2]==='install','用法 prepare|install absolute_spec.json');result=await installAndObserve({...spec,request,brainUrl});}
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
