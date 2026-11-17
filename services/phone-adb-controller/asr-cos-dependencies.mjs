import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import {verifiedTarFiles} from './preflight-pg-dependencies.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const LOCK_SHA='fccbf14de07a6389e3fd81b071b5a478a59d5ddf49bafc8766759adde54fc6d6';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,c)=>{if(!v)throw Error('ASR_COS_DEPENDENCY_'+c);};
function regular(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const info=fs.fstatSync(fd);need(info.isFile()&&info.uid===process.getuid()&&!(info.mode&0o022)&&info.size<=16*1024*1024,'FILE');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function lock(){const bytes=regular(path.join(HERE,'asr-cos-sdk-lock.json'));need(sha(bytes)===LOCK_SHA,'LOCK');return JSON.parse(bytes);}
const tarName=e=>e.name+'-'+e.version+'.tgz';
const destination=root=>path.join(root,'_dependencies','asr-cos');
function paths(root,prefix=''){
 const out=[];for(const e of fs.readdirSync(path.join(root,prefix),{withFileTypes:true})){const p=prefix?prefix+'/'+e.name:e.name;need(!e.isSymbolicLink(),'SYMLINK');if(e.isDirectory())out.push(...paths(root,p));else{need(e.isFile(),'SPECIAL');out.push(p);}}return out.sort();
}
export function verifyAsrCosSdk({directory=destination(HERE)}={}){
 try{
  need(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'DIRECTORY');
  const manifest=JSON.parse(regular(path.join(directory,'manifest.json')));need(manifest.lock_sha256===LOCK_SHA&&/^[a-f0-9]{40}$/.test(manifest.source_commit),'MANIFEST');
  const expected=['manifest.json'],files=[];
  for(const e of lock().packages){
   const tar='tarballs/'+tarName(e),bytes=regular(path.join(directory,tar));expected.push(tar);files.push({path:tar,sha256:sha(bytes),bytes:bytes.length});
   for(const [name,content] of verifiedTarFiles(bytes,e)){const p='node_modules/'+e.name+'/'+name;need(sha(regular(path.join(directory,p)))===sha(content),'BYTES');expected.push(p);files.push({path:p,sha256:sha(content),bytes:content.length});}
  }
  need(JSON.stringify(paths(directory))===JSON.stringify(expected.sort()),'EXTRA');files.sort((a,b)=>a.path.localeCompare(b.path));need(JSON.stringify(files)===JSON.stringify(manifest.files),'MANIFEST_FILES');
  return {directory,manifest,manifest_sha256:sha(regular(path.join(directory,'manifest.json')))};
 }catch{throw Error('ASR_COS_DEPENDENCY_UNVERIFIED');}
}
function download(e){
 need(e.resolved===`https://registry.npmjs.org/${e.name}/-/${e.name}-${e.version}.tgz`,'REGISTRY');
 return new Promise((resolve,reject)=>{
  const req=https.get(e.resolved,{agent:false},r=>{if(r.statusCode!==200){r.destroy();reject(Error('ASR_COS_DEPENDENCY_DOWNLOAD'));return;}const chunks=[];let length=0;r.on('data',b=>{length+=b.length;if(length>4*1024*1024)req.destroy();else chunks.push(b);});r.on('end',()=>resolve(Buffer.concat(chunks)));r.on('error',()=>reject(Error('ASR_COS_DEPENDENCY_DOWNLOAD')));});req.setTimeout(15000,()=>req.destroy());req.on('error',()=>reject(Error('ASR_COS_DEPENDENCY_DOWNLOAD')));
 });
}
/** Build only: no npm scripts, no global installation, no runtime downloading. */
export async function installAsrCosSdk({runtimeRoot=HERE,sourceCommit,tarballs}={}){
 need(/^[a-f0-9]{40}$/.test(sourceCommit||''),'SOURCE');const target=destination(runtimeRoot);need(!fs.existsSync(target),'EXISTS');
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const stage=target+'.'+randomUUID();fs.mkdirSync(stage,{mode:0o700});
 try{
  const files=[];
  const put=(name,bytes)=>{const dest=path.join(stage,name);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,bytes,{mode:0o600,flag:'wx'});files.push({path:name,sha256:sha(bytes),bytes:bytes.length});};
  for(const e of lock().packages){const bytes=tarballs?regular(path.join(tarballs,tarName(e))):await download(e);const extracted=verifiedTarFiles(bytes,e);put('tarballs/'+tarName(e),bytes);for(const [name,b] of extracted)put('node_modules/'+e.name+'/'+name,b);}
  const manifest={schema:1,source_commit:sourceCommit,lock_sha256:LOCK_SHA,entry:'cos-nodejs-sdk-v5/sdk/util.js',capabilities:['getAuth','xml2json'],files:files.sort((a,b)=>a.path.localeCompare(b.path))};
  fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx'});verifyAsrCosSdk({directory:stage});fs.renameSync(stage,target);return verifyAsrCosSdk({directory:target});
 }catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
}
export function verifiedCosUtilities(){
 const {directory}=verifyAsrCosSdk();const require=createRequire(path.join(directory,'entry.cjs'));
 // Require only the official local utility module: SDK HTTP/retry code is never loaded.
 return require('./node_modules/cos-nodejs-sdk-v5/sdk/util.js');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [root,commit]=process.argv.slice(2);const result=await installAsrCosSdk({runtimeRoot:root,sourceCommit:commit});console.log(JSON.stringify({verified:true,manifest_sha256:result.manifest_sha256,files:result.manifest.files.length}));}
 catch{console.error('ASR_COS_DEPENDENCY_BUILD_FAILED');process.exitCode=1;}
}
