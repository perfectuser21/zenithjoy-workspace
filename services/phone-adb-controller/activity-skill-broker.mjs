// Original run owns resources/state. The child can repair and resume only this slot.
import {createServer} from 'node:net';
import {chmodSync,mkdirSync,writeFileSync,appendFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';

export async function startActivityBroker({directory,request,inspect,resume,phone,authorize=async()=>false,isBlockedError=()=>false}) {
 if(request?.protocol!=='leadgen-activity-v1'||!/^\w[\w.-]{0,150}$/.test(request.run_id||'')||!/^\w{1,48}$/.test(request.activity_key||'')||!/^[a-f0-9]{48}$/.test(request.nonce||'')||!Number.isSafeInteger(request.deadline_ms))throw Error('SKILL_BROKER_REQUEST_INVALID');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const socket=join(tmpdir(),'leadgen-skill-'+randomBytes(12).toString('hex')+'.sock');
 const requestPath=join(directory,'broker-request.json');
 const fixed={...request,socket};writeFileSync(requestPath,JSON.stringify(fixed),{flag:'wx',mode:0o600});
 let reserved=false,result,closed=false,active=0,nativeReads=0,current=request,blockedError=null;
 const readOnly=new Set(['status','foreground','window','ui-evidence','snapshot-evidence','outward-ledger']);
 const repair=new Set(['back-evidence','back-to-results','back-to-profile','detail-restored']);
 const dispatch=async q=>{
  if(closed||Date.now()>=request.deadline_ms)throw Error('SKILL_BROKER_EXPIRED');
  if(q.transport_generation!==current.transport_generation||q.nonce!==request.nonce||q.run_id!==request.run_id||q.activity_key!==request.activity_key)throw Error('SKILL_BROKER_IDENTITY_MISMATCH');
  if(await authorize(q)!==true)throw Error('SKILL_CHILD_NOT_BOUND');
  if(closed||Date.now()>=request.deadline_ms||q.transport_generation!==current.transport_generation)throw Error('SKILL_BROKER_EXPIRED');
  if(blockedError&&q.op!=='inspect')throw Error('SKILL_RECOVERY_POLICY_BLOCKED');
  if(q.op==='inspect'){
   active++;try{const context=await inspect();
   return request.activity_key==='qualification'&&current.mode==='repair'?{...context,phone_capabilities:[...readOnly,...(!reserved?['native-audio-evidence',...repair]:[])]}:context;}finally{active--;}
  }
  if(active>0&&q.op!=='inspect')throw Error('SKILL_OPERATION_BUSY');
  if(q.op==='resume'){
   if(current.mode!=='repair'||request.activity_key==='send_dm'||reserved)throw Error('SKILL_RESUME_NOT_ALLOWED');
   reserved=true;active++;try{result=await resume();return result;}finally{active--;}
  }
  if(q.op==='phone'){
   const native=q.command==='native-audio-evidence'&&request.activity_key==='qualification'&&current.mode==='repair';
   if(!Array.isArray(q.args)||q.args.length>8||q.args.some(s=>typeof s!=='string'||s.length>250||/[\r\n\0]/.test(s))||(!readOnly.has(q.command)&&!native&&!(current.mode==='repair'&&request.activity_key!=='send_dm'&&repair.has(q.command))))throw Error('SKILL_PHONE_OPERATION_NOT_ALLOWED');
   if(native){if(q.args.length!==0||nativeReads>=2)throw Error('SKILL_NATIVE_READBACK_NOT_ALLOWED');nativeReads++;}
   if(request.activity_key==='scoring'||request.activity_key==='mark_leads')throw Error('SKILL_SCORING_HAS_NO_PHONE');
   active++;try{return await phone(q.command,...q.args);}finally{active--;}
  }
  throw Error('SKILL_OPERATION_NOT_ALLOWED');
 };
 const server=createServer({allowHalfOpen:true},client=>{
  let raw='';client.setTimeout(1000,()=>client.destroy());
  client.on('data',chunk=>{raw+=chunk;if(raw.length>12000)client.destroy();});
  client.on('end',async()=>{
   client.setTimeout(0);
   let out;try{out={ok:true,result:await dispatch(JSON.parse(raw))};}catch(error){if(isBlockedError(error)===true)blockedError=String(error.message).slice(0,300);out={ok:false,error:String(error.message).slice(0,300)};}
   appendFileSync(join(directory,'broker-events.jsonl'),JSON.stringify({at:new Date().toISOString(),request_sha_scope:{run_id:request.run_id,activity:request.activity_key},ok:out.ok,error:out.error||null})+'\n',{mode:0o600});
   client.end(JSON.stringify(out)+'\n');
  });
  client.on('error',()=>{});
 });
 await new Promise((yes,no)=>{server.once('error',no);server.listen(socket,yes);});chmodSync(socket,0o600);
 return {requestPath,request:fixed,getResult:()=>({reserved,result,active,nativeReads,blocked_error:blockedError}),advanceTurn:(cause='agent_failed')=>{
  if(!['agent_failed','verification_failed'].includes(cause)||cause==='verification_failed'&&!reserved||closed||active!==0||request.transport_generation!==0||current.transport_generation!==0||Date.now()>=request.deadline_ms)throw Error('SKILL_GENERATION_ADVANCE_REJECTED');
  const next={...request,transport_generation:1,continuation_cause:cause,mode:reserved?'readback_only':request.mode,broker_request_path:join(directory,'broker-request-turn-1.json')};
  writeFileSync(next.broker_request_path,JSON.stringify({...next,socket}),{flag:'wx',mode:0o600});current=next;return next;
 },close:async()=>{closed=true;await new Promise(yes=>server.close(yes));try{unlinkSync(socket);}catch(error){if(error.code!=='ENOENT')throw error;}}};
}
