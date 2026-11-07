// Fixed read-only ADB sync ingress. A returned file is not a remote execution-stop proof.
import {Socket} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,writeFileSync,fsyncSync,readdirSync,constants} from 'node:fs';
import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {canonical,isCanonicalTcpDeviceSerial} from './runtime-definition.mjs';
import {readNativePhoneCommandSource} from './native-phone-command-source.mjs';
import {adbRequest,adbPayloadLength,protocolModulePath} from './adb-shell-v2-protocol.mjs';
const instances=new WeakSet(),bindings=new WeakMap(),receipts=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>Object.assign(Error('NATIVE_PHONE_READ_'+code),{code:'NATIVE_PHONE_READ_'+code});
const systemFiles=new Set(['/system/bin/sh','/system/framework/monkey.jar','/system/framework/android.test.runner.jar','/system/bin/uiautomator','/system/bin/input','/system/bin/am','/system/bin/cmd','/system/bin/toybox','/system/bin/app_process','/system/bin/app_process32','/system/bin/app_process64','/system/bin/dumpsys','/system/bin/screencap','/system/bin/getprop','/system/bin/settings','/system/bin/monkey','/system/bin/wm','/system/bin/ime','/system/framework/uiautomator.jar','/system/framework/input.jar']);
export const isNativePhoneAdbRead=value=>instances.has(value);
export function nativePhoneAdbReadMatches(value,source,scope){const b=bindings.get(value);return Boolean(b&&b.source===canonical(source)&&b.scope===canonical(scope));}
export function createNativePhoneAdbRead(options={}){return createRead(options,null);}
// Separate Code-only ingress: possession of a reviewed Source capability, not a
// path flag or a Worker JSON object, is required before reading UI artifacts.
export function createNativePhoneEvidenceRead({commandSource,...options}={}){
 const p=readNativePhoneCommandSource(commandSource,{source:options.source}),q=options.scope;
 for(const key of ['task_id','binding_id','run_id','source_commit','profile','serial','epoch','endpoint'])if(p[key]!==q?.[key])throw fail('EVIDENCE_SCOPE');
 if(canonical(p.claim)!==canonical(q.claim)||q.worker_deadline_ms>p.worker_deadline_ms||q.cleanup_deadline_ms>p.cleanup_deadline_ms)throw fail('EVIDENCE_SCOPE');
 return createRead(options,()=>readNativePhoneCommandSource(commandSource,{source:options.source}));
}
function createRead({runtimeRoot,source,directory,scope,readAuthority}={},evidenceSource){
 let q,fixed;try{q=structuredClone(scope);fixed=structuredClone(source);}catch{throw fail('SCOPE');}
 const ip=q?.endpoint?.match(/^tcp:127\.0\.0\.1:([1-9][0-9]{0,4})$/),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 if(!q||q.protocol!=='native-phone-adb-read/v1'||!uuid.test(q.task_id||'')||!uuid.test(q.binding_id||'')||!/^[-A-Za-z0-9_.]{1,150}$/.test(q.run_id||'')||!/^[-A-Za-z0-9_.]{1,80}$/.test(q.profile||'')||!(/^[-A-Za-z0-9_.]{1,80}$/.test(q.serial||'')||isCanonicalTcpDeviceSerial(q.serial))||!ip||Number(ip[1])>65535||!/^[a-f0-9]{40}$/.test(q.source_commit||'')||fixed?.commit!==q.source_commit||!Number.isSafeInteger(q.epoch)||q.epoch<0||!Number.isSafeInteger(q.worker_deadline_ms)||!Number.isSafeInteger(q.cleanup_deadline_ms)||q.worker_deadline_ms>=q.cleanup_deadline_ms||typeof readAuthority!=='function'||!q.claim?.claimed_by||!Number.isFinite(Date.parse(q.claim?.claimed_at)))throw fail('SCOPE');
 const verifySource=()=>{try{
  if(realpathSync(runtimeRoot)!==resolve(runtimeRoot)||dirname(realpathSync(fileURLToPath(import.meta.url)))!==runtimeRoot||realpathSync(protocolModulePath)!==resolve(runtimeRoot,'adb-shell-v2-protocol.mjs')||!Array.isArray(fixed.files)||fixed.files.length>512||new Set(fixed.files.map(f=>f.path)).size!==fixed.files.length)throw Error();
  for(const name of ['native-phone-adb-read.mjs','adb-shell-v2-protocol.mjs','runtime-definition.mjs'])if(fixed.files.filter(f=>f.path===name).length!==1)throw Error();
  for(const f of fixed.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(s=>s==='.'||s==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw Error();const path=resolve(runtimeRoot,f.path),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=fstatSync(fd),s=lstatSync(path),bytes=readFileSync(fd),z=fstatSync(fd);if(!a.isFile()||s.isSymbolicLink()||(a.mode&0o022)||![0,process.getuid()].includes(a.uid)||a.dev!==s.dev||a.ino!==s.ino||a.size!==z.size||a.mtimeMs!==z.mtimeMs||sha(bytes)!==f.sha256)throw Error();}finally{closeSync(fd);}}
 }catch{throw fail('SOURCE');}};verifySource();
 const initial=lstatSync(directory),artifacts=new Map();
 const verifyJournal=()=>{const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(directory)!==resolve(directory)||s.dev!==initial.dev||s.ino!==initial.ino||s.uid!==process.getuid()||(s.mode&0o777)!==0o700)throw fail('JOURNAL');for(const [name,entry]of artifacts){const path=join(directory,name),st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.dev!==entry.dev||st.ino!==entry.ino||st.nlink!==1||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||sha(readFileSync(path))!==entry.sha256)throw fail('JOURNAL');}};
 verifyJournal();if(readdirSync(directory).length)throw fail('PREVIOUS_UNKNOWN');
 const record=(name,value)=>{verifyJournal();let fd,parent;try{const bytes=Buffer.from(JSON.stringify(value)+'\n');parent=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const ds=fstatSync(parent);if(ds.dev!==initial.dev||ds.ino!==initial.ino)throw Error();fd=openSync(join(directory,name),constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);writeFileSync(fd,bytes);fsyncSync(fd);fsyncSync(parent);const s=fstatSync(fd);artifacts.set(name,{dev:s.dev,ino:s.ino,sha256:sha(bytes)});}catch{throw fail('JOURNAL');}finally{if(fd!==undefined)closeSync(fd);if(parent!==undefined)closeSync(parent);}};
 record('lifecycle.intent.json',{protocol:q.protocol,instance_id:randomUUID(),scope_sha256:sha(canonical(q)),source_sha256:sha(canonical(fixed))});
 let sealed=false,unknown=false,index=0,closing;const jobs=new Set(),channels=new Set(),reasons=new Set();
 const guard=()=>{if(unknown)throw fail('UNKNOWN');if(sealed)throw fail('CLOSED');if(Date.now()>=q.worker_deadline_ms)throw fail('DEADLINE');};
 const admit=async()=>{guard();evidenceSource?.();verifySource();verifyJournal();guard();let value;try{value=await readAuthority();}catch{throw fail('AUTHORITY');}guard();verifySource();verifyJournal();guard();if(!value||canonical(value.scope)!==canonical(q)||value.claimed_by!==q.claim.claimed_by||value.claimed_at!==q.claim.claimed_at||!Number.isFinite(Date.parse(value.lease_until))||Date.parse(value.lease_until)<=Date.now())throw fail('AUTHORITY');return Date.parse(value.lease_until);};
 const snapshot=()=>Object.freeze({domain:'native-phone-adb-read/v1',sealed,pending:jobs.size,open_sockets:channels.size,unknown,unknown_reasons:Object.freeze([...reasons]),channel_stopped:sealed&&!unknown&&!jobs.size&&!channels.size,remote_execution_stopped:'not_attested',android_services:'not_attested',authority_reader_execution:'not_attested'});
 const seal=()=>{sealed=true;for(const job of jobs)job.cancel();return snapshot();};
 async function read(path){
  guard();if(jobs.size)throw fail('BUSY');
  const evidencePath=typeof path==='string'&&(path==='/sdcard/douyin-leadgen-ui-'+q.profile+'.xml'||/^\/sdcard\/preflight-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:xml|png)$/.test(path));
  if(typeof path!=='string'||!(evidenceSource?evidencePath:systemFiles.has(path)))throw fail('PATH');
  const current={cancel:()=>{},done:null},id=index++;jobs.add(current);let interrupt;
  const interrupted=new Promise((_,reject)=>{interrupt=code=>reject(fail(code));});interrupted.catch(()=>{});
  let timer,socket,canceled=false,leaseUntil=0;current.cancel=(code='CLOSED')=>{unknown=true;reasons.add(code);canceled=true;interrupt(code);socket?.destroy();};
  timer=setTimeout(()=>current.cancel('DEADLINE'),Math.max(0,q.worker_deadline_ms-Date.now()));
  current.done=(async()=>{
   let closed,ended=false,connectionError,buffer=Buffer.alloc(0),total=0;const wake=new Set();const notify=()=>{for(const resolve of wake)resolve();wake.clear();};let closePromise;
   try{
    record(`read-${id}.intent.json`,{id,path,scope_sha256:sha(canonical(q))});leaseUntil=await admit();guard();
    socket=new Socket();channels.add(socket);closePromise=new Promise(r=>{closed=r;});
    socket.on('data',chunk=>{total+=chunk.length;if(total>64*1024*1024){connectionError='LIMIT';socket.destroy();}else buffer=Buffer.concat([buffer,chunk]);notify();});socket.on('end',()=>{ended=true;notify();});socket.on('error',()=>{connectionError='SOCKET';notify();});socket.on('close',hadError=>{if(hadError||!ended)connectionError??='SOCKET';channels.delete(socket);closed();notify();});
    const connected=new Promise((yes,no)=>{socket.once('connect',yes);socket.once('error',()=>no(fail('SOCKET')));socket.once('close',()=>no(fail('SOCKET')));});connected.catch(()=>{unknown=true;});
    guard();try{socket.connect(Number(ip[1]),'127.0.0.1');}catch{throw fail('SOCKET');}await connected;guard();
    // Only this private job owns the admitted socket and lease. Incoming sync
    // frames are not new commands; each send and the returned capability re-admit.
    const frameGuard=()=>{guard();if(!jobs.has(current)||canceled)throw fail('CLOSED');if(Date.now()>=leaseUntil)throw fail('AUTHORITY');};
    const receive=async n=>{frameGuard();while(buffer.length<n){frameGuard();if(connectionError)throw fail(connectionError);if(ended||!channels.has(socket))throw fail('TRUNCATED');await new Promise(r=>wake.add(r));}frameGuard();if(connectionError)throw fail(connectionError);const bytes=buffer.subarray(0,n);buffer=buffer.subarray(n);return bytes;};
    const send=async bytes=>{record(`read-${id}-write-${totalWrites++}.intent.json`,{bytes:bytes.length,sha256:sha(bytes)});leaseUntil=await admit();guard();await new Promise((yes,no)=>socket.write(bytes,e=>e?no(fail('SOCKET')):yes()));guard();};let totalWrites=0;
    const status=async()=>{const code=await receive(4);if(code.equals(Buffer.from('OKAY')))return;if(code.equals(Buffer.from('FAIL'))){const n=adbPayloadLength(await receive(4),4096);await receive(n);throw fail('FAIL');}throw fail('ACK');};
    await send(adbRequest('host:transport:'+q.serial));await status();await send(adbRequest('sync:'));await status();
    const header=Buffer.alloc(8);header.write('RECV');header.writeUInt32LE(Buffer.byteLength(path),4);await send(Buffer.concat([header,Buffer.from(path)]));
    const chunks=[];let bytes=0;
    while(true){const h=await receive(8),kind=h.subarray(0,4).toString('latin1'),size=h.readUInt32LE(4);if(kind==='DONE'){if(size!==0)throw fail('FRAME');break;}if(kind==='FAIL'){if(size>4096)throw fail('FRAME');await receive(size);throw fail('FAIL');}if(kind!=='DATA'||size>65536||bytes+size>64*1024*1024)throw fail('FRAME');chunks.push(await receive(size));bytes+=size;}
    const quit=Buffer.alloc(8);quit.write('QUIT');await send(quit);
    while(!ended){frameGuard();if(connectionError)throw fail(connectionError);if(!channels.has(socket))throw fail('TRUNCATED');await new Promise(r=>wake.add(r));}
    await closePromise;frameGuard();if(connectionError||buffer.length)throw fail('TRAILING');
    await admit();guard();const data=Buffer.concat(chunks);if(evidenceSource&&data.length>(path.endsWith('.png')?12:5)*1024*1024)throw fail('LIMIT');const cap=Object.freeze({domain:'native-phone-adb-read/v1',id});receipts.set(cap,{owner:api,scope_sha256:sha(canonical(q)),path,bytes:data});record(`read-${id}.returned.json`,{id,path,sha256:sha(data),bytes:data.length,peer_eof:true,socket_closed:true});return cap;
   }catch(error){unknown=true;const code=/^NATIVE_PHONE_READ_[A-Z_]+$/.test(error?.code||'')?error.code:'NATIVE_PHONE_READ_FAILED';reasons.add(code);try{record(`read-${id}.unknown.json`,{id,code});}catch{reasons.add('NATIVE_PHONE_READ_JOURNAL');}throw fail(code.slice('NATIVE_PHONE_READ_'.length));}
   finally{socket?.destroy();if(closePromise)await closePromise;clearTimeout(timer);jobs.delete(current);if(canceled)unknown=true;}
  })();current.done.catch(()=>{});return Promise.race([current.done,interrupted]);
 }
 const api=Object.freeze({read,readReceipt(cap,{scope:expected}={}){verifySource();verifyJournal();const r=receipts.get(cap);if(unknown||!r||r.owner!==api||canonical(expected)!==canonical(q)||r.scope_sha256!==sha(canonical(q)))throw fail('BRAND');return {path:r.path,bytes:Buffer.from(r.bytes),sha256:sha(r.bytes),scope_sha256:r.scope_sha256};},snapshot,seal,close:()=>closing??=(async()=>{seal();let timer;try{await Promise.race([Promise.allSettled([...jobs].map(j=>j.done)),new Promise(resolveClose=>{timer=setTimeout(()=>{unknown=true;resolveClose();},Math.max(0,q.cleanup_deadline_ms-Date.now()));})]);}finally{clearTimeout(timer);}return snapshot();})()});instances.add(api);bindings.set(api,{source:canonical(fixed),scope:canonical(q)});return api;
}
