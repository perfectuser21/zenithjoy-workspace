import {readMaintenanceAuthority} from './qualification-maintenance-brain.mjs';
import {closeMaintenanceEpoch} from './qualification-maintenance-close.mjs';
// 外部入口只有正规Task ID；现场adapter不接受调用方传verified/scope/停止证明。
export async function runMaintenance({verb,taskId}) {
 let authority;
 try{authority=await readMaintenanceAuthority(taskId,{renew:false});}
 catch{return {status:'blocked',stage:'authority',code:'MAINTENANCE_AUTHORITY_UNPROVEN'};}
 try{
  const {createMaintenanceRuntime}=await import('./qualification-maintenance-runtime.mjs');
  const runtime=await createMaintenanceRuntime({authority,verb});
  if(verb==='preflight')return await runtime.preflight();
  if(verb==='readback')return await runtime.readback();
  if(verb==='close')return await closeMaintenanceEpoch(runtime.io);
  return {status:'blocked',stage:'command',code:'MAINTENANCE_COMMAND_INVALID'};
 }catch(error){
  const code=/^MAINTENANCE_[A-Z_]+$/.test(error?.message||'')?error.message:'MAINTENANCE_EXECUTION_UNKNOWN';
  return {status:'blocked',stage:'runtime',code};
 }
}
