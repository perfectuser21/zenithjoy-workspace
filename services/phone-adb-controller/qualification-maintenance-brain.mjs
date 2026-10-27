import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {authorizeMaintenance} from './qualification-maintenance-authority.mjs';
const uuid=/^[a-f0-9-]{36}$/i;
const need=value=>{if(!value)throw Error('MAINTENANCE_BRAIN_AUTHORITY_UNKNOWN');};
export async function maintenanceBrainRequest(path,body) {
 need(/^\/(?:tasks\/[a-f0-9-]{36}(?:\/heartbeat)?|device-locks(?:\/release)?)$/i.test(path));
 const base=new URL(process.env.BRAIN_URL||'http://localhost:5221');
 need(base.protocol==='http:'&&['localhost','127.0.0.1','100.79.41.61'].includes(base.hostname)&&base.port==='5221');
 const file=join(homedir(),'.credentials','cecelia-internal.env'),stat=lstatSync(file);
 need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.uid===process.getuid());
 const matches=[...readFileSync(file,'utf8').matchAll(/^(?:export )?CECELIA_INTERNAL_TOKEN=(.+)$/gm)];need(matches.length===1);
 const token=matches[0][1].trim().replace(/^(['"])(.*)\1$/,'$2');need(token.length>0);
 const response=await fetch(new URL('/api/brain'+path,base),{method:body===undefined?'GET':'POST',
  headers:{'X-Internal-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
  redirect:'error',signal:AbortSignal.timeout(10000)});
 need(response.ok);return response.json();
}
export async function readMaintenanceAuthority(taskId,{request=maintenanceBrainRequest,renew=false}={}) {
 need(uuid.test(taskId||''));
 const read=async()=>{
  const maintenanceTask=await request('/tasks/'+taskId);
  const originalId=maintenanceTask?.result?.qualification_maintenance?.original_task_id;need(uuid.test(originalId||''));
  const originalTask=await request('/tasks/'+originalId);
  return authorizeMaintenance({maintenanceTask,originalTask});
 };
 const authority=await read();
 const lock=async()=>{
  const result=await request('/device-locks'),rows=result?.locks?.filter(x=>x.device_name===authority.scope.serial);
  need(result.success===true&&rows?.length===1);
  const row=rows[0];
  if(row.locked_by===null&&!renew)return 'free';
  need(row.locked_by===authority.original_task_id&&Date.parse(row.expires_at)>Date.now());return 'original_owner';
 };
 await lock();
 const heartbeat_receipts=[];
 if(renew) {
  for(const [id,claimer]of [[authority.maintenance_task_id,authority.actor],[authority.original_task_id,authority.original_actor]]) {
   // 委托已明确renew-original-lease；省略lease_seconds保现有策略，绝不claim。
   const result=await request('/tasks/'+id+'/heartbeat',{claimer});
   need(result.ok===true&&Date.parse(result.lease_until)>Date.now()&&Number.isSafeInteger(result.lease_seconds)&&result.lease_seconds>0);
   heartbeat_receipts.push({task_id:id,claimer,...result});
  }
 }
 const final=await read();need(final.contract_sha256===authority.contract_sha256&&final.actor===authority.actor&&final.original_actor===authority.original_actor);
 const central_lock_state=await lock();
 return {...final,central_lock_state,heartbeat_receipts,lease_evidence:'current_renewal_only_not_prior_continuity'};
}
