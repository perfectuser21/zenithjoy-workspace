#!/usr/bin/env node
// 运行于mmv受信控制通道：token只进本进程/部署子进程，不写artifact或打印。
import {readFileSync,realpathSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDeploymentReleases,readDeploymentToken,brainRequest,DEPLOY_REPO} from './deployment-preflight.mjs';
export async function prepareAndDeploy({root,sha,bundlePath,attemptKey,brainUrl,tokenPath}){
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(!/^[0-9a-f]{40}$/.test(sha)||git('rev-parse','HEAD')!==sha||git('rev-parse','origin/main')!==sha||git('status','--porcelain=v1','--untracked-files=no'))throw Error('部署源不是干净的固定main');
 const origin=git('remote','get-url','origin');
 if(![`https://github.com/${DEPLOY_REPO}.git`,`https://github.com/${DEPLOY_REPO}`,`git@github.com:${DEPLOY_REPO}.git`].includes(origin))throw Error('部署来源仓库不符');
 const bundle=JSON.parse(readFileSync(bundlePath,'utf8'));
 if(bundle.run?.repo!==DEPLOY_REPO||bundle.run.sha!==sha||bundle.run.branch!=='main'||!['push','workflow_dispatch'].includes(bundle.run.event)||bundle.run.path!=='.github/workflows/pilot-release-verification.yml'||!Number.isSafeInteger(bundle.run.id)||!attemptKey.startsWith(`github:${bundle.run.id}:`))throw Error('部署证据与受信run不符');
 const token=readDeploymentToken(tokenPath),request=brainRequest(brainUrl,token);
 const releaseIds=await prepareDeploymentReleases({bundle,sha,environment:'production',attemptKey,request,readFile:path=>{
  const fixed=execFileSync('git',['-C',root,'show',`${sha}:${path}`],{stdio:['ignore','pipe','pipe']});
  const actual=readFileSync(resolve(root,path));if(!fixed.equals(actual))throw Error('部署工作区字节漂移');return actual;
 }});
 if(git('rev-parse','HEAD')!==sha||git('status','--porcelain=v1','--untracked-files=no'))throw Error('部署预检期间工作区变化');
 const child=spawn('bash',[join(root,'services/phone-adb-controller/deploy.sh')],{stdio:['ignore','inherit','inherit'],env:{...process.env,
  DEPLOY_SHA:sha,WF_RELEASE_IDS:JSON.stringify(releaseIds),WF_DEPLOY_ENVIRONMENT:'production',WF_DEPLOY_COLLECTOR:'phone-adb-deployer',
  WF_DEPLOY_ATTEMPT_KEY:attemptKey,BRAIN_URL:brainUrl,BRAIN_INTERNAL_TOKEN:token}});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 if(code!==0)throw Error('部署或观测未完成');
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{await prepareAndDeploy({root:process.cwd(),sha:process.argv[2],bundlePath:process.argv[3],attemptKey:process.argv[4],brainUrl:process.env.BRAIN_URL||'http://localhost:5221',tokenPath:join(homedir(),'.credentials/cecelia-internal.env')});}
 catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
