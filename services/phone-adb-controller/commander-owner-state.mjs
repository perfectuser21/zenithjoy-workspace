import {mkdirSync,lstatSync,readdirSync,openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {executionDidNotStart} from './leadgen-client.mjs';
import {acquireOwnerLock} from './commander-owner-lock.mjs';
import {commanderModelReceipt} from './commander-model-receipt.mjs';
export function workflowCommanderSession(receipt) {
  if(!/^\w[\w.-]{0,150}$/.test(receipt?.run_id||'')||!/^[a-f0-9]{40}$/.test(receipt?.source_commit||''))throw Error('COMMANDER_WORKFLOW_IDENTITY_INVALID');
  if(typeof receipt.binding_id!=='string'||!receipt.binding_id||receipt.binding_id.length>160)throw Error('COMMANDER_BINDING_IDENTITY_INVALID');
  const key=createHash('sha256').update(JSON.stringify([receipt.run_id,receipt.source_commit,receipt.binding_id,receipt.task_id??null])).digest('hex').slice(0,32);
  return `agent:work-commander:workflow-${key}`;
}

export function ownerPending(scope,home){
  const session=workflowCommanderSession(scope),name=session.split(':').at(-1);
  for(const path of [resolve(home,'.openclaw'),resolve(home,'.openclaw','leadgen-owner-turns')]){
    mkdirSync(path,{recursive:true,mode:0o700});
    const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o022)!==0)throw Error('COMMANDER_OWNER_STATE_INVALID');
  }
  return {session,file:resolve(home,'.openclaw','leadgen-owner-turns',name+'.pending.json')};
}
const unresolved=()=>{const error=Error('COMMANDER_OWNER_TURN_UNRESOLVED');error.executionStopped=false;return error;};
export function assertWorkflowOwnerAvailable(scope,{home=homedir()}={}){
  const {file}=ownerPending(scope,home);
  try{lstatSync(file);throw unresolved();}catch(error){if(error.code!=='ENOENT')throw error;}
}
// A reservation can only deny another transport launch. It is never evidence
// that business succeeded, a child stopped, or resources may be released.
export async function reserveWorkflowCommanderTurn(scope,{home=homedir()}={}){
  const {file,session}=ownerPending(scope,home),nonce=randomUUID(),release=await acquireOwnerLock(file);
  const record={protocol:'commander-owner-turn-v1',session,run_id:scope.run_id,binding_id:scope.binding_id,source_commit:scope.source_commit,task_id:scope.task_id??null,transport_nonce:nonce,status:'reserved',started_at:new Date().toISOString()};
  const raw=JSON.stringify(record);let reservation;
  try{reservation=await release.command('reserve',{raw});}catch{await release();throw unresolved();}
  const archive=async(status,details)=>{
    const receipt={...record,status,...details,original_sha256:reservation.sha256};
    return release.command(status,{expected:reservation,receipt_json:JSON.stringify(receipt)});
  };
  return {
    // This cached check is diagnostic only. Mutations are executed by the
    // kernel-lock holder, and parent keeps the shared lock FD until close.
    assertHeld:release.assertHeld,
    check:()=>release.command('check'),
    returned:raw=>archive('returned',{returned_at:new Date().toISOString(),response_sha256:createHash('sha256').update(raw).digest('hex'),
      ...(scope.workflow_key==='douyin_video_discovery'?{workflow_key:scope.workflow_key,activity:scope.activity,phase:scope.phase,raw_response:raw}:{})}),
    notStarted:async(error,command,args)=>{
      if(!executionDidNotStart(error,command,args))throw unresolved();
      return archive('not_started',{failed_at:new Date().toISOString(),failure:'native_pre_spawn_error'});
    },
    close:release,
  };
}

// A lost SSH stdout can be recovered only from the original, completed owner
// archive. This reader never reserves a turn or invokes OpenClaw.
export async function readReturnedCommanderTurn(scope,{home=homedir()}={}){
  const invalid=()=>{throw Error('COMMANDER_RETURNED_READBACK_INVALID');};
  if(scope?.workflow_key!=='douyin_video_discovery')invalid();
  const hash=raw=>createHash('sha256').update(raw).digest('hex');
  const session=workflowCommanderSession(scope);
  const dir=resolve(home,'.openclaw','leadgen-owner-turns');
  for(const path of [resolve(home,'.openclaw'),dir]){
    const stat=lstatSync(path);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o022)!==0)invalid();
  }
  const base=resolve(dir,session.split(':').at(-1)+'.pending.json');
  try{lstatSync(base);invalid();}catch(error){if(error.code!=='ENOENT')throw error;}
  const snapshot=path=>{
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const before=fstatSync(fd),seen=lstatSync(path);
      if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.nlink!==1||before.size>2*1024*1024||before.dev!==seen.dev||before.ino!==seen.ino)invalid();
      const raw=readFileSync(fd),after=fstatSync(fd);
      if(raw.length!==before.size||before.dev!==after.dev||before.ino!==after.ino||before.ctimeMs!==after.ctimeMs||before.size!==after.size)invalid();
      return raw;
    }finally{closeSync(fd);}
  };
  const prefix=base.split('/').at(-1)+'.';
  const names=readdirSync(dir).filter(name=>name.startsWith(prefix)&&/\.returned\.json$/.test(name));
  const matches=[];
  for(const name of names){
    const nonce=name.slice(prefix.length,-'.returned.json'.length);
    if(!/^[a-f0-9-]{36}$/.test(nonce))invalid();
    const returnedRaw=snapshot(resolve(dir,name));
    const originalRaw=snapshot(resolve(dir,name.replace(/\.returned\.json$/,'.returned.original.json')));
    const returned=JSON.parse(returnedRaw),original=JSON.parse(originalRaw);
    const keys=['session','run_id','binding_id','source_commit','task_id','transport_nonce'];
    if(returned.protocol!=='commander-owner-turn-v1'||returned.status!=='returned'
      ||original.protocol!=='commander-owner-turn-v1'||original.status!=='reserved'
      ||keys.some(key=>returned[key]!==original[key])||original.session!==session
      ||original.transport_nonce!==nonce||returned.original_sha256!==hash(originalRaw)
      ||!Number.isFinite(Date.parse(original.started_at))||!Number.isFinite(Date.parse(returned.returned_at))
      ||Date.parse(returned.returned_at)<Date.parse(original.started_at)
      ||typeof returned.raw_response!=='string'||returned.response_sha256!==hash(returned.raw_response))invalid();
    if(['run_id','binding_id','source_commit','task_id'].some(key=>returned[key] !== (scope[key]??null))
      ||returned.workflow_key!==scope.workflow_key||returned.activity!==scope.activity||returned.phase!==scope.phase)continue;
    const {parseCommanderResponse}=await import('./activity-commander.mjs');
    const decision=parseCommanderResponse(returned.raw_response);
    decision.model_receipt=commanderModelReceipt(returned.raw_response,scope);
    matches.push(decision);
  }
  if(matches.length!==1)invalid();
  return matches[0];
}
