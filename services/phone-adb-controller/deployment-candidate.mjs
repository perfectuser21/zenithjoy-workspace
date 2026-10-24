// 候选只写版本目录；不改正式入口、launchd、手机、账号或队列。
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {digest} from './runtime-definition.mjs';
import {readDeploymentSource,fixedSourceEnvironment} from './deployment-fixed-source.mjs';
import {observeDeployment} from './deployment-release.mjs';
import {commanderMap} from './deployment-targets.mjs';
import {buildPublishRelease} from './deployment-publish-release.mjs';
const remoteCode=readFileSync(new URL('./deployment-candidate-remote.py',import.meta.url),'utf8');
const sshOptions=['-C','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none'];
function ssh(host,phase,command,options){
 const connect=phase==='presence'?['-o','ConnectTimeout=10']:[];
 try{return execFileSync('ssh',[...sshOptions,...connect,host,command],options);}
 catch(error){throw Object.assign(Error(`候选 SSH ${host}/${phase}: ${error.code||error.status||'unknown'}`),{cause:error});}
}
function remoteCommand(mode,spec){
 const payload=deflateSync(Buffer.from(JSON.stringify(spec))).toString('base64');
 const code=Buffer.from(remoteCode).toString('base64');
 return `python3 -I -c 'import base64;exec(base64.b64decode("${code}"))' ${mode} ${payload}`;
}
function presenceOutput(host,spec){
 const started=performance.now(),deadline=started+30000,command=remoteCommand('presence',spec);
 for(let attempt=1;attempt<=2;attempt++){
  const remaining=Math.floor(deadline-performance.now());need(remaining>0,'presence预算耗尽');
  try{
   const output=ssh(host,'presence',command,{encoding:'utf8',timeout:remaining,maxBuffer:1024*1024});
   console.error(JSON.stringify({event:'candidate_presence_attempt',host,attempt,exit_code:0,total_elapsed_ms:Math.ceil(performance.now()-started),stdout_bytes:Buffer.byteLength(output),stdout_digest:digest(output)}));
   return output;
  }catch(error){
   const cause=error.cause,output=cause?.stdout,knownOutput=Buffer.isBuffer(output)||typeof output==='string';
   console.error(JSON.stringify({event:'candidate_presence_attempt',host,attempt,exit_code:cause?.status??null,error_code:cause?.code??null,signal:cause?.signal??null,total_elapsed_ms:Math.ceil(performance.now()-started),stdout_bytes:knownOutput?Buffer.byteLength(output):null,stdout_digest:knownOutput?digest(output):null}));
   // presence只读；已返回内容或真实校验拒绝不得被运输恢复覆盖。
   if(attempt===2||cause?.status!==255||cause.signal!==null||!knownOutput||output.length!==0||performance.now()>=deadline)throw error;
  }
 }
}
function presence(host,spec){
 const value=JSON.parse(presenceOutput(host,spec));
 need(value?.protocol==='candidate_presence_v1'&&['present','absent'].includes(value.state),'候选存在状态未知');
 need(digest(Object.keys(value).sort())===digest((value.state==='present'?['protocol','state','identity']:['protocol','state']).sort()),'候选存在协议异常');
 if(value.state==='present')need(digest(value.identity)===digest(spec.identity),'候选身份不符');
 return value.state;
}
const prefix='services/phone-adb-controller/';
const need=(v,m)=>{if(!v)throw Error('候选准备: '+m);};
// Measured 2.87 MB over the existing Xian route takes 166s; bound size-based
// transfer time at 10 KiB/s plus 30s connection overhead, never beyond 5min.
export function candidateInstallTimeout(bytes){
 need(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=128*1024*1024,'invalid archive size');
 return Math.min(300000,Math.max(120000,30000+Math.ceil(bytes/10240)*1000));
}
export function candidateRelativeRoot(sha){
 need(/^[a-f0-9]{40}$/.test(sha),'非法版本');
 return `.local/share/zenithjoy/phone-candidates/${sha}/runtime`;
}
export function materializeCandidate({root,sha,destination,release}){
 need(release?.environment===`staging:${sha}`,'只能物化候选release');candidateRelativeRoot(sha);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{env:fixedSourceEnvironment(),maxBuffer:64*1024*1024,encoding:'utf8'});
 const paths=new Set(git('ls-tree','-r','--name-only',sha,'--',prefix).trim().split('\n').filter(p=>p.startsWith(prefix)&&!p.includes('/__tests__/')&&!p.includes('/runtime/tests/')));
 // 迁移后的Skill不再受业务仓Git追踪，从固定catalog显式取完整同一分发版本。
 const lock=JSON.parse(readDeploymentSource(root,sha,'.skills-source.json'));
 const catalog=JSON.parse(execFileSync('git',['-C',join(root,'.skills-source'),'show',`${lock.revision}:distribution/catalog.json`],{env:fixedSourceEnvironment(),encoding:'utf8'}));
 for(const entry of catalog.profiles[lock.profile].files)if(entry.path.startsWith(prefix))paths.add(entry.path);
 for(const c of release.payload.components)if(c.kind!=='repo')paths.add(c.path);
 const files=[];
 for(const path of [...paths].sort()){
  need(!path.startsWith('/')&&!path.split('/').some(p=>['','..','.'].includes(p)),'非法固定源路径');
  const deployed_path=path.startsWith(prefix)?path.slice(prefix.length):`_components/${path}`;
  const bytes=readDeploymentSource(root,sha,path);
  const target=join(destination,deployed_path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,bytes,{mode:0o755,flag:'wx'});
  files.push({path,deployed_path,content_sha256:digest(bytes)});
 }
 need(files.some(f=>f.deployed_path==='leadgen-run.sh')&&files.some(f=>f.deployed_path==='leadgen-rpc.mjs'),'缺候选执行入口');
 return {schema_version:1,source_repo:'perfectuser21/zenithjoy-workspace',source_commit:sha,files};
}
export async function stageCandidate({root,sha,plan,attemptKey,request,brainUrl}){
 need(plan.environment===`staging:${sha}`,'禁止借候选写production');
 // 纯Skill与多平台发布的候选保留完整依赖闭包；只build，不activate正式Skill链接。
 const sourcePackage=buildPublishRelease(root,sha);
 const relative=candidateRelativeRoot(sha),temp=mkdtempSync(join(tmpdir(),'phone-candidate-'));
 try{
  const manifests={};let commanderSnapshot;
  for(const host of ['mmv','xian-m4']){
   const directory=join(temp,host,'runtime');mkdirSync(directory,{recursive:true});
   const release=plan.releases[host],manifest=materializeCandidate({root,sha,destination:directory,release});
   if(host==='mmv'){
    execFileSync('python3',['-B',join(directory,'commander/wf-v2-io.py'),'manifest',join(directory,'commander'),JSON.stringify(commanderMap(release))],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    commanderSnapshot=JSON.parse(readFileSync(join(directory,'commander/runtime-manifest.json'))).runtime_snapshot_sha256;
   }
   const identity={source_commit:sha,release_id:release.id,manifest_sha256:release.manifest_sha256};
   writeFileSync(join(temp,host,'candidate-identity.json'),JSON.stringify(identity),{mode:0o600});
   writeFileSync(join(temp,host,'run.sh'),`#!/bin/bash\nset -euo pipefail\nunset WF_RELEASE_ID WF_DEPLOYMENT_MANIFEST\nexport WFR_HOME="$HOME/.local/share/zenithjoy/phone-candidate-runs/${sha}"\nexec zsh "$(cd "$(dirname "$0")" && pwd)/runtime/leadgen-run.sh" "$@"\n`,{mode:0o755});
   const spec={sha,identity,files:manifest.files,wrapper_sha256:digest(readFileSync(join(temp,host,'run.sh')))};
   if(presence(host,spec)==='absent'){
    const archive=execFileSync('tar',['-C',join(temp,host),'-cf','-','runtime','candidate-identity.json','run.sh'],{maxBuffer:128*1024*1024});
    ssh(host,'install',remoteCommand('install',spec),{input:archive,stdio:['pipe','pipe','pipe'],timeout:host==='xian-m4'?candidateInstallTimeout(archive.length):120000});
    need(presence(host,spec)==='present','安装后候选仍不存在');
   }
   const observed=await observeDeployment({host,manifest,releaseId:release.id,environment:`staging:${sha}`,collector:'phone-adb-deployer',attemptKey:`${attemptKey}:candidate`,brainUrl,
    stateDir:join(homedir(),'.config/zenithjoy/candidate-observations',sha,host),request,
    collect:async()=>JSON.parse(ssh(host,'collect',`node "$HOME/${relative}/deployment-manifest.mjs" collect "$HOME/${relative}" -`,{input:JSON.stringify(manifest),encoding:'utf8',timeout:60000}))});
   ssh(host,'manifest',`umask 077; cat > "$HOME/${relative}/deployment-manifest.json.tmp"; mv "$HOME/${relative}/deployment-manifest.json.tmp" "$HOME/${relative}/deployment-manifest.json"`,{input:JSON.stringify(observed),timeout:30000});
   manifests[host]=observed;
  }
  const result={source_commit:sha,environment:`staging:${sha}`,release_ids:plan.release_ids,observation_ids:Object.fromEntries(Object.entries(manifests).map(([h,m])=>[h,m.observation_id])),commander_runtime_snapshot_sha256:commanderSnapshot,
   candidate_root:`~/${relative}`,run_entry:`~/.local/share/zenithjoy/phone-candidates/${sha}/run.sh`,commander_entry:`~/${relative}/commander/wf-launch.sh`,
   runtime_state:`~/.local/share/zenithjoy/phone-candidate-runs/${sha}`,skill_source_package:sourcePackage.package,business_runtime_status:'not_evaluated'};
  const record=join(homedir(),'.config/zenithjoy/candidate-observations',sha,'candidate.json');
  writeFileSync(record,JSON.stringify(result)+'\n',{mode:0o600});return {...result,record};
 }finally{rmSync(temp,{recursive:true,force:true});}
}
