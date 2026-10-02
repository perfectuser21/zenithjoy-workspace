// 运行登记是副作用前的同步门禁；失败重发固定请求，不把ACK缺失当业务失败。
import { existsSync,readFileSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFrozen,digest } from './runtime-definition.mjs';
import { assertRuntimeHost } from './runtime-host.mjs';
import { atomic } from './runtime-outbox.mjs';
export function expectedPath(frozen,stepSpec){
 const result=[];
 for(const a of frozen.activities){
  const base={reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id};
  result.push({...base,required:true});
  for(const step of a.version.payload.steps||[]){
   const plan=(stepSpec.steps||[]).find(p=>(p.usage?.slot_key||p.activity)===a.reference.slot_key && (p.key===step.locator?.step_key||p.key?.endsWith(`.${step.locator?.step_key}`)));
   if(step.step_id && !plan)throw Error(`Step不在冻结计划: ${step.locator?.step_key}`);
   if(step.step_id)result.push({...base,step_id:step.step_id,required:step.contract?.optional!==true});
  }
 }
 return result;
}
function verifyBinding(binding,record){
 if(!binding?.id || binding.run_id!==record.run_id)throw Error('运行绑定ACK身份不匹配');
 for(const [key,value] of Object.entries(record.body))if(digest(binding[key]??binding.payload?.[key])!==digest(value))throw Error(`运行绑定ACK内容不匹配: ${key}`);
 return binding;
}
export function readBinding(dir,attempt,frozen=readFrozen(dir)){
 const record=JSON.parse(readFileSync(join(dir,'run-bindings',`${attempt}.request.json`),'utf8'));
 if(record.runtime_snapshot_sha256!==frozen.snapshot_sha256)throw Error('运行绑定冻结字节摘要不匹配');
 const ack=JSON.parse(readFileSync(join(dir,'run-bindings',`${attempt}.ack.json`),'utf8'));
 return verifyBinding(ack.binding,record);
}
export async function bindRun({dir,runId,brainUrl,request,ledgerPath=new URL('./ledger.mjs',import.meta.url).pathname}){
 const frozen=readFrozen(dir);if(!frozen.release?.id || !frozen.deployment?.observation_id)throw Error('运行缺少明确release及观测，不能登记');
 const host=assertRuntimeHost(frozen.release,frozen.deployment);
 const folder=join(dir,'run-bindings');mkdirSync(folder,{recursive:true,mode:0o700});const reservationPath=join(folder,'reservation.json');
 let reservation=existsSync(reservationPath)?JSON.parse(readFileSync(reservationPath,'utf8')):null;
 const ledger=(...args)=>JSON.parse(execFileSync(process.execPath,[ledgerPath,...args,'--run-dir',dir],{encoding:'utf8'}));
 if(!reservation || reservation.started){
  if(!existsSync(join(dir,'ledger.json')))ledger('init','--run-id',runId,'--hostkey',host);
  const next=ledger('next-attempt');reservation={attempt_key:next.attempt_id,skip_words:next.skip_words,started:false};atomic(reservationPath,reservation);
 }
 const attempt=reservation.attempt_key;if(!/^a[1-9][0-9]*$/.test(attempt))throw Error('运行attempt身份无效');
 const file=join(folder,`${attempt}.request.json`),ackPath=join(folder,`${attempt}.ack.json`),blocked=join(folder,`${attempt}.blocked.json`);
 if(existsSync(blocked))throw Error('运行绑定冲突blocked');
 const body={release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,workflow_id:frozen.workflow_version.payload.workflow_id,workflow_definition_version_id:frozen.workflow_version.id,snapshot_sha256:frozen.workflow_version.payload_sha256,runtime_snapshot_sha256:frozen.snapshot_sha256,source_kind:'external',external_origin:`zenithjoy:${host}`,attempt_key:attempt,actor:'runtime:phone-adb-controller',expected_path:expectedPath(frozen,JSON.parse(readFileSync(join(dir,'step-dod.json'),'utf8')))};
 const run_id=`${runId}__${attempt}`,endpoint=`${(brainUrl||'').replace(/\/$/,'')}/api/brain/runs/${encodeURIComponent(run_id)}/definition`;
 let record={run_id,endpoint,body,runtime_snapshot_sha256:frozen.snapshot_sha256};
 if(existsSync(file)){
  const old=JSON.parse(readFileSync(file,'utf8'));if(digest(old.body)!==digest(body)||old.runtime_snapshot_sha256!==frozen.snapshot_sha256)throw Error('运行绑定请求已固定，内容冲突');record=old;
 }else {if(!brainUrl)throw Error('BRAIN_URL缺失，不能登记运行');atomic(file,record);}
 let binding;
 if(existsSync(ackPath))binding=readBinding(dir,attempt,frozen);
 else {
  try{
   const posted=await request(record.endpoint,record.body);verifyBinding(posted?.binding,record);
   const readback=await request(record.endpoint);binding=verifyBinding(readback?.binding,record);
   if(binding.id!==posted.binding.id)throw Error('运行绑定回读ID不匹配');atomic(ackPath,{binding});
  }catch(err){if(err.status===409)atomic(blocked,{state:'blocked',http_status:409});throw err;}
 }
 atomic(reservationPath,{...reservation,started:true});return {binding,attempt_key:attempt,skip_words:reservation.skip_words};
}
