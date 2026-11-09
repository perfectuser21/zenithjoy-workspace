// Observer-only owner locks. The legacy owner protocol and mutations are reused.
import {spawn} from 'node:child_process';
import {openSync,closeSync,fstatSync,lstatSync,readFileSync,realpathSync,constants} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {COMMANDER_OWNER_LOCK_PYTHON} from './commander-owner-lock.mjs';
import {reserveWorkflowCommanderTurn} from './commander-owner-state.mjs';

const fail=()=>Object.assign(Error('COMMANDER_OWNER_BOUNDED_UNVERIFIED'),{executionStopped:false});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['commander-bounded-owner.mjs','commander-owner-lock.mjs','commander-owner-state.mjs','activity-commander.mjs','official-skill-owner.mjs'];
const profile='(version 1)(allow default)(deny process-fork)';

export function createBoundedCommanderOwner({runtimeRoot,source,python,deadlineMs,cleanupDeadlineMs=deadlineMs}={}){
 const fixed=structuredClone(source),py=structuredClone(python);
 if(process.platform!=='darwin'||typeof runtimeRoot!=='string'||realpathSync(runtimeRoot)!==runtimeRoot
  ||runtimeRoot!==dirname(fileURLToPath(import.meta.url))||!/^[a-f0-9]{40}$/.test(fixed?.commit||'')
  ||!Array.isArray(fixed.files)||!Number.isSafeInteger(deadlineMs)||!Number.isSafeInteger(cleanupDeadlineMs)
  ||deadlineMs>=cleanupDeadlineMs||Date.now()>=deadlineMs)throw fail();
 const verify=()=>{
  for(const path of files){
   const entries=fixed.files.filter(entry=>entry.path===path),target=join(runtimeRoot,path),stat=lstatSync(target);
   if(entries.length!==1||!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o022)||sha(readFileSync(target))!==entries[0].sha256)throw fail();
  }
  if(!isAbsolute(py?.path||'')||realpathSync(py.path)!==py.path||!/^[a-f0-9]{64}$/.test(py.sha256||''))throw fail();
  const stat=lstatSync(py.path);if(!stat.isFile()||(stat.mode&0o022)||sha(readFileSync(py.path))!==py.sha256)throw fail();
 };
 verify();
 let sealed=false,unknown=false,calibration,calibrating,closing,identityKey;const leaves=[];
 const active=()=>{if(sealed||unknown||Date.now()>=deadlineMs)throw fail();verify();};
 function launch(args,{purpose,fd=null,guard,runDeadline=deadlineMs,closeDeadline=cleanupDeadlineMs,probe=false}={}){
  const state={purpose,pid:null,ready:false,process_closed:false,stdin_closed:false,stdout_closed:false,stderr_closed:false,
   fd_closed:fd===null,closing:probe,unknown:false,code:null,signal:null};
  let child,output='',stderr='',sequence=0,identity,readyResolve,readyReject,closedResolve,opTimer,killTimer,hardTimer,readyTimer;
  const waiting=new Map(),ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  ready.catch(()=>{});
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const nativeClosed=()=>state.process_closed&&state.stdin_closed&&state.stdout_closed&&state.stderr_closed;
  const snapshot=()=>({...state});
  const poison=()=>{unknown=true;state.unknown=true;readyReject(fail());for(const pending of waiting.values())pending.reject(fail());waiting.clear();};
  const finish=()=>{
   if(!state.closing||!nativeClosed())return;
   if(!state.fd_closed){try{closeSync(fd);state.fd_closed=true;}catch{poison();}}
   if(state.fd_closed){clearTimeout(opTimer);clearTimeout(killTimer);clearTimeout(hardTimer);clearTimeout(readyTimer);closedResolve(snapshot());}
  };
  const shutdown=()=>{
   if(!state.closing){state.closing=true;child?.stdin.end();}
   if(!nativeClosed()&&!killTimer)killTimer=setTimeout(()=>{child?.kill('SIGKILL');},Math.max(0,closeDeadline-Date.now()-100));
   finish();return closed;
  };
  const leaf={state,ready,closed,snapshot,shutdown,stderr:()=>stderr};leaves.push(leaf);
  hardTimer=setTimeout(()=>{if(!nativeClosed()||!state.fd_closed){poison();child?.kill('SIGKILL');}finish();closedResolve(snapshot());},Math.max(0,closeDeadline-Date.now()));
  opTimer=setTimeout(()=>{if((probe||!state.closing)&&!nativeClosed()){poison();shutdown();}},Math.max(0,runDeadline-Date.now()));
  if(!probe)readyTimer=setTimeout(()=>{if(!state.ready){poison();shutdown();}},Math.max(0,Math.min(5000,runDeadline-Date.now())));
  try{
   child=spawn('/usr/bin/sandbox-exec',['-p',profile,py.path,'-I','-S','-B',...args],{
    env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','pipe',...(fd===null?[]:[fd])]});
   child.once('spawn',()=>{state.pid=child.pid;});child.once('error',()=>{poison();shutdown();});
   for(const [name,stream]of [['stdin',child.stdin],['stdout',child.stdout],['stderr',child.stderr]]){
    stream.once('close',()=>{state[name+'_closed']=true;finish();});stream.on('error',()=>{poison();shutdown();});
   }
   child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>4096){poison();shutdown();}});
   child.stdout.on('data',bytes=>{
    output+=bytes;if(output.length>8192){poison();shutdown();return;}
    if(probe)return;
    while(output.includes('\n')){
     const end=output.indexOf('\n'),line=output.slice(0,end);output=output.slice(end+1);
     try{
      const q=JSON.parse(line);
      if(!state.ready){
       const actual=fstatSync(fd);
       if(q.ready!==true||q.identity?.dev!==actual.dev||q.identity?.ino!==actual.ino)throw fail();
       identity=q.identity;state.ready=true;clearTimeout(readyTimer);readyResolve(identity);
      }else{
       const pending=waiting.get(q.id);if(!pending){if(state.closing)continue;throw fail();}
       waiting.delete(q.id);q.ok===true?pending.resolve(q.result):(poison(),pending.reject(fail()));
      }
     }catch{poison();shutdown();}
    }
   });
   child.once('close',(code,signal)=>{
    state.process_closed=true;state.code=code;state.signal=signal;
    if(!probe&&(!state.closing||waiting.size))poison();
    if(!state.ready&&!probe)readyReject(fail());finish();
   });
   if(probe)child.stdin.end();
  }catch{poison();state.closing=true;}
  leaf.command=(op,body={})=>{
   try{
    active();if(state.closing||!state.ready||waiting.size||!child||state.process_closed)throw fail();
    const stat=lstatSync(guard),opened=fstatSync(fd);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)
     ||stat.dev!==identity.dev||stat.ino!==identity.ino||opened.dev!==identity.dev||opened.ino!==identity.ino)throw fail();
    const id=++sequence,line=JSON.stringify({...body,id,op})+'\n';if(Buffer.byteLength(line)>4*1024*1024)throw fail();
    return new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{poison();shutdown();},Math.max(0,Math.min(5000,runDeadline-Date.now())));
     waiting.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
     child.stdin.write(line,error=>{if(error){poison();shutdown();}});
    });
   }catch{return Promise.reject(fail());}
  };
  return leaf;
 }
 async function calibrate(){
  if(calibrating)return calibrating;
  calibrating=(async()=>{
   active();
   const positive=launch(['-c','print("owner_nofork_ready")'],{purpose:'calibration-positive',probe:true,runDeadline:Math.min(deadlineMs,Date.now()+2000),closeDeadline:Math.min(cleanupDeadlineMs,Date.now()+2500)});
   await positive.closed;active();
   const negative=launch(['-c','import os; os.fork()'],{purpose:'calibration-negative',probe:true,runDeadline:Math.min(deadlineMs,Date.now()+2000),closeDeadline:Math.min(cleanupDeadlineMs,Date.now()+2500)});
   await negative.closed;
   if(positive.state.code!==0||positive.state.signal||positive.state.unknown||negative.state.code===0||negative.state.signal||negative.state.unknown
    ||!/(Operation not permitted|Resource temporarily unavailable)/.test(negative.stderr()))throw fail();
   calibration=Object.freeze({positive_closed:true,fork_denied:true});
  })();return calibrating;
 }
 async function acquireLock(file){
  active();await calibrate();active();
  const guard=file+'.guard';if(realpathSync(dirname(guard))!==dirname(guard))throw fail();
  const fd=openSync(guard,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600),stat=fstatSync(fd);
  if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)){closeSync(fd);throw fail();}
  const leaf=launch(['-c',COMMANDER_OWNER_LOCK_PYTHON,guard],{purpose:'owner',fd,guard});
  try{await leaf.ready;active();}catch(error){await leaf.shutdown();throw error;}
  const release=()=>leaf.shutdown();release.command=leaf.command;
  release.assertHeld=()=>{if(leaf.state.closing||leaf.state.process_closed||leaf.state.unknown)throw fail();};
  return release;
 }
 const snapshot=()=>({sealed,calibration,pending:leaves.filter(leaf=>!leaf.state.fd_closed||!leaf.state.process_closed||!leaf.state.stdin_closed||!leaf.state.stdout_closed||!leaf.state.stderr_closed).length,
  execution_unknown:unknown||leaves.some(leaf=>leaf.state.unknown),execution_stopped:sealed&&!unknown&&leaves.every(leaf=>!leaf.state.unknown&&leaf.state.fd_closed&&leaf.state.process_closed&&leaf.state.stdin_closed&&leaf.state.stdout_closed&&leaf.state.stderr_closed),
  leaves:leaves.map(leaf=>leaf.snapshot())});
 return Object.freeze({
  reserveOwner:async(scope,options)=>{
   active();if(scope?.source_commit!==fixed.commit||scope.commander_role!=='observer')throw fail();
   const key=JSON.stringify(['workflow_key','run_id','binding_id','source_commit','task_id','commander_role'].map(name=>scope[name]??null));
   if(identityKey!==undefined&&identityKey!==key)throw fail();identityKey=key;
   return reserveWorkflowCommanderTurn(scope,{...options,acquireLock});
  },snapshot,
  close:()=>closing??=(async()=>{sealed=true;await Promise.all(leaves.map(leaf=>leaf.shutdown()));return snapshot();})(),
 });
}
