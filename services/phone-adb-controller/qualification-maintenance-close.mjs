// 仅编排受信adapter；公开CLI不提供adapter/proof注入，真实适配器必须从现场读取。
export async function closeMaintenanceEpoch(io) {
 let phase='authority_preflight',authority;
 const need=value=>{if(!value)throw Error('MAINTENANCE_CLOSE_UNPROVEN');};
 const record=async(phase,extra={})=>io.append({phase,at_ms:Date.now(),contract_sha256:authority?.contract_sha256,...extra});
 const current=async()=>{
  const fresh=await io.authority();need(fresh&&fresh.contract_sha256===authority.contract_sha256);
  return fresh;
 };
 try {
  authority=await io.authority();need(/^[a-f0-9]{64}$/.test(authority?.contract_sha256||''));
  phase='candidate_preflight';need(await io.candidate(authority));
  return await io.withGuard(async()=>{
   try {
    phase='guard_authority';await current();
    const local=await io.readLocal(),central=await io.readCentral();
    need(['original_owner','free'].includes(local)&&['original_owner','free'].includes(central));
    phase='db_readback';const prior=await io.readDb();
    need(['db_not_committed','db_committed'].includes(prior?.status));
    // 无已提交审计时任何提前free都不属于本状态机，不能补写或伪补资源身份。
    if(prior.status==='db_not_committed')need(local==='original_owner'&&central==='original_owner');
    if(local==='original_owner')need(central==='original_owner');
    phase='effects_preflight';const effects=await io.effects();
    need(effects?.status==='verified'&&/^[a-f0-9]{64}$/.test(effects.effects_receipt_sha256||''));
    await current();
    if(prior.status==='db_not_committed') {
     phase='db_intent';await record(phase,{effects_receipt_sha256:effects.effects_receipt_sha256});
     phase='commit_unknown';const committed=await io.restoreDb(effects);
     if(committed?.status==='commit_unknown'){await record(phase);return {status:'blocked',phase};}
     need(committed?.status==='db_committed');
    }
    phase='db_committed';await record(phase);
    await current();
    // 必须fresh再次CAS；期间owner变更不沿最初读回继续执行。
    const localNow=await io.readLocal(),centralNow=await io.readCentral();
    need(['original_owner','free'].includes(localNow)&&['original_owner','free'].includes(centralNow));
    if(localNow==='original_owner') {
     need(centralNow==='original_owner');phase='local_release_intent';await record(phase);
     phase='local_release_unknown';await io.releaseLocal();
     need(await io.readLocal()==='free');
    }
    phase='local_released';await record(phase);await current();
    need(await io.readLocal()==='free');
    const centralLast=await io.readCentral();need(['original_owner','free'].includes(centralLast));
    if(centralLast==='original_owner') {
     phase='central_release_intent';await record(phase);
     phase='central_release_unknown';await io.releaseCentral();
     need(await io.readCentral()==='free');
    }
    phase='closed';await record(phase);return {status:'closed',phase};
   }catch(error){try{await record(phase,{outcome:'blocked'});}catch{}return {status:'blocked',phase};}
  });
 }catch(error){try{await record(phase,{outcome:'blocked'});}catch{}return {status:'blocked',phase};}
}
