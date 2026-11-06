// Fixed business Git blobs remain the trust root; generated Skills use its pinned bootstrap/catalog.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,mkdirSync,writeFileSync,renameSync,rmSync,openSync,fstatSync,closeSync,readSync,constants,realpathSync,mkdtempSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {userInfo,tmpdir} from 'node:os';
import {TextDecoder} from 'node:util';
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
// Only the fixed cold bootstrap owns this credential. No environment/path fallback.
function bootstrapKey(){
 let fd;
 try{
  const home=userInfo().homedir, parent=resolve(home,'.credentials'), path=resolve(parent,'zenithjoy-skills-source-read.key');
  if(realpathSync(home)!==home||realpathSync(parent)!==parent)throw Error();
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(fd),valid=s=>s.isFile()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.nlink===1&&s.size>0&&s.size<=65536;
  if(!valid(before))throw Error();
  const buffer=Buffer.alloc(65537);let count=0,read;
  while(count<buffer.length&&(read=readSync(fd,buffer,count,buffer.length-count,null))>0)count+=read;
  const bytes=buffer.subarray(0,count),after=fstatSync(fd);
  if(!valid(after)||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k])||bytes.length!==before.size||bytes.includes(0))throw Error();
  const key=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!key.trim())throw Error();return key;
 }catch{throw Error('SKILL_SOURCE_BOOTSTRAP_KEY_INVALID');}finally{if(fd!==undefined)closeSync(fd);}
}
function coldBootstrapCode(root,revision){
 // Keep the pinned helper unchanged. Its own process may read the key, but every
 // subprocess (explicit env or inherited env) gets an independent scrubbed copy.
 return `import os as _source_os, subprocess as _source_subprocess
_source_popen = _source_subprocess.Popen
class _SourcePopen(_source_popen):
 def __init__(self, *args, **kwargs):
  env = kwargs.get("env")
  env = dict(_source_os.environ if env is None else env)
  env.pop("SKILLS_SOURCE_SSH_KEY", None)
  kwargs["env"] = env
  super().__init__(*args, **kwargs)
_source_subprocess.Popen = _SourcePopen
${bootstrapCode(root,revision)}`;
}
export function prepareDeploymentSkillSources(root,revision){
 try{git(root,'cat-file','-e',`${revision}:.skills-source.json`);}catch{return;}
 try{pinnedCache(root,revision);return;}catch{}
 const lock=git(root,'show',`${revision}:.skills-source.json`);
 if(!readFileSync(resolve(root,'.skills-source.json')).equals(lock))throw Error('Skill锁与固定发布不一致');
 const key=bootstrapKey(),code=coldBootstrapCode(root,revision),temporary=mkdtempSync(resolve(realpathSync(tmpdir()),'skill-source-bootstrap-'));
 try{
  execFileSync('python3',['-I','-c',code,'install','--workspace',root],{...options(),env:{...fixedSourceEnvironment({network:true}),GIT_ALLOW_PROTOCOL:'ssh',SKILLS_SOURCE_SSH_KEY:key,TMPDIR:temporary},timeout:120000});
 }catch{throw Error('SKILL_SOURCE_BOOTSTRAP_FAILED');}finally{rmSync(temporary,{recursive:true,force:true});}
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
