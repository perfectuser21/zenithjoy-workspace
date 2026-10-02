#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync,realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from './runtime-definition.mjs';
export function deploymentManifest(root,files,{commit,repo='perfectuser21/zenithjoy-workspace'}={}){
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:null});
  commit=commit||git('rev-parse','HEAD').toString().trim();
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('部署必须使用固定commit');
  const entries=files.map(name=>{
    if(name.startsWith('/')||name.split('/').includes('..'))throw Error('非法部署文件路径');
    const path=`services/phone-adb-controller/${name}`;
    const actual=readFileSync(resolve(root,path)); const fixed=git('show',`${commit}:${path}`);
    if(digest(actual)!==digest(fixed))throw Error(`部署文件不属于固定commit: ${path}`);
    return {path,deployed_path:name,content_sha256:digest(actual)};
  });
  return {schema_version:1,source_repo:repo,source_commit:commit,files:entries};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
  try{process.stdout.write(JSON.stringify(deploymentManifest(resolve(process.argv[2]),process.argv.slice(3)),null,2)+'\n');}
  catch(err){process.stderr.write(err.message+'\n');process.exitCode=1;}
}
