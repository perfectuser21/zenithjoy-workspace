// Private EXIT/wire observer only. adbd EXIT and local Socket close never
// establish that an OEM command, detached descendant or Android service stopped.
import {Socket} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readSync,lstatSync,realpathSync,readdirSync,openSync,writeFileSync,fsyncSync,fstatSync,closeSync,constants} from 'node:fs';
import {protocolModulePath,adbRequest,adbPayloadLength,closeStdinFrame,createShellV2Decoder} from './adb-shell-v2-protocol.mjs';
import {readNativePhoneCommandSource,compileVerifiedNativePhoneCommand} from './native-phone-command-source.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const canonical=v=>JSON.stringify(v,(_k,x)=>plain(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const failure=code=>Object.assign(new Error(code),{code});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys='protocol task_id binding_id run_id source_commit serial profile endpoint epoch claim worker_deadline_ms cleanup_deadline_ms'.split(' ').sort().join(',');
const receipts=new WeakMap();
const commandWireLimit=reviewed=>reviewed?.operation==='screenshot'?13*1024*1024:2*1024*1024;
function serial(value){
 if(typeof value!=='string')return false;if(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value))return true;
 const m=value.match(/^(\d+\.\d+\.\d+\.\d+):([1-9]\d{0,4})$/);return !!m&&Number(m[2])<=65535&&m[1].split('.').every(x=>/^(?:0|[1-9]\d{0,2})$/.test(x)&&Number(x)<=255);
}
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
function pinnedBytes(path,{max,privateFile=false}){
 let fd;
 try{
  if(realpathSync(path)!==path)throw Error();fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);
  if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o022)||privateFile&&(s.mode&0o777)!==0o600||s.nlink!==1||s.size>max)throw Error();
  const bytes=Buffer.alloc(s.size+1);let count=0,n;
  while(count<bytes.length&&(n=readSync(fd,bytes,count,bytes.length-count,null))>0)count+=n;
  const end=fstatSync(fd);if(count!==s.size||s.dev!==end.dev||s.ino!==end.ino||s.size!==end.size||s.mtimeMs!==end.mtimeMs||s.ctimeMs!==end.ctimeMs||realpathSync(path)!==path)throw Error();return {bytes:bytes.subarray(0,count),stat:s};
 }finally{if(fd!==undefined)closeSync(fd);}
}

export function createAdbShellV2Observer(options={}){return createObserver(options,null);}
export function createNativePhoneCommandObserver(options={}){
 const {commandSource,operation,args,context,...base}=options,provenance=readNativePhoneCommandSource(commandSource,{source:base.source});
 for(const key of ['task_id','binding_id','run_id','source_commit','profile','serial','epoch','endpoint'])if(provenance[key]!==base.scope?.[key])throw failure('NATIVE_PHONE_COMMAND_SOURCE_SCOPE');
 if(canonical(provenance.claim)!==canonical(base.scope.claim)||base.scope.worker_deadline_ms>provenance.worker_deadline_ms||base.scope.cleanup_deadline_ms>provenance.cleanup_deadline_ms)throw failure('NATIVE_PHONE_COMMAND_SOURCE_SCOPE');
 const command=compileVerifiedNativePhoneCommand(commandSource,operation,args,context);
 return createObserver(base,{command,operation,verify:()=>readNativePhoneCommandSource(commandSource,{source:base.source})});
}
function createObserver({source,runtimeRoot,directory,scope,readAuthority}={},reviewed){
 let fixed,q;try{fixed=frozen(JSON.parse(JSON.stringify(source)));q=frozen(JSON.parse(JSON.stringify(scope)));}catch{throw failure('ADB_SHELL_V2_SCOPE');}
 const endpoint=typeof q?.endpoint==='string'?q.endpoint.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/):null;
 if(!plain(q)||Object.keys(q).sort().join(',')!==keys||q.protocol!=='adb-shell-v2-observation/v1'||!uuid.test(q.task_id||'')||!uuid.test(q.binding_id||'')||!/^[-A-Za-z0-9_.]{1,150}$/.test(q.run_id||'')||!serial(q.serial)||!/^[-A-Za-z0-9_.]{1,80}$/.test(q.profile||'')||!endpoint||Number(endpoint[1])>65535||!Number.isSafeInteger(q.epoch)||q.epoch<0
  ||!Number.isSafeInteger(q.worker_deadline_ms)||!Number.isSafeInteger(q.cleanup_deadline_ms)||q.worker_deadline_ms>=q.cleanup_deadline_ms||!plain(q.claim)||Object.keys(q.claim).sort().join(',')!=='claimed_at,claimed_by'||typeof q.claim.claimed_by!=='string'||!q.claim.claimed_by||!Number.isFinite(Date.parse(q.claim.claimed_at))||typeof readAuthority!=='function')throw failure('ADB_SHELL_V2_SCOPE');
 const verifySource=()=>{
  try{
   if(!/^[a-f0-9]{40}$/.test(fixed.commit||'')||fixed.commit!==q.source_commit||realpathSync(runtimeRoot)!==resolve(runtimeRoot)||realpathSync(fileURLToPath(import.meta.url))!==resolve(runtimeRoot,'adb-shell-v2.mjs')||realpathSync(protocolModulePath)!==resolve(runtimeRoot,'adb-shell-v2-protocol.mjs')||!Array.isArray(fixed.files)||!fixed.files.length||fixed.files.length>512||new Set(fixed.files.map(f=>f.path)).size!==fixed.files.length)throw Error();
   for(const name of ['adb-shell-v2.mjs','adb-shell-v2-protocol.mjs'])if(fixed.files.filter(f=>f.path===name).length!==1)throw Error();
   for(const f of fixed.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(x=>x==='.'||x==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw Error();if(sha(pinnedBytes(resolve(runtimeRoot,f.path),{max:4*1024*1024}).bytes)!==f.sha256)throw Error();}
  }catch{throw failure('ADB_SHELL_V2_SOURCE');}
 };
 verifySource();
 let dirIdentity;const artifacts=new Map();
 const verifyJournal=()=>{
  try{const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(directory)!==resolve(directory)||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||dirIdentity&&(s.dev!==dirIdentity.dev||s.ino!==dirIdentity.ino))throw Error();for(const [name,a]of artifacts){const {bytes,stat:st}=pinnedBytes(resolve(directory,name),{max:65536,privateFile:true});if(st.ino!==a.ino||st.dev!==a.dev||sha(bytes)!==a.sha256)throw Error();}return s;}catch{throw failure('ADB_SHELL_V2_JOURNAL');}
 };
 dirIdentity=verifyJournal();if(readdirSync(directory).length)throw failure('ADB_SHELL_V2_PREVIOUS_UNKNOWN');
 const record=(name,data)=>{
  verifyJournal();let fd,dir;
  try{dir=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const ds=fstatSync(dir);if(ds.dev!==dirIdentity.dev||ds.ino!==dirIdentity.ino)throw Error();const bytes=Buffer.from(JSON.stringify(data)+'\n');fd=openSync(resolve(directory,name),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);writeFileSync(fd,bytes);fsyncSync(fd);fsyncSync(dir);verifyJournal();const s=fstatSync(fd);artifacts.set(name,{dev:s.dev,ino:s.ino,sha256:sha(bytes)});}catch{throw failure('ADB_SHELL_V2_JOURNAL');}finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}
 };
 record('lifecycle.intent.json',{schema_version:1,instance_id:randomUUID(),scope_sha256:sha(canonical(q)),source_sha256:sha(canonical(fixed))});
 let used=false,sealed=false,unknown=false,complete=false,epoch=q.epoch,pending=0,pipeline,connectionIndex=0,writeIndex=0;const channels=new Set(),reasons=new Set();
 const snapshot=()=>Object.freeze({domain:'adb-shell-v2-wire-observation/v1',pending,open_sockets:channels.size,sealed,unknown,wire_complete:complete,remote_execution_stopped:'not_attested',command_source:'not_attested',android_services:'not_attested',resource_authority:'not_attested',authority_reader_execution:'not_attested',loaded_process_attestation:false,unknown_reasons:Object.freeze([...reasons])});
 const taint=code=>{unknown=true;complete=false;reasons.add(code);};
 const guard=()=>{if(Date.now()>=q.worker_deadline_ms)throw failure('ADB_SHELL_V2_DEADLINE');if(sealed||epoch!==q.epoch)throw failure('ADB_SHELL_V2_CLOSED');if(unknown)throw failure('ADB_SHELL_V2_UNKNOWN');};
 const admit=async()=>{
  guard();verifyJournal();verifySource();reviewed?.verify();guard();let a;try{a=await readAuthority();}catch{throw failure('ADB_SHELL_V2_AUTHORITY');}guard();verifyJournal();verifySource();reviewed?.verify();guard();
  if(!a||canonical(a.scope)!==canonical(q)||a.claimed_by!==q.claim.claimed_by||a.claimed_at!==q.claim.claimed_at||!Number.isFinite(Date.parse(a.lease_until))||Date.parse(a.lease_until)<=Date.now())throw failure('ADB_SHELL_V2_AUTHORITY');
  return Date.parse(a.lease_until);
 };
 let interrupt;const destroyAll=()=>{for(const c of channels)c.socket.destroy();};
 function seal(){if(!sealed){sealed=true;epoch++;if(pending){taint('ADB_SHELL_V2_CLOSED');interrupt?.();}destroyAll();}return snapshot();}
 async function connect(){
  if(connectionIndex>=2)throw failure('ADB_SHELL_V2_RECONNECT');
  const index=connectionIndex++;record(`socket-${index}.intent.json`,{schema_version:1,index,endpoint_sha256:sha(q.endpoint),serial_sha256:sha(q.serial)});const leaseUntil=await admit();guard();
  const socket=new Socket(),c={socket,leaseUntil,buffer:Buffer.alloc(0),ended:false,closed:false,error:null,total:0,wake:new Set()};
  let close;const closePromise=new Promise(r=>{close=r;}),notify=()=>{for(const wake of c.wake)wake();c.wake.clear();};
  channels.add(c);socket.on('data',bytes=>{c.total+=bytes.length;if(c.total>commandWireLimit(reviewed)){c.error='ADB_SHELL_V2_LIMIT';socket.destroy();}else c.buffer=Buffer.concat([c.buffer,bytes]);notify();});
  socket.on('end',()=>{c.ended=true;notify();});socket.on('error',()=>{c.error='ADB_SHELL_V2_SOCKET';notify();});socket.on('close',hadError=>{c.closed=true;if(hadError||!c.ended)c.error??='ADB_SHELL_V2_SOCKET';channels.delete(c);close();notify();});
  const wait=()=>new Promise(r=>c.wake.add(r));
  // This connection is a private, single-observer inflight ticket. Frame reads
  // cannot issue a command: every write and the final receipt still re-admit.
  const frameGuard=()=>{guard();if(Date.now()>=c.leaseUntil)throw failure('ADB_SHELL_V2_AUTHORITY');};
  c.read=async size=>{frameGuard();while(c.buffer.length<size){frameGuard();if(c.error)throw failure(c.error);if(c.ended||c.closed)throw failure('ADB_SHELL_V2_TRUNCATED');await wait();}frameGuard();if(c.error)throw failure(c.error);const bytes=c.buffer.subarray(0,size);c.buffer=c.buffer.subarray(size);return bytes;};
  c.chunk=async()=>{frameGuard();while(!c.buffer.length&&!c.ended){frameGuard();if(c.error)throw failure(c.error);if(c.closed)throw failure('ADB_SHELL_V2_TRUNCATED');await wait();}frameGuard();if(c.error)throw failure(c.error);const bytes=c.buffer;c.buffer=Buffer.alloc(0);return bytes.length?bytes:null;};
  c.finish=async()=>{while(!c.ended){frameGuard();if(c.error)throw failure(c.error);if(c.closed)throw failure('ADB_SHELL_V2_TRUNCATED');await wait();}if(c.buffer.length)throw failure('ADB_SHELL_V2_TRAILING');await closePromise;frameGuard();if(c.error)throw failure(c.error);};
  c.closePromise=closePromise;
  const connected=new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',()=>reject(failure('ADB_SHELL_V2_SOCKET')));socket.once('close',()=>reject(failure('ADB_SHELL_V2_SOCKET')));});
  // Own rejection synchronously: guard() or connect() can throw before await.
  // Await the ORIGINAL promise below, so real connect failure still rejects;
  // the independent closePromise remains in the owned cleanup pipeline.
  connected.catch(()=>{taint('ADB_SHELL_V2_SOCKET');});
  guard();try{socket.connect(Number(endpoint[1]),'127.0.0.1');}catch{throw failure('ADB_SHELL_V2_SOCKET');}await connected;guard();return c;
 }
 async function write(c,bytes){
  record(`write-${writeIndex++}.intent.json`,{schema_version:1,bytes:bytes.length,sha256:sha(bytes)});c.leaseUntil=await admit();guard();
  await new Promise((resolve,reject)=>c.socket.write(bytes,error=>error?reject(failure('ADB_SHELL_V2_SOCKET')):resolve()));guard();
 }
 async function status(c){const ack=await c.read(4);if(ack.equals(Buffer.from('OKAY')))return;if(ack.equals(Buffer.from('FAIL'))){const n=adbPayloadLength(await c.read(4),4096);await c.read(n);throw failure('ADB_SHELL_V2_FAIL');}throw failure('ADB_SHELL_V2_ACK');}
 async function observeDump(...args){
  if(args.length)throw failure('ADB_SHELL_V2_ARGUMENTS');if(used)throw failure('ADB_SHELL_V2_USED');used=true;guard();pending++;
  let rejectInterrupt;const interruption=new Promise((_,reject)=>{rejectInterrupt=()=>reject(failure('ADB_SHELL_V2_CLOSED'));});interrupt=rejectInterrupt;
  const timer=setTimeout(()=>{taint('ADB_SHELL_V2_DEADLINE');seal();},Math.max(1,q.worker_deadline_ms-Date.now()));
  pipeline=(async()=>{
   try{
    const feature=await connect();await write(feature,adbRequest('host-serial:'+q.serial+':features'));await status(feature);
    const n=adbPayloadLength(await feature.read(4),4096),text=(await feature.read(n)).toString('latin1'),features=text.split(',');if(!features.length||features.some(x=>!/^[a-z][a-z0-9_]*$/.test(x))||new Set(features).size!==features.length||!features.includes('shell_v2'))throw failure('ADB_SHELL_V2_UNSUPPORTED');await feature.finish();
    const command=await connect();await write(command,adbRequest('host:transport:'+q.serial));await status(command);
    await write(command,adbRequest('shell,v2,raw:'+(reviewed?.command??`exec /system/bin/uiautomator dump --compressed /sdcard/douyin-leadgen-ui-${q.profile}.xml`)));await status(command);await write(command,closeStdinFrame());
    const decoder=createShellV2Decoder({maxBytes:commandWireLimit(reviewed)});let chunk;while((chunk=await command.chunk())!==null)decoder.push(chunk);const parsed=decoder.finish();await command.finish();
    await admit();guard();complete=true;
    const cap=Object.freeze({protocol:'adb-shell-v2-wire/v1',exit_code:parsed.exit_code,stdout_sha256:sha(parsed.stdout),stderr_sha256:sha(parsed.stderr),stdout_bytes:parsed.stdout.length,stderr_bytes:parsed.stderr.length,wire_bytes:parsed.wire_bytes,remote_execution_stopped:'not_attested',command_source:'not_attested',android_services:'not_attested',resource_authority:'not_attested'});
    receipts.set(cap,{owner:api,scope,scope_sha256:sha(canonical(q)),reviewed:reviewed!==null,operation:reviewed?.operation,stdout:Buffer.from(parsed.stdout),stderr:Buffer.from(parsed.stderr)});return cap;
   }catch(error){const code=/^ADB_SHELL_V2_[A-Z_]+$/.test(error?.code||'')?error.code:'ADB_SHELL_V2_FAILED';taint(code);throw failure(code);}
   finally{destroyAll();await Promise.all([...channels].map(c=>c.closePromise));}
  })().finally(()=>{pending--;clearTimeout(timer);interrupt=null;});
  try{return await Promise.race([pipeline,interruption]);}finally{pipeline.catch(()=>{});interruption.catch(()=>{});}
 }
 async function close(){seal();if(pending){let timer;await Promise.race([pipeline?.catch(()=>{}),new Promise(r=>{timer=setTimeout(r,Math.max(0,q.cleanup_deadline_ms-Date.now()));})]).finally(()=>clearTimeout(timer));}if(pending)taint('ADB_SHELL_V2_CLEANUP_PENDING');return snapshot();}
 const matches=(cap,expected)=>{const p=receipts.get(cap);return p?.owner===api&&p.scope===scope&&expected?.scope===scope&&p.scope_sha256===sha(canonical(scope))&&!unknown&&complete;};
 const api=Object.freeze({observeDump,seal,close,snapshot,verifyWireReceipt:matches,readReviewedCommandReceipt(cap,expected){
  if(!reviewed||!matches(cap,expected))throw failure('NATIVE_PHONE_COMMAND_RECEIPT');reviewed.verify();const p=receipts.get(cap);
  return Object.freeze({operation:p.operation,code:cap.exit_code,stdout:Buffer.from(p.stdout),stderr:Buffer.from(p.stderr),reviewed_command_returned:true,wire_complete:true,android_services:'not_attested'});
 }});return api;
}
