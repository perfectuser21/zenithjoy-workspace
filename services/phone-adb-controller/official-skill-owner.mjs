// Only the public official-child parent uses this RPC lifecycle. A lost ACK is
// inspected by its durable key; it never permits a second agent dispatch.
import {openSync,writeSync,fsyncSync,closeSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const stopped=new WeakMap(),closed=new WeakMap();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw Error('RPC_SKILL_OWNER_SCOPE_INVALID');};
function durable(path,value){
 const fd=openSync(path,'wx',0o600),bytes=Buffer.from(JSON.stringify(value)+'\n');
 try{let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(count<=0)fail();offset+=count;}fsyncSync(fd);}finally{closeSync(fd);}
 const parent=openSync(join(path,'..'),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
const branded=(map,result,request)=>map.get(result)?.scope_sha256===hash(request)&&map.get(result)?.result_sha256===hash(result);
export function officialOwnerRunTerminated(result,request){return branded(stopped,result,request);}
export function officialOwnerTerminated(result,request){return branded(closed,result,request);}
export async function runOfficialSkillOwner({request,parent,directory,message,execute,authorize}){
 if(request?.protocol!=='leadgen-activity-v1'||request.mode!=='execute'||request.primary_host!=='official-child-v1'
  ||Object.hasOwn(request,'execution_transport')||Object.hasOwn(request,'transport_generation')
  ||!/^[a-f0-9]{40}$/.test(request.source_commit||'')||!/^[a-f0-9]{48}$/.test(request.nonce||'')
  ||!/^agent:work-commander:[A-Za-z0-9_.:/-]+$/.test(parent||'')||typeof message!=='string'||!message
  ||typeof execute!=='function'||typeof authorize!=='function')fail();
 const end=request.receipt_deadline_ms,scopeHash=hash(request);
 if(!Number.isSafeInteger(end)||end>=request.deadline_ms||Date.now()>=end)fail();
 const current=()=>{
  if(hash(request)!==scopeHash||hash(JSON.parse(readFileSync(join(directory,'activity-request.json'),'utf8')))!==scopeHash
   ||existsSync(join(directory,'handoff-closed.json'))||existsSync(join(directory,'generation-revoked.json')))fail();
 };
 current();if(await authorize()!==true)fail();current();
 const intent={protocol:'official-skill-owner-intent/v1',owner_run_id:randomUUID(),parent_session_key:parent,
  run_id:request.run_id,task_id:request.task_id,binding_id:request.binding_id,source_commit:request.source_commit,
  nonce:request.nonce,scope_sha256:scopeHash,message_sha256:hash(message),started_at_ms:Date.now(),receipt_deadline_ms:end};
 durable(join(directory,'owner-rpc-intent.json'),intent); // successful fsync precedes the only send
 const call=async(method,params,timeoutMs)=>{
  const args=['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout',String(Math.max(1,Math.floor(timeoutMs)))];
  const value=await execute('openclaw',args,{timeoutMs:Math.max(1,Math.floor(timeoutMs)),maxBuffer:1024*1024});
  if(value?.code!==0||value.signal)throw Error('RPC_SKILL_OWNER_TRANSPORT_UNKNOWN');
  return {raw:value,body:JSON.parse(value.stdout)};
 };
 let ack=null,conflict=false,terminal=null,reads=0;
 try{
  current();const remaining=end-Date.now();if(remaining<=0)fail();
  const value=await call('agent',{agentId:'work-commander',sessionKey:parent,message,deliver:false,
   timeout:Math.max(1,Math.floor(remaining/1000)),idempotencyKey:intent.owner_run_id},Math.min(10000,remaining));
  ack=value.body;durable(join(directory,'owner-rpc-ack.json'),value);
  conflict=ack?.runId!==intent.owner_run_id||ack?.sessionKey!==parent||ack?.agentId!=='work-commander'
   ||ack?.status!=='accepted'||!Number.isFinite(ack.acceptedAt)||ack.acceptedAt<intent.started_at_ms-1000||ack.acceptedAt>Date.now()+1000;
 }catch{durable(join(directory,'owner-rpc-ack-unknown.json'),{protocol:'official-skill-owner-ack-unknown/v1',owner_run_id:intent.owner_run_id});}
 // agent.wait is read-only even after authorization is revoked. Broker business
 // admission remains independently fresh; this read never grants tool authority.
 while(Date.now()<end){
  try{
   current();const remaining=end-Date.now();if(remaining<=0)break;
   const value=await call('agent.wait',{runId:intent.owner_run_id,timeoutMs:Math.max(0,Math.floor(Math.min(10000,remaining)))},Math.min(12000,remaining));
   durable(join(directory,`owner-rpc-wait-${String(++reads).padStart(3,'0')}.json`),value);current();
   const body=value.body;
   if(body?.runId!==intent.owner_run_id){conflict=true;break;}
   if(body.endedAt!==undefined){
    if(!['ok','error','timeout','aborted'].includes(body.status)||!Number.isFinite(body.endedAt)
     ||body.endedAt<intent.started_at_ms-1000||body.endedAt>Date.now()+1000||body.endedAt>end){conflict=true;break;}
    terminal=body;break;
   }
   if(!['pending','timeout'].includes(body.status)){conflict=true;break;}
  }catch{break;}
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(100,end-Date.now()))));
 }
 const result=Object.freeze({protocol:'official-skill-owner-result/v1',owner_run_id:intent.owner_run_id,parent_session_key:parent,
  status:terminal?.status||'unknown',execution_stopped:!!terminal&&!conflict,ack_received:ack!==null,ack_conflict:conflict,
  scope_sha256:scopeHash,source_commit:request.source_commit,terminal});
 durable(join(directory,'parent-owner-result.json'),result);
 if(result.execution_stopped)stopped.set(result,{scope_sha256:scopeHash,result_sha256:hash(result)});
 return result;
}
// A finished RPC run does not rule out completion delivery starting another
// turn in the same parent session. Only fresh, repeated official readbacks can
// close that owner scope; this never turns its business result into success.
export async function closeOfficialSkillOwner({result,request,child,directory,execute}){
 if(!officialOwnerRunTerminated(result,request)||typeof execute!=='function')fail();
 const scopeHash=hash(request),parent=result.parent_session_key,end=request.receipt_deadline_ms;
 const identity=['run_id','task_id','parent_session_key','nonce','child_run_id','child_session_key'];
 const current=()=>{
  const binding=JSON.parse(readFileSync(join(directory,'agent-binding.json'))),intent=JSON.parse(readFileSync(join(directory,'owner-rpc-intent.json')));
  if(hash(request)!==scopeHash||hash(JSON.parse(readFileSync(join(directory,'activity-request.json'))))!==scopeHash
   ||intent.owner_run_id!==result.owner_run_id||intent.scope_sha256!==scopeHash||intent.parent_session_key!==parent
   ||!child||identity.some(k=>binding[k]!==child[k])||binding.run_id!==request.run_id||binding.task_id!==request.task_id
   ||binding.nonce!==request.nonce||binding.parent_session_key!==parent||Date.now()>=end)fail();
 };
 let reads=0,sessionId,verified=false;
 const read=async(method,params)=>{
  current();const start=Date.now(),remaining=end-start;
  const raw=await execute('openclaw',['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout',String(Math.min(5000,remaining))],{timeoutMs:Math.min(5000,remaining),maxBuffer:1024*1024});
  if(raw.code!==0||raw.signal)fail();const body=JSON.parse(raw.stdout);
  durable(join(directory,`owner-closure-read-${String(++reads).padStart(3,'0')}.json`),{method,params,start_ms:start,end_ms:Date.now(),raw});current();return {body,start};
 };
 const describe=async()=>{
  const {body:description,start}=await read('sessions.describe',{key:parent,agentId:'work-commander'}),row=description.session;
  if(row?.key!==parent||typeof row.sessionId!=='string'||!row.sessionId||sessionId&&row.sessionId!==sessionId
   ||typeof row.hasActiveRun!=='boolean'||!Number.isFinite(row.snapshotAt)
   ||row.snapshotAt<start-1000||row.snapshotAt>Date.now()+1000)fail();sessionId=row.sessionId;
  if(row.hasActiveRun){
   if(row.activeRunIds!==undefined&&(!Array.isArray(row.activeRunIds)||!row.activeRunIds.length||row.activeRunIds.some(id=>typeof id!=='string'||!id)))fail();
   return 'pending';
  }
  if(!Array.isArray(row.activeRunIds)||row.activeRunIds.length)fail();return 'ready';
 };
 const census=async()=>{
  if(await describe()==='pending')return 'pending';
  const {body:history}=await read('chat.history',{sessionKey:parent,limit:1}),queue=history.pendingInputs;
  if(history.sessionKey!==parent||history.sessionId!==sessionId||!queue||!Number.isSafeInteger(queue.total)||queue.total<0
   ||!Number.isSafeInteger(queue.queuedCount)||queue.queuedCount<0||!Array.isArray(queue.items)||queue.total<queue.items.length
   ||queue.items.some(item=>!item||typeof item!=='object'||typeof item.id!=='string'||!item.id))fail();
  if(queue.total||queue.queuedCount||queue.items.length)return 'pending';
  const {body:core}=await read('tools.invoke',{name:'subagents',sessionKey:parent,args:{action:'list'}}),d=core.output?.details;
  if(core.ok!==true||core.toolName!=='subagents'||core.source!=='core'||d?.status!=='ok'||d.action!=='list'
   ||d.callerIsSubagent!==false||d.callerSessionKey!==parent||d.requesterSessionKey!==parent
   ||!Array.isArray(d.active)||!Array.isArray(d.recent)
   ||d.active.some(row=>!row||typeof row.runId!=='string'||!row.runId||typeof row.sessionKey!=='string'||!row.sessionKey
    ||!['queued','running','waiting','finished'].includes(row.execution?.state)))fail();
  const matches=d.recent.filter(r=>r.runId===child.child_run_id&&r.sessionKey===child.child_session_key);
  if(matches.length!==1||matches[0].execution?.state!=='finished'||!Number.isSafeInteger(matches[0].pendingDescendants)||matches[0].pendingDescendants<0
   ||!['pending','in_progress','delivered'].includes(matches[0].deliveryStatus))fail();
  if(d.active.length||matches[0].pendingDescendants||matches[0].deliveryStatus!=='delivered')return 'pending';
  return 'ready';
 };
 try{
  let rounds=0;
  while(Date.now()<end){
   if(await census()==='ready'){
    if(++rounds<2)continue;
    if(await describe()==='ready'){current();verified=true;break;}
   }
   rounds=0;
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(100,end-Date.now()))));
  }
 }catch{/* An unfinished delivery or an uncertain census retains the original reservation. */}
 const proof=Object.freeze({...result,protocol:'official-skill-owner-closure/v1',owner_run_execution_stopped:true,
  execution_stopped:verified,session_quiescent:verified,session_id:sessionId??null,closure_read_count:reads});
 durable(join(directory,'parent-owner-closure.json'),proof);if(verified)closed.set(proof,{scope_sha256:scopeHash,result_sha256:hash(proof)});return proof;
}
