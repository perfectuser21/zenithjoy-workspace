#!/usr/bin/env node
// 运行于mmv受信控制通道：token只进本进程/部署子进程，不写artifact或打印。
import {readFileSync,realpathSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDeploymentToken,brainRequest,DEPLOY_REPO} from './deployment-preflight.mjs';
import {readDeploymentSource,fixedSourceEnvironment,prepareDeploymentSkillSources} from './deployment-fixed-source.mjs';
import {prepareTargetReleases} from './deployment-targets.mjs';
import {verifyTransactionProtocol} from './deployment-protocol.mjs';
import {stageCandidate} from './deployment-candidate.mjs';
import {runMaintenanceInstall} from './maintenance-install-backend.mjs';
export async function prepareAndDeploy({root,sha,bundlePath,attemptKey,brainUrl,tokenPath,mode='candidate',businessRunIds=[],acceptanceTaskIds={},transaction,
 stageCandidateFn=stageCandidate,runSafetyFn=runMaintenanceInstall}){
 if(!['candidate','maintenance-install','maintenance-recover','promote','recover','rollback'].includes(mode))throw Error('无效手机部署操作');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:fixedSourceEnvironment(),timeout:15000,maxBuffer:32*1024*1024}).trim();
 if(!/^[0-9a-f]{40}$/.test(sha)||git('rev-parse','HEAD')!==sha||git('status','--porcelain=v1','--untracked-files=no'))throw Error('部署源不是干净的固定main');
 git('merge-base','--is-ancestor',sha,'origin/main');
 const origin=git('remote','get-url','origin');
 if(![`https://github.com/${DEPLOY_REPO}.git`,`https://github.com/${DEPLOY_REPO}`,`git@github.com:${DEPLOY_REPO}.git`].includes(origin))throw Error('部署来源仓库不符');
 if(mode!=='candidate')verifyTransactionProtocol(readDeploymentSource(root,sha,'services/phone-adb-controller/deployment-protocol.json'));
 const token=readDeploymentToken(tokenPath),request=brainRequest(brainUrl,token);
 if(mode==='maintenance-recover'){
  if(!/^phone-safety-[a-f0-9]{24}$/.test(transaction||''))throw Error('安全恢复必须指定原事务ID');
  return runSafetyFn({root,sha,attemptKey,request,action:'recover',transaction});
 }
 if(['recover','rollback'].includes(mode)){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(transaction||''))throw Error('恢复必须指定原始事务ID');
  const child=spawn('python3',[join(root,'services/phone-adb-controller/deployment-guard.py'),'node',join(root,'services/phone-adb-controller/deployment-backend.mjs'),mode,sha,transaction],{
   stdio:['ignore','inherit','inherit'],env:{...fixedSourceEnvironment({network:true}),BRAIN_URL:brainUrl,BRAIN_INTERNAL_TOKEN:token}});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  if(code!==0)throw Error('原始事务恢复未完成；保持实际失败证据');return;
 }

 const bundle=JSON.parse(readFileSync(bundlePath,'utf8'));
 if(bundle.run?.repo!==DEPLOY_REPO||bundle.run.sha!==sha||bundle.run.branch!=='main'||!['push','workflow_dispatch'].includes(bundle.run.event)||bundle.run.path!=='.github/workflows/pilot-release-verification.yml'||!Number.isSafeInteger(bundle.run.id)||!attemptKey.startsWith(`github:${bundle.run.id}:`))throw Error('部署证据与受信run不符');
 prepareDeploymentSkillSources(root,sha);

 const plan=await prepareTargetReleases({bundle,sha,environment:mode==='promote'?'production':`staging:${sha}`,businessRunIds,acceptanceTaskIds,attemptKey,request,readFile:path=>{
  return readDeploymentSource(root,sha,path,{materialize:true});
 }});
 if(git('rev-parse','HEAD')!==sha||git('status','--porcelain=v1','--untracked-files=no'))throw Error('部署预检期间工作区变化');
 if(mode==='candidate')return stageCandidateFn({root,sha,plan,attemptKey,request,brainUrl});
 if(mode==='maintenance-install'){
  if(businessRunIds.length||Object.keys(acceptanceTaskIds).length)throw Error('安全安装不接收业务run或验收Task');
  const candidate=await stageCandidateFn({root,sha,plan,attemptKey,request,brainUrl});
  if(candidate?.source_commit!==sha||candidate.environment!==`staging:${sha}`||candidate.business_runtime_status!=='not_evaluated')throw Error('安全安装候选身份不符');
  return runSafetyFn({root,sha,attemptKey,request,candidate,transaction});
 }
 const folder=mkdtempSync(join(tmpdir(),'phone-deployment-plan-'));
 const planFile=join(folder,'plan.json'),mapFile=join(folder,'commander-releases.json');
 writeFileSync(planFile,JSON.stringify(plan),{mode:0o600});writeFileSync(mapFile,JSON.stringify(plan.commander_releases),{mode:0o600});
 try {
 const child=spawn('bash',[join(root,'services/phone-adb-controller/deploy.sh')],{stdio:['ignore','inherit','inherit'],env:{...fixedSourceEnvironment({network:true}),
  DEPLOY_SHA:sha,WF_RELEASE_IDS:JSON.stringify(plan.release_ids),WF_DEPLOY_PLAN_FILE:planFile,WF_COMMANDER_RELEASES_FILE:mapFile,WF_DEPLOY_ENVIRONMENT:'production',WF_DEPLOY_COLLECTOR:'phone-adb-deployer',
  WF_BUSINESS_RUN_IDS:JSON.stringify(businessRunIds),WF_BUSINESS_ACCEPTANCE_TASK_IDS:JSON.stringify(acceptanceTaskIds),WF_DEPLOY_ATTEMPT_KEY:attemptKey,BRAIN_URL:brainUrl,BRAIN_INTERNAL_TOKEN:token}});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 if(code!==0)throw Error('部署或观测未完成');
 } finally {rmSync(folder,{recursive:true,force:true});}
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{const result=await prepareAndDeploy({root:process.cwd(),sha:process.argv[2],bundlePath:process.argv[3],attemptKey:process.argv[4],mode:process.argv[5]||'candidate',businessRunIds:JSON.parse(process.argv[6]||'[]'),transaction:process.argv[7],acceptanceTaskIds:JSON.parse(process.argv[8]||'{}'),brainUrl:process.env.BRAIN_URL||'http://localhost:5221',tokenPath:join(homedir(),'.credentials/cecelia-internal.env')});if(result)process.stdout.write(JSON.stringify(result)+'\n');}
 catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
