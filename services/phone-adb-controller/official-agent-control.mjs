// Parent-only authority transport. Launch, stop and Worker execution remain unsupported.
import {request as requestHttp} from 'node:http';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,writeSync,fsyncSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {canonical} from './runtime-definition.mjs';
import {verifyRpcSource} from './leadgen-rpc.mjs';
import {verifySkillRequest,skillAuthority} from './leadgen-skill-agent.mjs';

const failure=code=>Object.assign(Error(code),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function defaultCredential(){
 const path=join(homedir(),'.credentials/cecelia-internal.env'),stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600)throw failure('OFFICIAL_CONTROL_CREDENTIAL');
 const matches=[...readFileSync(path,'utf8').matchAll(/^(?:export )?CECELIA_INTERNAL_TOKEN=(.+)$/gm)];
 if(matches.length!==1)throw failure('OFFICIAL_CONTROL_CREDENTIAL');
 const value=matches[0][1].trim().replace(/^(['"])(.*)\1$/,'$2');
 if(!value||/[\r\n]/.test(value))throw failure('OFFICIAL_CONTROL_CREDENTIAL');return value;
}

export function createOfficialAgentControl({source,runtimeRoot,request,home=homedir(),journalDirectory,deadlineMs,cleanupDeadlineMs=deadlineMs,credential=defaultCredential,httpRequest=requestHttp}={}){
 const fixed=structuredClone(request),fixedSource=structuredClone(source);
 if(fixed?.mode!=='execute'||fixed.broker_host!=='mmv'||!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(fixed.workflow_key)
  ||fixed.protocol!=='leadgen-activity-v1'||!/^[a-f0-9]{48}$/.test(fixed.nonce||'')||!/^\w[\w.-]{0,150}$/.test(fixed.run_id||'')
  ||fixed.source_commit!==fixedSource?.commit||!/^[a-f0-9]{40}$/.test(fixed.source_commit||'')||!Number.isSafeInteger(fixed.deadline_ms)||!Number.isSafeInteger(deadlineMs)
  ||!Number.isSafeInteger(cleanupDeadlineMs)||deadlineMs>cleanupDeadlineMs||cleanupDeadlineMs>fixed.deadline_ms
  ||typeof credential!=='function'||typeof httpRequest!=='function')throw failure('OFFICIAL_CONTROL_SCOPE');
 for(const path of [runtimeRoot,home,journalDirectory])if(typeof path!=='string'||!path.startsWith('/'))throw failure('OFFICIAL_CONTROL_SCOPE');
 if(realpathSync(runtimeRoot)!==realpathSync(dirname(fileURLToPath(import.meta.url))))throw failure('OFFICIAL_CONTROL_SOURCE');
 const stat=lstatSync(journalDirectory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)||realpathSync(journalDirectory)!==resolve(journalDirectory))throw failure('OFFICIAL_CONTROL_JOURNAL');
 const ledger=join(journalDirectory,'official-authority-'+randomUUID()+'.jsonl');
 let sealed=false,epoch=0,tainted=false,journalClosed=false,closing;const jobs=new Set();
 let descriptor,identity;
 try{
  descriptor=openSync(ledger,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);identity=fstatSync(descriptor);
  const parent=openSync(journalDirectory,constants.O_RDONLY|constants.O_DIRECTORY);
  try{fsyncSync(parent);}finally{closeSync(parent);}
 }catch{
  if(descriptor!==undefined)try{closeSync(descriptor);}catch{}
  throw failure('OFFICIAL_CONTROL_JOURNAL');
 }
 const snapshot=()=>Object.freeze({sealed,pending:jobs.size,execution_stopped:sealed&&jobs.size===0&&!tainted&&journalClosed,execution_unknown:tainted||jobs.size>0});
 const record=value=>{try{
  const current=lstatSync(ledger),opened=fstatSync(descriptor);
  if(journalClosed||!current.isFile()||current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||opened.dev!==identity.dev||opened.ino!==identity.ino||current.nlink!==1||current.uid!==process.getuid()||(current.mode&0o777)!==0o600)throw Error();
  const bytes=Buffer.from(JSON.stringify(value)+'\n');let offset=0;
  while(offset<bytes.length){const written=writeSync(descriptor,bytes,offset,bytes.length-offset);if(written<1)throw Error();offset+=written;}
  fsyncSync(descriptor);
 }catch{tainted=true;throw failure('OFFICIAL_CONTROL_JOURNAL');}};
 const guard=e=>{if(tainted)throw failure('OFFICIAL_CONTROL_UNKNOWN');if(sealed||e!==epoch)throw failure('OFFICIAL_CONTROL_CLOSED');if(Date.now()>=deadlineMs)throw failure('OFFICIAL_CONTROL_DEADLINE');};
 function verify(){
  const own=fixedSource.files?.filter(file=>file.path==='official-agent-control.mjs');
  if(own?.length!==1||hash(readFileSync(join(runtimeRoot,own[0].path)))!==own[0].sha256)throw failure('OFFICIAL_CONTROL_SOURCE');
  try{verifyRpcSource(fixedSource,{base:runtimeRoot});}catch{throw failure('OFFICIAL_CONTROL_SOURCE');}
 }
 function readCentral(path,e,job){
  guard(e);
  if(typeof path!=='string'||path.split('/').some(part=>part==='.'||part==='..')||path.includes('%')||!/^\/api\/brain\/(?:runs\/[^/?#]+\/definition|tasks\/[a-f0-9-]{36}|workflows\/[^/?#]+\/versions\/[^/?#]+|activities\/[^/?#]+\/versions\/[^/?#]+)$/.test(path))throw failure('OFFICIAL_CONTROL_SCOPE');
  const token=credential();if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw failure('OFFICIAL_CONTROL_CREDENTIAL');
  guard(e);record({event:'read_intent',path,epoch:e});
  return new Promise((resolveRead,rejectRead)=>{
   let req,res,socket,requestClosed=false,responseClosed=true,socketClosed=true,error,value,ended=false,bytes=0;
   const chunks=[];let finished=false;
   const finish=()=>{
    if(finished||!requestClosed||!responseClosed||!socketClosed)return;
    finished=true;job.cancelRead=null;
    try{
     guard(e);if(error)throw error;if(!ended)throw failure('OFFICIAL_CONTROL_READ');
     record({event:'read_returned',path,epoch:e,bytes});resolveRead(value);
    }catch(cause){rejectRead(cause);}
   };
   const abort=cause=>{error??=cause;res?.destroy();socket?.destroy();req?.destroy();};
   job.cancelRead=()=>abort(failure('OFFICIAL_CONTROL_CLOSED'));
   try{
    req=httpRequest({protocol:'http:',hostname:'127.0.0.1',port:5221,method:'GET',path,agent:false,headers:{'X-Internal-Token':token,Connection:'close'}},response=>{
     res=response;responseClosed=false;
     res.once('close',()=>{responseClosed=true;finish();});
     res.once('error',()=>abort(failure('OFFICIAL_CONTROL_READ')));
     res.once('aborted',()=>abort(failure('OFFICIAL_CONTROL_READ')));
     try{guard(e);}catch(cause){abort(cause);return;}
     if(res.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(String(res.headers['content-type']||''))){abort(failure('OFFICIAL_CONTROL_READ'));return;}
     res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){abort(failure('OFFICIAL_CONTROL_LIMIT'));return;}chunks.push(chunk);});
     res.once('end',()=>{try{guard(e);value=JSON.parse(Buffer.concat(chunks).toString('utf8'));ended=true;}catch{error??=failure('OFFICIAL_CONTROL_READ');}finish();});
    });
    req.once('socket',owned=>{socket=owned;socketClosed=false;socket.once('close',()=>{socketClosed=true;finish();});if(sealed||e!==epoch)abort(failure('OFFICIAL_CONTROL_CLOSED'));});
    req.once('close',()=>{requestClosed=true;finish();});
    req.once('error',()=>{error??=failure('OFFICIAL_CONTROL_READ');});
    req.end();
   }catch{
    tainted=true;abort(failure('OFFICIAL_CONTROL_READ'));
    // No returned request handle means native allocation cannot be certified.
    if(!req){job.cancelRead=null;rejectRead(failure('OFFICIAL_CONTROL_UNKNOWN'));}
   }
  });
 }
 async function requestAuthority(body){
  guard(epoch);
  if(body?.kind!=='activity_skill_authority')throw failure('OFFICIAL_CONTROL_UNSUPPORTED');
  if(!body||Object.keys(body).sort().join(',')!=='kind,request'||canonical(body.request)!==canonical(fixed))throw failure('OFFICIAL_CONTROL_SCOPE');
  verify();guard(epoch);const e=epoch,job={cancelRead:null};jobs.add(job);
  let interrupt;const interrupted=new Promise((_,reject)=>{interrupt=reject;});
  job.cancel=code=>{interrupt(failure(code));job.cancelRead?.();};
  job.done=(async()=>{
   const timer=setTimeout(()=>{job.cancel('OFFICIAL_CONTROL_DEADLINE');},Math.max(1,deadlineMs-Date.now()));
   try{
    await verifySkillRequest(fixed,{get:path=>readCentral(path,e,job)});guard(e);verify();
    const authorized=skillAuthority(fixed,{home});guard(e);
    record({event:'authority_returned',epoch:e,authorized,request_sha256:hash(canonical(fixed))});
    return {ok:true,authorized};
   }finally{clearTimeout(timer);jobs.delete(job);}
  })();
  // Stop delivery immediately while retaining the actual native pipeline in jobs.
  return Promise.race([job.done,interrupted]);
 }
 async function close(){
  if(!closing){
   sealed=true;epoch++;for(const job of jobs)job.cancel('OFFICIAL_CONTROL_CLOSED');
   closing=(async()=>{
    let timer;
    try{await Promise.race([Promise.allSettled([...jobs].map(job=>job.done)),new Promise(resolveClose=>{timer=setTimeout(()=>{tainted=true;resolveClose();},Math.max(0,cleanupDeadlineMs-Date.now()));})]);}
    finally{clearTimeout(timer);try{closeSync(descriptor);journalClosed=true;}catch{tainted=true;}}
   })();
  }
  await closing;return snapshot();
 }
 return Object.freeze({request:requestAuthority,snapshot,close});
}
