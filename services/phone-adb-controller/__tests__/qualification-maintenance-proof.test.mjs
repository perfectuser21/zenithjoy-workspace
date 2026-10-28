import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest,canonical} from '../runtime-definition.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
import {authorizeMaintenance} from '../qualification-maintenance-authority.mjs';
import {appendMaintenanceJournal,readMaintenanceJournal} from '../qualification-maintenance-journal.mjs';
const api=await import('../qualification-maintenance-proof.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture(t){
 const home=realpathSync(mkdtempSync(join(tmpdir(),'maintenance-proof-')));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const f=authorityFixture();f.maintenanceTask.claimed_at='2026-10-28T01:00:00Z';f.originalTask.claimed_at='2026-10-28T00:00:00Z';const a=authorizeMaintenance(f),s=a.scope;
 // 只验证持久化/引用完整性；外部effects为结构fixture，不称真机已止写。
 const observation={fixture:'domain'},commander={fixture:'owner'},device={fixture:'device'},domain={status:'verified',observation_sha256:digest(observation),commander_sha256:digest(commander)},deviceVerdict={status:'verified',observation_sha256:digest(device)};
 const input={outcome:'verified',contract_sha256:a.contract_sha256,scope_sha256:a.contract_sha256,
 epoch:{maintenance_task_id:a.maintenance_task_id,intent_id:s.intent_id,candidate_sha:s.maintenance_source.commit},
 candidate:{status:'verified',source_commit:s.maintenance_source.commit,environment:s.maintenance_source.environment},
 original_identity:{snapshot_sha256:s.snapshot_sha256,binding_id:s.binding_id,source_commit:s.consumer_source,run_tag:s.run_tag},
 company_receipt:{company_id:s.company_id,tenant_id:s.tenant_id,version:s.config_version,policy_id:s.policy_id,run_id:s.run_tag,product_ids:['product']},observation,commander,device,domain};
 const raw=Buffer.from(canonical(input)),inputHash=digest(raw),receipt={contract_sha256:a.contract_sha256,effects_input_sha256:inputHash,domain,device:deviceVerdict,at_ms:Date.now()};
 appendMaintenanceJournal(a,{phase:'effects_input_chunk',at_ms:Date.now(),contract_sha256:a.contract_sha256,effects_input_sha256:inputHash,index:0,total:1,encoding:'base64',data:raw.toString('base64')},{home});
 return {home,a,input,receipt,hash:digest(receipt)};
}
test('完整receipt含原at_ms真实FS持久后可准确重算audit引用hash，历史证明不当fresh',t=>{
 assert.equal(typeof api?.appendEffectReceipt,'function');const f=fixture(t);api.appendEffectReceipt(f.a,f.receipt,{home:f.home});
 const out=api.readHistoricalEffectProof(f.a,readMaintenanceJournal(f.a,{home:f.home}),f.hash);
 assert.equal(out.status,'historical_effects_proof_verified');assert.equal(out.fresh,false);assert.equal(out.receipt.at_ms,f.receipt.at_ms);assert.equal(digest(out.receipt),f.hash);
});
for(const [name,mutate]of [['receipt丢失',r=>r.filter(x=>x.phase!=='effects_receipt')],['chunk丢失',r=>r.filter(x=>x.phase!=='effects_input_chunk')],['chunk重复',r=>[...r,r[0]]],['receipt时间漂移',r=>{r.find(x=>x.phase==='effects_receipt').receipt.at_ms++;return r;}],['chunk字节漂移',r=>{r[0].data=Buffer.from('{}').toString('base64');return r;}]])test(name+'拒绝冒认审计hash对应完整proof',t=>{
 assert.equal(typeof api?.appendEffectReceipt,'function');const f=fixture(t);api.appendEffectReceipt(f.a,f.receipt,{home:f.home});
 assert.throws(()=>api.readHistoricalEffectProof(f.a,mutate(readMaintenanceJournal(f.a,{home:f.home})),f.hash),/MAINTENANCE_EFFECTS_PROOF_UNPROVEN/);
});
