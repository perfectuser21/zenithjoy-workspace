// 固定只读诊断。自身 EXIT/EOF/CLOSE 只证明本次 wire 收回，不证明旧运行停止。
import {Socket} from 'node:net';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstatSync,realpathSync,readdirSync,openSync,writeSync,fsyncSync,closeSync,constants,readFileSync} from 'node:fs';
import {adbRequest,adbPayloadLength,closeStdinFrame,createShellV2Decoder} from './adb-shell-v2-protocol.mjs';
export const DIAGNOSTIC_COMMANDS=Object.freeze({
 sdk:'exec /system/bin/getprop ro.build.version.sdk',
 boot_id:'exec /system/bin/toybox cat /proc/sys/kernel/random/boot_id',
 processes:'exec /system/bin/toybox ps -A -o UID,PID,PPID,NAME,ARGS',
 input:'exec /system/bin/dumpsys input',
 activity:'exec /system/bin/dumpsys activity activities',
 window:'exec /system/bin/dumpsys window windows'
});
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const here=dirname(fileURLToPath(import.meta.url));
export function diagnosticSource(){return Object.fromEntries(['device-epoch-fence-diagnostics.mjs','adb-shell-v2-protocol.mjs'].map(n=>[n,sha(readFileSync(join(here,n)))]));}
export async function runDiagnostic({query,scope,directory,readAuthority,timeoutMs=30000}={}){
 if(!Object.hasOwn(DIAGNOSTIC_COMMANDS,query))throw fail('DIAGNOSTIC_QUERY');
 const q=structuredClone(scope),endpoint=q?.endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/);
 if(!endpoint||Number(endpoint[1])>65535||!/^[-a-zA-Z0-9_.:]{1,100}$/.test(q.serial||'')||!/^[-a-f0-9]{36}$/.test(q.maintenance_task_id||'')||typeof readAuthority!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw fail('DIAGNOSTIC_SCOPE');
 const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||realpathSync(directory)!==resolve(directory)||readdirSync(directory).length)throw fail('DIAGNOSTIC_JOURNAL');
 const source=diagnosticSource(),channels=[],started=new Date().toISOString(),events=[];let failure=null,parsed=null;
 const verifyDirectory=()=>{const now=lstatSync(directory);if(now.dev!==st.dev||now.ino!==st.ino||realpathSync(directory)!==resolve(directory))throw fail('DIAGNOSTIC_JOURNAL');};
 const save=(name,bytes)=>{verifyDirectory();const fd=openSync(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const df=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(df);}finally{closeSync(df);}return sha(bytes);};
 const expired=()=>Date.now()>=deadline;
 const deadline=Date.now()+timeoutMs;
 const admit=async()=>{if(expired())throw fail('DIAGNOSTIC_DEADLINE');verifyDirectory();if(canonical(diagnosticSource())!==canonical(source))throw fail('DIAGNOSTIC_SOURCE_DRIFT');const a=await readAuthority();if(expired())throw fail('DIAGNOSTIC_DEADLINE');if(canonical(a?.scope)!==canonical(q)||!Number.isFinite(Date.parse(a?.lease_until))||Date.parse(a.lease_until)<=Date.now())throw fail('DIAGNOSTIC_AUTHORITY');};
 save('intent.json',Buffer.from(JSON.stringify({protocol:'device-epoch-fence-diagnostic/v1',query,command:DIAGNOSTIC_COMMANDS[query],scope:q,source,started_at:started})+'\n'));
 const timer=setTimeout(()=>{failure??='DIAGNOSTIC_DEADLINE';for(const c of channels)c.socket.destroy();},timeoutMs);
 async function connect(){
  await admit();const index=channels.length,socket=new Socket(),c={socket,buffer:Buffer.alloc(0),eof:false,closed:false,error:null,total:0,wakes:new Set(),index};channels.push(c);
  verifyDirectory();const raw=openSync(join(directory,`socket-${index}.raw`),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);c.raw=raw;
  const notify=()=>{for(const w of c.wakes)w();c.wakes.clear();};
  c.closePromise=new Promise(r=>socket.once('close',hadError=>{c.closed=true;if(hadError||!c.eof)c.error??='DIAGNOSTIC_SOCKET';events.push({index,event:'close',had_error:hadError,peer_eof:c.eof,at:new Date().toISOString()});notify();r();}));
  socket.on('data',bytes=>{try{writeSync(raw,bytes);fsyncSync(raw);c.total+=bytes.length;if(c.total>8*1024*1024)throw fail('DIAGNOSTIC_LIMIT');c.buffer=Buffer.concat([c.buffer,bytes]);}catch(e){c.error=e.code==='DIAGNOSTIC_LIMIT'?e.code:'DIAGNOSTIC_JOURNAL';socket.destroy();}notify();});
  socket.on('end',()=>{c.eof=true;events.push({index,event:'eof',at:new Date().toISOString()});notify();});
  socket.on('error',()=>{c.error??='DIAGNOSTIC_SOCKET';notify();});
  const check=()=>{if(failure)throw fail(failure);if(c.error)throw fail(c.error);if(expired())throw fail('DIAGNOSTIC_DEADLINE');};
  const wait=()=>new Promise(r=>c.wakes.add(r));
  c.read=async n=>{while(c.buffer.length<n){check();if(c.eof||c.closed)throw fail('DIAGNOSTIC_TRUNCATED');await wait();}check();const b=c.buffer.subarray(0,n);c.buffer=c.buffer.subarray(n);return b;};
  c.chunk=async()=>{while(!c.buffer.length&&!c.eof){check();if(c.closed)throw fail('DIAGNOSTIC_TRUNCATED');await wait();}check();const b=c.buffer;c.buffer=Buffer.alloc(0);return b.length?b:null;};
  c.write=async bytes=>{await admit();check();if(c.eof||c.closed)throw fail('DIAGNOSTIC_SOCKET');await new Promise((r,j)=>socket.write(bytes,e=>e?j(fail('DIAGNOSTIC_SOCKET')):r()));};
  c.finish=async()=>{while(!c.eof){check();if(c.closed)throw fail('DIAGNOSTIC_TRUNCATED');await wait();}if(c.buffer.length)throw fail('DIAGNOSTIC_TRAILING');await c.closePromise;check();};
  await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',()=>j(fail('DIAGNOSTIC_SOCKET')));socket.once('close',()=>j(fail(failure??'DIAGNOSTIC_SOCKET')));socket.connect(Number(endpoint[1]),'127.0.0.1');});return c;
 }
 const status=async c=>{const ack=(await c.read(4)).toString();if(ack==='OKAY')return;if(ack==='FAIL'){await c.read(adbPayloadLength(await c.read(4),4096));throw fail('DIAGNOSTIC_ADB_FAIL');}throw fail('DIAGNOSTIC_ACK');};
 try{
  const f=await connect();await f.write(adbRequest('host-serial:'+q.serial+':features'));await status(f);const features=(await f.read(adbPayloadLength(await f.read(4),4096))).toString().split(',');if(!features.includes('shell_v2')||features.some(x=>!/^[a-z][a-z0-9_]*$/.test(x))||new Set(features).size!==features.length)throw fail('DIAGNOSTIC_SHELL_V2_REQUIRED');await f.finish();
  const c=await connect();await c.write(adbRequest('host:transport:'+q.serial));await status(c);await c.write(adbRequest('shell,v2,raw:'+DIAGNOSTIC_COMMANDS[query]));await status(c);
  if(!c.eof)await c.write(closeStdinFrame());const decoder=createShellV2Decoder({maxBytes:8*1024*1024});let chunk;while((chunk=await c.chunk())!==null)decoder.push(chunk);parsed=decoder.finish();await c.finish();await admit();
 }catch(e){failure??=/^(?:DIAGNOSTIC_|ADB_SHELL_V2_)[A-Z_]+$/.test(e.code||'')?e.code:'DIAGNOSTIC_FAILED';}
 finally{for(const c of channels)if(!c.closed)c.socket.destroy();await Promise.all(channels.map(c=>c.closePromise));for(const c of channels){fsyncSync(c.raw);closeSync(c.raw);}clearTimeout(timer);}
 const files={};for(const c of channels)files[`socket-${c.index}.raw`]=sha(readFileSync(join(directory,`socket-${c.index}.raw`)));
 if(parsed){files['stdout.raw']=save('stdout.raw',parsed.stdout);files['stderr.raw']=save('stderr.raw',parsed.stderr);}
 const result={protocol:'device-epoch-fence-diagnostic/v1',query,scope:q,source,started_at:started,finished_at:new Date().toISOString(),events,files,wire_complete:failure===null&&!!parsed,exit_code:parsed?.exit_code??null,error_code:failure,pending:0,open_sockets:0,original_execution_stopped:false,remote_quiescence:'unknown',resource_authority:'not_attested'};
 save('diagnostic.json',Buffer.from(JSON.stringify(result)+'\n'));return result;
}
