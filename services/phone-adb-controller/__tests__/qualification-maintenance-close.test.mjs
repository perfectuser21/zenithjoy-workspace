import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
import {authorizeMaintenance} from '../qualification-maintenance-authority.mjs';
const api=await import('../qualification-maintenance-close.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture(change={}) {
 const calls=[],records=[],state={db:'db_not_committed',local:'original_owner',central:'original_owner'};
 const real=authorityFixture(),authority=authorizeMaintenance(real);
 const op=(name,fn)=>async(...args)=>{calls.push(name);return fn(...args);};
 const io={authority:op('authority',()=>structuredClone(authority)),candidate:op('candidate',()=>true),
  withGuard:op('guard',async fn=>fn()),effects:op('effects',()=>({status:'verified',effects_receipt_sha256:'e'.repeat(64)})),
  readDb:op('readDb',()=>({status:state.db})),restoreDb:op('restoreDb',()=>{state.db='db_committed';return {status:'db_committed'};}),
  readLocal:op('readLocal',()=>state.local),releaseLocal:op('releaseLocal',()=>{state.local='free';}),
  readCentral:op('readCentral',()=>state.central),releaseCentral:op('releaseCentral',()=>{state.central='free';}),
  append:op('append',record=>records.push(record)),...change};
 return {calls,records,state,io,real};
}
const need=()=>assert.equal(typeof api?.closeMaintenanceEpoch,'function','缺少维护独立epoch收口状态机');
test('完整新epoch：guard内fresh authority/effects后才PG，再本地/中央exact释放',async()=>{
 need();const f=fixture(),r=await api.closeMaintenanceEpoch(f.io);assert.equal(r.status,'closed');
 const c=f.calls;assert.ok(c.indexOf('guard')<c.lastIndexOf('authority'));assert.ok(c.indexOf('effects')<c.indexOf('restoreDb'));
 assert.ok(c.indexOf('restoreDb')<c.indexOf('releaseLocal'));assert.ok(c.indexOf('releaseLocal')<c.indexOf('releaseCentral'));
 assert.ok(f.records.some(x=>x.phase==='db_committed'));assert.equal(f.records.at(-1).phase,'closed');
});
for(const stage of ['authority','candidate','effects','restoreDb'])test(stage+'异常不得继续释放',async()=>{
 need();const f=fixture({[stage]:async()=>{throw Error('fixture unknown');}});const r=await api.closeMaintenanceEpoch(f.io);
 assert.equal(r.status,'blocked');assert.ok(!f.calls.includes('releaseLocal'));assert.ok(!f.calls.includes('releaseCentral'));
});
test('effects明确BLOCK不能被普通对象或阶段日志变成授权',async()=>{
 need();const f=fixture({effects:async()=>({status:'blocked'})});assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'blocked');
 assert.ok(!f.calls.includes('restoreDb'));assert.ok(!f.calls.includes('releaseLocal'));
});
test('未知COMMIT只读对账，本次不释放也不自动第二次PG',async()=>{
 need();const f=fixture({restoreDb:async()=>({status:'commit_unknown'})});assert.equal((await api.closeMaintenanceEpoch(f.io)).phase,'commit_unknown');
 assert.ok(!f.calls.includes('releaseLocal'));assert.ok(!f.calls.includes('releaseCentral'));
});
test('提交已证+local已free：崩溃重入只续中央收口，不重PG或local释放',async()=>{
 need();const f=fixture();f.state.db='db_committed';f.state.local='free';assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'closed');
 assert.ok(!f.calls.includes('restoreDb'));assert.ok(!f.calls.includes('releaseLocal'));assert.equal(f.calls.filter(x=>x==='releaseCentral').length,1);
});
test('本地释放transport未知，本次停；后续读回free才续中央',async()=>{
 need();const f=fixture();f.io.releaseLocal=async()=>{f.state.local='free';throw Error('lost reply');};
 assert.equal((await api.closeMaintenanceEpoch(f.io)).phase,'local_release_unknown');assert.ok(!f.calls.includes('releaseCentral'));
 assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'closed');assert.equal(f.calls.filter(x=>x==='restoreDb').length,1);
});
test('中央释放transport未知保留部分状态，后续free只记完成不重发',async()=>{
 need();const f=fixture();let count=0;f.io.releaseCentral=async()=>{count++;f.state.central='free';throw Error('lost reply');};
 assert.equal((await api.closeMaintenanceEpoch(f.io)).phase,'central_release_unknown');assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'closed');assert.equal(count,1);
});
for(const domain of ['local','central'])test(domain+'新owner漂移绝不清理',async()=>{
 need();const f=fixture();f.state.db='db_committed';f.state[domain]='foreign_owner';assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'blocked');
 assert.ok(!f.calls.includes('releaseLocal'));assert.ok(!f.calls.includes('releaseCentral'));
});
test('authority二次检查失败不能沿首次结果写PG',async()=>{
 need();const f=fixture();let n=0;f.io.authority=async()=>{if(++n===2)throw Error('lease drift');return {contract_sha256:'a'.repeat(64)};};
 assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'blocked');assert.ok(!f.calls.includes('restoreDb'));
});
test('同scope授权已交新actor时，旧维护epoch不得沿新Task权利继续',async()=>{
 need();const f=fixture();let n=0;
 f.io.authority=async()=>{
  if(++n>1){f.real.maintenanceTask.claimed_by='codex:new-maintenance-owner';f.real.originalTask.result.qualification_maintenance_delegation.actor='codex:new-maintenance-owner';}
  return authorizeMaintenance(f.real);
 };
 assert.equal((await api.closeMaintenanceEpoch(f.io)).status,'blocked');
 assert.ok(!f.calls.includes('restoreDb'));assert.ok(!f.calls.includes('releaseLocal'));assert.ok(!f.calls.includes('releaseCentral'));
});
