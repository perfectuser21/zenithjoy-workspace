import {readFileSync} from 'node:fs';
import {digest} from './runtime-definition.mjs';
import {evaluateOriginalExecutionDomain} from './qualification-maintenance-domain.mjs';
const deviceDigest=digest(readFileSync(new URL('./qualification-maintenance-device.py',import.meta.url)));
const need=(v,code)=>{if(!v)throw Error(code);};
export function verifyRestoredDevice(original,o,serial) {
 const r=original.recording?.native_audio_restored,fail='MAINTENANCE_DEVICE_UNPROVEN';
 need(o?.status==='observed'&&o.serial===serial&&o.sdk===36&&original.recording.capture_audio_sdk===36
  &&o.observer_sha256===deviceDigest&&r?.package_uid_verified===true&&r.state==='started'
  &&['state','uid','pid','piid'].every(k=>o.audio?.[k]===r[k])&&o.uid===r.uid
  &&o.processes?.capture_pids?.length===0&&o.processes_after?.capture_pids?.length===0
  &&o.processes?.unknown_capture_pids?.length===0&&o.processes_after?.unknown_capture_pids?.length===0
  &&o.projection?.state==='inactive'&&o.projection_after?.state==='inactive'
  &&Number.isFinite(o.observed_at_ms)&&o.completed_at_ms>=o.observed_at_ms
  &&o.completed_at_ms>Date.now()-15000&&o.completed_at_ms<Date.now()+2000,fail);
 for(const key of ['sdk','processes','projection','audio','package','foreground','owners','processes_after','projection_after'])
  need(/^[a-f0-9]{64}$/.test(o.normalized_text_sha256?.[key]||''),fail);
 return {status:'verified',domain:'original_capture_stopped_and_playback_restored',observation_sha256:digest(o)};
}
// 内部编排，只由公开runtime传入本人现场reader；CLI不能提交reader/proof JSON。
export async function collectMaintenanceEffects({scope,epoch,contract_sha256,candidate,readOriginal,readCommander,readMmv,readDevice,readDomain,readDatabaseIdentities,retainEvidence,retainReceipt}) {
 let stage='original',original,deviceVerdict,domain;
 const partial={epoch,contract_sha256,candidate,scope_sha256:digest(scope)};
 try {
  original=await readOriginal();partial.original_raw_manifest=original.raw_manifest;
  partial.database_identity_receipts=readDatabaseIdentities?await readDatabaseIdentities():[];
  partial.company_receipt=original.company_receipt;
  partial.original_identity={snapshot_sha256:original.frozen?.snapshot_sha256,binding_id:original.split?.binding_id,
   source_commit:original.frozen?.deployment?.source_commit,run_tag:original.frozen?.run_identity?.tag};
  stage='commander';partial.commander=await readCommander();
  stage='mmv_rpc';partial.commander.mmv_rpc=await readMmv();
  stage='device';partial.device=await readDevice();deviceVerdict=verifyRestoredDevice(original,partial.device,scope.serial);
  stage='domain';partial.observation=await readDomain(original);
  domain=evaluateOriginalExecutionDomain({original,observation:partial.observation,commander:partial.commander,epoch});partial.domain=domain;
  need(domain.status==='verified','MAINTENANCE_ORIGINAL_DOMAIN_UNPROVEN');
 }catch(error){
  const code=/^MAINTENANCE_[A-Z_]+$/.test(error?.message||'')?error.message:'MAINTENANCE_EFFECTS_OBSERVATION_UNKNOWN';
  const input=await retainEvidence({...partial,outcome:'blocked',stage,code});
  return {status:'blocked',stage,code,effects_input_sha256:input};
 }
 const input=await retainEvidence({...partial,outcome:'verified'});
 const receipt={contract_sha256,effects_input_sha256:input,domain,device:deviceVerdict,at_ms:Date.now()};
 await retainReceipt(receipt);
 return {status:'verified',effects_receipt_sha256:digest(receipt),...receipt};
}
