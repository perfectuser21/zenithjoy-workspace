import {readFileSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
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
import {readHistoricalCompanySnapshot,readPendingClaimOutcome,restorePendingClaim} from './qualification-maintenance-pg.mjs';
import {readMaintenanceJournal,appendMaintenanceJournal} from './qualification-maintenance-journal.mjs';
import {appendEffectReceipt,readHistoricalEffectProof} from './qualification-maintenance-proof.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const need=(v,code='MAINTENANCE_RUNTIME_UNPROVEN')=>{if(!v)throw Error(code);};
function productionPool() {
 // 不继承开发会话PGHOST/PGDATABASE；与原正式RPC使用同一私有凭据源。
 const file=join(homedir(),'.credentials/zenithjoy-db.env'),st=lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o600);
 const config={};
 for(const line of readFileSync(file,'utf8').split('\n')){
  const m=line.match(/^(?:export )?(DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=(.*)$/);
  if(m){need(!Object.hasOwn(config,m[1]));config[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
 }
 let connection;
 if(config.DATABASE_URL){const url=new URL(config.DATABASE_URL);need(['postgres:','postgresql:'].includes(url.protocol)&&url.pathname==='/zenithjoy');connection={connectionString:config.DATABASE_URL};}
 else{need(config.PGHOST&&config.PGUSER&&config.PGPASSWORD&&(!config.PGDATABASE||config.PGDATABASE==='zenithjoy'));connection={host:config.PGHOST,user:config.PGUSER,password:config.PGPASSWORD,port:Number(config.PGPORT||5432),database:'zenithjoy'};}
 let Pool;
 for(const base of [join(homedir(),'.openclaw/leadgen-scripts/package.json'),join(homedir(),'.openclaw/package.json'),import.meta.url]){
  try{Pool=createRequire(base)('pg').Pool;break;}catch{}
 }
 need(Pool);return new Pool({...connection,max:2,connectionTimeoutMillis:5000,query_timeout:10000,application_name:'qualification-maintenance'});
}
export async function createMaintenanceRuntime({authority:initial,verb}) {
 const scope=initial?.scope;
 need(['preflight','close','readback'].includes(verb)&&initial?.contract_sha256===digest(scope));
 need(here===candidateRuntimeRoot('mmv',scope.maintenance_source.commit),'MAINTENANCE_RUNTIME_NOT_INSTALLED');
 let peer,original,snapshot,pool,lastAuthority=initial,lastEvidence,candidateProof;
 const db=()=>pool??=productionPool();
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
  snapshot=await readHistoricalCompanySnapshot(db(),{authorization:initial,company_receipt:original.company_receipt});return snapshot;
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
   retainReceipt:receipt=>appendEffectReceipt(initial,receipt)});
  return lastEvidence;
 };
 const withGuard=async fn=>{
  need(!peer);peer=await openMaintenanceGuard(scope);
  try{
   need(peer.identity.script_sha256===digest(readFileSync(join(here,'qualification-maintenance-host.py'))));
   return await fn();
  }finally{try{await peer.close();}finally{peer=undefined;if(pool){await pool.end();pool=undefined;}}}
 };
 const io={authority,candidate,withGuard,effects,
  readDb:async()=>{
   const r=await readPendingClaimOutcome(db(),await dbInput());
   if(r.status==='db_committed')readHistoricalEffectProof(initial,readMaintenanceJournal(initial),r.effects_receipt_sha256);
   return r;
  },
  restoreDb:async e=>{
   readHistoricalEffectProof(initial,readMaintenanceJournal(initial),e.effects_receipt_sha256);
   return restorePendingClaim(db(),{...await dbInput(),effects_receipt_sha256:e.effects_receipt_sha256});
  },
  readLocal:async()=>{need(peer);const r=await peer.request({op:'status'});need(r.status==='guard_held');return r.local_owner;},
  releaseLocal:async()=>{need(peer);const r=await peer.request({op:'release_exact'});need(r.status==='released');},
  readCentral,releaseCentral:async()=>{
   const r=await maintenanceBrainRequest('/device-locks/release',{device_name:scope.serial,locked_by:scope.central_owner});
   need(r.success===true&&r.released?.device_name===scope.serial&&r.released.locked_by===null);
  },append,readJournal:()=>readMaintenanceJournal(initial)};
 return {io,preflight:async()=>{
  await authority();await candidate();return withGuard(async()=>{
   await authority();await currentOriginal();await baseline();const e=await effects();if(e.status!=='verified')return e;
   return {status:'preflight_verified',contract_sha256:initial.contract_sha256,effects_receipt_sha256:e.effects_receipt_sha256,
    heartbeat_receipts:lastAuthority.heartbeat_receipts,lease_evidence:lastAuthority.lease_evidence};
  });
 },readback:async()=>{
  try{
   await authority();await candidate();await currentOriginal();const outcome=await io.readDb();
   const local=await readRemoteMaintenanceLocal(scope),central=await readCentral(),journal=readMaintenanceJournal(initial);
   return {status:'readback_verified',contract_sha256:initial.contract_sha256,db:outcome,local,central,
    journal_sha256:digest(journal),journal_phases:journal.map(r=>r.phase),os_full_stop:false};
  }finally{if(pool){await pool.end();pool=undefined;}}
 }};
}
