// 103固定模型/CRM HTTP、原严格解析器与原订单锁；无任意URL或程序入口。
import {request as httpsRequest} from 'node:https';import {request as httpRequest} from 'node:http';import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {readFileSync,lstatSync,realpathSync,openSync,writeSync,fsyncSync,closeSync,readdirSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {verifyRpcSource} from './leadgen-rpc.mjs';
const require=createRequire(import.meta.url),evidence=require('./queued-recipient-evidence.js'),{decodeXmlEntities}=require('./nickname-match-lib.js'),routes=require('./line-routes.js');
const fail=reason=>Object.assign(Error('NATIVE_103_'+reason),{code:'NATIVE_103_'+reason});
const sha=b=>createHash('sha256').update(b).digest('hex'),canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort().map(k=>[k,x[k]])):x);
const dependencyBrands=new WeakMap();export const nativeScoringDependenciesMatch=(value,source)=>dependencyBrands.get(value)===canonical(source);
const sandbox='(version 1)(allow default)(deny process-fork)';
export async function startNativeScoringProducers({root,source,scope,directory,python,deadlineMs,receiptDeadlineMs,requestImpl=(url,options,callback)=>(new URL(url).protocol==='http:'?httpRequest:httpsRequest)(url,options,callback),readSource,brainCredential,assertAuthority,deferNative=false,readOnly=false}={}){
 const src=structuredClone(source),fixed=structuredClone(scope),py=structuredClone(python),route=routes.routeOf(fixed?.line);
 if(realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||src?.commit!==fixed?.source_commit||fixed?.serial!=='none'||fixed?.profile!=='mmv-scoring'||!fixed.task_id||!fixed.binding_id||!Number.isSafeInteger(deadlineMs)||deadlineMs>=receiptDeadlineMs||Date.now()>=deadlineMs)throw fail('PRODUCER_SCOPE');
 const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||readdirSync(directory).length)throw fail('PRODUCER_PREVIOUS_UNKNOWN');
 let sealed=false,unknown=false,effectUnknown=false,closed=false,closing;const http=[],native=[],pending=new Set(),parsed=new Map();
 const verify=()=>{
  try{verifyRpcSource(src,{base:root,...(readSource?{read:readSource}:{})});for(const name of ['native-scoring-producers.mjs','queued-recipient-evidence.js','outreach-order-lock.py']){const rows=src.files.filter(f=>f.path===name);if(rows.length!==1||sha(readFileSync(join(root,name)))!==rows[0].sha256)throw Error();}if(realpathSync(py.path)!==py.path||sha(readFileSync(py.path))!==py.sha256)throw Error();const s=lstatSync(py.path);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022))throw Error();}catch{throw fail('PRODUCER_SOURCE');}
 };verify();
 const log=join(directory,'producer.jsonl'),fd=openSync(log,'wx',0o600);let text='';
 const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
 const record=value=>{if(closed){unknown=true;throw fail('PRODUCER_JOURNAL');}const line=JSON.stringify(value)+'\n';writeSync(fd,line);fsyncSync(fd);text+=line;};
 const check=()=>{if(sealed||Date.now()>=deadlineMs)throw fail('HTTP_CLOSED');if(unknown)throw fail('PRODUCER_UNKNOWN');verify();if(readFileSync(log,'utf8')!==text)throw fail('PRODUCER_JOURNAL');if(sealed||Date.now()>=deadlineMs)throw fail('HTTP_CLOSED');};
 record({event:'create',task_id:fixed.task_id,binding_id:fixed.binding_id,source_commit:src.commit});
 const nativeClosed=r=>r.process_closed&&r.stdin_closed&&r.stdout_closed&&r.stderr_closed;
 const snapshot=()=>Object.freeze({domain:'native-103-producers/v1',sealed,pending:pending.size,execution_stopped:sealed&&!unknown&&pending.size===0&&http.every(r=>r.request_closed&&r.response_closed&&r.socket_closed)&&native.every(nativeClosed),execution_unknown:unknown||pending.size>0,external_effect:effectUnknown?'unknown':http.some(r=>r.post&&r.dispatched)?'observed':'none',http:http.map(r=>({...r})),native:native.map(r=>({...r})),calibration:calibration&&{...calibration}});
 function leaf(program,args,input,{readyLine=null,probe=false}={}){
  check();const id=randomUUID(),r={id,pid:null,process_closed:false,stdin_closed:false,stdout_closed:false,stderr_closed:false,code:null,signal:null,ready:false};native.push(r);
  let child,out='',err='',resolveDone,rejectReady,resolveReady,settled=false,ending=false;
  const done=new Promise(resolve=>{resolveDone=resolve;}),ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const token={cancel(){unknown=true;child?.kill('SIGKILL');rejectReady(fail('PRODUCER_UNKNOWN'));}};pending.add(token);
  const finish=()=>{if(!nativeClosed(r))return;clearTimeout(timer);clearTimeout(hard);pending.delete(token);if(readyLine&&r.ready&&!ending)unknown=true;resolveDone({code:r.code,signal:r.signal,stdout:out,stderr:err});if(!r.ready)rejectReady(fail('PARSER_INVALID'));};
  const timer=setTimeout(()=>{unknown=true;child?.kill('SIGKILL');rejectReady(fail('PRODUCER_UNKNOWN'));},Math.max(1,deadlineMs-Date.now()));
  const hard=setTimeout(()=>{unknown=true;child?.kill('SIGKILL');rejectReady(fail('PRODUCER_UNKNOWN'));if(!settled){settled=true;resolveDone({unverified:true});}},Math.max(1,receiptDeadlineMs-Date.now()));
  record({event:'native-intent',id,purpose:readyLine?'order-lock':probe?'calibration':'recipient-parser'});
  check(); // durable fsync/Source检查耗时不能授截止后的新spawn。
  try{child=spawn(program,args,{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:directory,LANG:'en_US.UTF-8'}});r.pid=child.pid??null;}
  catch{unknown=true;clearTimeout(timer);clearTimeout(hard);pending.delete(token);throw fail('PRODUCER_UNKNOWN');}
  child.stdin.on('error',()=>{});for(const [stream,key] of [[child.stdin,'stdin_closed'],[child.stdout,'stdout_closed'],[child.stderr,'stderr_closed']])stream.once('close',()=>{r[key]=true;finish();});
  child.once('error',()=>{unknown=true;rejectReady(fail('PRODUCER_UNKNOWN'));});child.once('close',(code,signal)=>{r.process_closed=true;r.code=code;r.signal=signal;finish();});
  child.stdout.on('data',chunk=>{out+=chunk;if(Buffer.byteLength(out)>2*1024*1024){token.cancel();return;}if(readyLine&&out===readyLine&&!r.ready){r.ready=true;resolveReady();}});
  child.stderr.on('data',chunk=>{err+=chunk;if(Buffer.byteLength(err)>32000)token.cancel();});
  if(readyLine){child.stdin.write(input??'');}else{ending=true;child.stdin.end(input??'');}
  return {r,ready,done,end(){ending=true;child.stdin.end();},cancel:token.cancel};
 }
 let calibration,calibrating;
 async function prepareNative(){
 if(calibration)return calibration;if(calibrating)return calibrating;
 calibrating=(async()=>{check();
 if(process.platform!=='darwin')throw fail('PRODUCER_NOFORK_UNSUPPORTED');
 try{
  const code='import os,sys\ntry:\n p=os.fork()\nexcept OSError:\n sys.exit(7)\nif p==0: os._exit(0)\nos.waitpid(p,0)\n';
  const baseline=await leaf(py.path,['-I','-S','-c',code],null,{probe:true}).done;
  if(baseline.code!==0||baseline.signal)throw Error();
  const denied=await leaf('/usr/bin/sandbox-exec',['-p',sandbox,py.path,'-I','-S','-c',code],null,{probe:true}).done;
  if(denied.code!==7||denied.signal)throw Error();calibration={fork_positive:true,fork_denied:true};
 }catch{unknown=true;await close();throw fail('PRODUCER_CALIBRATION');}
 return calibration;})();return calibrating;
 }
 if(!deferNative)await prepareNative();
 function permit(url,method,body){
  if(readOnly&&method!=='GET')throw fail('READONLY_POST');
  const u=new URL(url);if(u.hash||u.username||u.password)throw fail('HTTP_SCOPE');
  if(u.origin==='http://127.0.0.1:5221'&&method==='GET'){
   if(u.pathname==='/api/brain/tasks/'+fixed.task_id&&!u.search)return;
   if(typeof fixed.source_run==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(fixed.source_run)){
    const prefix='/api/brain/runs/douyin_video_processing-'+fixed.source_run+'__a1';
    if([prefix+'/definition',prefix+'/reconciliation'].includes(u.pathname)&&!u.search||u.pathname===prefix&&u.search==='?include=spans')return;
   }
  }
  if(u.port)throw fail('HTTP_SCOPE');
  if(u.origin==='https://openrouter.ai'&&method==='POST'&&((u.pathname==='/api/alpha/decisions'&&body?.model==='typesafe/jev-1.13')||(u.pathname==='/api/v1/chat/completions'&&body?.model==='google/gemini-2.5-flash'))&&!u.search)return;
  if(u.origin==='https://open.feishu.cn'){
   if(method==='POST'&&u.pathname==='/open-apis/auth/v3/tenant_access_token/internal'&&!u.search)return;
   const prefix=`/open-apis/bitable/v1/apps/${route.base}/tables/${route.lead}`;
   if(method==='GET'&&new RegExp('^'+prefix+'/(records|fields)(/rec[A-Za-z0-9]+)?$').test(u.pathname)&&[...u.searchParams.keys()].every(k=>['page_size','page_token','automatic_fields'].includes(k)))return;
   if(method==='POST'&&u.pathname===prefix+'/records'&&!u.search)return;
  }
  throw fail('HTTP_SCOPE');
 }
 async function jsonRequest(url,opts={}){
  const method=opts.method||'GET',body=opts.body===undefined?undefined:JSON.parse(opts.body);permit(url,method,body);check();if(effectUnknown&&method!=='GET')throw fail('HTTP_UNKNOWN');
  const r={id:randomUUID(),post:method==='POST',dispatched:false,not_started:false,request_closed:false,response_closed:true,socket_closed:true,response_received:false};http.push(r);
  let req,res,socket,output='',ended=false,final=false,completing=false,resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;}),token={cancel(){if(final)return;final=true;opts.signal?.removeEventListener('abort',token.cancel);if(r.post&&r.dispatched)effectUnknown=true;req?.destroy();res?.destroy();socket?.destroy();rejectDone(fail('HTTP_CLOSED'));}};pending.add(token);
  const authority=async()=>{if(assertAuthority!==undefined&&await assertAuthority()!==true)throw fail('AUTHORITY');};
  const finish=()=>{if(completing||!(r.request_closed&&r.response_closed&&r.socket_closed))return;completing=true;
   (async()=>{try{if(!ended)throw fail('HTTP_UNKNOWN');await authority();check();if(final)return;const value=JSON.parse(output);final=true;resolveDone({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,body:value});}catch{if(r.post&&r.dispatched)effectUnknown=true;if(!final){final=true;rejectDone(fail('HTTP_UNKNOWN'));}}finally{opts.signal?.removeEventListener('abort',token.cancel);clearTimeout(timer);clearTimeout(hard);pending.delete(token);}})();
  };
  const bad=()=>{if(final)return;if(r.post&&r.dispatched)effectUnknown=true;req?.destroy();res?.destroy();socket?.destroy();};
  const timer=setTimeout(token.cancel,Math.max(1,deadlineMs-Date.now())),hard=setTimeout(()=>{if(pending.has(token)){unknown=true;token.cancel();}},Math.max(1,receiptDeadlineMs-Date.now()));
  record({event:'http-intent',id:r.id,method,origin:new URL(url).origin,path:new URL(url).pathname,body_sha256:opts.body?sha(opts.body):null});
  (async()=>{try{
   await authority();check();if(final)throw fail('HTTP_CLOSED');
   // Last check follows durable intent and awaited authority; no late dispatch.
   check();r.dispatched=true;
   req=requestImpl(url,{method,headers:{Connection:'close',...(opts.headers||{})},agent:false},response=>{res=response;r.response_received=true;r.response_closed=false;res.once('close',()=>{r.response_closed=true;finish();});res.on('error',bad);res.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>2*1024*1024)bad();});res.once('end',()=>{ended=true;finish();});});
   req.once('socket',s=>{socket=s;r.socket_closed=false;s.once('close',()=>{r.socket_closed=true;finish();});});
   req.once('close',()=>{r.request_closed=true;finish();});req.once('error',bad);opts.signal?.addEventListener('abort',token.cancel,{once:true});if(opts.signal?.aborted)token.cancel();else req.end(opts.body);
  }catch{if(!r.dispatched){r.not_started=true;r.request_closed=true;clearTimeout(timer);clearTimeout(hard);pending.delete(token);if(!final){final=true;rejectDone(fail('HTTP_CLOSED'));}}else{unknown=true;if(!req){r.request_closed=true;finish();}token.cancel();}}})();
  return done;
 }

 const httpPost=async(url,body,key,options={})=>{const r=await jsonRequest(url,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:options?.signal});return {...r.body,...(!r.ok?{error:r.body.error||{code:r.status,message:'upstream rejected'}}:{})};};
 const fetcher=async(url,options)=>{const r=await jsonRequest(url,options);return {ok:r.ok,status:r.status,json:async()=>structuredClone(r.body),text:async()=>JSON.stringify(r.body)};};
 const readTask=async()=>{check();if(typeof brainCredential!=='function')throw fail('DEPENDENCY');const key=brainCredential();if(typeof key!=='string'||!key||/[\r\n]/.test(key))throw fail('DEPENDENCY');const result=await jsonRequest('http://127.0.0.1:5221/api/brain/tasks/'+fixed.task_id,{headers:{Authorization:'Bearer '+key}});if(!result.ok)throw fail('HTTP_UNKNOWN');return structuredClone(result.body.task??result.body);};
 const parseKey=(profile,returned,s)=>sha(canonical({profile,returned,...s}));
 async function parseNative(profile,returned,options){
  check();if(!calibration)throw fail('DEPENDENCY');if(!['xml_raw','canonical'].includes(options?.commentEncoding||'canonical'))throw fail('PARSER_INVALID');
  const input={profile,returned,nickname:options.nickname,douyinId:options.douyinId,commentBody:options.commentEncoding==='xml_raw'?decodeXmlEntities(options.commentBody):options.commentBody};
  const result=await leaf('/usr/bin/sandbox-exec',['-p',sandbox,py.path,'-I','-S','-c',evidence.recipientNativePython],JSON.stringify(input)).done;check();
  if(result.code!==0||result.signal||result.unverified)throw fail('PARSER_INVALID');let value;try{value=JSON.parse(result.stdout);if(value.native_profile_verified!==true||value.returned_comment_verified!==true||!Array.isArray(value.native_profile_texts))throw Error();}catch{throw fail('PARSER_INVALID');}
  parsed.set(parseKey(profile,returned,options),structuredClone(value));return value;
 }
 const verifyRecipient=(e,s,options={})=>evidence.validateEvidence(e,s,{...options,parseNative:(profile,returned,expected)=>{check();const result=parsed.get(parseKey(profile,returned,expected));if(!result)throw fail('PARSER_RECEIPT_MISSING');return structuredClone(result);}});
 async function stageRows(rows){
  check();for(const row of rows||[]){const e=row?.recipient_evidence||row?.payload?.recipient_evidence;if(!e?.raw?.profile||!e.raw.returned)continue;const options={nickname:e.scope?.nickname,douyinId:e.scope?.douyin_id,commentBody:row.comment_body??row.payload?.comment_body,commentEncoding:e.scope?.comment_encoding};if(typeof options.commentBody!=='string')continue;await parseNative(e.raw.profile,e.raw.returned,options);}check();
 }
 let heldLock;
 async function withOrderLock(line,fn,{directory:lockDirectory=join(directory,'order-locks')}={}){
  check();if(readOnly)throw fail('READONLY_LOCK');if(!calibration)throw fail('DEPENDENCY');if(line!==route.key||heldLock)throw fail('ORDER_LOCK_SCOPE');mkdirSync(lockDirectory,{recursive:true,mode:0o700});
  const code=readFileSync(join(root,'outreach-order-lock.py'),'utf8'),target=leaf('/usr/bin/sandbox-exec',['-p',sandbox,py.path,'-I','-S','-c',code,lockDirectory,line,String(process.pid),randomUUID()],'',{readyLine:'ORDER_LOCK_READY\n'});heldLock=target;
  let readyTimer;const readyBound=new Promise((_,reject)=>{readyTimer=setTimeout(()=>{target.cancel();reject(fail('ORDER_LOCK_READY_TIMEOUT'));},Math.max(1,Math.min(5000,deadlineMs-Date.now())));});
  try{await Promise.race([target.ready,readyBound]);clearTimeout(readyTimer);check();return await fn();}finally{clearTimeout(readyTimer);target.end();const result=await target.done;heldLock=null;if(result.code!==0||result.signal||result.unverified){unknown=true;throw fail('ORDER_LOCK_STOP_UNKNOWN');}}
 }
 async function queueDependencies({apiKey,feishuCredentials,orderDirectory}={}){
  check();if(!calibration)throw fail('DEPENDENCY');if(typeof apiKey!=='string'||!apiKey||!feishuCredentials?.[route.account]?.appId||!feishuCredentials[route.account].appSecret)throw fail('DEPENDENCY');
  const model=require('./judge-comment.js'),recipient=require('./judge-recipient.js'),orders=require('./leadgen-outreach-orders.js');
  let clientPromise;
  const originalClient=()=>clientPromise??=orders.orderClient(route,{fetcher,read:()=>JSON.stringify(feishuCredentials),env:{HOME:directory},deadlineAt:deadlineMs});
  const client=Object.fromEntries(['all','fields','post','get'].map(method=>[method,async(...args)=>(await originalClient())[method](...args)]));
  const deps={judgeComment:(...args)=>model.judgeCommentOnce(...args.slice(0,3),{...args[3],apiKey,httpPost}),judgePolicy:(comment,video,profile,reason,options)=>model.judgeCommander(comment,video,profile,reason,{...options,apiKey,httpPost}),qualifyRecipient:(comment,config,options)=>recipient.qualifyRecipientFromScore(comment,config,{...options,apiKey,httpPost,verifyRecipient}),verifyRecipient,client,lock:(line,fn)=>withOrderLock(line,fn,{directory:orderDirectory}),stageRows};
  deps.reviewPolicy=(...args)=>require('./leadgen-queue.js').reviewBoundComment(...args,deps);
  deps.sampledAdmission={verifyRecipient,readProof:async sourceRun=>{
   check();if(typeof sourceRun!=='string'||sourceRun!==fixed.source_run||!/^[-A-Za-z0-9_]{1,120}$/.test(sourceRun))throw fail('SOURCE_PROOF_SCOPE');
   if(typeof brainCredential!=='function')throw fail('DEPENDENCY');const key=brainCredential();if(typeof key!=='string'||!key||/[\r\n]/.test(key))throw fail('DEPENDENCY');
   return require('./leadgen-sampled-admission.js').readRunProof(sourceRun,{read:async path=>{const result=await jsonRequest('http://127.0.0.1:5221/api/brain'+path,{headers:{Authorization:'Bearer '+key}});if(!result.ok)throw fail('SOURCE_PROOF_UNAVAILABLE');return structuredClone(result.body);}});
  }};
  deps.snapshot=snapshot;deps.close=close;
  deps.assertActive=({readOnly=false}={})=>{check();if(!readOnly&&effectUnknown)throw fail('HTTP_UNKNOWN');if(heldLock&&nativeClosed(heldLock.r)){unknown=true;throw fail('ORDER_LOCK_STOP_UNKNOWN');}};
  dependencyBrands.set(deps,canonical(src));return Object.freeze(deps);
 }
 function seal(){sealed=true;for(const token of pending)token.cancel();return snapshot();}
 async function close(){if(closing)return closing;closing=(async()=>{seal();while(pending.size&&Date.now()<receiptDeadlineMs)await new Promise(resolve=>setTimeout(resolve,Math.min(5,receiptDeadlineMs-Date.now())));if(pending.size)unknown=true;if(!pending.size&&!closed){record({event:'closed',external_effect:effectUnknown?'unknown':'observed'});closeSync(fd);closed=true;}return snapshot();})();return closing;}
 return Object.freeze({httpPost,fetcher,readTask,prepareNative,parseNative,stageRows,verifyRecipient,withOrderLock,queueDependencies,seal,close,snapshot});
}
