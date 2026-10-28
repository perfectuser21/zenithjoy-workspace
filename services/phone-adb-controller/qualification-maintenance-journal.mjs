// 单个维护intent的持久回执。未知原件保留；日志本身不授予DB或资源修改能力。
import {lstatSync,realpathSync,mkdirSync,readdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {digest,canonical} from './runtime-definition.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const need=v=>{if(!v)throw Error('MAINTENANCE_JOURNAL_UNPROVEN');};
const epochKeys=['contract_sha256','maintenance_task_id','actor','original_task_id','original_actor','maintenance_claimed_at','original_claimed_at'];
function context(authority,home,create=false) {
 need(authority&&uuid.test(authority.maintenance_task_id||'')&&uuid.test(authority.original_task_id||'')
  &&uuid.test(authority.scope?.intent_id||'')&&/^[a-f0-9]{64}$/.test(authority.contract_sha256||'')
  &&digest(authority.scope)===authority.contract_sha256);
 for(const key of ['actor','original_actor'])need(typeof authority[key]==='string'&&authority[key].length>0&&!/[\r\n]/.test(authority[key]));
 for(const key of ['maintenance_claimed_at','original_claimed_at'])need(typeof authority[key]==='string'&&Number.isFinite(Date.parse(authority[key])));
 const epoch=Object.fromEntries(epochKeys.map(k=>[k,authority[k]]));epoch.intent_id=authority.scope.intent_id;
 home=resolve(home);need(home===realpathSync(home));
 const parts=['.local','share','zenithjoy','qualification-maintenance',authority.maintenance_task_id,authority.scope.intent_id];
 let path=home;checkDir(path,false);
 for(const [i,part]of parts.entries()) {
  path=join(path,part);
  if(create){try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}}
  try{checkDir(path,i>=3);}catch(e){if(!create&&e.code==='ENOENT')return {path,epoch,missing:true};throw e;}
 }
 return {path,epoch,missing:false};
}
function checkDir(path,privateDir) {
 const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()
  &&(s.mode&0o022)===0&&(!privateDir||(s.mode&0o777)===0o700));
}
function fileBytes(path) {
 const stat=lstatSync(path);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()
  &&(stat.mode&0o777)===0o600&&stat.size<=65536);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{return readFileSync(fd);}finally{closeSync(fd);}
}
function parse(raw) {try{return JSON.parse(raw);}catch{return null;}}
function snapshot(ctx) {
 if(ctx.missing)return {records:[],last_hash:null,max_sequence:0};
 const names=readdirSync(ctx.path).sort();need(names.length<=3072);
 const groups=new Map(),originals=new Map();
 for(const name of names) {
  const match=name.match(/^(\d{8})\.(?:reserve|([a-f0-9-]{36})\.(pending|json))$/);
  need(match&&Number(match[1])>0&&(!match[2]||uuid.test(match[2])));
  const sequence=Number(match[1]),raw=fileBytes(join(ctx.path,name));originals.set(name,raw);
  if(!groups.has(sequence))groups.set(sequence,[]);groups.get(sequence).push({name,raw});
 }
 let previous=null,max=0;const records=[];
 for(const [sequence,parts]of [...groups].sort((a,b)=>a[0]-b[0])) {
  need(sequence===max+1);max=sequence;
  const stem=String(sequence).padStart(8,'0'),reserve=parts.find(p=>p.name===stem+'.reserve');need(reserve);
  const raw_manifest=parts.map(p=>({path:p.name,bytes:p.raw.length,sha256:digest(p.raw)}));
  const chain=digest(raw_manifest),reservation=parse(reserve.raw);
  const incomplete=()=>({phase:'journal_incomplete',journal_sequence:sequence,journal_sha256:chain,raw_manifest});
  if(!reservation) {records.push(incomplete());previous=chain;continue;}
  need(reservation.schema_version===1&&reservation.sequence===sequence&&uuid.test(reservation.nonce||'')
   &&isDeepStrictEqual(reservation.epoch,ctx.epoch)&&reservation.previous_sha256===previous
   &&/^[a-f0-9]{64}$/.test(reservation.record_sha256||''));
  const file=stem+'.'+reservation.nonce+'.json',pending=stem+'.'+reservation.nonce+'.pending';
  need(parts.every(p=>[stem+'.reserve',file,pending].includes(p.name)));
  const final=parts.find(p=>p.name===file),unfinished=parts.some(p=>p.name===pending);
  const envelope=final&&!unfinished?parse(final.raw):null;
  if(!envelope) {records.push(incomplete());previous=chain;continue;}
  need(envelope.schema_version===1&&envelope.sequence===sequence&&envelope.nonce===reservation.nonce
   &&isDeepStrictEqual(envelope.epoch,ctx.epoch)&&envelope.previous_sha256===previous
   &&digest(envelope.record)===reservation.record_sha256);
  validateRecord(envelope.record,ctx.epoch);
  records.push({...envelope.record,journal_sequence:sequence,journal_sha256:digest(final.raw)});previous=chain;
 }
 need(isDeepStrictEqual(readdirSync(ctx.path).sort(),names));
 for(const [name,raw]of originals)need(raw.equals(fileBytes(join(ctx.path,name))));
 return {records,last_hash:previous,max_sequence:max};
}
function validateRecord(record,epoch) {
 need(record&&typeof record==='object'&&!Array.isArray(record)&&/^[a-z_]{1,80}$/.test(record.phase||'')
  &&Number.isSafeInteger(record.at_ms)&&record.at_ms>0&&record.contract_sha256===epoch.contract_sha256
  &&Buffer.byteLength(canonical(record))<=32768&&!Object.keys(record).some(k=>k.startsWith('journal_')));
}
function exclusive(path,body) {
 const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}
}
export function readMaintenanceJournal(authority,{home=homedir()}={}) {
 try{return snapshot(context(authority,home)).records;}catch{throw Error('MAINTENANCE_JOURNAL_UNPROVEN');}
}
export function appendMaintenanceJournal(authority,record,{home=homedir()}={}) {
 try {
  const ctx=context(authority,home,true);validateRecord(record,ctx.epoch);
  const prior=snapshot(ctx);
  // 这是额外防重屏障；已提交后的新观察由close状态机的真实DB审计授权。
  if(record.phase==='db_intent')need(!prior.records.some(r=>['db_intent','commit_unknown','journal_incomplete'].includes(r.phase)));
  const sequence=prior.max_sequence+1;need(sequence<=99999999);
  const stem=String(sequence).padStart(8,'0'),nonce=randomUUID();
  const reservation={schema_version:1,sequence,nonce,epoch:ctx.epoch,previous_sha256:prior.last_hash,record_sha256:digest(record)};
  // reserve永不回收；迟到的同序号writer不能在rename后重占序号或覆盖别人的final。
  exclusive(join(ctx.path,stem+'.reserve'),canonical(reservation)+'\n');
  const envelope={schema_version:1,sequence,nonce,epoch:ctx.epoch,previous_sha256:prior.last_hash,record};
  const body=canonical(envelope)+'\n',pending=join(ctx.path,stem+'.'+nonce+'.pending'),final=join(ctx.path,stem+'.'+nonce+'.json');
  exclusive(pending,body);
  try{lstatSync(final);throw Error('MAINTENANCE_JOURNAL_FINAL_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  renameSync(pending,final);
  const dir=openSync(ctx.path,constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}
  need(fileBytes(final).equals(Buffer.from(body)));
  return {path:final,sha256:digest(body),durable:true};
 }catch{throw Error('MAINTENANCE_JOURNAL_UNPROVEN');}
}
