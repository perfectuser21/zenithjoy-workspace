// First-run Skill capability. Deliberately separate from the Code-recovery broker.
import {createServer} from 'node:net';
import {chmodSync,mkdirSync,writeFileSync,appendFileSync,unlinkSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const detail=error=>{
  const code=String(error?.message||'');
  return /^(?:SKILL_PRIMARY_|AGENT_(?:TOOL|PRIMARY)_|RPC_|COMPANY_|DISCOVERY_|RECIPIENT_|RECORD_)[A-Z0-9_]+$/.test(code)?code:'SKILL_PRIMARY_OPERATION_FAILED';
};
export async function startPrimaryActivityBroker({directory,request,inspect,phone,business,getActivityResult=()=>null,isReadOnlyBusinessOperation=()=>false,authorize=async()=>false,onEvent=async()=>({action:'none'}),onAbort=async()=>({execution_stopped:false}),observerTimeoutMs=20000}){
  if(request?.protocol!=='leadgen-activity-v1'||request.mode!=='execute'
    ||!/^\w[\w.-]{0,150}$/.test(request.run_id||'')||!uuid.test(request.task_id||'')||!uuid.test(request.binding_id||'')
    ||!/^\w{1,48}$/.test(request.activity_key||'')||!['preflight','source','collect_videos','dedup','qualification','collection','scoring','mark_leads','cleanup'].includes(request.activity_key)
    ||!/^[a-f0-9]{48}$/.test(request.nonce||'')||!/^[a-f0-9]{40}$/.test(request.source_commit||'')
    ||!/^[a-f0-9]{64}$/.test(request.runtime_snapshot_sha256||'')||!Number.isSafeInteger(request.deadline_ms)
    ||typeof inspect!=='function'||typeof business!=='function'||typeof phone!=='function')throw Error('SKILL_PRIMARY_REQUEST_INVALID');
  if((request.worker_deadline_ms!==undefined||request.receipt_deadline_ms!==undefined)&&(!Number.isSafeInteger(request.worker_deadline_ms)||!Number.isSafeInteger(request.receipt_deadline_ms)||request.worker_deadline_ms>=request.receipt_deadline_ms||request.receipt_deadline_ms>=request.deadline_ms))throw Error('SKILL_PRIMARY_REQUEST_INVALID');
  if(!Number.isSafeInteger(observerTimeoutMs)||observerTimeoutMs<1||observerTimeoutMs>20000)throw Error('SKILL_PRIMARY_OBSERVER_BUDGET_INVALID');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('SKILL_PRIMARY_DIRECTORY_INVALID');
  const socket=join(tmpdir(),'leadgen-primary-'+randomBytes(12).toString('hex')+'.sock');
  const requestPath=join(directory,'broker-request.json'),fixed={...request,socket};
  writeFileSync(requestPath,JSON.stringify(fixed),{flag:'wx',mode:0o600});
  let closed=false,sealed=false,pending=0,active=0,executionUnknown=false,commanderAborted=false,abortUnknown=false;
  const unknownReasons=new Set();
  const markUnknown=reason=>{executionUnknown=true;unknownReasons.add(reason);};
  const guidance=[],observerRecordingFailures=[];let observerStatus='not_requested';
  const abort=async reason=>{
    if(commanderAborted)return {execution_stopped:!executionUnknown&&!abortUnknown&&active===0};
    commanderAborted=true;
    try{const stopped=await onAbort(String(reason||'commander_abort').slice(0,1000));abortUnknown=stopped?.execution_stopped!==true||active>0;if(abortUnknown)unknownReasons.add('abort_stop_unknown');return stopped;}
    catch{abortUnknown=true;unknownReasons.add('abort_stop_unknown');return {execution_stopped:false};}
  };
  const observe=async(event,notify=true)=>{
    let action={action:'none'},commanderStatus='not_requested',timer,observerTimedOut=false;
    // Context inspection is not business progress. Explicit reports and real
    // operation completions reach the observer within the existing deadline.
    if(notify){
      try{
        const wait=Math.max(1,Math.min(observerTimeoutMs,event.type==='question'?20000:10000,Math.floor((request.deadline_ms-Date.now())/5)));
        const observation=Promise.resolve().then(()=>onEvent(event));
        observation.then(late=>{if(!observerTimedOut)return;
          const action={action:['answer','steer','abort'].includes(late?.action)?late.action:'none',...(typeof late?.text==='string'?{text:late.text.slice(0,16000)}:{}),...(typeof late?.reason==='string'?{reason:late.reason.slice(0,16000)}:{})};
          try{appendFileSync(join(directory,'broker-observer-late-events.jsonl'),JSON.stringify({at:new Date().toISOString(),activity:request.activity_key,action,action_applied:false,reason:'observer_deadline_elapsed'})+'\n',{mode:0o600});}
          catch{observerRecordingFailures.push('SKILL_PRIMARY_LATE_OBSERVER_RECORD_FAILED');}
        },()=>{});
        action=await Promise.race([observation,new Promise((_,reject)=>{timer=setTimeout(()=>{observerTimedOut=true;reject(Error('SKILL_PRIMARY_OBSERVER_TIMEOUT'));},wait);})]);
        commanderStatus=action?.commander_status==='unavailable'?'unavailable':'available';
      }catch{commanderStatus='unavailable';action={action:'none'};}
      finally{clearTimeout(timer);}
    }

    if(commanderStatus!=='not_requested')observerStatus=commanderStatus;
    return {action,commanderStatus};
  };
  const allowedKeys=new Set([...Object.keys(fixed),'op','operation','input','command','args','question','progress','error']);
  const dispatch=async q=>{
    if(!object(q)||Object.keys(q).some(key=>!allowedKeys.has(key)))throw Error('SKILL_PRIMARY_INPUT_INVALID');
    if(sealed)throw Error('SKILL_PRIMARY_SEALED');
    if(closed||Date.now()>=request.deadline_ms)throw Error('SKILL_PRIMARY_EXPIRED');
    for(const key of ['run_id','activity_key','nonce'])if(q[key]!==request[key])throw Error('SKILL_PRIMARY_SCOPE_MISMATCH');
    for(const key of ['task_id','binding_id','source_commit','runtime_snapshot_sha256','transport_generation'])if(q[key]!==undefined&&q[key]!==request[key])throw Error('SKILL_PRIMARY_SCOPE_MISMATCH');
    if(await authorize(q)!==true)throw Error('SKILL_PRIMARY_CHILD_NOT_BOUND');
    if(sealed)throw Error('SKILL_PRIMARY_SEALED');
    if(closed||Date.now()>=request.deadline_ms)throw Error('SKILL_PRIMARY_EXPIRED');
    if(q.op==='inspect'){
      const context=await inspect();
      if(!object(context))throw Error('SKILL_PRIMARY_INSPECT_INVALID');
      return {...context,...(guidance.length?{commander_guidance:guidance.splice(0)}:{}),...(commanderAborted?{commander_abort:true}:{})};
    }
    if(Date.now()>=(request.worker_deadline_ms??request.deadline_ms))throw Error('SKILL_PRIMARY_WORKER_EXPIRED');
    if(commanderAborted||abortUnknown||executionUnknown&&!(q.op==='business'&&isReadOnlyBusinessOperation(q.operation,q.input)===true))throw Error('SKILL_PRIMARY_EXECUTION_BLOCKED');
    if(active!==0)throw Error('SKILL_PRIMARY_OPERATION_BUSY');
    if(!['phone','business'].includes(q.op))throw Error('SKILL_PRIMARY_OPERATION_NOT_ALLOWED');
    if(q.op==='phone'&&(!/^[a-z][a-z0-9-]{0,63}$/.test(q.command||'')||!Array.isArray(q.args)||q.args.length>8||q.args.some(arg=>typeof arg!=='string'||arg.length>1000||/[\0\r\n]/.test(arg))))throw Error('SKILL_PRIMARY_PHONE_INPUT_INVALID');
    if(q.op==='business'&&(!/^[a-z][a-z0-9_.-]{0,63}$/.test(q.operation||'')||!object(q.input)||Buffer.byteLength(JSON.stringify(q.input))>256*1024))throw Error('SKILL_PRIMARY_BUSINESS_INPUT_INVALID');
    active++;
    try{
      const result=await (q.op==='phone'?phone(q.command,...q.args):business(q.operation,q.input));
      if(result?.execution_stopped===false||result?.external_effect==='unknown')markUnknown(q.op==='business'?'business_commit_unknown':'native_execution_unknown');
      return result;
    }catch(error){if(error.executionStopped===false||error.externalEffect==='unknown')markUnknown(q.op==='business'?'business_commit_unknown':'native_execution_unknown');throw error;}
    finally{active--;}
  };
  const connections=new Set();let closePromise;
  const server=createServer({allowHalfOpen:true},client=>{
    connections.add(client);client.on('close',()=>connections.delete(client));
    let raw='';client.setTimeout(1000,()=>client.destroy());
    client.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>300*1024)client.destroy();});
    client.on('end',async()=>{
      if(sealed){client.end(JSON.stringify({ok:false,error:'SKILL_PRIMARY_SEALED'})+'\n');return;}
      pending++;
      try{
      client.setTimeout(0);let q,out;
      try{q=JSON.parse(raw);out={ok:true,result:await dispatch(q)};}
      catch(error){out={ok:false,error:detail(error)};}
      const event={type:out.ok?(typeof q?.question==='string'?'question':typeof q?.error==='string'?'error':'progress'):'error',
        text:[q?.question,q?.error,q?.progress,out.error,'工具完成'].find(value=>typeof value==='string')?.slice(0,16000),operation:q?.op||'invalid',command:q?.command||q?.operation||null};
      const {action,commanderStatus}=await observe(event,q?.op!=='inspect'||['question','progress','error'].some(key=>typeof q?.[key]==='string'));
      try{
        appendFileSync(join(directory,'broker-events.jsonl'),JSON.stringify({at:new Date().toISOString(),run_id:request.run_id,activity:request.activity_key,event,
          input:q?{op:q.op,operation:q.operation,input:q.input,command:q.command,args:q.args}:null,response:out,commander_action:action,commander_status:commanderStatus})+'\n',{mode:0o600});
        if(['answer','steer'].includes(action?.action)&&typeof action.text==='string')guidance.push(action.text.slice(0,16000));
        if(action?.action==='abort')await abort(action.reason);
      }catch{markUnknown('event_delivery_unknown');out={ok:false,error:'SKILL_PRIMARY_EVENT_DELIVERY_UNKNOWN'};}
      client.end(JSON.stringify(out)+'\n');
      }finally{pending--;}
    });
    client.on('error',()=>{});
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(socket,yes);});chmodSync(socket,0o600);
  const state=()=>({sealed,pending,active,execution_unknown:executionUnknown||abortUnknown});
  return {directory,requestPath,request:fixed,abort,
    report:async event=>{
      const {action,commanderStatus}=await observe(event,!sealed&&!closed);
      const apply=!sealed&&!closed;
      appendFileSync(join(directory,'broker-events.jsonl'),JSON.stringify({at:new Date().toISOString(),run_id:request.run_id,activity:request.activity_key,event,response:null,commander_action:action,commander_status:commanderStatus,action_applied:apply})+'\n',{mode:0o600});
      if(!apply)return {action:'none'};
      if(['answer','steer'].includes(action?.action)&&typeof action.text==='string')guidance.push(action.text.slice(0,16000));
      if(action?.action==='abort')await abort(action.reason);
      return action;
    },
    seal:()=>{sealed=true;if(pending!==0||active!==0)markUnknown('inflight_at_seal');return state();},
    confirmAbortStopped:receipt=>{if(commanderAborted&&active===0&&receipt?.owner_execution_stopped===true&&receipt.child_execution_stopped===true&&receipt.terminal?.runId===receipt.child_run_id&&Number.isFinite(receipt.terminal?.endedAt)){abortUnknown=false;unknownReasons.delete('abort_stop_unknown');}},
    getResult:()=>({result:getActivityResult(),...state(),unknown_reasons:[...unknownReasons],observer_recording_failures:[...observerRecordingFailures],commander_status:observerStatus,commander_aborted:commanderAborted}),
    close:async()=>{
      if(closePromise)return closePromise;
      closed=true;sealed=true;if(active!==0||pending!==0)markUnknown('inflight_at_seal');
      closePromise=new Promise((yes,no)=>{server.close(error=>error?no(error):yes());for(const client of connections)client.destroy();})
        .then(()=>{try{unlinkSync(socket);}catch(error){if(error.code!=='ENOENT')throw error;}});
      return closePromise;
    }};
}
