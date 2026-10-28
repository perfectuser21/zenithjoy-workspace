import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,canonical} from './runtime-definition.mjs';
import {sameMaintenanceAuthorityEpoch} from './qualification-maintenance-authority.mjs';
import {readMaintenanceAuthority,maintenanceBrainRequest} from './qualification-maintenance-brain.mjs';
import {verifyMaintenanceCandidate} from './qualification-maintenance-candidate.mjs';
import {collectMaintenanceCandidateRoot} from './qualification-maintenance-bytes.mjs';
import {candidateRuntimeRoot,collectRemoteMaintenanceCandidate,openMaintenanceGuard,decodeOriginalPacket,readRemoteMaintenanceOriginal,readRemoteMaintenanceLocal} from './qualification-maintenance-transport.mjs';
import {originalExecutionScope} from './qualification-maintenance-domain.mjs';
import {collectMaintenanceEffects} from './qualification-maintenance-effects.mjs';
export {verifyRestoredDevice} from './qualification-maintenance-effects.mjs';
import {readCommanderClosure} from './qualification-maintenance-commander.mjs';
import {readMmvRpcClosure} from './qualification-maintenance-mmv.mjs';
import {readHistoricalCompanySnapshot,readPendingClaimOutcome,restorePendingClaim,readCommittedMaintenanceAudit} from './qualification-maintenance-pg.mjs';
import {readMaintenanceJournal,appendMaintenanceJournal} from './qualification-maintenance-journal.mjs';
import {appendEffectReceipt,readHistoricalEffectProof,observeSealedMaintenanceEpoch} from './qualification-maintenance-proof.mjs';
import {closeMaintenanceEpoch} from './qualification-maintenance-close.mjs';
import {openMaintenanceDatabase} from './qualification-maintenance-database.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const need=(v,code='MAINTENANCE_RUNTIME_UNPROVEN')=>{if(!v)throw Error(code);};
export async function closeRuntimeMaintenance(authority,{sealed,io}) {
 const result=await observeSealedMaintenanceEpoch(authority,sealed);
 return result.status==='not_sealed'?closeMaintenanceEpoch(io):result;
}
export async function createMaintenanceRuntime({authority:initial,verb}) {
 const scope=initial?.scope;
 need(['preflight','close','readback'].includes(verb)&&initial?.contract_sha256===digest(scope));
 need(here===candidateRuntimeRoot('mmv',scope.maintenance_source.commit),'MAINTENANCE_RUNTIME_NOT_INSTALLED');
 let peer,original,snapshot,databasePromise,lastAuthority=initial,lastEvidence,candidateProof,databaseReceipts=[];
 const db=async()=>{
  const handle=await(databasePromise??=openMaintenanceDatabase(initial));databaseReceipts=handle.identity_receipts;return handle.pool;
 };
 const closeDatabase=async()=>{
  if(databasePromise){const handle=databasePromise;databasePromise=undefined;await(await handle).close();}
 };
 const identities=()=>structuredClone(databaseReceipts);
 const authority=async()=>{
  let a=await readMaintenanceAuthority(initial.maintenance_task_id,{renew:false});
  need(sameMaintenanceAuthorityEpoch(initial,a));
  // 已释放中央资源的重入只观察收口，不重新claim/取得锁或假造旧lease连续性。
  if(verb!=='readback'&&a.central_lock_state==='original_owner')a=await readMaintenanceAuthority(initial.maintenance_task_id,{renew:true});
  need(sameMaintenanceAuthorityEpoch(initial,a));lastAuthority=a;return a;
 };
 const candidate=async()=>candidateProof=await verifyMaintenanceCandidate(initial,{request:maintenanceBrainRequest,collect:target=>target==='mmv'
  ?collectMaintenanceCandidateRoot(here):collectRemoteMaintenanceCandidate(scope.maintenance_source.commit)});
 const currentOriginal=async()=>{
  original=peer?decodeOriginalPacket(await peer.request({op:'original',scope})):await readRemoteMaintenanceOriginal(scope);
  return original;
 };
 const baseline=async()=>{
  if(!original)await currentOriginal();
  snapshot=await readHistoricalCompanySnapshot(await db(),{authorization:initial,company_receipt:original.company_receipt});return snapshot;
 };
 const dbInput=async()=>({authorization:initial,expected_snapshot:snapshot||await baseline()});
 const readCentral=async()=>{
  const response=await maintenanceBrainRequest('/device-locks');
  const rows=response?.locks?.filter(r=>r.device_name===scope.serial);need(response.success===true&&rows?.length===1);
  if(rows[0].locked_by===null)return 'free';
  return rows[0].locked_by===scope.central_owner&&Date.parse(rows[0].expires_at)>Date.now()?'original_owner':'foreign_owner';
 };
 const append=r=>appendMaintenanceJournal(initial,{at_ms:Date.now(),contract_sha256:initial.contract_sha256,...r});
 const retainEvidence=evidence=>{
  const bytes=Buffer.from(canonical(evidence));need(bytes.length<=2*1024*1024);
  const hash=digest(bytes),total=Math.ceil(bytes.length/20000);
  for(let index=0;index<total;index++)append({phase:'effects_input_chunk',effects_input_sha256:hash,index,total,encoding:'base64',data:bytes.subarray(index*20000,(index+1)*20000).toString('base64')});
  return hash;
 };
 const effects=async()=>{
  need(peer);await currentOriginal();
  const epoch={maintenance_task_id:initial.maintenance_task_id,intent_id:scope.intent_id,candidate_sha:scope.maintenance_source.commit,
   guard_pid:peer.identity.pid,guard_start_identity:peer.identity.start_identity,
   guard_script_path:candidateRuntimeRoot('xian-m4',scope.maintenance_source.commit)+'/qualification-maintenance-host.py',
   guard_script_sha256:peer.identity.script_sha256};
  lastEvidence=await collectMaintenanceEffects({scope,epoch,contract_sha256:initial.contract_sha256,candidate:candidateProof,
   readOriginal:currentOriginal,readCommander:()=>readCommanderClosure(scope),readMmv:()=>readMmvRpcClosure(scope),
   readDevice:()=>peer.request({op:'device'}),
   readDomain:o=>peer.request({op:'domain',scope:originalExecutionScope(o,peer.identity.uid),epoch}),retainEvidence,
   readDatabaseIdentities:identities,
   retainReceipt:receipt=>appendEffectReceipt(initial,receipt)});
  return lastEvidence;
 };
 const withGuard=async fn=>{
  need(!peer);peer=await openMaintenanceGuard(scope);
  try{
   need(peer.identity.script_sha256===digest(readFileSync(join(here,'qualification-maintenance-host.py'))));
   return await fn();
  }finally{try{await peer.close();}finally{peer=undefined;await closeDatabase();}}
 };
 const io={authority,candidate,withGuard,effects,
  readDb:async()=>{
   const r=await readPendingClaimOutcome(await db(),await dbInput());
   if(r.status==='db_committed')readHistoricalEffectProof(initial,readMaintenanceJournal(initial),r.effects_receipt_sha256);
   return r;
  },
  restoreDb:async e=>{
   readHistoricalEffectProof(initial,readMaintenanceJournal(initial),e.effects_receipt_sha256);
   const r=await restorePendingClaim(await db(),{...await dbInput(),effects_receipt_sha256:e.effects_receipt_sha256});
   append({phase:'database_identity_observation',identity_receipts:identities()});return r;
  },
  readLocal:async()=>{need(peer);const r=await peer.request({op:'status'});need(r.status==='guard_held');return r.local_owner;},
  releaseLocal:async()=>{need(peer);const r=await peer.request({op:'release_exact'});need(r.status==='released');},
  readCentral,releaseCentral:async()=>{
   const r=await maintenanceBrainRequest('/device-locks/release',{device_name:scope.serial,locked_by:scope.central_owner});
   need(r.success===true&&r.released?.device_name===scope.serial&&r.released.locked_by===null);
  },append,readJournal:()=>readMaintenanceJournal(initial)};
 return {io,close:async()=>{
  try{return await closeRuntimeMaintenance(initial,{io,sealed:{
   readAuthority:()=>readMaintenanceAuthority(initial.maintenance_task_id,{renew:false}),
   readJournal:()=>readMaintenanceJournal(initial),readLocal:()=>readRemoteMaintenanceLocal(scope),readCentral,
   readAudit:async company_receipt=>{
    const expected_snapshot=await readHistoricalCompanySnapshot(await db(),{authorization:initial,company_receipt});
    return readCommittedMaintenanceAudit(await db(),{authorization:initial,expected_snapshot});
   }
  }});}finally{await closeDatabase();}
 },preflight:async()=>{
  await authority();await candidate();return withGuard(async()=>{
   await authority();await currentOriginal();await baseline();const e=await effects();if(e.status!=='verified')return e;
   return {status:'preflight_verified',contract_sha256:initial.contract_sha256,effects_receipt_sha256:e.effects_receipt_sha256,
    heartbeat_receipts:lastAuthority.heartbeat_receipts,lease_evidence:lastAuthority.lease_evidence,database_identity_receipts:identities()};
  });
 },readback:async()=>{
  try{
   await authority();await candidate();await currentOriginal();const outcome=await io.readDb();
   const local=await readRemoteMaintenanceLocal(scope),central=await readCentral(),journal=readMaintenanceJournal(initial);
   return {status:'readback_verified',contract_sha256:initial.contract_sha256,db:outcome,local,central,
    journal_sha256:digest(journal),journal_phases:journal.map(r=>r.phase),database_identity_receipts:identities(),os_full_stop:false};
  }finally{await closeDatabase();}
 }};
}
