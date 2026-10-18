// Fixed business Git blobs remain the trust root; generated Skills use its pinned bootstrap/catalog.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
export function readDeploymentSource(root,revision,path,{materialize=false}={}){
 if(!/^[0-9a-f]{40}$/.test(revision)||typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('非法固定部署路径或版本');
 root=resolve(root);let current=root;
 for(const part of path.split('/')){current=resolve(current,part);try{if(lstatSync(current).isSymbolicLink())throw Error('部署路径不能包含符号链接');}catch(error){if(error.code!=='ENOENT')throw error;}}
 let expected,generated=false;
 try{expected=git(root,'show',`${revision}:${path}`);}catch{
  // Execute the bootstrap from the release commit, never the mutable working copy.
  const bootstrap=git(root,'show',`${revision}:scripts/skills-source.py`).toString('utf8');
  const code=`__file__ = ${JSON.stringify(resolve(root,'scripts/skills-source.py'))}\n${bootstrap}`;
  expected=execFileSync('python3',['-c',code,'cat','--workspace',root,'--ref',revision,'--path',path],{stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
  generated=true;
 }
 const target=resolve(root,path);
 if(!existsSync(target)&&materialize&&generated){
  mkdirSync(dirname(target),{recursive:true});const temp=target+`.deploy-${process.pid}`;
  try{writeFileSync(temp,expected,{flag:'wx'});renameSync(temp,target);}finally{rmSync(temp,{force:true});}
 }
 const actual=readFileSync(target);if(!actual.equals(expected))throw Error(`部署工作区字节漂移，不属于固定commit: ${path}`);
 return actual;
}
