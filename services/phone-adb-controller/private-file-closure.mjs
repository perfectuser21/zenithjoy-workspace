import {lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve,sep} from 'node:path';

const fail=()=>{throw Error('PRIVATE_FILE_CLOSURE_DRIFT');};
const identity=s=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');

// Only a run-local, owned, non-aliased fixed tree may reuse a byte check.
export function pinPrivateFileClosure({root,files,verify}) {
 if(!isAbsolute(root)||realpathSync(root)!==root)fail();
 const uid=BigInt(process.getuid()),rows=new Map();
 const rootIdentity=()=>{
  const s=lstatSync(root,{bigint:true});
  if(!s.isDirectory()||s.uid!==uid||(s.mode&0o022n))fail();
  return [s.dev,s.ino,s.uid,s.mode].join(':');
 };
 const pinnedRoot=rootIdentity();
 const fingerprint=(path,directory)=>{
  const s=lstatSync(path,{bigint:true});
  if((directory?!s.isDirectory():!s.isFile()||s.nlink!==1n)||s.uid!==uid||(s.mode&0o022n))fail();
  return identity(s);
 };
 for(const path of files){
  if(resolve(path)!==path||!path.startsWith(root+sep)||realpathSync(path)!==path)fail();
  rows.set(path,{directory:false,identity:fingerprint(path,false)});
  // Evidence alongside runtime/ may grow. Only its fixed subdirectories are pinned.
  for(let p=dirname(path);p!==root&&!rows.has(p);p=dirname(p))rows.set(p,{directory:true,identity:fingerprint(p,true)});
 }
 const check=()=>{
  if(realpathSync(root)!==root||rootIdentity()!==pinnedRoot)fail();
  for(const [path,row] of rows)if(fingerprint(path,row.directory)!==row.identity)fail();
 };
 const verifyBytes=()=>{check();verify();check();};
 verifyBytes();
 return Object.freeze({check,verifyBytes});
}
