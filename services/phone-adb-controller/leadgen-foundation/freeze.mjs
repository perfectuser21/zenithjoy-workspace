import fs from 'node:fs';
import path from 'node:path';
import {canonical,hash,need} from './context.mjs';
export function relative(name){need(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'SOURCE_PATH');return name;}
function safeDirectory(directory){const s=fs.lstatSync(directory);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o022),'HOST_DIRECTORY');}
function readSource(directory,name){
 let file=directory;for(const part of relative(name).split('/')){file=path.join(file,part);const s=fs.lstatSync(file);need(!s.isSymbolicLink(),'RECOVERY_SOURCE');}
 const s=fs.statSync(file);need(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o022),'RECOVERY_SOURCE');return fs.readFileSync(file);
}
export function recoverHost({directory,identity,expectedFiles}){
 safeDirectory(directory);let receipt;
 try{receipt=JSON.parse(readSource(directory,'leadgen-host-receipt.json'));}catch{throw Error('LEADGEN_RECOVERY_RECEIPT');}
 need(receipt.schema==='leadgen-run-host/v1'&&canonical(receipt.identity)===canonical(identity),'RECOVERY_IDENTITY');
 need(receipt.files&&Object.keys(receipt.files).length>0,'RECOVERY_RECEIPT');
 need(expectedFiles&&canonical(receipt.files)===canonical(expectedFiles),'RECOVERY_SOURCE');
 for(const [name,digest]of Object.entries(receipt.files)){
  try{need(/^[a-f0-9]{64}$/.test(digest)&&hash(readSource(directory,name))===digest,'RECOVERY_SOURCE');}catch{throw Error('LEADGEN_RECOVERY_SOURCE');}
 }
 return {...receipt,recovered:true};
}
/** Receipt is written last. An incomplete prior assembly is rejected, never repaired over evidence. */
export function freezeHost({directory,identity,files,executableFiles=[]}){
 need(path.isAbsolute(directory)&&path.dirname(directory)===fs.realpathSync(path.dirname(directory)),'HOST_PATH');
 if(fs.existsSync(directory))return recoverHost({directory,identity,expectedFiles:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)]))});
 need(files&&Object.keys(files).length>0&&!Object.hasOwn(files,'leadgen-host-receipt.json'),'SOURCE_FILES');
 for(const [name,bytes]of Object.entries(files)){relative(name);need(typeof bytes==='string'||Buffer.isBuffer(bytes),'SOURCE_BYTES');}
 need(executableFiles.every(name=>Object.hasOwn(files,name)),'SOURCE_EXECUTABLE');
 fs.mkdirSync(directory,{mode:0o700});
 for(const [name,bytes]of Object.entries(files)){
  const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{flag:'wx',mode:executableFiles.includes(name)?0o700:0o600});
 }
 const receipt={schema:'leadgen-run-host/v1',identity,files:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)])),assembled_at_ms:Date.now(),status:'assembled_not_started'};
 fs.writeFileSync(path.join(directory,'leadgen-host-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 return {...receipt,recovered:false};
}
