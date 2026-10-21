import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import axios from 'axios';
import contract from './install-pack-release-contract.json';
import type {InstallPackManifest} from './install-pack-manifest';

type ModuleArtifact = {line_id:string;filename:string;sha256:string;cos_url:string};
type Candidate = InstallPackManifest & {source_sha:string;modules:ModuleArtifact[];bundle_sha256:string};
type Promotion = {source_sha:string;sha256:string;acceptance_run_key:string;expected_current_manifest_sha256:string|null};
type AcceptanceCheck = Record<string,unknown>;
type AcceptanceRecord = {run?:Record<string,unknown>&{detail?:Record<string,unknown>};checks?:AcceptanceCheck[]};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function need(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(message);}
const validSha=(s:unknown,n:number)=>typeof s==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(s);

export function installPackContract(){return {...contract,spec_sha:'sha256:'+hash(JSON.stringify(contract))};}

function candidate(body:Candidate):Candidate {
 need(body&&validSha(body.source_sha,40)&&validSha(body.sha256,64),'invalid candidate identity');
 need(typeof body.version==='string'&&/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(body.version),'invalid version');
 need(Number.isSafeInteger(body.size)&&body.size>0&&Number.isFinite(Date.parse(body.build_time)),'invalid artifact size/date');
 need(typeof body.download_url==='string'&&/^\/download\/[a-zA-Z0-9_.-]+\.tar\.gz$/.test(body.download_url),'invalid download path');
 const url=new URL(body.cos_url||'');
 need(url.origin==='https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com'&&!url.search&&!url.hash&&!url.username&&!url.password,'invalid artifact origin');
 need(url.pathname===`/install-pack/candidates/${body.source_sha}/${body.sha256}/${path.basename(body.download_url)}`,'artifact is not immutable candidate');
 need(Array.isArray(body.modules)&&body.modules.length===4,'four module artifacts required');
 const modules=body.modules.map(m=>{
  need(['line01-publish','line02-lead-gen','line04-wechat-cs','line05-video'].includes(m.line_id)&&validSha(m.sha256,64),'invalid module');
  need(new RegExp(`^${m.line_id}-v[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.gz$`).test(m.filename),'invalid module filename');
  need(m.cos_url===`https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules/candidates/${body.source_sha}/${m.sha256}/${m.filename}`,'invalid module origin');
  return {line_id:m.line_id,filename:m.filename,sha256:m.sha256,cos_url:m.cos_url};
 });
 need(new Set(modules.map(m=>m.line_id)).size===4,'duplicate module');
 need(body.bundle_sha256===hash(JSON.stringify({source_sha:body.source_sha,sha256:body.sha256,modules})),'bundle digest mismatch');
 return {modules,bundle_sha256:body.bundle_sha256,version:body.version,sha256:body.sha256,source_sha:body.source_sha,download_url:body.download_url,cos_url:body.cos_url,size:body.size,build_time:body.build_time};
}

function candidatePath(file:string,sha:string,digest:string){
 need(validSha(sha,40)&&validSha(digest,64),'invalid candidate identity');
 return path.join(file+'.candidates',sha,digest+'.json');
}
function immutable(file:string,text:string){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 if(fs.existsSync(file)){need(fs.readFileSync(file,'utf8')===text,'immutable candidate conflict');return;}
 const temp=file+'.'+randomUUID()+'.pending';
 try{
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(temp,file);}catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   need(fs.readFileSync(file,'utf8')===text,'immutable candidate conflict');
  }
  const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }finally{fs.rmSync(temp,{force:true});}
}
function atomic(file:string,text:string){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.tmp';
 try{immutable(tmp,text);fs.renameSync(tmp,file);const fd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 finally{fs.rmSync(tmp,{force:true});}
}
export function publishCandidate(file:string,body:Candidate){
 const value=candidate(body);immutable(candidatePath(file,value.source_sha,value.sha256),JSON.stringify(value));return value;
}

export function validateInstallPackAcceptance(record:AcceptanceRecord|null|undefined,value:Candidate,key:string){
 const {run,checks}=record||{},d=run?.detail||{},c=installPackContract();
 need(run?.run_key===key&&run.id&&run.gp_id&&run.status==='adjudicated','acceptance is not adjudicated');
 need(d.source_repo==='perfectuser21/zenithjoy-workspace'&&d.environment==='staging'&&Array.isArray(d.release_targets)&&d.release_targets.length===1&&d.release_targets[0]==='install-pack','acceptance scope mismatch');
 need(d.source_sha===value.source_sha&&d.observed_source_sha===value.source_sha,'source mismatch');
 need(d.package_sha256===value.sha256&&d.observed_package_sha256===value.sha256,'package mismatch');
 need(d.bundle_sha256===value.bundle_sha256&&d.observed_bundle_sha256===value.bundle_sha256,'module bundle mismatch');
 need(d.spec_sha===c.spec_sha&&d.gate_verdict==='绿'&&d.ai_status!=='dumb'&&!d.blocked_reason,'acceptance gate not passed');
 need(Array.isArray(checks)&&checks.length===c.checks.length&&new Set(checks.map(x=>x.check_key)).size===c.checks.length,'missing acceptance checks');
 for(const expected of c.checks){
  const check=checks?.find(x=>x.check_key===expected.check_key);
  need(check?.run_id===run.id&&check.name===expected.name&&check.kind===expected.kind&&check.result==='通过'&&typeof check.note==='string'&&check.note.trim(),'business acceptance failed or has no evidence');
 }
 return {run_id:run.id,run_key:key,spec_sha:c.spec_sha};
}
async function readReceipt(key:string){
 need(/^[a-zA-Z0-9_.:-]{1,180}$/.test(key||''),'invalid acceptance key');
 const base=process.env.CECELIA_BRAIN_URL;
 need(base,'Brain URL is not configured');
 const url=new URL(base!);
 need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','invalid fixed Brain URL');
 url.pathname='/api/brain/acceptance/runs/'+encodeURIComponent(key);
 const token=process.env.CECELIA_INTERNAL_TOKEN;
 return (await axios.get(url.href,{timeout:20000,maxRedirects:0,maxContentLength:1048576,headers:token?{Authorization:'Bearer '+token}:{}})).data;
}

export function manifestState(file:string){
 const raw=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 return {manifest:raw===null?null:JSON.parse(raw),manifest_sha256:raw===null?null:hash(raw)};
}
export async function verifyCandidate(file:string,input:Promotion){
 const value=candidate(JSON.parse(fs.readFileSync(candidatePath(file,input.source_sha,input.sha256),'utf8')));
 const receipt=validateInstallPackAcceptance(await readReceipt(input.acceptance_run_key),value,input.acceptance_run_key);
 return {candidate:value,receipt};
}

// 唯一生产API进程在异步验收读回后同步CAS+rename；工作流另持共享生产锁。
// 旧字节和验收原件先持久化到不可变journal，再原子切换manifest内的journal指针。
export async function promoteCandidate(file:string,input:Promotion,reader=readReceipt){
 const value=candidate(JSON.parse(fs.readFileSync(candidatePath(file,input.source_sha,input.sha256),'utf8')));
 const record=await reader(input.acceptance_run_key);
 const receipt=validateInstallPackAcceptance(record,value,input.acceptance_run_key);
 const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 const old=previous?JSON.parse(previous):null;
 if(old?.sha256===value.sha256&&old?.source_sha===value.source_sha&&old?.release_receipt?.run_key===receipt.run_key)return old;
 need((previous===null?null:hash(previous))===input.expected_current_manifest_sha256,'production manifest changed');
 const id=randomUUID();
 const next={...value,release_receipt:receipt,release_journal:id};
 const bytes=JSON.stringify(next,null,2)+'\n';
 immutable(path.join(file+'.releases',id+'.json'),JSON.stringify({previous,previous_hash:previous===null?null:hash(previous),next_hash:hash(bytes),receipt,acceptance:record}));
 atomic(file,bytes);return next;
}
export function rollbackManifest(file:string,input:{expected_current_manifest_sha256:string}){
 const current=fs.readFileSync(file,'utf8'),value=JSON.parse(current);
 need(validSha(input.expected_current_manifest_sha256,64)&&hash(current)===input.expected_current_manifest_sha256,'production manifest changed');
 need(typeof value.release_journal==='string'&&/^[a-f0-9-]{36}$/.test(value.release_journal),'no saved production predecessor');
 const journal=JSON.parse(fs.readFileSync(path.join(file+'.releases',value.release_journal+'.json'),'utf8'));
 need(journal.next_hash===hash(current)&&typeof journal.previous==='string'&&journal.previous_hash===hash(journal.previous),'rollback journal mismatch or no predecessor');
 const old=JSON.parse(journal.previous);need(validSha(old.sha256,64)&&typeof old.download_url==='string','invalid saved predecessor');
 atomic(file,journal.previous);return old;
}
