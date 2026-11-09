// Only the public official-child parent uses this RPC lifecycle. A lost ACK is
// inspected by its durable key; it never permits a second agent dispatch.
import {openSync,writeSync,fsyncSync,closeSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const stopped=new WeakMap();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw Error('RPC_SKILL_OWNER_SCOPE_INVALID');};
function durable(path,value){
 const fd=openSync(path,'wx',0o600),bytes=Buffer.from(JSON.stringify(value)+'\n');
 try{let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(count<=0)fail();offset+=count;}fsyncSync(fd);}finally{closeSync(fd);}
 const parent=openSync(join(path,'..'),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
export function officialOwnerTerminated(result,request){return stopped.get(result)?.scope_sha256===hash(request);}
export async function runOfficialSkillOwner({request,parent,directory,message,execute,authorize}){
 if(request?.protocol!=='leadgen-activity-v1'||request.mode!=='execute'||request.primary_host!=='official-child-v1'
  ||Object.hasOwn(request,'execution_transport')||Object.hasOwn(request,'transport_generation')
  ||!/^[a-f0-9]{40}$/.test(request.source_commit||'')||!/^[a-f0-9]{48}$/.test(request.nonce||'')
  ||!/^agent:work-commander:[A-Za-z0-9_.:/-]+$/.test(parent||'')||typeof message!=='string'||!message
  ||typeof execute!=='function'||typeof authorize!=='function')fail();
 const end=request.receipt_deadline_ms,scopeHash=hash(request);
 if(!Number.isSafeInteger(end)||end>=request.deadline_ms||Date.now()>=end)fail();
 const current=()=>{
  if(hash(JSON.parse(readFileSync(join(directory,'activity-request.json'),'utf8')))!==scopeHash
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
     ||body.endedAt<intent.started_at_ms-1000||body.endedAt>Date.now()+1000){conflict=true;break;}
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
 if(result.execution_stopped)stopped.set(result,{scope_sha256:scopeHash});
 return result;
}
