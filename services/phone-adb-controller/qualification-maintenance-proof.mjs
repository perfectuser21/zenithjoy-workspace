import {digest,canonical} from './runtime-definition.mjs';
import {readMaintenanceJournal,appendMaintenanceJournal} from './qualification-maintenance-journal.mjs';
const need=v=>{if(!v)throw Error('MAINTENANCE_EFFECTS_PROOF_UNPROVEN');};
export function readHistoricalEffectProof(a,journal,hash) {
 const s=a.scope;need(a.contract_sha256===digest(s)&&Array.isArray(journal)&&/^[a-f0-9]{64}$/.test(hash||''));
 const matches=journal.filter(r=>r.phase==='effects_receipt'&&r.effects_receipt_sha256===hash);need(matches.length===1);
 const receipt=matches[0].receipt;
 need(receipt&&digest(receipt)===hash&&receipt.contract_sha256===a.contract_sha256
  &&Number.isSafeInteger(receipt.at_ms)&&receipt.at_ms>0&&receipt.domain?.status==='verified'&&receipt.device?.status==='verified');
 const chunks=journal.filter(r=>r.phase==='effects_input_chunk'&&r.effects_input_sha256===receipt.effects_input_sha256);
 need(chunks.length>0&&chunks.length<=128&&chunks.every(r=>r.total===chunks.length&&r.encoding==='base64')
  &&new Set(chunks.map(r=>r.index)).size===chunks.length);
 const raw=Buffer.concat(chunks.sort((x,y)=>x.index-y.index).map((r,index)=>{
  need(r.index===index&&typeof r.data==='string'&&r.data.length<=30000);
  const b=Buffer.from(r.data,'base64');need(b.toString('base64')===r.data);return b;
 }));
 need(raw.length<=2*1024*1024&&digest(raw)===receipt.effects_input_sha256);
 let input;try{input=JSON.parse(raw);}catch{need(false);}
 need(raw.toString()===canonical(input)&&input.outcome==='verified'&&input.contract_sha256===a.contract_sha256
  &&input.scope_sha256===a.contract_sha256&&input.epoch?.maintenance_task_id===a.maintenance_task_id
  &&input.epoch.intent_id===s.intent_id&&input.epoch.candidate_sha===s.maintenance_source.commit
  &&input.candidate?.status==='verified'&&input.candidate.source_commit===s.maintenance_source.commit
  &&input.candidate.environment===s.maintenance_source.environment);
 const identity=input.original_identity,c=input.company_receipt;
 need(identity?.snapshot_sha256===s.snapshot_sha256&&identity.binding_id===s.binding_id
  &&identity.source_commit===s.consumer_source&&identity.run_tag===s.run_tag
  &&c?.company_id===s.company_id&&c.tenant_id===s.tenant_id&&c.version===s.config_version
  &&c.policy_id===s.policy_id&&c.run_id===s.run_tag&&Array.isArray(c.product_ids)&&c.product_ids.length>0
  &&digest(input.domain)===digest(receipt.domain)&&receipt.domain.observation_sha256===digest(input.observation)
  &&receipt.domain.commander_sha256===digest(input.commander)&&receipt.device.observation_sha256===digest(input.device));
 return {status:'historical_effects_proof_verified',fresh:false,os_full_stop:false,receipt,input};
}
export function appendEffectReceipt(a,receipt,{home}={}) {
 const record={phase:'effects_receipt',at_ms:Date.now(),contract_sha256:a.contract_sha256,effects_receipt_sha256:digest(receipt),receipt};
 readHistoricalEffectProof(a,[...readMaintenanceJournal(a,{home}),record],record.effects_receipt_sha256);
 return appendMaintenanceJournal(a,record,{home});
}
