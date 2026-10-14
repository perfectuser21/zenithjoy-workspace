#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync,realpathSync } from 'node:fs';
import { resolve,sep,basename } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest } from './runtime-definition.mjs';
export function deploymentManifest(root,files,{commit,repo='perfectuser21/zenithjoy-workspace',repositoryFiles=[]}={}){
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:null});
  commit=commit||git('rev-parse','HEAD').toString().trim();
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('部署必须使用固定commit');
  const sources=files.map(name=>({path:`services/phone-adb-controller/${name}`,deployed_path:name}));
  for(const entry of repositoryFiles){
    if(!entry||!/^apps\/api\/db\/migrations\/[A-Za-z0-9_-]+\.sql$/.test(entry.path)||entry.deployed_path!==`release-evidence/${basename(entry.path)}`)throw Error('非法部署附件路径');
    sources.push(entry);
  }
  const seen=new Set();
  const entries=sources.map(({path,deployed_path:name})=>{
    if(name.startsWith('/')||name.split('/').includes('..'))throw Error('非法部署文件路径');
    if(seen.has(name))throw Error('重复部署落点');seen.add(name);
    const actual=readFileSync(resolve(root,path)); const fixed=git('show',`${commit}:${path}`);
    if(digest(actual)!==digest(fixed))throw Error(`部署文件不属于固定commit: ${path}`);
    return {path,deployed_path:name,content_sha256:digest(actual)};
  });
  return {schema_version:1,source_repo:repo,source_commit:commit,files:entries};
}
export function collectDeployment(root,manifest){
  root=realpathSync(root);
  if(!/^[a-f0-9]{40}$/.test(manifest.source_commit)||!manifest.source_repo||!manifest.files?.length)throw Error('部署来源不完整');
  const files=manifest.files.map(entry=>{
    if(!entry.deployed_path||entry.deployed_path.startsWith('/')||entry.deployed_path.split('/').includes('..'))throw Error('非法部署文件路径');
    const file=realpathSync(resolve(root,entry.deployed_path));
    if(!file.startsWith(root+sep))throw Error('部署文件越界');
    const content_sha256=digest(readFileSync(file));
    if(content_sha256!==entry.content_sha256)throw Error(`实际文件digest不符: ${entry.path}`);
    return {...entry,content_sha256};
  });
  return {source_repo:manifest.source_repo,source_commit:manifest.source_commit,files,observed_hostname:hostname()};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
  try{const arguments_=process.argv.slice(3),repositoryFiles=[],files=[];
    for(const arg of arguments_){if(arg.startsWith('--repository-file=')){const pair=arg.slice('--repository-file='.length).split('=');if(pair.length!==2)throw Error('非法部署附件参数');repositoryFiles.push({path:pair[0],deployed_path:pair[1]});}else files.push(arg);}
    const result=process.argv[2]==='collect'?collectDeployment(process.argv[3],JSON.parse(readFileSync(process.argv[4]==='-'?0:process.argv[4],'utf8'))):deploymentManifest(resolve(process.argv[2]),files,{repositoryFiles});process.stdout.write(JSON.stringify(result,null,2)+'\n');}
  catch(err){process.stderr.write(err.message+'\n');process.exitCode=1;}
}
