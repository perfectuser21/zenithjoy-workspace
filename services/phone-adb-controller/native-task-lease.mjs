// Starter-only Task metadata producer. No Worker/body/result-supplied lease is accepted.
import{createHash}from'node:crypto';
import http from 'node:http';import https from 'node:https';
import{mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,lstatSync,realpathSync}from'node:fs';
import{resolve,dirname,join}from'node:path';import{userInfo}from'node:os';
const issued=new WeakMap();
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Error(`NATIVE_TASK_LEASE_${code}`);
function bindingOf(b){
 const keys=['task_id','source_commit','run_tag','claim','snapshot_sha256','scope_sha256','worker_deadline_ms','receipt_deadline_ms'];
 if(!b||Object.keys(b).sort().join()!==keys.sort().join()||!/^[-a-f0-9]{36}$/.test(b.task_id||'')||!/^[a-f0-9]{40}$/.test(b.source_commit||'')||!/^[-A-Za-z0-9_]{1,120}$/.test(b.run_tag||'')||!['snapshot_sha256','scope_sha256'].every(k=>/^[a-f0-9]{64}$/.test(b[k]||''))||!b.claim||Object.keys(b.claim).sort().join()!=='claimed_at,claimed_by'||typeof b.claim.claimed_by!=='string'||!b.claim.claimed_by||!Number.isFinite(Date.parse(b.claim.claimed_at))||!Number.isSafeInteger(b.worker_deadline_ms)||!Number.isSafeInteger(b.receipt_deadline_ms)||b.worker_deadline_ms>b.receipt_deadline_ms)throw fail('BINDING');
 return JSON.parse(canonical(b));
}
function durable(directory,name,value){const fd=openSync(join(directory,name),'wx',0o600);try{writeFileSync(fd,canonical(value));fsyncSync(fd);}finally{closeSync(fd);}const d=openSync(directory,'r');try{fsyncSync(d);}finally{closeSync(d);}}
function parentSafe(directory){let p=dirname(directory);if(realpathSync(p)!==p)throw fail('DIRECTORY');const s=lstatSync(p);if(!s.isDirectory()||s.uid!==userInfo().uid||(s.mode&0o022))throw fail('DIRECTORY');}
async function metadataRequest({origin,credential,binding,read=false}){
 const u=new URL(origin);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw fail('ORIGIN');
 const token=credential();if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw fail('CREDENTIAL');
 if(Date.now()>=binding.worker_deadline_ms)throw fail('UNKNOWN');
 const path=`/api/brain/tasks/${binding.task_id}`+(read?'':'/heartbeat'),body=read?null:Buffer.from(JSON.stringify({claimer:binding.claim.claimed_by,lease_seconds:14400}));
 return new Promise((yes,no)=>{
  let req,res,socket,timer,ended=false,requestClosed=false,responseClosed=false,socketClosed=false,error=false,settled=false,bytes=0;const chunks=[];
  const done=()=>{if(settled||!requestClosed||!socketClosed||res&&!responseClosed)return;settled=true;clearTimeout(timer);if(error||!ended)return no(fail('UNKNOWN'));let reply;try{reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return no(fail('UNKNOWN'));}yes({reply,transport:{request_closed:true,response_closed:true,socket_closed:true}});};
  const bad=()=>{if(settled)return;error=true;res?.destroy();req?.destroy();socket?.destroy();done();};
  timer=setTimeout(()=>{bad();if(!settled){settled=true;no(fail('UNKNOWN'));}},Math.max(1,Math.min(binding.worker_deadline_ms,binding.receipt_deadline_ms)-Date.now()));
  try{if(Date.now()>=binding.worker_deadline_ms)throw fail('UNKNOWN');req=(u.protocol==='https:'?https:http).request(u,{method:read?'GET':'POST',path,agent:false,headers:{Authorization:`Bearer ${token}`,...(read?{}:{'Content-Type':'application/json','Content-Length':body.length}),Connection:'close'}},r=>{res=r;r.once('error',bad);r.once('aborted',bad);r.once('close',()=>{responseClosed=true;if(!ended)error=true;done();});if(r.statusCode!==200)return bad();r.on('data',c=>{bytes+=c.length;if(bytes>65536)return bad();chunks.push(c);});r.once('end',()=>{ended=true;done();});});req.once('socket',s=>{socket=s;s.once('error',bad);s.once('close',()=>{socketClosed=true;done();});});req.once('error',bad);req.once('close',()=>{requestClosed=true;if(!socket)socketClosed=true;done();});req.end(body);}catch{error=true;requestClosed=true;socketClosed=!socket;bad();done();}
 });
}
export async function issueNativeTaskLease({directory,origin,credential,binding,readClaim}={}){
 const b=bindingOf(binding);if(typeof credential!=='function'||typeof readClaim!=='function'||resolve(directory||'')!==directory||Date.now()>=b.worker_deadline_ms)throw fail('BINDING');
 parentSafe(directory);try{mkdirSync(directory,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw fail('ALREADY_ATTEMPTED');throw fail('DIRECTORY');}
 // Existence is an exclusive lifecycle claim, including a prior intent/result write failure.
 const parent=openSync(dirname(directory),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
 durable(directory,'intent.json',{protocol:'native-task-lease/v1',binding:b,started_at:new Date().toISOString()});
 try{
  const response=await metadataRequest({origin,credential,binding:b}),r=response.reply,until=Date.parse(r?.lease_until);
  if(r?.ok!==true||!Number.isFinite(until)||until<=Date.now()||!Number.isSafeInteger(r.lease_seconds)||r.lease_seconds<1||r.lease_seconds>14400||!Number.isSafeInteger(r.heartbeat_count)||r.heartbeat_count<1||until>Date.now()+r.lease_seconds*1000+5000||Date.now()>=b.worker_deadline_ms)throw fail('UNKNOWN');
  const taskResponse=await metadataRequest({origin,credential,binding:b,read:true});const claim=readClaim(taskResponse.reply);if(canonical(claim)!==canonical(b.claim)||Date.now()>=b.worker_deadline_ms)throw fail('UNKNOWN');
  const value={protocol:'native-task-lease/v1',binding:b,reply:{ok:true,lease_until:r.lease_until,lease_seconds:r.lease_seconds,heartbeat_count:r.heartbeat_count},observed_at:new Date().toISOString(),effective_deadline_ms:Math.min(until,b.receipt_deadline_ms),transport:{heartbeat:response.transport,task:taskResponse.transport}};
  durable(directory,'result.json',value);if(Date.now()>=b.worker_deadline_ms)throw fail('UNKNOWN');const proof=Object.freeze({});issued.set(proof,{binding:canonical(b),value});return proof;
 }catch{try{durable(directory,'unknown.json',{protocol:'native-task-lease/v1',lease_unknown:true});}catch{}throw fail('UNKNOWN');}
}
export function consumeNativeTaskLease(proof,binding){const found=issued.get(proof);if(!found)throw fail('UNBRANDED');if(found.binding!==canonical(bindingOf(binding)))throw fail('BINDING');return structuredClone(found.value);}
export function assertFrozenNativeTaskLease(frozen){
 const input=frozen?.agent_input,v=frozen?.native_task_lease,b=v?.binding;
 if(!input||frozen.execution_mode!=='agent'||input.workflow_key!=='douyin_comment_scoring'||input.profile!=='mmv-scoring'||input.serial!=='none'||frozen.control_scope||!v||v.protocol!=='native-task-lease/v1')throw fail('FROZEN');
 bindingOf(b);if(b.task_id!==input.task_id||b.source_commit!==frozen.deployment?.source_commit||b.run_tag!==input.run_tag||canonical(b.claim)!==canonical(frozen.native_claim)||b.worker_deadline_ms!==(input.run_start_ts+input.run_max_seconds)*1000||b.receipt_deadline_ms!==b.worker_deadline_ms||b.scope_sha256!==sha(canonical(input)))throw fail('FROZEN');
 const{snapshot_sha256,native_task_lease,...body}=frozen;if(b.snapshot_sha256!==sha(canonical(body)))throw fail('FROZEN');
 if(v.reply?.ok!==true||!Number.isFinite(Date.parse(v.reply.lease_until))||!Number.isSafeInteger(v.effective_deadline_ms)||v.effective_deadline_ms!==Math.min(Date.parse(v.reply.lease_until),b.receipt_deadline_ms)||v.effective_deadline_ms<=Date.now()||canonical(v.transport)!==canonical({heartbeat:{request_closed:true,response_closed:true,socket_closed:true},task:{request_closed:true,response_closed:true,socket_closed:true}}))throw fail('FROZEN');
 return structuredClone(v);
}
