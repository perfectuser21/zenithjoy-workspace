import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {openSync,closeSync,writeFileSync,readFileSync,fsyncSync,lstatSync,realpathSync,fstatSync,constants} from 'node:fs';
import {join} from 'node:path';
export const peerCanonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const peerHash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:peerCanonical(value)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const stopped=new WeakMap(),clients=new WeakMap();
const fail=reason=>Object.assign(Error('OFFICIAL_PHONE_PEER_'+reason),{code:'OFFICIAL_PHONE_PEER_'+reason,executionStopped:false,externalEffect:'unknown'});
const need=(ok,reason)=>{if(!ok)throw fail(reason);};
const operations=new Set(['begin','prepare','inspect','phone','business','heartbeat','seal_activity','settle','release','verify_activity','close']);
function checkedSession(session){
 need(session?.protocol==='official-phone-peer-session/v1'&&['session_id','run_id','task_id'].every(k=>uuid.test(session[k]||''))&&/^[a-f0-9]{48}$/.test(session.nonce||'')&&/^[a-f0-9]{64}$/.test(session.descriptor_sha256||'')&&/^[a-f0-9]{40}$/.test(session.source_commit||'')&&Number.isSafeInteger(session.deadline_ms),'SESSION');
 return structuredClone(session);
}
export function phonePeerEnvelope(message,key){need(typeof key==='string'&&key.length>=32&&!/[\r\n]/.test(key),'CREDENTIAL');return {message,signature:createHmac('sha256',key).update(peerCanonical(message)).digest('hex')};}
export function verifyPhonePeerEnvelope(envelope,key){
 need(envelope&&Object.keys(envelope).sort().join(',')==='message,signature'&&/^[a-f0-9]{64}$/.test(envelope.signature||''),'SIGNATURE');
 const wanted=phonePeerEnvelope(envelope.message,key).signature;need(timingSafeEqual(Buffer.from(wanted),Buffer.from(envelope.signature)),'SIGNATURE');return envelope.message;
}
function privateRead(path){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);need(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.nlink===1&&s.size<=8*1024*1024,'JOURNAL');const bytes=readFileSync(fd),after=fstatSync(fd);need(s.dev===after.dev&&s.ino===after.ino&&s.size===bytes.length&&s.size===after.size&&s.mtimeMs===after.mtimeMs,'JOURNAL');return JSON.parse(bytes);}finally{closeSync(fd);}}
function durable(directory,name,value){const fd=openSync(join(directory,name),'wx',0o600);try{writeFileSync(fd,peerCanonical(value));fsyncSync(fd);}finally{closeSync(fd);}const d=openSync(directory,'r');try{fsyncSync(d);}finally{closeSync(d);}}
export function createPhonePeerOperationHost({session:provided,key,directory,authorize,execute,snapshot,seal,hostIdentity,readOnly=false}={}){
 const session=checkedSession(provided),scopeHash=peerHash(session),s=lstatSync(directory);
 need(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(directory)===directory&&s.uid===process.getuid()&&!(s.mode&0o077)&&[authorize,execute,snapshot,seal].every(f=>typeof f==='function'),'HOST');
 let busy=false,closed=false,unknown=false,sequence=0;
 const actual=()=>{const value=snapshot();need(value&&typeof value==='object'&&Number.isSafeInteger(value.pending)&&value.pending>=0&&typeof value.active==='boolean'&&typeof value.execution_unknown==='boolean','STATE');return structuredClone(value);};
 const current=async()=>{need(Date.now()<session.deadline_ms&&!closed,'DEADLINE');need(await authorize()===true,'AUTHORITY');need(Date.now()<session.deadline_ms,'DEADLINE');};
 const read=id=>{need(uuid.test(id||''),'OPERATION_ID');try{return privateRead(join(directory,id+'.result.json'));}catch(e){if(e.code!=='ENOENT')throw e;const intent=privateRead(join(directory,id+'.intent.json'));need(intent.scope_sha256===scopeHash,'SCOPE');return {status:'pending_or_unknown',operation_id:id,scope_sha256:scopeHash,request_sha256:intent.request_sha256};}};
 return Object.freeze({async handle(envelope){
  const q=verifyPhonePeerEnvelope(envelope,key);need(q?.protocol==='official-phone-peer-operation/v1'&&q.scope_sha256===scopeHash&&Number.isSafeInteger(q.sequence)&&q.sequence>0&&uuid.test(q.operation_id||'')&&q.input_sha256===peerHash(q.input),'REQUEST');
  const requestHash=peerHash(q);
  if(q.operation==='read_operation'){sequence=Math.max(sequence,q.sequence);need(Object.keys(q.input||{}).join(',')==='operation_id','READ_ONLY');return phonePeerEnvelope({protocol:'official-phone-peer-readback/v1',scope_sha256:scopeHash,operation_id:q.operation_id,sequence:q.sequence,request_sha256:requestHash,record:read(q.input.operation_id)},key);}
  need(!readOnly&&operations.has(q.operation)&&q.deadline_ms===session.deadline_ms,'OPERATION');
  const intentPath=join(directory,q.operation_id+'.intent.json');
  try{const old=privateRead(intentPath);need(old.scope_sha256===scopeHash&&old.operation===q.operation&&old.input_sha256===q.input_sha256,'OPERATION_CONFLICT');return phonePeerEnvelope(read(q.operation_id),key);}catch(e){if(e.code!=='ENOENT')throw e;}
  need(!busy&&!closed&&!unknown&&q.sequence===sequence+1,'ORDER');await current();need(!busy&&!unknown,'ORDER');busy=true;sequence=q.sequence;
  durable(directory,q.operation_id+'.intent.json',{scope_sha256:scopeHash,request_sha256:requestHash,input_sha256:q.input_sha256,operation:q.operation,request:q});
  try{
   const start=Date.now();let value;
   if(q.operation==='close'){value=await seal();need(value?.execution_stopped===true,'PRODUCER_CLOSE');}
   else value=await execute(q.operation,structuredClone(q.input));
   await current();const state=actual();need(!state.execution_unknown,'PRODUCER_UNKNOWN');
   const physical=q.operation==='close'||q.operation==='seal_activity';
   if(physical)need(state.pending===0&&!state.active&&value?.execution_stopped===true,'PRODUCER_CLOSE');
   const result={protocol:'official-phone-peer-result/v1',status:'completed',scope_sha256:scopeHash,operation_id:q.operation_id,sequence:q.sequence,request_sha256:requestHash,input_sha256:q.input_sha256,operation:q.operation,source_commit:session.source_commit,descriptor_sha256:session.descriptor_sha256,host:'xian-m4',host_identity:hostIdentity??null,start_ms:start,end_ms:Date.now(),result:value??null,state,physical_sealed:physical};
   need(result.end_ms<session.deadline_ms,'DEADLINE');durable(directory,q.operation_id+'.result.json',result);if(q.operation==='close')closed=true;return phonePeerEnvelope(result,key);
  }catch(error){unknown=true;durable(directory,q.operation_id+'.unknown.json',{scope_sha256:scopeHash,request_sha256:requestHash,operation_id:q.operation_id,status:'unknown',retry_allowed:false});throw error;}
  finally{busy=false;}
 },snapshot:()=>({busy,closed,unknown,sequence,state:actual()})});
}
export function createPhonePeerOperationClient({session:provided,key,exchange,closeTransport}){
 const owner=Object.freeze({}),session=checkedSession(provided),scopeHash=peerHash(session),sent=new Map();let sequence=0,pending=null,unknown=false,closed=false,lastState={active:false,pending:0,execution_unknown:false},lastResult;
 need(typeof exchange==='function'&&typeof closeTransport==='function','CLIENT');
 const bound=(q,body)=>{need(body.protocol==='official-phone-peer-result/v1'&&body.status==='completed'&&body.scope_sha256===scopeHash&&body.operation_id===q.operation_id&&body.sequence===q.sequence&&body.request_sha256===peerHash(q)&&body.operation===q.operation&&body.input_sha256===q.input_sha256&&body.source_commit===session.source_commit&&body.descriptor_sha256===session.descriptor_sha256&&body.host==='xian-m4'&&Number.isSafeInteger(body.start_ms)&&Number.isSafeInteger(body.end_ms)&&body.end_ms>=body.start_ms&&body.end_ms<session.deadline_ms&&Date.now()<session.deadline_ms,'RECEIPT');need(body.state&&body.state.execution_unknown===false&&Number.isSafeInteger(body.state.pending)&&typeof body.state.active==='boolean','STATE');return body;};
 const cache=body=>{lastState=structuredClone(body.state);lastResult=body;pending=null;return structuredClone(body.result);};
 const request=async(operation,input={},options={})=>{
  need(!unknown&&!closed&&Date.now()<session.deadline_ms&&!pending,'CLOSED');need(operations.has(operation),'OPERATION');const operationId=options.operationId??randomUUID();need(uuid.test(operationId),'OPERATION_ID');need(!sent.has(operationId),'OPERATION_CONFLICT');
  const q={protocol:'official-phone-peer-operation/v1',scope_sha256:scopeHash,operation_id:operationId,sequence:++sequence,operation,input:structuredClone(input),input_sha256:peerHash(input),deadline_ms:session.deadline_ms};sent.set(operationId,q);pending=q;
  let reply;try{reply=await exchange(phonePeerEnvelope(q,key));}catch(error){throw Object.assign(fail('ACK_UNKNOWN'),{operationId,cause:error});}
  try{return cache(bound(q,verifyPhonePeerEnvelope(reply,key)));}catch(error){unknown=true;throw error;}
 };
 const readOperation=async id=>{
  need(!unknown&&!closed&&sent.has(id)&&(!pending||pending.operation_id===id),'READ_SCOPE');const original=sent.get(id),q={protocol:'official-phone-peer-operation/v1',scope_sha256:scopeHash,operation_id:randomUUID(),sequence:++sequence,operation:'read_operation',input:{operation_id:id},input_sha256:peerHash({operation_id:id}),deadline_ms:session.deadline_ms};
  const body=verifyPhonePeerEnvelope(await exchange(phonePeerEnvelope(q,key)),key);need(body.protocol==='official-phone-peer-readback/v1'&&body.scope_sha256===scopeHash&&body.operation_id===q.operation_id&&body.sequence===q.sequence&&body.request_sha256===peerHash(q),'READ_RECEIPT');
  if(body.record?.status!=='completed')throw fail('READBACK_UNCONFIRMED');return cache(bound(original,body.record));
 };
 const client=Object.freeze({request,readOperation,snapshot:()=>({unknown,closed,pending_operation_id:pending?.operation_id??null,state:structuredClone(lastState),last_receipt:lastResult?structuredClone(lastResult):null}),async close(){
  const value=lastResult?.operation==='close'?structuredClone(lastResult.result):await request('close');const body=lastResult;need(body?.physical_sealed===true&&body.state.pending===0&&!body.state.active&&value?.execution_stopped===true,'PRODUCER_CLOSE');
  const transport=await closeTransport();need(transport?.closed===true&&transport.code===0&&!transport.signal,'TRANSPORT_CLOSE');need(Date.now()<session.deadline_ms,'DEADLINE');closed=true;
  const proof=Object.freeze({protocol:'official-phone-peer-stopped/v1',execution_stopped:true,scope_sha256:scopeHash,receipt_sha256:peerHash(body),transport_closed:true});stopped.set(proof,{scopeHash,owner});return proof;
 }});clients.set(client,owner);return client;
}
export const phonePeerStopped=(proof,session,client)=>{const p=stopped.get(proof);return Boolean(p&&p.owner===clients.get(client)&&p.scopeHash===peerHash(checkedSession(session)));};
