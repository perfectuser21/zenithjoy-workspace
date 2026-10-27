import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, openSync, closeSync, writeFileSync, renameSync, readFileSync, fsyncSync} from 'node:fs';
import {join, resolve, isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const validTaskId=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=256;
const tailBudgetMs=1000,signalBudgetMs=5000,maximumObservedProcesses=32;
function inspectionTimeout(maximum,deadline=Infinity){
 const remaining=deadline-performance.now();
 if(remaining<=0)throw Error('NATIVE_OBSERVATION_BUDGET_EXHAUSTED');
 return Math.min(maximum,Math.ceil(remaining));
}
async function observedWithin(promise,maximum,deadline=Infinity){
 let timer;
 try{
  const timeout=inspectionTimeout(maximum,deadline);
  return await Promise.race([promise,new Promise(r=>{timer=setTimeout(()=>r(false),timeout);})]);
 }catch{return false;}finally{clearTimeout(timer);}
}
const receiptKeys=new Set(['version','operation_id','run_dir','run_id','task_id','profile','serial','source_commit','owner','activity','status','execution_stopped','process_coverage','observed_processes_stopped','created_at','started_at','ended_at','pid','pgid','start_identity','signal','signals','wait_code','wait_signal','failure','processes']);
const watcher=`import os,sys,select\np=int(sys.argv[1])\ntry:\n if hasattr(os,'pidfd_open'):\n  fd=os.pidfd_open(p,0); print('READY',flush=True); select.select([fd],[],[]); print('EXIT',flush=True)\n else:\n  k=select.kqueue(); k.control([select.kevent(p,filter=select.KQ_FILTER_PROC,flags=select.KQ_EV_ADD|select.KQ_EV_ENABLE,fflags=select.KQ_NOTE_EXIT)],0); print('READY',flush=True); k.control(None,1); print('EXIT',flush=True)\nexcept Exception:\n print('UNKNOWN',flush=True); sys.exit(1)\n`;
const inspector=`import os,sys,json,ctypes,struct\np=int(sys.argv[1]); mode=sys.argv[2]; children=mode=='children'\nif sys.platform=='darwin':\n lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)\n def info(pid):\n  b=ctypes.create_string_buffer(136)\n  if lib.proc_pidinfo(pid,3,0,b,136)!=136:return None\n  x=b.raw\n  return {'pid':pid,'ppid':struct.unpack_from('=I',x,16)[0],'uid':struct.unpack_from('=I',x,20)[0],'pgid':struct.unpack_from('=I',x,100)[0],'start_identity':str(struct.unpack_from('=Q',x,120)[0])+':'+str(struct.unpack_from('=Q',x,128)[0])}\n def direct(pid):\n  b=ctypes.create_string_buffer(16384); n=lib.proc_listchildpids(pid,b,len(b))\n  if n<0 or n*4>=len(b):raise RuntimeError('PROCESS_INSPECTION_FAILED')\n  return [x[0] for x in struct.iter_unpack('=I',b.raw[:n*4]) if x[0]>0]\n def group(pid):\n  b=ctypes.create_string_buffer(16384); n=lib.proc_listpgrppids(pid,b,len(b))\n  if n<0 or n*4>=len(b):raise RuntimeError('PROCESS_GROUP_INSPECTION_FAILED')\n  return [x[0] for x in struct.iter_unpack('=I',b.raw[:n*4]) if x[0]>0 and x[0]!=pid]\nelse:\n def info(pid):\n  try:\n   s=open('/proc/%d/stat'%pid).read(); f=s[s.rfind(')')+2:].split()\n   return {'pid':pid,'ppid':int(f[1]),'uid':os.stat('/proc/%d'%pid).st_uid,'pgid':int(f[2]),'start_identity':f[19]}\n  except (FileNotFoundError,ProcessLookupError):return None\n def direct(pid):\n  out=[]\n  for name in os.listdir('/proc'):\n   if name.isdigit():\n    row=info(int(name))\n    if row and row['ppid']==pid:out.append(int(name))\n  return out\n def group(pid):\n  out=[]\n  for name in os.listdir('/proc'):\n   if name.isdigit():\n    row=info(int(name))\n    if row and row['pgid']==pid and row['pid']!=pid:out.append(row['pid'])\n  return out\nif children:\n result=[]; seen={p}; queue=[p]\n while queue:\n  for q in direct(queue.pop(0)):\n   if q not in seen:seen.add(q);result.append(q);queue.append(q)\n print(json.dumps(result))\nelif mode=='group': print(json.dumps(group(p)))\nelse: print(json.dumps(info(p)))\n`;

export function receiptPath(runDir,operationId){
 if(!isAbsolute(runDir)||!idPattern.test(operationId))throw Error('NATIVE_OPERATION_ID_INVALID');
 return join(resolve(runDir),'native-operations',operationId+'.json');
}
export function nativeOperationIdentityMatches(proof,context){
 const fields={operation_id:'operationId',run_dir:'runDir',run_id:'runId',task_id:'taskId',profile:'profile',serial:'serial',source_commit:'sourceCommit',owner:'owner',activity:'activity'};
 return Object.entries(fields).every(([actual,expected])=>Object.hasOwn(context||{},expected)&&Object.hasOwn(proof||{},actual)
  &&(expected==='taskId'?validTaskId(context[expected]):typeof context[expected]==='string'&&context[expected].length>0)&&proof[actual]===context[expected]);
}
export function readNativeOperation(runDir,operationId){
 let value;
 try{value=JSON.parse(readFileSync(receiptPath(runDir,operationId),'utf8'));}catch{return {operation_id:operationId,status:'unknown',execution_stopped:false};}
 const publicValue={version:value?.version,operation_id:value?.operation_id,run_dir:value?.run_dir,run_id:value?.run_id,task_id:value?.task_id,profile:value?.profile,serial:value?.serial,source_commit:value?.source_commit,owner:value?.owner,activity:value?.activity,
  status:value?.status,execution_stopped:value?.execution_stopped,process_coverage:value?.process_coverage,observed_processes_stopped:value?.observed_processes_stopped,created_at:value?.created_at,started_at:value?.started_at,ended_at:value?.ended_at,pid:value?.pid,pgid:value?.pgid,start_identity:value?.start_identity,
  signal:value?.signal,signals:Array.isArray(value?.signals)?value.signals.map(s=>({name:s?.name,at:s?.at,targets:s?.targets})):undefined,wait_code:value?.wait_code,wait_signal:value?.wait_signal,failure:value?.failure,
  processes:Array.isArray(value?.processes)?value.processes.map(p=>({pid:p?.pid,ppid:p?.ppid,uid:p?.uid,pgid:p?.pgid,start_identity:p?.start_identity,termination:{confirmed:p?.termination?.confirmed===true}})):[]};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!receiptKeys.has(key))
   ||value.operation_id!==operationId||value.run_dir!==resolve(runDir)||value.execution_stopped!==true
   ||!Object.hasOwn(value,'task_id')||!validTaskId(value.task_id)
   ||![value.run_id,value.profile,value.serial,value.source_commit,value.owner,value.activity].every(s=>typeof s==='string'&&s.length>0)
   ||value.status!=='not_started'||value.failure!=='native_pre_spawn_error'
   ||value.pid!==undefined||value.started_at!==undefined||!Array.isArray(value.processes)||value.processes.length!==0)
  return {...publicValue,status:'unknown',execution_stopped:false};
 return publicValue;
}
function persist(path,value,exclusive=false){
 const tmp=path+'.'+randomBytes(8).toString('hex')+'.tmp';
 if(exclusive){const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}return;}
 const fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,path);
}
export function processIdentity(pid,deadline){
 if(!Number.isSafeInteger(pid)||pid<=0)return null;
 const r=spawnSync('python3',['-c',inspector,String(pid),'identity'],{encoding:'utf8',timeout:inspectionTimeout(2000,deadline)});
 if(r.status!==0)throw Error('NATIVE_PROCESS_INSPECTION_FAILED');
 return JSON.parse(r.stdout);
}
function inspectAsync(pid,mode,deadline,signal){
 if(!Number.isSafeInteger(pid)||pid<=0)return mode==='identity'?Promise.resolve(null):Promise.reject(Error('NATIVE_PROCESS_INSPECTION_FAILED'));
 const timeout=inspectionTimeout(mode==='identity'?2000:3000,deadline);
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('NATIVE_OBSERVATION_CANCELLED'));return;}
  const child=spawn('python3',['-c',inspector,String(pid),mode],{stdio:['ignore','pipe','pipe']});
  let stdout='',bytes=0,failure,settled=false;
  const cancel=()=>{failure??=Error('NATIVE_OBSERVATION_CANCELLED');child.kill('SIGKILL');child.stdout.destroy();child.stderr.destroy();finish(failure);};
  const timer=setTimeout(()=>{failure??=Error('NATIVE_PROCESS_INSPECTION_FAILED');cancel();},timeout);
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
  signal.addEventListener('abort',cancel,{once:true});
  child.once('spawn',()=>{if(signal.aborted)cancel();});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024){failure??=Error('NATIVE_PROCESS_INSPECTION_FAILED');cancel();}else stdout+=chunk;});
  child.stderr.on('data',()=>{});
  child.once('error',()=>finish(Error('NATIVE_PROCESS_INSPECTION_FAILED')));
  child.once('close',code=>{if(failure||code!==0){finish(failure||Error('NATIVE_PROCESS_INSPECTION_FAILED'));return;}
   try{finish(null,JSON.parse(stdout));}catch{finish(Error('NATIVE_PROCESS_INSPECTION_FAILED'));}
  });
 });
}
function watchExit(pid){
 const child=spawn('python3',['-c',watcher,String(pid)],{stdio:['ignore','pipe','ignore']});
 let readyResolve,exitResolve,buffer='',ready=false,ended=false;
 const readyPromise=new Promise(r=>readyResolve=r),exitPromise=new Promise(r=>exitResolve=r);
 child.stdout.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line==='READY'){ready=true;readyResolve(true);}if(line==='EXIT'){ended=true;exitResolve(true);}if(line==='UNKNOWN'){readyResolve(false);exitResolve(false);}}});
 child.on('close',()=>{if(!ready)readyResolve(false);if(!ended)exitResolve(false);});
 child.on('error',()=>{readyResolve(false);exitResolve(false);});
 return {ready:readyPromise,exited:exitPromise,close:()=>{if(!ended)child.kill('SIGTERM');}};
}
export function beginNativeOperation(context){
 const {runDir,operationId,runId,taskId,profile,serial,sourceCommit,owner,activity}=context||{};
 if(!isAbsolute(runDir||'')||!idPattern.test(operationId||'')||!Object.hasOwn(context||{},'taskId')||!validTaskId(taskId)
  ||![runId,profile,serial,sourceCommit,owner,activity].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw Error('NATIVE_OPERATION_CONTEXT_INVALID');
 const path=receiptPath(runDir,operationId);mkdirSync(join(resolve(runDir),'native-operations'),{recursive:true,mode:0o700});
 const value={version:1,operation_id:operationId,run_dir:resolve(runDir),run_id:runId,task_id:taskId,profile,serial,source_commit:sourceCommit,owner,activity,status:'intent',execution_stopped:false,process_coverage:'observed_only',created_at:new Date().toISOString(),processes:[]};
 persist(path,value,true);
 let poller,unknown=false,stopped=false,finalized=false,tailDeadline,epoch=0,scanFlight,stopPromise;
 let observations=new AbortController();
 const adding=new Map();
 const current=token=>token===epoch&&!finalized;
 const nextEpoch=()=>{epoch++;observations.abort();observations=new AbortController();};
 const inspect=async(pid,mode,token)=>{
  const result=await inspectAsync(pid,mode,tailDeadline,observations.signal);
  if(!current(token))throw Error('NATIVE_OBSERVATION_CANCELLED');
  return result;
 };
 // TERM, KILL and final readback share one monotonic observation budget.
 // Exhaustion never proves termination or grants another business attempt.
 const startTail=(budget=tailBudgetMs)=>tailDeadline=Math.min(tailDeadline??Infinity,performance.now()+budget);
 const candidates=ids=>{
  if(!Array.isArray(ids))throw Error('NATIVE_PROCESS_INSPECTION_FAILED');
  if(ids.length>maximumObservedProcesses)unknown=true;
  return ids.slice(0,maximumObservedProcesses);
 };
 const tracked=new Map();
 const add=(pid,token=epoch)=>{
  if(tracked.has(pid))return;
  const key=token+':'+pid;if(adding.has(key))return adding.get(key);
  const work=(async()=>{
  if(!current(token))return;
  if(tracked.size>=maximumObservedProcesses||(tailDeadline!==undefined&&performance.now()>=tailDeadline)){unknown=true;return;}
  let identity;try{identity=await inspect(pid,'identity',token);}catch{if(current(token))unknown=true;return;}
  if(!current(token))return;
  if(!identity){unknown=true;return;}
  if(identity.pid!==pid||!Number.isSafeInteger(identity.uid)||!Number.isSafeInteger(identity.pgid)||typeof identity.start_identity!=='string'){unknown=true;return;}
  if(value.pid&&identity.pgid!==value.pgid)unknown=true;
  const watcher=watchExit(pid);tracked.set(pid,{...identity,watcher});
  const ready=await observedWithin(watcher.ready,1000,tailDeadline);
  if(!current(token)){watcher.close();return;}
  try{if(!ready||(await inspect(pid,'identity',token))?.start_identity!==identity.start_identity)unknown=true;}catch{if(current(token))unknown=true;}
  if(!current(token))return;
  value.processes=[...tracked.values()].map(({watcher,...publicIdentity})=>publicIdentity);
  if(!stopped)persist(path,value);
  })();
  adding.set(key,work);const clear=()=>adding.delete(key);void work.then(clear,clear);return work;
 };
 const scan=(token=epoch)=>{
  if(scanFlight?.token===token)return scanFlight.promise;
  const promise=(async()=>{try{
   const ids=candidates(await inspect(value.pid,'children',token));
   for(const child of ids){if(!current(token))return;await add(child,token);}
  }catch{if(current(token))unknown=true;}})();
  const entry={token,promise};scanFlight=entry;
  void promise.finally(()=>{if(scanFlight===entry)scanFlight=undefined;});return promise;
 };
 const started=async pid=>{
  if(stopped||finalized)return;
  const token=epoch;
  value.pid=pid;value.pgid=pid;value.status='running';value.started_at=new Date().toISOString();
  await add(pid,token);if(!current(token)||stopped)return;
  value.start_identity=tracked.get(pid)?.start_identity||null;
  persist(path,value);
  poller=setInterval(()=>{if(!stopped&&!scanFlight)void scan();},25);
  poller.unref();
 };
 const stop=(signal,code,waitSignal)=>{
  if(stopPromise)return stopPromise;
  if(finalized)return Promise.resolve(readNativeOperation(runDir,operationId));
  startTail();
  stopped=true;clearInterval(poller);if(scanFlight||adding.size)unknown=true;nextEpoch();const token=epoch;
  stopPromise=(async()=>{
  await scan(token);
  try{if(candidates(await inspect(value.pgid,'group',token)).some(pid=>!tracked.has(pid)))unknown=true;}catch{unknown=true;}
  const records=[];
  for(const item of tracked.values()){
   let actual;try{actual=await inspect(item.pid,'identity',token);}catch{unknown=true;}
   if(actual&&(actual.pid!==item.pid||actual.start_identity!==item.start_identity||actual.uid!==item.uid||actual.pgid!==item.pgid||actual.ppid!==item.ppid))unknown=true;
   const exited=await observedWithin(item.watcher.exited,200,tailDeadline);
   if(!exited)unknown=true;
   records.push({pid:item.pid,start_identity:item.start_identity,pgid:item.pgid,termination:{confirmed:exited}});
   item.watcher.close();
  }
  value.processes=records;value.signal=signal||null;value.wait_code=code??null;value.wait_signal=waitSignal||null;
  // Exit events prove only the observed PID set. A fork can escape between
  // scans; neither an empty group nor every observed EXIT proves completeness.
  value.observed_processes_stopped=!unknown&&records.length>0&&records.every(p=>p.termination.confirmed);
  finalized=true;nextEpoch();value.status='unknown';value.execution_stopped=false;value.ended_at=new Date().toISOString();persist(path,value);
  return value;
  })();return stopPromise;
 };
 const maySignal=async(pid,token)=>{
  const expected=tracked.get(pid);let actual;try{actual=await inspect(pid,'identity',token);}catch{if(current(token))unknown=true;return false;}
  if(!current(token)||stopped)return false;
  if(!expected||!actual||actual.pid!==pid||actual.start_identity!==expected.start_identity||actual.uid!==expected.uid||actual.pgid!==expected.pgid){unknown=true;return false;}
  return true;
 };
 const notStarted=()=>{stopped=true;finalized=true;clearInterval(poller);nextEpoch();value.status='not_started';value.execution_stopped=true;value.process_coverage='not_started';value.failure='native_pre_spawn_error';value.ended_at=new Date().toISOString();persist(path,value);return value;};
 const signalTargets=async signal=>{
  if(stopped||finalized)return 0;
  startTail(signalBudgetMs);const token=epoch;
  await scan(token);
  try{const root=await inspect(value.pid,'identity',token);if(root?.start_identity===value.start_identity){for(const pid of candidates(await inspect(value.pgid,'group',token)))await add(pid,token);}else unknown=true;}catch{if(current(token))unknown=true;}
  if(!current(token)||stopped)return 0;
  let sent=0;
  for(const pid of [...tracked.keys()].reverse())if(await maySignal(pid,token)){
   try{process.kill(pid,signal);sent++;}catch(error){if(error.code!=='ESRCH')unknown=true;}
  }
  if(current(token)&&!stopped){value.signals??=[];value.signals.push({name:signal,at:new Date().toISOString(),targets:sent});persist(path,value);}
  return sent;
 };
 return {started,stop,signalTargets,notStarted,markUnknown:()=>{unknown=true;},snapshot:()=>value};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [verb,runFlag,runDir,idFlag,operationId]=process.argv.slice(2);
 try{
  if(verb!=='readback'||runFlag!=='--run-dir'||idFlag!=='--operation-id')throw Error('NATIVE_READBACK_ARGUMENT_INVALID');
  const value=readNativeOperation(runDir,operationId);
  process.stdout.write(JSON.stringify(value)+'\n');if(value.execution_stopped!==true)process.exitCode=1;
 }catch{process.stdout.write(JSON.stringify({status:'unknown',execution_stopped:false})+'\n');process.exitCode=1;}
}
