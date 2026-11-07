// Only the host recorder domain. This private proof NEVER proves Android Server,
// its shell wire, tunnels, restored audio or phone resources stopped.
import {spawn} from 'node:child_process';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,writeFileSync,writeSync,fsyncSync,fstatSync,readdirSync,constants} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const proofs=new WeakMap(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const fail=code=>Object.assign(Error('NATIVE_SCRCPY_HOST_'+code),{code:'NATIVE_SCRCPY_HOST_'+code,resourceUnknown:!['SCOPE','ARGUMENT','REASON','REPLAY','NOT_STARTED','CLOSED'].includes(code)});
const terminationReserveMs=10000+2000+500;
const uid=()=>process.getuid(),safe=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
function pinned(path,expected,max=16*1024*1024){let fd;try{if(resolve(path)!==path||realpathSync(path)!==path)throw fail('PATH');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=fstatSync(fd),named=lstatSync(path);if(!before.isFile()||named.isSymbolicLink()||before.nlink!==1||![uid(),0].includes(before.uid)||(before.mode&0o022)||before.size>max||named.dev!==before.dev||named.ino!==before.ino)throw fail('FILE');const bytes=readFileSync(fd),after=fstatSync(fd),current=lstatSync(path);if(current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino||realpathSync(path)!==path||before.size!==bytes.length||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||expected&&sha(bytes)!==expected)throw fail('HASH');return {bytes,stat:before};}finally{if(fd!==undefined)closeSync(fd);}}
export function readNativeScrcpyHostStop(proof,{scope,bridge}={}){const value=proofs.get(proof);if(!value||scope&&value.scopeKey!==canonical(scope)||bridge&&value.bridge!==bridge)throw fail('STOP_BRAND');return structuredClone(value.facts);}
export function createNativeScrcpyHostProducer({runtimeRoot,source,scope,directory,assertResources,nativeBridge}={}){
 const src=structuredClone(source),q=structuredClone(scope),scopeKey=canonical(q);
 if(typeof assertResources!=='function'||realpathSync(runtimeRoot)!==dirname(fileURLToPath(import.meta.url))||resolve(runtimeRoot)!==runtimeRoot||src?.commit!==q?.source_commit||!/^[a-f0-9]{40}$/.test(src?.commit||'')||!['task_id','run_id','binding_id','profile','owner','broker_host'].every(k=>typeof q[k]==='string'&&safe.test(q[k]))||!(typeof q.serial==='string'&&(safe.test(q.serial)||/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[1-9][0-9]{0,4}$/.test(q.serial)&&Number(q.serial.split(':')[1])<=65535&&q.serial.split(':')[0].split('.').every(o=>/^(0|[1-9][0-9]{0,2})$/.test(o)&&Number(o)<=255)))||!Number.isSafeInteger(q.device_sdk)||q.device_sdk>99||q.device_sdk!==31&&q.device_sdk<33||!Number.isSafeInteger(q.worker_deadline_ms)||!Number.isSafeInteger(q.receipt_deadline_ms)||!Number.isSafeInteger(q.cleanup_deadline_ms)||q.worker_deadline_ms>=q.receipt_deadline_ms||q.receipt_deadline_ms>q.cleanup_deadline_ms||Date.now()>=q.worker_deadline_ms)throw fail('SCOPE');
 const kind=q.device_sdk===31?'sdk31':'sdk33',policyPath=kind==='sdk31'?'runtime/runtime-policy.json':'runtime/runtime-policy-sdk33.json',hostPath='config/native-scrcpy-hosts.json';let row,policy,bridgeModule,nativeBound=false,startup=null;
 const verifySource=()=>{
  if(!Array.isArray(src.files)||src.files.length>512||new Set(src.files.map(f=>f.path)).size!==src.files.length)throw fail('SOURCE');
  for(const required of ['native-scrcpy-host-producer.mjs',policyPath,hostPath])if(src.files.filter(f=>f.path===required).length!==1)throw fail('SOURCE');
  for(const f of src.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(p=>p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw fail('SOURCE');pinned(join(runtimeRoot,f.path),f.sha256);}
  const hosts=JSON.parse(readFileSync(join(runtimeRoot,hostPath))),matches=hosts.hosts?.filter(r=>r.target===q.broker_host&&r.kind===kind);
  if(hosts.schema_version!==1||matches?.length!==1)throw fail('POLICY');const current=matches[0];if(row&&canonical(current)!==canonical(row))throw fail('POLICY');row=current;
  if(row.shim?.path!=='native-scrcpy-adb-shim.mjs'||row.ps?.path!=='/bin/ps'||!row.review?.path||!row.node?.path||realpathSync(row.root)!==row.root||resolve(row.root)!==row.root)throw fail('POLICY');
  for(const f of [row.review,row.shim])if(src.files.filter(s=>s.path===f.path&&s.sha256===f.sha256).length!==1)throw fail('SOURCE');
  policy=JSON.parse(readFileSync(join(runtimeRoot,policyPath)));if(policy.schema!==(kind==='sdk31'?'scrcpy-sdk31-pinned-v1':'scrcpy-sdk33-pinned-v1')||policy.version!==(kind==='sdk31'?'5.0.1':'3.3.4')||policy.adb_server_protocol!==41||policy.remote_server!=='/data/local/tmp/scrcpy-server.jar')throw fail('POLICY');
  const installed=lstatSync(row.root);if(!installed.isDirectory()||installed.isSymbolicLink()||![uid(),0].includes(installed.uid)||(installed.mode&0o022))throw fail('RUNTIME_DIRECTORY');
  for(const name of ['client_sha256','server_sha256'])if(!/^[a-f0-9]{64}$/.test(policy[name]||''))throw fail('POLICY');
  for(const [path,digest]of [[join(row.root,'scrcpy'),policy.client_sha256],[join(row.root,'scrcpy-server'),policy.server_sha256],[row.ps.path,row.ps.sha256],[row.node.path,row.node.sha256],[join(runtimeRoot,row.shim.path),row.shim.sha256]])pinned(path,digest,path===row.node.path?512*1024*1024:16*1024*1024);
 };verifySource();
 const initial=lstatSync(directory),artifacts=new Map();if(!initial.isDirectory()||initial.isSymbolicLink()||initial.uid!==uid()||(initial.mode&0o777)!==0o700||realpathSync(directory)!==directory||readdirSync(directory).length)throw fail('DIRECTORY');
 const verifyDirectory=()=>{const st=lstatSync(directory);if(st.dev!==initial.dev||st.ino!==initial.ino||st.uid!==uid()||st.isSymbolicLink()||(st.mode&0o777)!==0o700||realpathSync(directory)!==directory)throw fail('DIRECTORY');for(const[path,id]of artifacts){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.dev!==id.dev||s.ino!==id.ino||s.uid!==uid()||s.nlink!==1||(s.mode&0o777)!==0o600)throw fail('ARTIFACT');}};
 const createFile=(name,bytes)=>{verifyDirectory();const path=join(directory,name),fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);try{if(bytes)writeFileSync(fd,bytes);fsyncSync(fd);const st=fstatSync(fd);artifacts.set(path,{dev:st.dev,ino:st.ino});return {path,fd};}catch(error){closeSync(fd);throw error;}};
 const publish=(name,value)=>{const f=createFile(name,Buffer.from(JSON.stringify(value)+'\n'));closeSync(f.fd);const parent=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parent);}finally{closeSync(parent);}};
 publish('host.intent.json',{protocol:'native-scrcpy-host/v1',scope:q,source_sha256:sha(canonical(src)),kind,remote_server_stopped:'not_attested'});
 let child,childState,argv,outputPath,logPath,logFd,logText='',rootIdentity,started=false,closing,unknown=false,timer,startPromise,startPending=false,probeSequence=0,startupBufferMs=null;const owned=new Map(),probes=new Set(),signals=[];
 const mark=()=>{unknown=true;};
 const guard=async(cleanup=false)=>{try{if(!cleanup&&unknown)throw fail('UNKNOWN');verifySource();verifyDirectory();if(!cleanup&&(closing||Date.now()>=q.worker_deadline_ms))throw fail('CLOSED');if(await assertResources()!==true)throw fail('AUTHORITY');verifySource();verifyDirectory();if(!cleanup&&(closing||Date.now()>=q.worker_deadline_ms))throw fail('CLOSED');}catch(error){if(error.code!=='NATIVE_SCRCPY_HOST_CLOSED')mark();throw error;}};
 const executable=path=>{const st=lstatSync(path);if(!(st.mode&0o111))throw fail('EXECUTABLE');};
 // ps is itself a bounded, Source-pinned owned leaf; a callback never supplies rows.
 const identityUnproven=()=>{mark();return fail('IDENTITY_UNPROVEN');};
 function identityEnd(requested,cleanup){
  let end=Math.min(requested,cleanup?q.cleanup_deadline_ms:q.worker_deadline_ms);
  if(!cleanup&&nativeBound&&startup&&!childState?.ready){const phase=bridgeModule.readNativeScrcpyStartupPhase(nativeBridge,{scope:q});end=Math.min(end,startup.protocol_deadline_ms);if(phase.phase==='buffer'){if(startup.post_exec_verified_at_ms!==null&&startup.post_exec_verified_at_ms!==phase.post_exec_verified_at_ms)throw fail('SESSION_TIME');end=Math.min(end,phase.post_exec_verified_at_ms+startupBufferMs);}}
  return end;
 }
 // Observe conflicts before waiting: a later empty ps must not erase a foreign
 // identity. This does not register any row or confer signal authority.
 function observedConflicts(rows){
  const rootCommand=join(row.root,'scrcpy')+' '+argv.join(' '),shim=join(runtimeRoot,row.shim.path),prefixes=[shim,row.node.path+' '+shim,basename(row.node.path)+' '+shim],knownParents=new Set(owned.keys());knownParents.add(childState.pid);
  for(const r of rows)if(prefixes.some(prefix=>r.command===prefix||r.command.startsWith(prefix+' ')))knownParents.add(r.pid);
  for(const r of rows){
   if(r.uid!==uid()||r.pgid!==childState.pid)throw fail('FOREIGN_PROCESS');const previous=owned.get(r.pid),placeholder=/^\([A-Za-z0-9_.-]+\)$/.test(r.command);
   if(previous&&(previous.birth!==r.birth||previous.uid!==r.uid||!r.state.startsWith('Z')&&!placeholder&&previous.command!==r.command))throw fail('PROCESS_REPLACED');
   if(r.pid===childState.pid){if(r.ppid!==process.pid||rootIdentity&&rootIdentity.birth!==r.birth||!placeholder&&r.command!==rootCommand)throw fail('ROOT_IDENTITY');}
   else{if(r.ppid!==1&&!knownParents.has(r.ppid))throw fail('ANCESTRY');const strict=prefixes.some(prefix=>r.command===prefix||r.command.startsWith(prefix+' ')),pending=!previous&&(r.ppid===childState.pid||owned.has(r.ppid))&&(r.command===rootCommand||r.state.startsWith('Z')||r.command==='/usr/bin/env node '+shim||r.command.startsWith('/usr/bin/env node '+shim+' '));if(!placeholder&&!strict&&!pending&&!(previous&&r.state.startsWith('Z')))throw fail('FOREIGN_PROCESS');}
  }
 }
 async function processRows(cleanup=false,requestedEnd=cleanup?q.cleanup_deadline_ms:q.worker_deadline_ms,recheck=false){
  const check=async()=>{if(cleanup)pinned(row.ps.path,row.ps.sha256);else await guard();};await check();if(!childState?.pid)return [];
  let identityDeadline=identityEnd(requestedEnd,cleanup);if(Date.now()>=(cleanup?q.cleanup_deadline_ms:identityDeadline)||recheck&&Date.now()>=identityDeadline)throw identityUnproven();
  const state={process_closed:false,stdin_closed:false,stdout_closed:false,stderr_closed:false,stdout_eof:false,stderr_eof:false},parts=[],errors=[];let processHandle,exit,bytes=0,done,deadlineTimer;
  const returned=new Promise((yes,no)=>done={yes,no});const job={state,returned};probes.add(job);
  const finish=()=>{if(state.process_closed&&state.stdin_closed&&state.stdout_closed&&state.stderr_closed){clearTimeout(deadlineTimer);probes.delete(job);if(exit?.code===0&&exit.signal===null&&state.stdout_eof&&state.stderr_eof)done.yes(Buffer.concat(parts).toString());else if(exit?.code===1&&exit.signal===null&&bytes===0&&state.stdout_eof&&state.stderr_eof)done.yes('');else{mark();done.no(fail('PS_UNPROVEN'));}}};
  try{processHandle=spawn(row.ps.path,['-ww','-g',String(childState.pid),'-o','pid=,ppid=,pgid=,uid=,lstart=,stat=,command='],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});processHandle.once('error',()=>{mark();});processHandle.stdin.end();
   for(const[name,stream]of [['stdin',processHandle.stdin],['stdout',processHandle.stdout],['stderr',processHandle.stderr]]){stream.on('error',()=>mark());stream.once('close',()=>{state[name+'_closed']=true;finish();});if(name!=='stdin')stream.once('end',()=>state[name+'_eof']=true);}
   processHandle.stdout.on('data',b=>{bytes+=b.length;if(bytes>2*1024*1024){mark();processHandle.kill('SIGKILL');}else parts.push(b);});processHandle.stderr.on('data',b=>errors.push(b));processHandle.once('close',(code,signal)=>{exit={code,signal};state.process_closed=true;finish();});
   deadlineTimer=setTimeout(()=>{mark();processHandle.kill('SIGKILL');},Math.max(1,Math.min(1000,(cleanup&&!recheck&&identityDeadline<=Date.now()?q.cleanup_deadline_ms:identityDeadline)-Date.now())));
  }catch(error){probes.delete(job);mark();throw error;}
  const text=await returned;await check();const rows=[];
  for(const line of text.split('\n').filter(s=>s.trim())){const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/);if(!m)throw fail('PS_FORMAT');const r={pid:Number(m[1]),ppid:Number(m[2]),pgid:Number(m[3]),uid:Number(m[4]),birth:m[5].replace(/\s+/g,' '),state:m[6],command:m[7]};if(r.pgid!==childState.pid){mark();throw fail('GROUP');}rows.push(r);}
  identityDeadline=identityEnd(requestedEnd,cleanup);try{publish('host-processes-'+probeSequence+++'.json',{rows,observed_at_ms:Date.now(),identity_deadline_ms:identityDeadline,cleanup});}catch(error){if(!cleanup)throw error;mark();}
  // A read during fork/exec or kernel teardown can lose argv. These are
  // read-only rechecks, never identities or signal authority; the final rows
  // still pass the original strict matcher within the original absolute budget.
  try{observedConflicts(rows);}catch(error){mark();throw error;}const rootCommand=join(row.root,'scrcpy')+' '+argv.join(' '),shim=join(runtimeRoot,row.shim.path);const pending=rows.some(r=>!(owned.has(r.pid)&&r.state.startsWith('Z'))&&(/^\([A-Za-z0-9_.-]+\)$/.test(r.command)||!owned.has(r.pid)&&r.pid!==childState.pid&&r.uid===uid()&&(r.ppid===childState.pid||owned.has(r.ppid))&&(r.command===rootCommand||r.state.startsWith('Z')||r.command==='/usr/bin/env node '+shim||r.command.startsWith('/usr/bin/env node '+shim+' '))));identityDeadline=identityEnd(requestedEnd,cleanup);if(!cleanup&&Date.now()>=identityDeadline)throw identityUnproven();if(pending){if(Date.now()>=identityDeadline)throw identityUnproven();await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(10,identityDeadline-Date.now()))));return processRows(cleanup,identityDeadline,true);}return rows;
 }
 function remember(rows){
  const rootCommand=join(row.root,'scrcpy')+' '+argv.join(' '),shim=join(runtimeRoot,row.shim.path),prefixes=[shim,row.node.path+' '+shim,basename(row.node.path)+' '+shim];
  for(const r of rows){if(r.uid!==uid()||r.pgid!==childState.pid)throw fail('FOREIGN_PROCESS');const previous=owned.get(r.pid);if(previous&&r.state.startsWith('Z')&&previous.birth===r.birth&&previous.uid===r.uid){owned.set(r.pid,{...r,command:previous.command});continue;}if(previous&&(previous.birth!==r.birth||previous.command!==r.command||previous.uid!==r.uid))throw fail('PROCESS_REPLACED');
   if(r.pid===childState.pid){if(r.command!==rootCommand||r.ppid!==process.pid)throw fail('ROOT_IDENTITY');if(rootIdentity&&rootIdentity.birth!==r.birth)throw fail('ROOT_IDENTITY');rootIdentity=r;}
   else if(!prefixes.some(prefix=>r.command===prefix||r.command.startsWith(prefix+' ')))throw fail('FOREIGN_PROCESS');
   owned.set(r.pid,r);
  }
  for(const r of rows)if(r.pid!==childState.pid&&!owned.has(r.ppid)&&r.ppid!==1)throw fail('ANCESTRY');
 }
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const snapshot=()=>Object.freeze({domain:'native-scrcpy-host/v1',started,pid:childState?.pid??null,unknown,closing:!!closing,pending:probes.size+(childState&&!childState.process_closed?1:0)+(startPending?1:0),client:childState?{...childState}:null,owned_processes:[...owned.values()].map(r=>({...r})),signals:[...signals],log_fd_closed:logFd===undefined,startup:startup?{...startup}:null,remote_server_stopped:'not_attested',tunnels_stopped:'not_attested',native_audio_restored:'not_attested'});
 async function stopInternal(reason){
  clearTimeout(timer);if(nativeBound)nativeBridge.beginStop();let rows=[],safe=true;
  try{await guard(true);}catch{mark();}
  try{rows=await processRows(true,q.cleanup_deadline_ms-terminationReserveMs);remember(rows);}catch{mark();safe=false;}
  for(const [signal,waitMs]of [['SIGINT',10000],['SIGTERM',2000],['SIGKILL',500]]){
   if(!rows.some(r=>!r.state.startsWith('Z')))break;
   if(Date.now()>=q.cleanup_deadline_ms)break;
   try{pinned(row.ps.path,row.ps.sha256);rows=await processRows(true,q.cleanup_deadline_ms-(signal==='SIGINT'?terminationReserveMs:signal==='SIGTERM'?2500:500));remember(rows);if(!rows.some(r=>!r.state.startsWith('Z')))break;if(!safe)break;
    // The leader is either the exact unreaped ChildProcess or rows retain its
    // registered group identity. A replacement/foreign row always fails above.
    if(Date.now()>=q.cleanup_deadline_ms){mark();break;}process.kill(-childState.pid,signal);signals.push(signal);
   }catch(error){if(error.code!=='ESRCH')mark();}
   const reserve=signal==='SIGINT'?2500:signal==='SIGTERM'?500:0;const until=Math.min(q.cleanup_deadline_ms-reserve,Date.now()+waitMs);
   do{if(Date.now()>=until)break;await sleep(Math.max(1,Math.min(50,until-Date.now())));if(Date.now()>=until)break;try{rows=await processRows(true,until);remember(rows);}catch{mark();safe=false;break;}}while(rows.some(r=>!r.state.startsWith('Z'))&&Date.now()<until);
  }
  while(childState&&!childState.process_closed&&Date.now()<q.cleanup_deadline_ms)await sleep(Math.max(1,Math.min(20,q.cleanup_deadline_ms-Date.now())));
  if(childState&&!childState.process_closed){mark();if(!childState.exited)child?.kill('SIGKILL');for(const s of [child.stdin,child.stdout,child.stderr])s.destroy();}
  if(childState&&(!childState.process_closed||!childState.stdin_closed||!childState.stdout_closed||!childState.stderr_closed||!childState.stdout_eof||!childState.stderr_eof))mark();
  try{rows=await processRows(true);remember(rows);if(rows.some(r=>!r.state.startsWith('Z')))mark();}catch{mark();}
  if(logFd!==undefined){try{fsyncSync(logFd);closeSync(logFd);logFd=undefined;}catch{mark();}}
  while(probes.size&&Date.now()<q.cleanup_deadline_ms)await sleep(Math.max(1,Math.min(20,q.cleanup_deadline_ms-Date.now())));if(probes.size)mark();let known=!unknown&&(!childState||childState.process_closed&&childState.stdin_closed&&childState.stdout_closed&&childState.stderr_closed&&childState.stdout_eof&&childState.stderr_eof)&&!rows.some(r=>!r.state.startsWith('Z'))&&logFd===undefined;
  const facts=Object.freeze({domain:'native-scrcpy-host/v1',host_stopped:known,host_unknown:!known,reason,client:childState?Object.freeze({...childState}):null,owned_processes:Object.freeze([...owned.values()].map(r=>Object.freeze({...r}))),signals:Object.freeze([...signals]),log_fd_closed:logFd===undefined,startup:startup?{...startup}:null,remote_server_stopped:'not_attested',tunnels_stopped:'not_attested',native_audio_restored:'not_attested'});
  try{publish('host.closed.json',facts);}catch{mark();known=false;}
  const proof=Object.freeze({...facts,host_stopped:known,host_unknown:!known});if(known)proofs.set(proof,{scopeKey,facts:proof,bridge:nativeBridge});return proof;
 }
 const stop=(reason='stop')=>{if(!['stop','close','timeout','abort','startup-failed'].includes(reason))return Promise.reject(fail('REASON'));return closing??=(async()=>stopInternal(reason))();};
 const start=(eid,maxSeconds=110)=>{
  if(started||closing||startPromise)return Promise.reject(fail('REPLAY'));if(typeof eid!=='string'||!safe.test(eid)||!eid.startsWith(q.owner+'-')||!Number.isSafeInteger(maxSeconds)||maxSeconds<5||maxSeconds>1800)return Promise.reject(fail('ARGUMENT'));
  startPending=true;startPromise=(async()=>{
   try{await guard();if(nativeBridge&&src.files.filter(f=>f.path==='native-scrcpy-adb-bridge.mjs').length!==1)throw fail('SOURCE');executable(join(row.root,'scrcpy'));executable(join(runtimeRoot,row.shim.path));executable(row.node.path);executable(row.ps.path);const maximum=Math.min(maxSeconds,320),container=kind==='sdk31'?'wav':'matroska';
    const protocolEnd=q.worker_deadline_ms-maximum*1000-terminationReserveMs;const checkStartupBudget=()=>{if(nativeBridge&&Date.now()>=protocolEnd)throw fail('STARTUP_BUDGET');};checkStartupBudget();if(nativeBridge){bridgeModule=await import('./native-scrcpy-adb-bridge.mjs');bridgeModule.readNativeScrcpyShimEnvironment(nativeBridge,{scope:q});bridgeModule.readNativeScrcpyStartupPhase(nativeBridge,{scope:q});nativeBound=true;}
    const output=createFile(eid+(kind==='sdk31'?'.rec.wav':'.rec.mkv'),Buffer.alloc(0));outputPath=output.path;closeSync(output.fd);const log=createFile(eid+'.rec.log',Buffer.alloc(0));logPath=log.path;logFd=log.fd;
    argv=kind==='sdk31'?['-s',q.serial,'--no-window','--no-playback','--no-video','--audio-source=output','--audio-codec=raw','--record-format=wav','--require-audio','--record='+outputPath,'--time-limit='+maximum,'--no-cleanup']:['-s',q.serial,'--no-window','--no-playback','--audio-source=playback','--audio-dup','--require-audio','--record='+outputPath,'--time-limit='+maximum,'--no-cleanup'];
    startupBufferMs=Math.min(12000,maximum*1000);startup={mode:nativeBound?'native-protocol':'legacy',protocol_deadline_ms:nativeBound?protocolEnd:null,post_exec_verified_at_ms:null,media_deadline_ms:null};publish('host.launch.json',{argv,client_sha256:policy.client_sha256,server_sha256:policy.server_sha256,maximum,scope_sha256:sha(scopeKey),remote_server_stopped:'not_attested'});await guard();checkStartupBudget();
    childState={pid:null,exited:false,process_closed:false,stdin_closed:false,stdout_closed:false,stderr_closed:false,stdout_eof:false,stderr_eof:false,code:null,signal:null,ready:false};
    child=spawn(join(row.root,'scrcpy'),argv,{detached:true,env:{...(nativeBound?bridgeModule.readNativeScrcpyShimEnvironment(nativeBridge,{scope:q}):{}),PATH:dirname(row.node.path)+':/usr/bin:/bin',LANG:'C',LC_ALL:'C',ADB:join(runtimeRoot,row.shim.path),SCRCPY_SERVER_PATH:join(row.root,'scrcpy-server')},stdio:['pipe','pipe','pipe']});childState.pid=child.pid;started=true;child.on('error',()=>mark());child.once('exit',(code,signal)=>{childState.exited=true;childState.code=code;childState.signal=signal;});child.once('close',()=>childState.process_closed=true);
    for(const[name,stream]of [['stdin',child.stdin],['stdout',child.stdout],['stderr',child.stderr]]){stream.on('error',()=>mark());stream.once('close',()=>childState[name+'_closed']=true);if(name!=='stdin'){stream.once('end',()=>childState[name+'_eof']=true);stream.on('data',bytes=>{try{if(logText.length+bytes.length>1024*1024)throw fail('LOG_LIMIT');logText+=bytes.toString();writeSync(logFd,bytes);}catch{mark();void stop('abort');}});}}
    child.stdin.end();timer=setTimeout(()=>{void stop('timeout');},Math.max(1,q.worker_deadline_ms-Date.now()));let end=nativeBound?protocolEnd:Math.min(q.worker_deadline_ms-1,Date.now()+Math.min(12000,maximum*1000));if(!nativeBound)startup.media_deadline_ms=end;
    while(Date.now()<end){await guard();let sessionReady=!nativeBound;if(nativeBound){const phase=bridgeModule.readNativeScrcpyStartupPhase(nativeBridge,{scope:q});if(phase.phase==='buffer'){const at=phase.post_exec_verified_at_ms;if(startup.post_exec_verified_at_ms!==null&&startup.post_exec_verified_at_ms!==at)throw fail('SESSION_TIME');if(startup.post_exec_verified_at_ms===null){startup.post_exec_verified_at_ms=at;startup.media_deadline_ms=Math.min(protocolEnd,at+Math.min(12000,maximum*1000));startup.mode='native-buffer';end=startup.media_deadline_ms;publish('host.startup-phase.json',{...startup,termination_reserve_ms:terminationReserveMs});}sessionReady=true;}}if(Date.now()>=end)break;const rows=await processRows(false,end);remember(rows);const out=lstatSync(outputPath),ready=sessionReady&&rows.some(r=>r.pid===childState.pid&&!r.state.startsWith('Z'))&&out.size>0&&logText.split(/\r?\n/).includes('INFO: Recording started to '+container+' file: '+outputPath)&&!logText.split(/\r?\n/).includes('INFO: Recording complete to '+container+' file: '+outputPath);
     if(ready){await guard();if(Date.now()>=end)break;if(nativeBound){const phase=bridgeModule.readNativeScrcpyStartupPhase(nativeBridge,{scope:q});if(phase.phase!=='buffer'||phase.post_exec_verified_at_ms!==startup.post_exec_verified_at_ms)throw fail('SESSION_TIME');}const again=await processRows(false,end);remember(again);if(Date.now()<end&&again.some(r=>r.pid===childState.pid&&!r.state.startsWith('Z'))&&lstatSync(outputPath).size>0){childState.ready=true;publish('host.ready.json',{pid:childState.pid,root_identity:rootIdentity,path:outputPath,log:logPath,remote_server_stopped:'not_attested'});return Object.freeze({pid:childState.pid,path:outputPath,log:logPath,maximum,capture_audio_mode:kind==='sdk31'?'output_pcm_sdk31':'playback_dup',remote_server_stopped:'not_attested'});}}
     if(childState.exited)throw fail('STARTUP_EXIT');await sleep(Math.max(1,Math.min(100,end-Date.now())));
    }throw fail('READINESS');
   }catch(error){await stop('startup-failed');throw error;}finally{startPending=false;}
  })();return startPromise;
 };
 const status=async()=>{try{await guard();if(!started)throw fail('NOT_STARTED');const rows=await processRows();remember(rows);verifyDirectory();return Object.freeze({state:rows.some(r=>!r.state.startsWith('Z'))?'recording':'stopped',bytes:lstatSync(outputPath).size,path:outputPath,remote_server_stopped:'not_attested'});}catch(error){if(!['NATIVE_SCRCPY_HOST_CLOSED','NATIVE_SCRCPY_HOST_NOT_STARTED'].includes(error.code))mark();throw error;}};
 return Object.freeze({start,status,stop,close:()=>stop('close'),snapshot,verifyHostStopped:proof=>proofs.get(proof)?.scopeKey===scopeKey});
}
