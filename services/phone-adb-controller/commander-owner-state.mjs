import {readFileSync,writeFileSync,mkdirSync,lstatSync,openSync,closeSync,fstatSync,unlinkSync,renameSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {executionDidNotStart} from './leadgen-client.mjs';
import {acquireOwnerLock} from './commander-owner-lock.mjs';
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
  const {file,session}=ownerPending(scope,home),nonce=randomUUID();let fd;
  const release=await acquireOwnerLock(file);
  try{fd=openSync(file,'wx',0o600);}catch(error){await release();if(error.code==='EEXIST')throw unresolved();throw error;}
  const stat=fstatSync(fd),record={protocol:'commander-owner-turn-v1',session,run_id:scope.run_id,binding_id:scope.binding_id,source_commit:scope.source_commit,task_id:scope.task_id??null,transport_nonce:nonce,status:'reserved',started_at:new Date().toISOString()};
  writeFileSync(fd,JSON.stringify(record));
  let closed=false;
  const archive=(status,details)=>{
    release.assertHeld();
    const current=lstatSync(file);
    if(current.isSymbolicLink()||current.dev!==stat.dev||current.ino!==stat.ino||readFileSync(file,'utf8')!==JSON.stringify(record))throw unresolved();
    const receipt={...record,status,...details};
    const tmp=file+'.'+nonce+'.tmp',target=file+'.'+nonce+'.'+status+'.json';
    writeFileSync(tmp,JSON.stringify(receipt),{flag:'wx',mode:0o600});renameSync(tmp,target);
    unlinkSync(file);
  };
  return {
    assertHeld:release.assertHeld,
    returned:raw=>archive('returned',{returned_at:new Date().toISOString(),response_sha256:createHash('sha256').update(raw).digest('hex')}),
    notStarted:(error,command,args)=>{
      if(!executionDidNotStart(error,command,args))throw unresolved();
      archive('not_started',{failed_at:new Date().toISOString(),failure:'native_pre_spawn_error'});
    },
    close:async()=>{if(!closed){closed=true;closeSync(fd);await release();}},
  };
}

