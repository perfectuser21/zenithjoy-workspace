/** Versioned, self-contained publishing source package. Existing deployment admission serializes writers. */
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,renameSync,rmSync,symlinkSync,readlinkSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {fixedSourceEnvironment,readDeploymentSource} from './deployment-fixed-source.mjs';
const REPO='perfectuser21/zenithjoy-workspace',ENTRY='.agents/skills/multi-platform-publish';
const MANIFEST='publish-source-manifest.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const env=()=>({...fixedSourceEnvironment(),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'});
function git(root,args,{local=false,input,maxBuffer=32*1024*1024,timeout=30000}={}){
 return execFileSync('git',['--literal-pathspecs','-C',root,...args],{env:{...env(),GIT_ALLOW_PROTOCOL:local?'file':''},stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],input,timeout,maxBuffer});
}
function need(value,message){if(!value)throw Error(message);}
function regular(root,path){
 need(typeof path==='string'&&!isAbsolute(path)&&!path.includes('\\')&&!path.split('/').some(p=>!p||p==='.'||p==='..'),'发布文件路径无效');
 let current=resolve(root);for(const part of path.split('/')){current=join(current,part);need(!lstatSync(current).isSymbolicLink(),'发布文件不能经软链接');}
 need(lstatSync(current).isFile(),'发布文件不是普通文件');return readFileSync(current);
}
function safeDirectory(path){
 const absolute=resolve(path),parts=absolute.split('/').filter(Boolean);let current='/';
 for(const part of parts){current=join(current,part);if(!existsSync(current))mkdirSync(current);need(!lstatSync(current).isSymbolicLink()&&lstatSync(current).isDirectory(),'发布安装目录不能经软链接');}
 return absolute;
}
const base=home=>join(resolve(home),'.local/share/zenithjoy/publish-releases');
const links=home=>['.codex-team1/skills/multi-platform-publish','.openclaw/skills/multi-platform-publish'].map(p=>join(resolve(home),p));
function ownGit(source,revision,target,{cacheOnly=false}={}){
 need(/^[0-9a-f]{40}$/.test(revision)&&isAbsolute(source),'固定发布来源无效');safeDirectory(target);
 git(target,['init','--quiet']);git(target,['config','core.hooksPath','/dev/null']);
 git(target,['fetch','--quiet','--no-tags','--depth=1',source,revision],{local:true});
 // checkout attributes may rewrite bytes (eol/filter/encoding); materialize raw objects instead.
 git(target,['read-tree',revision]);git(target,['update-ref','--no-deref','HEAD',revision]);
 const rows=git(target,['ls-tree','-rz',revision]).toString().split('\0').filter(Boolean).map(row=>{
  const m=row.match(/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/s);if(!m&&cacheOnly)return null;need(m,'发布包含非普通Git文件');return {mode:m[1],oid:m[2],path:m[3]};
 }).filter(Boolean);
 const objects=git(target,['cat-file','--batch'],{input:rows.map(row=>row.oid+'\n').join(''),maxBuffer:256*1024*1024,timeout:60000});let offset=0;
 for(const row of rows){
  const end=objects.indexOf(10,offset),header=objects.subarray(offset,end).toString().split(' '),size=Number(header[2]);
  need(end>=offset&&header[0]===row.oid&&header[1]==='blob'&&Number.isSafeInteger(size)&&size>=0&&end+size+1<objects.length&&objects[end+size+1]===10,'Git对象批次不完整');
  const bytes=objects.subarray(end+1,end+1+size);offset=end+size+2;
  need(!isAbsolute(row.path)&&!row.path.split('/').some(part=>!part||part==='.'||part==='..'),'Git发布路径无效');
  safeDirectory(dirname(join(target,row.path)));writeFileSync(join(target,row.path),bytes,{flag:'wx',mode:row.mode==='100755'?0o755:0o644});
 }
 need(offset===objects.length,'Git对象批次多余字节');
 need(!existsSync(join(target,'.git/objects/info/alternates')),'发布Git对象不得共享可变源');
}
function closure(packageRoot,revision){
 need(/^[0-9a-f]{40}$/.test(revision),'发布版本必须为完整SHA');
 need(!lstatSync(packageRoot).isSymbolicLink()&&lstatSync(join(packageRoot,'.git')).isDirectory(),'发布包必须自带真实Git对象');
 need(git(packageRoot,['rev-parse','HEAD']).toString().trim()===revision,'发布包Git版本不符');
 need(!existsSync(join(packageRoot,'.git/objects/info/alternates')),'发布包不能共享Git对象');
 const files=new Map(),rows=git(packageRoot,['ls-tree','-rz',revision]).toString().split('\0').filter(Boolean);
 for(const row of rows){
  const m=row.match(/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/s);need(m,'发布包含非普通Git文件');
  const bytes=regular(packageRoot,m[3]),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  need(blob===m[2],'发布Git文件字节漂移: '+m[3]);files.set(m[3],{path:m[3],sha256:hash(bytes),origin:'business'});
 }
 const lock=JSON.parse(readDeploymentSource(packageRoot,revision,'.skills-source.json'));
 need(lock.version===1&&lock.repository==='perfectuser21/zenithjoy-skills'&&/^[0-9a-f]{40}$/.test(lock.revision),'固定Skills锁无效');
 const cache=join(packageRoot,'.skills-source');need(!lstatSync(cache).isSymbolicLink()&&lstatSync(join(cache,'.git')).isDirectory(),'Skills必须自带独立Git对象');
 need(!existsSync(join(cache,'.git/objects/info/alternates')),'Skills对象不能共享');
 const catalog=JSON.parse(git(cache,['show',`${lock.revision}:distribution/catalog.json`]));
 for(const entry of catalog.profiles[lock.profile].files){
  need(!files.has(entry.path),'Skill生成物不能覆盖业务代码');
  const bytes=readDeploymentSource(packageRoot,revision,entry.path);need(hash(bytes)===entry.sha256,'Skill依赖摘要不符');
  files.set(entry.path,{path:entry.path,sha256:entry.sha256,origin:'skills',source_path:entry.source});
 }
 const allowed=new Set([...files.keys(),MANIFEST,'.skills-source-state.json']);
 const inspect=(directory,prefix='')=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
  const relative=prefix?prefix+'/'+entry.name:entry.name;
  if(!prefix&&['.git','.skills-source'].includes(entry.name))continue;
  need(!entry.isSymbolicLink(),'发布包额外路径不能是软链接');
  if(entry.isDirectory())inspect(join(directory,entry.name),relative);else need(allowed.has(relative),'发布包有未知额外文件: '+relative);
 }};inspect(packageRoot);
 need(files.has(ENTRY+'/SKILL.md')&&files.has(ENTRY+'/scripts/publish_catalog.py')&&[...files.keys()].some(p=>p.startsWith('.skills-runtime/')),'发布依赖闭包缺少入口、路由或运行手册');
 return {schema_version:1,source_repo:REPO,source_commit:revision,skills_source:{repository:lock.repository,revision:lock.revision,profile:lock.profile},files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
export function verifyPublishRelease(packageRoot,revision){
 const expected=closure(packageRoot,revision),recorded=JSON.parse(regular(packageRoot,MANIFEST));
 need(JSON.stringify(recorded)===JSON.stringify(expected),'发布依赖闭包manifest不符');return expected;
}
export function buildPublishRelease(source,revision,{home=homedir()}={}){
 source=resolve(source);need(/^[0-9a-f]{40}$/.test(revision),'发布版本必须为完整SHA');
 const root=safeDirectory(base(home)),destination=join(root,revision);
 if(existsSync(destination)){verifyPublishRelease(destination,revision);return {package:destination,revision};}
 const stage=mkdtempSync(join(root,'.prepare-'+revision.slice(0,8)+'-'));
 try{
  ownGit(source,revision,stage);const lock=JSON.parse(git(stage,['show',`${revision}:.skills-source.json`]));
  ownGit(join(source,'.skills-source'),lock.revision,join(stage,'.skills-source'),{cacheOnly:true});
  // The just-restored Git script and pinned loader are checked by the existing bootstrap.
  execFileSync('python3',['-I',join(stage,'scripts/skills-source.py'),'install','--workspace',stage],{env:env(),stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:32*1024*1024});
  execFileSync('python3',['-I',join(stage,'scripts/skills-source.py'),'verify','--workspace',stage],{env:env(),stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:32*1024*1024});
  writeFileSync(join(stage,MANIFEST),JSON.stringify(closure(stage,revision)),{mode:0o600});
  verifyPublishRelease(stage,revision);renameSync(stage,destination);return {package:destination,revision};
 }finally{if(existsSync(stage))rmSync(stage,{recursive:true,force:true});}
}
function validatePackage(packageRoot,home){
 const path=resolve(packageRoot);need(dirname(path)===base(home)&&/^[0-9a-f]{40}$/.test(path.split('/').at(-1)),'发布安装根无效');
 safeDirectory(dirname(path));return {path,revision:path.split('/').at(-1),target:join(path,ENTRY)};
}
function atomicLink(path,target){const temp=path+'.publish-'+process.pid;try{symlinkSync(target,temp);renameSync(temp,path);}finally{rmSync(temp,{force:true});}}
function previousLinks(home){
 return links(home).map(path=>{
  safeDirectory(dirname(path));let before=null;
  try{need(lstatSync(path).isSymbolicLink(),'现有Skill入口不是链接，保留目录并拒绝');before=readlinkSync(path);const old=resolve(dirname(path),before);need(dirname(dirname(dirname(dirname(old))))===base(home)&&/^[0-9a-f]{40}$/.test(dirname(dirname(dirname(old))).split('/').at(-1))&&old.endsWith('/'+ENTRY),'现有Skill链接不属于固定发布目录');}catch(error){if(error.code!=='ENOENT')throw error;}
  return {path,before};
 });
}
export function rollbackPublishRelease(receipt,{home=homedir()}={}){
 const pkg=validatePackage(receipt.package,home),allowed=links(home);need(receipt.links?.length===allowed.length&&new Set(receipt.links.map(r=>r.path)).size===allowed.length,'回退链接清单不完整');
 for(const row of receipt.links){
  need(allowed.includes(row.path),'非法回退路径');
  if(row.before!==null){const previous=resolve(dirname(row.path),row.before);need(dirname(dirname(dirname(dirname(previous))))===base(home)&&/^[0-9a-f]{40}$/.test(dirname(dirname(dirname(previous))).split('/').at(-1))&&previous.endsWith('/'+ENTRY),'非法回退目标');}
  let current=null;try{need(lstatSync(row.path).isSymbolicLink(),'回退入口已被其他写者替换');current=readlinkSync(row.path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(current===row.before)continue;need(current===pkg.target,'回退CAS冲突，保留其他写者');
  if(row.before===null)rmSync(row.path);else atomicLink(row.path,row.before);
 }
 return {...receipt,status:'rolled_back'};
}
export function activatePublishRelease(packageRoot,{home=homedir(),verifyActivated=()=>{},persist=()=>{}}={}){
 const pkg=validatePackage(packageRoot,home);verifyPublishRelease(pkg.path,pkg.revision);
 const receipt={schema_version:1,package:pkg.path,revision:pkg.revision,links:previousLinks(home),status:'prepared'};persist(receipt);
 try{for(const row of receipt.links)atomicLink(row.path,pkg.target);verifyActivated(receipt);receipt.status='active';persist(receipt);return receipt;}
 catch(error){persist(rollbackPublishRelease(receipt,{home}));throw error;}
}
function receiptFile(home,revision){need(/^[0-9a-f]{40}$/.test(revision),'非法发布事务版本');const root=safeDirectory(join(home,'.local/share/zenithjoy/publish-transactions'));return join(root,revision+'.json');}
function saveReceipt(file,data){const temp=file+'.tmp-'+process.pid;writeFileSync(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});renameSync(temp,file);}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [action,arg,revision]=process.argv.slice(2),home=homedir();let result;
  if(action==='deploy-stdin'){const input=JSON.parse(readFileSync(0,'utf8'));const pkg=buildPublishRelease(input.source,input.revision,{home});const file=receiptFile(home,input.revision);result=activatePublishRelease(pkg.package,{home,persist:r=>saveReceipt(file,r)});}
  else if(action==='build')result=buildPublishRelease(arg,revision,{home});
  else if(action==='verify')result=verifyPublishRelease(arg,revision);
  else if(action==='deploy'){
   const pkg=buildPublishRelease(arg,revision,{home}),file=receiptFile(home,revision);
   result=activatePublishRelease(pkg.package,{home,persist:r=>saveReceipt(file,r)});
  }else if(action==='rollback'){
   const file=receiptFile(home,arg);result=existsSync(file)?rollbackPublishRelease(JSON.parse(regular(dirname(file),file.split('/').at(-1))),{home}):{status:'not_activated'};
   if(existsSync(file))saveReceipt(file,result);
  }else throw Error('未知发布操作');
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
