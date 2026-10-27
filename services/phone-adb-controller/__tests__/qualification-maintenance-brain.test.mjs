import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-brain.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fake(change={}) {
 const f=authorityFixture(),calls=[];
 const request=async(path,body)=>{
  calls.push({path,body});if(change.request)return change.request(path,body,f,calls);
  if(path.endsWith('/heartbeat'))return {ok:true,lease_seconds:14400,lease_until:new Date(Date.now()+14400000).toISOString()};
  if(path==='/device-locks')return {success:true,locks:[{device_name:f.scope.serial,locked_by:f.originalTask.id,expires_at:new Date(Date.now()+120000).toISOString()}]};
  return structuredClone(path==='/tasks/'+f.maintenanceTask.id?f.maintenanceTask:f.originalTask);
 };
 return {...f,calls,request};
}
test('readback纯GET；没有隐藏heartbeat或claim',async()=>{
 assert.equal(typeof api?.readMaintenanceAuthority,'function');const f=fake();
 const out=await api.readMaintenanceAuthority(f.maintenanceTask.id,{request:f.request,renew:false});
 assert.equal(out.contract_sha256,f.originalTask.result.qualification_maintenance_delegation.contract_sha256);
 assert.ok(f.calls.every(x=>x.body===undefined));
});
test('显式preflight续两Task原lease，省略lease_seconds并有前后Task GET',async()=>{
 assert.equal(typeof api?.readMaintenanceAuthority,'function');const f=fake();await api.readMaintenanceAuthority(f.maintenanceTask.id,{request:f.request,renew:true});
 const h=f.calls.filter(x=>x.path.endsWith('/heartbeat'));assert.equal(h.length,2);
 assert.deepEqual(h.map(x=>x.body),[{claimer:f.maintenanceTask.claimed_by},{claimer:f.originalTask.claimed_by}]);
 for(const id of [f.maintenanceTask.id,f.originalTask.id])assert.ok(f.calls.filter(x=>x.path==='/tasks/'+id).length>=2);
 assert.ok(!f.calls.some(x=>x.path.includes('/claim')));
});
for(const kind of ['409','timeout','owner_drift','central_drift','no_delegation'])test(kind+'不沿旧authority继续',async()=>{
 assert.equal(typeof api?.readMaintenanceAuthority,'function');const f=fake();const normal=f.request;
 if(kind==='no_delegation')delete f.originalTask.result.qualification_maintenance_delegation;
 const request=async(path,body)=>{
  if(body&&kind==='409')throw Error('HTTP_409');if(body&&kind==='timeout')throw Error('timeout');
  const out=await normal(path,body);
  if(kind==='owner_drift'&&f.calls.some(x=>x.body)&&path==='/tasks/'+f.originalTask.id)out.claimed_by='other';
  if(kind==='central_drift'&&path==='/device-locks')out.locks[0].locked_by='other';
  return out;
 };
 await assert.rejects(api.readMaintenanceAuthority(f.maintenanceTask.id,{request,renew:true}));
 if(kind==='no_delegation'||kind==='central_drift')assert.ok(f.calls.every(x=>x.body===undefined));
});
