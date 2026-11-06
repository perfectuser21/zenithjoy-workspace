// Code-only capture/publishing. Artifacts prove bytes, never permission or OS quiescence.
import {openSync,closeSync,fsyncSync,writeFileSync,readFileSync,lstatSync,realpathSync,renameSync,constants} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assertPreflightPng} from './preflight-phone-driver.mjs';
const helper='native-phone-ui-step.py',pkg='com.ss.android.ugc.aweme';
const policies=new Set(['standard','opportunistic-search-tab','verified-seed-share','verified-seed-share-retry','paused-douyin','paused-detail']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(reason,extra={})=>Object.assign(Error('NATIVE_UI_'+reason),{code:'NATIVE_UI_'+reason,returned:true,...extra});
export function createNativePhoneUi({context,io}={}){
 if(!context||context.package!==pkg||!isAbsolute(context.evidenceRoot||'')||!/^[-A-Za-z0-9_.]+$/.test(context.run||'')||!/^[-A-Za-z0-9_.]+$/.test(context.profile||'')||typeof context.serial!=='string'||!context.serial||!['width','height'].every(k=>Number.isSafeInteger(context[k])&&context[k]>0)||!io||['command','readEvidence','foreground','wait','local'].some(k=>typeof io[k]!=='function'))throw fail('DEPENDENCY');
 const c=Object.freeze(structuredClone(context)),root=resolve(c.evidenceRoot),remote=`/sdcard/douyin-leadgen-ui-${c.profile}.xml`;
 if(realpathSync(root)!==root||!lstatSync(root).isDirectory()||lstatSync(root).mode&0o022)throw fail('EVIDENCE_ROOT');
 const directory=lstatSync(root),artifacts=new WeakMap(),owned=new Map();let sealed=false,unsafe=false,busy=false,sequence=0,crashPending=false;
 const active=()=>{if(sealed||unsafe)throw fail('CLOSED',{executionStopped:!unsafe,resourceUnknown:unsafe});const st=lstatSync(root);if(st.dev!==directory.dev||st.ino!==directory.ino||!st.isDirectory()||st.isSymbolicLink())throw fail('EVIDENCE_ROOT_CHANGED');};
 const id=eid=>{if(typeof eid!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(eid)||!eid.startsWith(c.run+'-'))throw fail('EVIDENCE_SCOPE');return eid;};
 const fsyncDirectory=()=>{const fd=openSync(root,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
 const unchanged=record=>{const st=lstatSync(record.path);if(!st.isFile()||st.isSymbolicLink()||st.dev!==record.dev||st.ino!==record.ino||st.size!==record.size||st.mode&0o077||sha(readFileSync(record.path))!==record.sha256)throw fail('EVIDENCE_CHANGED');return record;};
 const publish=(path,bytes)=>{active();const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}fsyncDirectory();const st=lstatSync(path),record={path,dev:st.dev,ino:st.ino,size:st.size,sha256:sha(bytes)};owned.set(path,record);return record;};
 const artifact=(record,bytes,ext)=>{const value=Object.freeze({path:record.path,sha256:record.sha256,...(ext==='xml'?{xml:bytes.toString('utf8')}:{})});artifacts.set(value,{record,bytes:Buffer.from(bytes),ext});return value;};
 const write=(eid,ext,input)=>{active();id(eid);if(!['xml','png','txt'].includes(ext)||!(typeof input==='string'||Buffer.isBuffer(input)))throw fail('EVIDENCE_BYTES');const bytes=Buffer.from(input);if(!bytes.length||bytes.length>12*1024*1024)throw fail('EVIDENCE_SIZE');return artifact(publish(join(root,eid+'.'+ext),bytes),bytes,ext);};
 const unknown=error=>{unsafe=true;sealed=true;throw fail('EXECUTION_UNKNOWN',{returned:false,executionStopped:false,execution_unknown:true,resourceUnknown:true,cause:error});};
 const call=async(op,args=[])=>{active();let r;try{r=await io.command(op,args);}catch(e){return unknown(e);}if(!r||r.reviewed_command_returned!==true||!Number.isInteger(r.code)||!Buffer.isBuffer(r.stdout)||!Buffer.isBuffer(r.stderr))return unknown(fail('COMMAND_RECEIPT'));active();return r;};
 const wait=async ms=>{active();await io.wait(ms);active();};
 const predicate=async(operation,payload)=>{active();const r=await io.local(helper,{operation,package:pkg,...payload});active();if(!r||typeof r.accepted!=='boolean')throw fail('PARSER_RECEIPT');return r.accepted;};
 const foreground=async()=>{active();let raw;try{raw=await io.foreground();}catch(e){return unknown(e);}active();if(typeof raw!=='string')return unknown(fail('FOREGROUND_RECEIPT'));return predicate('foreground',{foreground:raw});};
 const requireZero=async(op,args=[])=>{const r=await call(op,args);if(r.code!==0)throw fail('COMMAND_FAILED');return r;};
 const absent=async()=>{const exists=await call('ui-exists'),symlink=await call('ui-symlink');return exists.code===1&&symlink.code===1;};
 const read=async()=>{active();let value;try{value=await io.readEvidence(remote);}catch(e){return unknown(e);}active();if(!Buffer.isBuffer(value)||value.length>5*1024*1024)return unknown(fail('RECV_RECEIPT'));return value;};
 const valid=async(bytes,policy,crash)=>{const xml=bytes.toString('utf8');if(!bytes.length||!xml.includes('<hierarchy')||!xml.includes('</hierarchy>'))return false;if(['standard','opportunistic-search-tab'].includes(policy)&&!crash)return true;return predicate(policy==='paused-douyin'||crash&&['standard','opportunistic-search-tab'].includes(policy)?'complete':'fresh-share',{xml});};
 const attemptEvidence=(eid,bytes)=>artifact(publish(join(root,`${eid}-capture-${++sequence}-${randomUUID()}.xml`),bytes),bytes,'xml');
 const finalEvidence=(eid,bytes)=>{const path=join(root,eid+'.xml');try{lstatSync(path);}catch(e){if(e.code==='ENOENT')return write(eid,'xml',bytes);throw e;}if(!owned.has(path))throw fail('EVIDENCE_EXISTS');unchanged(owned.get(path));return attemptEvidence(eid,bytes);};
 async function wave(eid,policy,crashState){
  if(policy.startsWith('paused-')){if(!await foreground())throw fail('WRONG_FOREGROUND');await requireZero('keyevent',['127']);if(!await foreground())throw fail('WRONG_FOREGROUND');await wait(300);}
  const max=policy==='opportunistic-search-tab'?1:3;let crash=crashState.seen,lastOutput='';
  for(let n=1;n<=max;n++){
   await requireZero('remove-ui');let started;
   if(crash){if(!await absent())throw fail('CRASH_ABSENCE');const r=await requireZero('device-date');started=r.stdout.toString().trim();if(!/^\d+$/.test(started))throw fail('CRASH_TIME');}
   const dump=await call('dump');lastOutput=Buffer.concat([dump.stdout,dump.stderr]).toString();
   if(dump.code===137){crash=true;crashState.seen=true;if(n<max)await wait(900);continue;}
   if(crash){if(dump.code!==0)throw fail('CRASH_DUMP');const r=await requireZero('stat-ui-mtime'),mtime=r.stdout.toString().trim();if(!/^\d+$/.test(mtime)||BigInt(mtime)<BigInt(started)||!await foreground())throw fail('CRASH_FRESHNESS');}
   let freshNonempty=false;const stat=await call('stat-ui'),size=stat.code===0?stat.stdout.toString().trim():'unknown';let remoteAbsent=false;
   if(policy.startsWith('paused-')&&n===1&&stat.code!==0&&Buffer.concat([stat.stdout,stat.stderr]).toString().trim()===`stat: '${remote}': No such file or directory`&&lastOutput.includes('could not get idle state'))remoteAbsent=await absent();
   if(/^\d+$/.test(size)&&BigInt(size)>0n){const bytes=await read();freshNonempty=bytes.length>0;attemptEvidence(eid,bytes);if(await valid(bytes,policy,crash))return finalEvidence(eid,bytes);if(policy.startsWith('paused-'))throw fail('PAUSED_XML_REJECTED');}
   if((policy==='verified-seed-share'||policy.startsWith('paused-'))&&n===1&&!freshNonempty&&lastOutput.includes('could not get idle state')&&(policy==='verified-seed-share'||size==='0'||remoteAbsent))break;
   if(n<max)await wait(900);
  }
  if(policy==='opportunistic-search-tab')throw fail('TREE_UNAVAILABLE');
  if(lastOutput.includes('could not get idle state')){
   const toggle=await call('keyevent',['85']);if(toggle.code!==0&&policy.startsWith('paused-'))throw fail('PAUSE_TOGGLE');let started,dump,stat;
   try{await wait(500);await call('remove-ui');
   if(crash){if(!await absent())throw fail('CRASH_ABSENCE');const r=await requireZero('device-date');started=r.stdout.toString().trim();if(!/^\d+$/.test(started))throw fail('CRASH_TIME');}
   dump=await call('dump');stat=await call('stat-ui');
   }finally{if(!unsafe&&!sealed){const restore=await call('keyevent',['85']);if(restore.code!==0&&policy.startsWith('paused-'))throw fail('RESTORE_TOGGLE');}}
   if(dump.code===137){crashState.seen=true;await requireZero('remove-ui');throw fail('TOGGLE_CRASH');}
   if(crash){if(dump.code!==0)throw fail('CRASH_DUMP');const r=await requireZero('stat-ui-mtime'),mtime=r.stdout.toString().trim();if(!/^\d+$/.test(mtime)||BigInt(mtime)<BigInt(started)||!await foreground())throw fail('CRASH_FRESHNESS');}
   const size=stat.code===0?stat.stdout.toString().trim():'unknown';
   if(/^\d+$/.test(size)&&BigInt(size)>0n){const bytes=await read();attemptEvidence(eid,bytes);if(await valid(bytes,policy,crash))return finalEvidence(eid,bytes);if(policy.startsWith('paused-'))throw fail('PAUSED_XML_REJECTED');}
  }
  throw fail('TREE_UNAVAILABLE');
 }
 async function captureXml(eid,{policy='standard'}={}){active();id(eid);if(!policies.has(policy))throw fail('POLICY');const existing=join(root,eid+'.xml');try{lstatSync(existing);if(!owned.has(existing))throw fail('EVIDENCE_EXISTS');unchanged(owned.get(existing));}catch(e){if(e.code!=='ENOENT')throw e;}if(busy)throw fail('BUSY');busy=true;const crashState={seen:crashPending};try{const waves=['standard','verified-seed-share','verified-seed-share-retry'].includes(policy)?3:1;for(let n=1;n<=waves;n++){try{const result=await wave(eid,n>1&&policy==='verified-seed-share'?'verified-seed-share-retry':policy,crashState);crashState.seen=false;return result;}catch(e){if(unsafe||e?.returned!==true||n===waves)throw e;await wait(n===1?10000:20000);}}}finally{crashPending=crashState.seen;busy=false;}}
 async function snapshot(eid){active();id(eid);const r=await requireZero('screenshot');assertPreflightPng(r.stdout,{width:c.width,height:c.height});return write(eid,'png',r.stdout);}
 function publishXml(eid,{source,first}={}){active();id(eid);const s=artifacts.get(source),f=artifacts.get(first);if(!s||s.ext!=='xml'||!f||f.ext!=='xml')throw fail('ARTIFACT_BRAND');unchanged(s.record);unchanged(f.record);const canonical=join(root,eid+'.xml');if(f.record.path!==canonical||owned.get(canonical)!==f.record)throw fail('CANONICAL_OWNER');
  // Preserve the first XML before updating only this publisher's exact inode.
  publish(join(root,eid+'-first.xml'),f.bytes);const temp=join(root,`${eid}-publish-${randomUUID()}.xml`),record=publish(temp,s.bytes);unchanged(f.record);renameSync(temp,canonical);owned.delete(temp);fsyncDirectory();record.path=canonical;owned.set(canonical,record);return artifact(record,s.bytes,'xml');
 }
 const readArtifact=cap=>{active();const item=artifacts.get(cap);if(!item)throw fail('ARTIFACT_BRAND');unchanged(item.record);return Object.freeze({ext:item.ext,bytes:Buffer.from(item.bytes),path:item.record.path,sha256:item.record.sha256});};
 return Object.freeze({captureXml,snapshot,publishXml,writeEvidence:write,readArtifact,seal:()=>{sealed=true;},snapshotState:()=>Object.freeze({sealed,unsafe,busy,crashPending,artifacts:owned.size,remote_execution_stopped:'not_attested'})});
}
