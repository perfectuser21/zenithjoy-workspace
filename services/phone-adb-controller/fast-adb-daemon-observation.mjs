import {spawn} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {bytes,digest} from './device-epoch-fence-reference.mjs';

const helper=fileURLToPath(new URL('./adb-daemon-observation-fast.py',import.meta.url));
const kernel=fileURLToPath(new URL('./adb-process-observation.py',import.meta.url));
const fail=code=>Object.assign(Error(code),{code});
const need=(value,code)=>{if(!value)throw fail(code);};
const env={PATH:'/usr/bin:/bin:/usr/sbin',LANG:'C',LC_ALL:'C',TZ:'UTC'};

export function openFastAdbDaemonObservation({python,frozen,deadlineMs=Date.now()+300000}) {
 need(process.platform==='darwin'&&process.arch==='arm64'&&typeof python?.path==='string'
  &&realpathSync(python.path)===python.realpath,'EPOCH_DAEMON_OBSERVER');
 const interpreter=statSync(python.realpath);
 need(interpreter.isFile()&&[0,process.getuid()].includes(interpreter.uid)&&!(interpreter.mode&0o022)
  &&digest(readFileSync(python.realpath))===python.sha256,'EPOCH_DAEMON_OBSERVER');
 const sourceFiles=new Map([[helper,frozen.files['runtime/adb-daemon-observation-fast.py']],[kernel,frozen.files['runtime/adb-process-observation.py']]]);
 const metadata=path=>{
  const s=lstatSync(path,{bigint:true});
  need(s.isFile()&&s.nlink===1n&&s.uid===BigInt(process.getuid())&&!(s.mode&0o022n),'EPOCH_DAEMON_SOURCE');
  return [s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
 };
 const pinned=new Map(),births=new Map();
 function file(path,expected) {
  const previous=pinned.get(path),observed=metadata(path);
  if(previous)need(previous.metadata===observed&&previous.expected===expected,'EPOCH_DAEMON_SOURCE');
  else {
   need(digest(bytes(path))===expected&&metadata(path)===observed,'EPOCH_DAEMON_SOURCE');
   pinned.set(path,{expected,metadata:observed});
  }
 }
 for(const [path,expected] of sourceFiles)file(path,expected);
 const child=spawn(python.path,['-I','-B',helper,kernel],{env,stdio:['pipe','pipe','ignore']});
 let pending,output='',ended=false,closing=false;
 const cancel=error=>{if(pending){const job=pending;pending=undefined;clearTimeout(job.timer);job.reject(error);}};
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>{ended=true;cancel(fail('EPOCH_DAEMON_OBSERVER'));resolve({code,signal});}));
 child.on('error',()=>cancel(fail('EPOCH_DAEMON_OBSERVER')));
 child.stdin.on('error',()=>cancel(fail('EPOCH_DAEMON_OBSERVER')));
 child.stdout.setEncoding('utf8').on('data',chunk=>{
  output+=chunk;
  if(output.length>256||!pending){cancel(fail('EPOCH_DAEMON_OBSERVER'));child.kill();return;}
  if(!output.includes('\n'))return;
  const job=pending;pending=undefined;clearTimeout(job.timer);
  try{
   const response=JSON.parse(output);output='';
   need(Object.keys(response).join(',')==='birth'&&Array.isArray(response.birth)&&response.birth.length===2
    &&response.birth.every(Number.isSafeInteger)&&response.birth[0]>0&&response.birth[1]>=0&&response.birth[1]<1000000,'EPOCH_DAEMON_IDENTITY');
   job.resolve(response.birth.join(':'));
  }catch(error){job.reject(error);}
 });
 async function read(expected){
  const port=expected?.endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/)?.[1];
  const timeout=Math.min(3000,deadlineMs-Date.now());
  need(port&&Number(port)<=65535&&Number.isSafeInteger(expected.pid)&&expected.pid>1&&expected.uid===process.getuid()
   &&!pending&&!ended&&!closing&&timeout>0,'EPOCH_DAEMON_SCOPE');
  const files=[...sourceFiles,...Object.entries(expected.source_files||{}),[expected.executable,expected.executable_sha256],[expected.policy_path,expected.policy_sha256]];
  for(const [path,digest] of files)file(path,digest);
  const {pid,uid,start_identity,command,executable}=expected;
  const birth=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cancel(fail('EPOCH_DAEMON_OBSERVER'));child.kill();},timeout);
   pending={resolve,reject,timer};child.stdin.write(JSON.stringify({pid,uid,start_identity,command,executable,port:Number(port)})+'\n');
  });
  need(!births.has(pid)||births.get(pid)===birth,'EPOCH_DAEMON_IDENTITY');births.set(pid,birth);
  for(const [path,digest] of files)file(path,digest);
  return structuredClone(expected);
 }
 async function close(verify){
  closing=true;child.stdin.end();
  const timer=setTimeout(()=>child.kill('SIGKILL'),1000);
  try{
   const result=await closed;
   if(verify){
    need(result.code===0&&!result.signal,'EPOCH_DAEMON_OBSERVER');
    for(const [path,previous] of pinned)need(metadata(path)===previous.metadata&&digest(bytes(path))===previous.expected&&metadata(path)===previous.metadata,'EPOCH_DAEMON_SOURCE');
   }
  }finally{clearTimeout(timer);}
 }
 return Object.freeze({read,close});
}
