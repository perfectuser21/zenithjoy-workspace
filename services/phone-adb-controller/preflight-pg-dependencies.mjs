// 第三方依赖独立于业务 Git 文件：只接纳受审锁的官方 tarball，不运行安装脚本。
import {createHash,timingSafeEqual} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {get} from 'node:https';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,readdirSync,openSync,fstatSync,closeSync,constants,existsSync,fsyncSync,linkSync,unlinkSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const LOCK_SHA='a8ca6b5cb0ab3337928d39100c3f7322113e3649b570c84bbf919ac4e5a3941c';
const need=(v,code)=>{if(!v)throw Error('PREFLIGHT_PG_'+code);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const decodeJson=(bytes,reason)=>{try{return JSON.parse(bytes);}catch{throw Error('PREFLIGHT_PG_'+reason);}};
const safePath=p=>typeof p==='string'&&/^[A-Za-z0-9_./@+-]+$/.test(p)&&!p.startsWith('/')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
function directory(p,privateMode=false){let s;try{s=lstatSync(p);}catch{throw Error('PREFLIGHT_PG_DIRECTORY');}need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o022)&&(!privateMode||(s.mode&0o777)===0o700),'DIRECTORY');return realpathSync(p);}
function regular(p,max=16*1024*1024){
 let before;try{before=lstatSync(p);}catch{throw Error('PREFLIGHT_PG_FILE_MISSING');}need(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.uid===process.getuid()&&(before.mode&0o777)===0o600&&before.size<=max,'FILE_ACL');
 const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=fstatSync(fd);need(s.dev===before.dev&&s.ino===before.ino&&s.size===before.size,'FILE_CHANGED');return readFileSync(fd);}finally{closeSync(fd);}
}
function lockAt(root){
 directory(root);const file=join(root,'preflight-pg-lock.json');
 let s;try{s=lstatSync(file);}catch{throw Error('PREFLIGHT_PG_LOCK_FILE');}need(s.isFile()&&!s.isSymbolicLink()&&!(s.mode&0o022),'LOCK_FILE');const bytes=readFileSync(file);need(sha(bytes)===LOCK_SHA,'LOCK_DIGEST');
 const value=decodeJson(bytes,'LOCK_JSON');need(value.schema_version===1&&value.entry==='pg'&&value.packages.length===14,'LOCK_SCHEMA');return {value,bytes};
}
export function preflightPgLockIdentity({runtimeRoot=HERE}={}){
 const {value}=lockAt(runtimeRoot);return {lock_sha256:LOCK_SHA,package_lock_sha256:value.package_lock_sha256};
}
// 构建时对整份 Git 锁机械复算闭包与最近父级解析，不以新 descriptor 自证集合。
export function verifyPreflightPgLock(packageLockBytes){
 const {value}=lockAt(HERE);need(sha(packageLockBytes)===value.package_lock_sha256,'GIT_LOCK_DIGEST');const all=decodeJson(packageLockBytes,'GIT_LOCK_JSON').packages,seen=new Map();
 function visit(path){if(seen.has(path))return;const p=all[path];need(p,'GIT_PACKAGE');const edges={};seen.set(path,{p,edges});
  for(const name of Object.keys({...p.dependencies,...p.optionalDependencies}).sort()){
   let current=path,found;
   while(true){const trial=(current?current+'/':'')+'node_modules/'+name;if(all[trial]){found=trial;break;}need(current!=='','UNRESOLVED');current=dirname(current)==='.'?'':dirname(current);}
   edges[name]=found;visit(found);
  }
 }
 visit('node_modules/pg');need(seen.size===value.packages.length,'CLOSURE_SIZE');
 for(const e of value.packages){const v=seen.get(e.path);need(v&&v.p.version===e.version&&e.path==='node_modules/'+e.name,'CLOSURE_VERSION');need(JSON.stringify(v.edges)===JSON.stringify(Object.fromEntries(Object.entries(e.dependencies).sort())),'CLOSURE_EDGES');if(v.p.integrity)need(v.p.integrity===e.integrity&&v.p.resolved===e.resolved,'ORIGINAL_SSRI');}
 return preflightPgLockIdentity();
}
export function verifiedTarFiles(bytes,entry){
 need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=4*1024*1024,'TARBALL_SIZE');need(/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity),'SSRI_SCHEMA');
 const actual=createHash('sha512').update(bytes).digest(),expected=Buffer.from(entry.integrity.slice(7),'base64');need(expected.length===actual.length&&timingSafeEqual(expected,actual),'SSRI');
 const raw=gunzipSync(bytes,{maxOutputLength:16*1024*1024}),files=new Map();let offset=0,ended=false;
 const text=(b,a,n)=>b.subarray(a,a+n).toString('utf8').split('\0')[0];
 while(offset+512<=raw.length){const h=raw.subarray(offset,offset+512);offset+=512;if(h.every(x=>x===0)){ended=true;break;}
  const oct=(a,n)=>{const v=text(h,a,n).trim();need(/^[0-7]+$/.test(v),'TAR_NUMBER');return parseInt(v,8);};
  const sum=[...h].reduce((s,v,i)=>s+(i>=148&&i<156?32:v),0);need(oct(148,8)===sum,'TAR_CHECKSUM');
  const prefix=text(h,345,155),name=(prefix?prefix+'/':'')+text(h,0,100),type=text(h,156,1)||'0',size=oct(124,12);
  need(name.startsWith('package/')&&safePath(name.replace(/\/$/,'')),'TAR_PATH');need(type==='0'||type==='5','TAR_TYPE');need(size<=4*1024*1024&&offset+size<=raw.length,'TAR_LENGTH');
  if(type==='0'){const key=name.slice(8);need(safePath(key)&&!files.has(key),'TAR_DUPLICATE');files.set(key,Buffer.from(raw.subarray(offset,offset+size)));}else need(size===0,'TAR_DIRECTORY');
  offset+=Math.ceil(size/512)*512;
 }
 need(ended&&files.size>0&&raw.subarray(offset).every(x=>x===0),'TAR_END');const pkg=decodeJson(files.get('package.json')||'null','PACKAGE_JSON');need(pkg?.name===entry.name&&pkg?.version===entry.version,'PACKAGE_IDENTITY');return files;
}
function target(root){return join(root,'_dependencies','preflight-pg');}
const tarName=e=>e.name+'-'+e.version+'.tgz';
function durableFile(path,bytes){writeFileSync(path,bytes,{flag:'wx',mode:0o600});const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncDirectory(path){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncDirectories(root){for(const e of readdirSync(root,{withFileTypes:true}))if(e.isDirectory())syncDirectories(join(root,e.name));syncDirectory(root);}
function fetchTarball(e){
 need(e.resolved===`https://registry.npmjs.org/${e.name}/-/${e.name}-${e.version}.tgz`,'REGISTRY_URL');
 return new Promise((ok,no)=>{const req=get(e.resolved,{timeout:10000},r=>{if(r.statusCode!==200){r.destroy();no(Error('PREFLIGHT_PG_REGISTRY_HTTP'));return;}const chunks=[];let bytes=0;r.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy(Error('PREFLIGHT_PG_TARBALL_SIZE'));else chunks.push(b);});r.on('end',()=>ok(Buffer.concat(chunks)));r.on('error',()=>no(Error('PREFLIGHT_PG_REGISTRY_BODY')));});req.on('timeout',()=>req.destroy(Error('PREFLIGHT_PG_REGISTRY_TIMEOUT')));req.on('error',()=>no(Error('PREFLIGHT_PG_REGISTRY_NETWORK')));});
}
export async function installPreflightPg({runtimeRoot,sourceCommit,tarballs}){
 need(/^[0-9a-f]{40}$/.test(sourceCommit),'SOURCE');directory(runtimeRoot);const {value:lock,bytes:lockBytes}=lockAt(HERE);
 const deployedLock=join(runtimeRoot,'preflight-pg-lock.json');if(!existsSync(deployedLock))writeFileSync(deployedLock,lockBytes,{flag:'wx',mode:0o600});lockAt(runtimeRoot);
 const parent=join(runtimeRoot,'_dependencies');if(!existsSync(parent))mkdirSync(parent,{mode:0o700});directory(parent,true);const dest=target(runtimeRoot);mkdirSync(dest,{mode:0o700});
 mkdirSync(join(dest,'tarballs'),{mode:0o700});mkdirSync(join(dest,'node_modules'),{mode:0o700});const files=[];
 for(const e of lock.packages){const bytes=tarballs?tarballs.get(e.name):await fetchTarball(e);const extracted=verifiedTarFiles(bytes,e);durableFile(join(dest,'tarballs',tarName(e)),bytes);
  for(const [path,data]of extracted){const rel=e.path+'/'+path,full=join(dest,rel);mkdirSync(dirname(full),{recursive:true,mode:0o700});durableFile(full,data);files.push({path:rel,sha256:sha(data),bytes:data.length});}
 }
 const manifest={schema_version:1,source_commit:sourceCommit,...preflightPgLockIdentity(),packages:lock.packages,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
 const pending=join(dest,`.manifest-${process.pid}.pending`);durableFile(pending,JSON.stringify(manifest)+'\n');syncDirectories(dest);
 // 完整树落盘后才用排他原子链接提交marker；partial目录不自动接纳/覆盖。
 linkSync(pending,join(dest,'manifest.json'));unlinkSync(pending);syncDirectory(dest);syncDirectory(parent);syncDirectory(runtimeRoot);
 verifyPreflightPg({runtimeRoot,frozen:{deployment:{source_commit:sourceCommit},preflight_pg:preflightPgLockIdentity()}});
 return {packages:lock.packages.length,entry_version:'8.18.0',frozen:preflightPgLockIdentity(),manifest_sha256:sha(regular(join(dest,'manifest.json')))};
}
function inventory(root,prefix=''){
 const out=[];for(const e of readdirSync(join(root,prefix),{withFileTypes:true})){const p=prefix?prefix+'/'+e.name:e.name;need(safePath(p),'FILE_PATH');if(e.isDirectory()){directory(join(root,p),true);out.push(...inventory(root,p));}else{regular(join(root,p));out.push(p);}}return out.sort();
}
export function verifyPreflightPg({runtimeRoot,frozen}){
 const identity=preflightPgLockIdentity({runtimeRoot});const source=frozen?.deployment?.source_commit;need(/^[a-f0-9]{40}$/.test(source||'')&&(!Object.hasOwn(frozen,'source_commit')||frozen.source_commit===source),'FROZEN_SOURCE');need(frozen.preflight_pg&&Object.keys(frozen.preflight_pg).sort().join(',')==='lock_sha256,package_lock_sha256'&&frozen.preflight_pg.lock_sha256===identity.lock_sha256&&frozen.preflight_pg.package_lock_sha256===identity.package_lock_sha256,'FROZEN_LOCK');
 const {value:lock}=lockAt(runtimeRoot),dest=target(runtimeRoot);directory(join(runtimeRoot,'_dependencies'),true);directory(dest,true);const actualPaths=inventory(dest);
 const manifest=decodeJson(regular(join(dest,'manifest.json')),'MANIFEST_JSON');need(manifest.schema_version===1&&manifest.source_commit===source&&manifest.lock_sha256===identity.lock_sha256&&manifest.package_lock_sha256===identity.package_lock_sha256,'MANIFEST');need(JSON.stringify(manifest.packages)===JSON.stringify(lock.packages),'MANIFEST_PACKAGES');
 const files=[];const expected=['manifest.json'];
 for(const e of lock.packages){const archive='tarballs/'+tarName(e);expected.push(archive);const raw=regular(join(dest,archive),4*1024*1024),extracted=verifiedTarFiles(raw,e);
  for(const [name,bytes]of extracted){const path=e.path+'/'+name;expected.push(path);const actual=regular(join(dest,path));need(sha(actual)===sha(bytes),'FILE_DIGEST');files.push({path,sha256:sha(bytes),bytes:bytes.length});}
 }
 need(JSON.stringify(actualPaths)===JSON.stringify(expected.sort()),'EXTRA_FILES');need(JSON.stringify(files.sort((a,b)=>a.path.localeCompare(b.path)))===JSON.stringify(manifest.files),'MANIFEST_FILES');return {manifest,manifest_sha256:sha(regular(join(dest,'manifest.json')))};
}
// Explicit offline handoff from a source-verified candidate into this run's
// private frozen tree. Runtime never searches the candidate or downloads packages.
export async function prepareFrozenPreflightPg({sourceRuntimeRoot,runtimeRoot,frozen,expectedDeployment}){
 const canonical=value=>JSON.stringify(value,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
 need(realpathSync(sourceRuntimeRoot)!==realpathSync(runtimeRoot),'FREEZE_ROOT');
 const sourceCommit=frozen?.deployment?.source_commit,verified=verifyPreflightPg({runtimeRoot:sourceRuntimeRoot,frozen});
 const observed=preflightPgDeployment({runtimeRoot:sourceRuntimeRoot,sourceCommit});need(expectedDeployment&&canonical(observed)===canonical(expectedDeployment),'FREEZE_DEPLOYMENT');
 const tarballs=new Map(verified.manifest.packages.map(e=>[e.name,regular(join(target(sourceRuntimeRoot),'tarballs',tarName(e)),4*1024*1024)]));
 need(tarballs.size===verified.manifest.packages.length,'FREEZE_TARBALLS');
 await installPreflightPg({runtimeRoot,sourceCommit,tarballs});
 const installed=preflightPgDeployment({runtimeRoot,sourceCommit});need(canonical(installed)===canonical(observed),'FREEZE_COPY');
 need(canonical(preflightPgDeployment({runtimeRoot:sourceRuntimeRoot,sourceCommit}))===canonical(observed),'FREEZE_SOURCE_CHANGED');return installed;
}
export function loadPreflightPg({runtimeRoot,frozen}){
 verifyPreflightPg({runtimeRoot,frozen});need(!process.env.NODE_PG_FORCE_NATIVE&&!process.env.NODE_PATH,'ENVIRONMENT_ROUTE');const dest=target(realpathSync(runtimeRoot)),require=createRequire(join(dest,'package.json'));
 need(require.resolve('pg')===join(dest,'node_modules/pg/lib/index.js'),'MODULE_ROUTE');const {Pool}=require('pg');need(typeof Pool==='function','POOL_EXPORT');return Object.freeze({Pool});
}
export function preflightPgDeployment({runtimeRoot,sourceCommit}){
 const frozen={deployment:{source_commit:sourceCommit},preflight_pg:preflightPgLockIdentity({runtimeRoot})};
 const verified=verifyPreflightPg({runtimeRoot,frozen}),root=target(runtimeRoot);
 return {schema_version:1,kind:'npm-tarball',source_commit:sourceCommit,...frozen.preflight_pg,manifest_sha256:verified.manifest_sha256,
  files:inventory(root).map(path=>({deployed_path:'_dependencies/preflight-pg/'+path,content_sha256:sha(regular(join(root,path))),mode:0o600}))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 Promise.resolve().then(()=>{need(process.argv.length===5&&process.argv[2]==='install','CLI');return installPreflightPg({runtimeRoot:resolve(process.argv[3]),sourceCommit:process.argv[4]});}).then(value=>console.log(JSON.stringify(value))).catch(()=>{process.stderr.write('PREFLIGHT_PG_INSTALL_REJECTED\n');process.exitCode=1;});
}
