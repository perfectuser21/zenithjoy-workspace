// Parent-only authority transport. Launch, stop and Worker execution remain unsupported.
import {request as requestHttp} from 'node:http';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,writeSync,fsyncSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {canonical} from './runtime-definition.mjs';
import {verifyRpcSource} from './leadgen-rpc.mjs';
import {verifySkillRequest,skillAuthority,skillExecutionIdentity} from './leadgen-skill-agent.mjs';

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

export function createOfficialAgentControl({source,runtimeRoot,request,home=homedir(),journalDirectory,deadlineMs,cleanupDeadlineMs=deadlineMs,credential=defaultCredential,httpRequest=requestHttp,gatewayDependencies,gatewayCredential}={}){
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
 function gatewayToken(){
  if(gatewayCredential)return gatewayCredential();
  const path=join(homedir(),'.credentials/mmv-official-gateway.env'),st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600)throw failure('OFFICIAL_CONTROL_GATEWAY_CREDENTIAL');
  const matches=[...readFileSync(path,'utf8').matchAll(/^OPENCLAW_GATEWAY_TOKEN=([^\r\n]+)$/gm)];if(matches.length!==1)throw failure('OFFICIAL_CONTROL_GATEWAY_CREDENTIAL');return matches[0][1];
 }
 async function gatewayRead(method,params,e,job){
  guard(e);let deps;
  try{deps=typeof gatewayDependencies==='function'?await gatewayDependencies({runtimeRoot,source:fixedSource}):gatewayDependencies;
   if(!deps){const loader=await import('./official-gateway-dependencies.mjs');deps=await loader.loadOfficialGatewayDependencies({runtimeRoot,source:fixedSource});}
  }catch{throw failure('OFFICIAL_CONTROL_GATEWAY_DEPENDENCIES');}
  guard(e);if(typeof deps?.GatewayProtocolClient!=='function'||typeof deps?.WebSocket!=='function'||typeof deps?.rawDataToString!=='function')throw failure('OFFICIAL_CONTROL_GATEWAY_DEPENDENCIES');
  const token=gatewayToken();if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw failure('OFFICIAL_CONTROL_GATEWAY_CREDENTIAL');
  let ws,request,socket,client,requestClosed=false,websocketClosed=false,socketClosed=false,created=false;
  let resolveHello,rejectHello,resolveClosed;const hello=new Promise((r,j)=>{resolveHello=r;rejectHello=j;}),closed=new Promise(r=>resolveClosed=r);
  const marks=()=>({request_closed:requestClosed,websocket_closed:websocketClosed,socket_closed:socketClosed});
  const checkClosed=()=>{if(Object.values(marks()).every(Boolean))resolveClosed();};
  const abort=()=>{rejectHello(failure('OFFICIAL_CONTROL_CLOSED'));client?.stop();ws?.terminate();request?.destroy();socket?.destroy();};job.cancelRead=abort;
  record({event:'gateway_read_intent',method,epoch:e});
  let value,error;
  try{
   guard(e);client=new deps.GatewayProtocolClient({createSocket(handlers){
    guard(e);created=true;
    try{
     ws=new deps.WebSocket('ws://127.0.0.1:18789',{handshakeTimeout:Math.max(1,deadlineMs-Date.now()),followRedirects:false,perMessageDeflate:false,maxPayload:2*1024*1024});
     request=ws._req;if(!request)throw failure('OFFICIAL_CONTROL_GATEWAY_ALLOCATION');
     request.once('close',()=>{requestClosed=true;checkClosed();});
     request.once('socket',s=>{socket=s;socket.once('close',()=>{socketClosed=true;checkClosed();});if(sealed||e!==epoch)s.destroy();});
     ws.on('open',handlers.open);ws.on('message',data=>handlers.message(deps.rawDataToString(data)));
     ws.on('close',(code,reason)=>{websocketClosed=true;checkClosed();handlers.close(code,reason.toString());});
     ws.on('error',()=>{handlers.error(failure('OFFICIAL_CONTROL_GATEWAY_IO'));rejectHello(failure('OFFICIAL_CONTROL_GATEWAY_IO'));});
     return {isOpen:()=>ws.readyState===deps.WebSocket.OPEN,send(data){guard(e);let f;try{f=JSON.parse(data);}catch{throw failure('OFFICIAL_CONTROL_GATEWAY_FRAME');}
      if(f.type!=='req'||!['connect',method].includes(f.method))throw failure('OFFICIAL_CONTROL_GATEWAY_FRAME');ws.send(data);},close:(code,reason)=>ws.close(code,reason)};
    }catch{tainted=true;abort();throw failure('OFFICIAL_CONTROL_GATEWAY_ALLOCATION');}
   },createRequestId:randomUUID,buildConnectPlan:context=>{guard(e);if(typeof context.nonce!=='string'||!context.nonce||!Number.isSafeInteger(context.challengeTs))throw failure('OFFICIAL_CONTROL_GATEWAY_CHALLENGE');return context;},
   buildConnectParams:()=>({minProtocol:4,maxProtocol:4,client:{id:'cli',version:'2026.8.1',platform:process.platform,mode:'cli',instanceId:randomUUID()},role:'operator',scopes:['operator.read'],caps:[],auth:{token}}),
   onHello:resolveHello,onConnectError:()=>rejectHello(failure('OFFICIAL_CONTROL_GATEWAY_AUTH')),onSocketFactoryError:()=>rejectHello(failure('OFFICIAL_CONTROL_GATEWAY_ALLOCATION')),onParseError:()=>rejectHello(failure('OFFICIAL_CONTROL_GATEWAY_PROTOCOL')),
   resolveClose:()=>({retry:false,notify:true}),onClose:()=>rejectHello(failure('OFFICIAL_CONTROL_GATEWAY_IO')),
   handshake:{mode:'require-challenge',timeoutMs:Math.max(1,deadlineMs-Date.now())},reconnect:{initialMs:100,multiplier:1,maxMs:100},requestTimeoutMs:Math.max(1,deadlineMs-Date.now())});
   client.start();const accepted=await hello;guard(e);
   if(accepted.protocol!==4||accepted.auth?.role!=='operator'||JSON.stringify(accepted.auth?.scopes)!==JSON.stringify(['operator.read']))throw failure('OFFICIAL_CONTROL_GATEWAY_AUTH');
   value=await client.request(method,params,{timeoutMs:Math.max(1,deadlineMs-Date.now())});guard(e);
  }catch(cause){error=/^OFFICIAL_CONTROL_/.test(cause?.code||'')?cause:failure('OFFICIAL_CONTROL_GATEWAY_READ');}
  finally{
   client?.stop();if(ws&&!websocketClosed)ws.terminate();
   if(created){let timer;const returned=await Promise.race([closed.then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),Math.max(0,cleanupDeadlineMs-Date.now()));})]);clearTimeout(timer);if(!returned){tainted=true;error??=failure('OFFICIAL_CONTROL_UNKNOWN');}}
   job.cancelRead=null;record({event:'gateway_read_closed',method,epoch:e,...marks()});
  }
  guard(e);if(error)throw error;record({event:'gateway_read_returned',method,epoch:e});return value;
 }
 async function readOfficial(body){
  guard(epoch);if(body?.operation!=='sessions.list')throw failure('OFFICIAL_CONTROL_UNSUPPORTED');
  if(Object.keys(body).sort().join(',')!=='kind,operation,request'||canonical(body.request)!==canonical(fixed))throw failure('OFFICIAL_CONTROL_SCOPE');
  verify();const e=epoch,job={cancelRead:null};jobs.add(job);let interrupt;const interrupted=new Promise((_,reject)=>{interrupt=reject;});job.cancel=code=>{interrupt(failure(code));job.cancelRead?.();};
  job.done=(async()=>{const timer=setTimeout(()=>job.cancel('OFFICIAL_CONTROL_DEADLINE'),Math.max(1,deadlineMs-Date.now()));
   try{await verifySkillRequest(fixed,{get:path=>readCentral(path,e,job)});guard(e);verify();const bound=skillExecutionIdentity(fixed,{home});guard(e);
    const started=Date.now(),result=await gatewayRead('sessions.list',{agentId:'skill-factory',search:bound.child_session_key,limit:5,archived:'all',includeLastMessage:false,includeDerivedTitles:false,includeActivitySummary:false},e,job);guard(e);
    if(!Number.isFinite(result?.ts)||result.ts<started-1000||result.ts>Date.now()+1000||!Array.isArray(result.sessions))throw failure('OFFICIAL_CONTROL_GATEWAY_RESPONSE');
    const rows=result.sessions.filter(row=>row?.key===bound.child_session_key);if(rows.length>1)throw failure('OFFICIAL_CONTROL_GATEWAY_RESPONSE');
    return {ok:true,official_terminal_proof:false,ts:result.ts,sessions:rows.map(row=>({key:row.key,sessionId:row.sessionId,updatedAt:row.updatedAt}))};
   }finally{clearTimeout(timer);jobs.delete(job);}
  })();return Promise.race([job.done,interrupted]);
 }
 async function requestAuthority(body){
  guard(epoch);
  if(body?.kind==='official_agent_read')return readOfficial(body);
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
