// 候选只写版本目录；不改正式入口、launchd、手机、账号或队列。
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {digest} from './runtime-definition.mjs';
import {readDeploymentSource,fixedSourceEnvironment} from './deployment-fixed-source.mjs';
import {observeDeployment} from './deployment-release.mjs';
import {commanderMap} from './deployment-targets.mjs';
import {buildPublishRelease} from './deployment-publish-release.mjs';
const prefix='services/phone-adb-controller/';
const need=(v,m)=>{if(!v)throw Error('候选准备: '+m);};
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
   const archive=execFileSync('tar',['-C',join(temp,host),'-cf','-','runtime','candidate-identity.json','run.sh'],{maxBuffer:128*1024*1024});
   // 路径只由SHA构造；已存在版本不覆盖，后续完整字节采集验证再使用。
   const install=`set -eu; base="$HOME/.local/share/zenithjoy/phone-candidates"; mkdir -p "$base"; test ! -L "$base"; test ! -L "$base/${sha}"; test ! -L "$base/${sha}/runtime"; if [ -e "$base/${sha}" ]; then cat >/dev/null; else stage=$(mktemp -d "$base/.${sha}.XXXXXX"); trap 'rm -rf "$stage"' EXIT; tar -xf - -C "$stage"; mv "$stage" "$base/${sha}"; fi`;
   execFileSync('ssh',[host,install],{input:archive,stdio:['pipe','pipe','pipe'],timeout:120000});
   const installedIdentity=JSON.parse(execFileSync('ssh',[host,`cat "$HOME/.local/share/zenithjoy/phone-candidates/${sha}/candidate-identity.json"`],{encoding:'utf8',timeout:30000}));
   need(digest(installedIdentity)===digest(identity),'同SHA目录已绑定不同release；保留原候选，拒绝覆盖其Commander身份');
   const observed=await observeDeployment({host,manifest,releaseId:release.id,environment:`staging:${sha}`,collector:'phone-adb-deployer',attemptKey:`${attemptKey}:candidate`,brainUrl,
    stateDir:join(homedir(),'.config/zenithjoy/candidate-observations',sha,host),request,
    collect:async()=>JSON.parse(execFileSync('ssh',[host,`node "$HOME/${relative}/deployment-manifest.mjs" collect "$HOME/${relative}" -`],{input:JSON.stringify(manifest),encoding:'utf8',timeout:60000}))});
   execFileSync('ssh',[host,`umask 077; cat > "$HOME/${relative}/deployment-manifest.json.tmp"; mv "$HOME/${relative}/deployment-manifest.json.tmp" "$HOME/${relative}/deployment-manifest.json"`],{input:JSON.stringify(observed),timeout:30000});
   manifests[host]=observed;
  }
  const result={source_commit:sha,environment:`staging:${sha}`,release_ids:plan.release_ids,observation_ids:Object.fromEntries(Object.entries(manifests).map(([h,m])=>[h,m.observation_id])),commander_runtime_snapshot_sha256:commanderSnapshot,
   candidate_root:`~/${relative}`,run_entry:`~/.local/share/zenithjoy/phone-candidates/${sha}/run.sh`,commander_entry:`~/${relative}/commander/wf-launch.sh`,
   runtime_state:`~/.local/share/zenithjoy/phone-candidate-runs/${sha}`,skill_source_package:sourcePackage.package,business_runtime_status:'not_evaluated'};
  const record=join(homedir(),'.config/zenithjoy/candidate-observations',sha,'candidate.json');
  writeFileSync(record,JSON.stringify(result)+'\n',{mode:0o600});return {...result,record};
 }finally{rmSync(temp,{recursive:true,force:true});}
}
