// Fixed business Git blobs remain the trust root; generated Skills use its pinned bootstrap/catalog.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
export function fixedSourceEnvironment({network=false}={}){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')&&!['SKILLS_SOURCE_DIR','SKILLS_SOURCE_SSH_KEY','PYTHONPATH','PYTHONHOME'].includes(key)));
 return {...env,GIT_NO_REPLACE_OBJECTS:'1',GIT_ALLOW_PROTOCOL:network?'https':'',GIT_TERMINAL_PROMPT:'0',PYTHONDONTWRITEBYTECODE:'1'};
}
const options=()=>({env:fixedSourceEnvironment(),stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024,timeout:15000});
const git=(root,...args)=>execFileSync('git',['-C',root,...args],options());
function bootstrapCode(root,revision){return `__file__ = ${JSON.stringify(resolve(root,'scripts/skills-source.py'))}\n${git(root,'show',`${revision}:scripts/skills-source.py`).toString('utf8')}`;}
function pinnedCache(root,revision){
 const lock=JSON.parse(git(root,'show',`${revision}:.skills-source.json`));
 if(!/^[0-9a-f]{40}$/.test(lock.revision||'')||lock.repository!=='perfectuser21/zenithjoy-skills')throw Error('Skill固定来源无效');
 const cache=resolve(root,'.skills-source');
 if(!existsSync(resolve(cache,'.git')))throw Error('Skill Git缓存不存在；请先安装固定版本');
 try{git(cache,'cat-file','-e',lock.revision+'^{commit}');}catch{throw Error('Skill Git缓存缺少固定版本；请先安装');}
 return {lock,cache};
}
export function prepareDeploymentSkillSources(root,revision){
 try{git(root,'cat-file','-e',`${revision}:.skills-source.json`);}catch{return;}
 try{pinnedCache(root,revision);return;}catch{}
 const lock=git(root,'show',`${revision}:.skills-source.json`);
 if(!readFileSync(resolve(root,'.skills-source.json')).equals(lock))throw Error('Skill锁与固定发布不一致');
 execFileSync('python3',['-I','-c',bootstrapCode(root,revision),'install','--workspace',root],{...options(),env:fixedSourceEnvironment({network:true}),timeout:120000});
 pinnedCache(root,revision);
}
export function readDeploymentSource(root,revision,path,{materialize=false}={}){
 if(!/^[0-9a-f]{40}$/.test(revision)||typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('非法固定部署路径或版本');
 root=resolve(root);let current=root;
 for(const part of path.split('/')){current=resolve(current,part);try{if(lstatSync(current).isSymbolicLink())throw Error('部署路径不能包含符号链接');}catch(error){if(error.code!=='ENOENT')throw error;}}
 let expected,generated=false;
 try{expected=git(root,'show',`${revision}:${path}`);}catch{
  // Execute the bootstrap from the release commit, never the mutable working copy.
  const {cache}=pinnedCache(root,revision);
  expected=execFileSync('python3',['-I','-c',bootstrapCode(root,revision),'cat','--workspace',root,'--source',cache,'--ref',revision,'--path',path],options());
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
