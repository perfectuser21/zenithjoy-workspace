#!/usr/bin/env node
// 开发隔离实验工具；不参与生产deploy。所有业务字节只取固定git对象。
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,posix,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const base='services/phone-adb-controller/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args]);
const safe=name=>{if(!name||name.startsWith('/')||name.split('/').includes('..'))throw Error('快照路径越界');return name;};
function sourceFiles(root,commit,role){
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('快照必须固定40位commit');
 const groups=role==='gateway'?['MMV_JS_FILES','MMV_PROBE_FILES']:role==='device'?['DEVICE_SH_FILES','DEVICE_NODE_FILES','DEVICE_PLAN_FILES','DEVICE_CTL_FILES']:null;
 if(!groups)throw Error('快照role非法');
 const deploy=git(root,'show',`${commit}:${base}deploy.sh`).toString();
 const files=new Set(groups.flatMap(group=>{
  const body=new RegExp('^'+group+'=\\(([\\s\\S]*?)\\)','m').exec(deploy)?.[1];
  if(!body)throw Error('快照缺角色清单');return body.replace(/#[^\n]*/g,'').trim().split(/\s+/);
 }));
 // 将静态相对JS依赖闭包落在同一平铺目录；不会从工作树混入未提交字节。
 for(const name of files){
  safe(name);const text=git(root,'show',`${commit}:${base}${name}`).toString();
  if(!/\.(?:js|mjs)$/.test(name))continue;
  for(const match of text.matchAll(/(?:require\(\s*|from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)){
   let dep=posix.normalize(posix.join(posix.dirname(name),match[1]));safe(dep);
   if(!posix.extname(dep))dep+='.js';files.add(dep);
  }
  // 同目录静态资产也是真身依赖，例如own-account/ramp配置与探针YAML。
  // 静态字符串参数之间必须有逗号，允许单个尾逗号，避免缺逗号源码触发指数回溯。
  for(const match of text.matchAll(/join\(\s*__dirname\s*,\s*(['"][^'"]+['"](?:\s*,\s*['"][^'"]+['"])*)\s*(?:,\s*)?\)/g)){
   const parts=[...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item=>item[1]);
   files.add(safe(posix.normalize(posix.join(posix.dirname(name),...parts))));
  }
  for(const match of text.matchAll(/new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)){
   files.add(safe(posix.normalize(posix.join(posix.dirname(name),match[1]))));
  }
 }
 return [...files].sort();
}
export function prepareSnapshot({root,commit,role,directory}){
 directory=resolve(directory);if(existsSync(directory))throw Error('快照目录已存在，禁止覆写');
 const files=sourceFiles(root,commit,role).map(name=>({name,bytes:git(root,'show',`${commit}:${base}${name}`)}));
 mkdirSync(directory,{recursive:true});
 for(const {name,bytes} of files){mkdirSync(dirname(join(directory,name)),{recursive:true});writeFileSync(join(directory,name),bytes,{mode:0o700});}
 const manifest={schema_version:1,role,source_commit:commit,files:files.map(({name,bytes})=>({path:name,sha256:hash(bytes)}))};
 writeFileSync(join(directory,'snapshot-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export function verifySnapshot({root,commit,role,directory}){
 try{
  const manifest=JSON.parse(readFileSync(join(directory,'snapshot-manifest.json')));
  if(manifest.role!==role)throw Error('角色不符');
  if(commit!==undefined&&manifest.source_commit!==commit)throw Error('固定commit不符');
  const expected=sourceFiles(root,manifest.source_commit,role);
  if(JSON.stringify(manifest.files.map(f=>f.path))!==JSON.stringify(expected))throw Error('清单不完整');
  for(const {path,sha256} of manifest.files){
   const target=join(directory,safe(path));if(!lstatSync(target).isFile()||realpathSync(target)!==join(realpathSync(directory),path))throw Error('文件非真身');
   const actual=hash(readFileSync(target));if(actual!==sha256||actual!==hash(git(root,'show',`${manifest.source_commit}:${base}${path}`)))throw Error('字节不属固定commit');
  }
  return manifest;
 }catch(error){throw Error('快照完整性拒绝: '+error.message);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,root,commitOrRole,roleOrDirectory,directory]=process.argv.slice(2);
 try{const result=mode==='prepare'?prepareSnapshot({root,commit:commitOrRole,role:roleOrDirectory,directory}):mode==='verify'?verifySnapshot({root,commit:commitOrRole,role:roleOrDirectory,directory}):(()=>{throw Error('用法: prepare ROOT SHA ROLE DIRECTORY | verify ROOT SHA ROLE DIRECTORY');})();
 process.stdout.write(JSON.stringify({role:result.role,source_commit:result.source_commit,files:result.files.length})+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
